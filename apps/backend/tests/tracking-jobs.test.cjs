const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

function load(file, dependencies = {}, globals = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, console, ...globals,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      throw new Error(`Unexpected import ${name}`)
    },
  }, { filename })
  return exports
}

const plain = (value) => JSON.parse(JSON.stringify(value))
const tick = async (times = 5) => { for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve)) }

function clock(start = Date.UTC(2026, 8, 27, 6, 0, 0)) {
  let now = start
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  return { Date: FakeDate, advance(ms) { now += ms }, iso(offset = 0) { return new Date(now + offset).toISOString() } }
}

/** tracking_state in memory, with switches to make reads or writes fail. */
function fakeDb() {
  return { state: new Map(), writes: [], reads: 0, failReads: false, failWrites: false }
}

function loadJobs(time) {
  return load("lib/tracking/jobs.ts", {
    "./db": {
      trackingDb: (container) => container.db,
      async getState(db, key) {
        db.reads += 1
        if (db.failReads) throw new Error("db down")
        return db.state.has(key) ? plain(db.state.get(key)) : null
      },
      async setState(db, key, value) {
        if (db.failWrites) throw new Error("db down")
        db.writes.push([key, plain(value)])
        db.state.set(key, plain(value))
      },
    },
  }, { Date: time.Date })
}

test("runTrackingJob writes last_run_at first, then last_ok_at", async () => {
  const time = clock()
  const jobs = loadJobs(time)
  const container = { db: fakeDb() }
  const seen = []
  await jobs.runTrackingJob(container, "outbox", async (c) => {
    seen.push(c)
    assert.deepEqual(container.db.writes.map(([key, value]) => [key, value.last_ok_at]), [["job:outbox", null]], "last_run_at is written before the run")
    time.advance(1500)
  })
  assert.deepEqual(seen, [container])
  const [first, second] = container.db.writes
  assert.equal(first[1].last_run_at, "2026-09-27T06:00:00.000Z")
  assert.deepEqual(second[1], { last_run_at: "2026-09-27T06:00:00.000Z", last_ok_at: "2026-09-27T06:00:01.500Z", last_error: null, last_error_at: null })
})

test("runTrackingJob records a failure as last_error (300 chars), keeps last_ok_at and never throws", async () => {
  const time = clock()
  const jobs = loadJobs(time)
  const container = { db: fakeDb() }
  container.db.state.set("job:rollup", { last_run_at: "2026-09-27T05:59:00.000Z", last_ok_at: "2026-09-27T05:59:01.000Z", last_error: null, last_error_at: null })
  await jobs.runTrackingJob(container, "rollup", async () => { throw new Error(`boom ${"x".repeat(400)}`) })
  const saved = container.db.state.get("job:rollup")
  assert.equal(saved.last_run_at, "2026-09-27T06:00:00.000Z")
  assert.equal(saved.last_ok_at, "2026-09-27T05:59:01.000Z")
  assert.equal(saved.last_error.length, 300)
  assert.match(saved.last_error, /^boom x/)
  assert.equal(saved.last_error_at, "2026-09-27T06:00:00.000Z")
  // Broken state storage never makes the job throw, and the job still runs.
  const broken = { db: { ...fakeDb(), failReads: true, failWrites: true } }
  let ran = false
  await assert.doesNotReject(jobs.runTrackingJob(broken, "reconcile", async () => { ran = true }))
  assert.equal(ran, true)
  await assert.doesNotReject(jobs.runTrackingJob(broken, "reconcile", async () => { throw "not an Error" }))
  await assert.doesNotReject(jobs.runTrackingJob({ get db() { throw new Error("no connection") } }, "catalog", async () => {}))
})

test("runTrackingJob skips a run that overlaps one still running in this process", async () => {
  const jobs = loadJobs(clock())
  const container = { db: fakeDb() }
  let release
  let runs = 0
  const first = jobs.runTrackingJob(container, "outbox", async () => {
    runs += 1
    await new Promise((resolve) => { release = resolve })
  })
  await tick()
  await jobs.runTrackingJob(container, "outbox", async () => { runs += 1 })
  assert.equal(runs, 1, "the overlapping run was skipped")
  // Another job name is not blocked.
  await jobs.runTrackingJob(container, "rollup", async () => { runs += 10 })
  assert.equal(runs, 11)
  release()
  await first
  await jobs.runTrackingJob(container, "outbox", async () => { runs += 1 })
  assert.equal(runs, 12, "runs again once the first finished")
})

test("kickStaleJobs runs only registered stale jobs, in the background, at most once a minute", async () => {
  const time = clock()
  const jobs = loadJobs(time)
  const container = { db: fakeDb() }
  const runs = []
  const register = (name, staleAfterMs) => jobs.registerTrackingJob(name, { staleAfterMs, run: async () => { runs.push(name) } })
  container.db.state.set("job:outbox", { last_run_at: time.iso(-10 * 60_000) })
  container.db.state.set("job:rollup", { last_run_at: time.iso(-60_000) })
  container.db.state.set("job:catalog", { last_run_at: time.iso(-24 * 3_600_000) })
  register("outbox", 180_000)
  register("rollup", 180_000)
  register("reconcile", 900_000) // never ran: stale
  // catalog is stale but not registered in this process.

  assert.equal(jobs.kickStaleJobs(container), undefined)
  assert.deepEqual(runs, [], "fire-and-forget: nothing ran synchronously")
  await tick()
  assert.deepEqual(runs.sort(), ["outbox", "reconcile"])

  // Make outbox look stale again in the database; within a minute it is not kicked again.
  runs.length = 0
  container.db.state.set("job:outbox", { last_run_at: time.iso(-10 * 60_000) })
  time.advance(31_000) // past the 30 s state cache, inside the 1 minute kick limit
  jobs.kickStaleJobs(container)
  await tick()
  assert.deepEqual(runs, [])
  time.advance(30_000)
  container.db.state.set("job:outbox", { last_run_at: time.iso(-10 * 60_000) })
  jobs.kickStaleJobs(container)
  await tick()
  assert.deepEqual(runs, ["outbox"], "kicked again after a minute")
})

test("kickStaleJobs caches job states for 30 s and never throws", async () => {
  const time = clock()
  const jobs = loadJobs(time)
  const container = { db: fakeDb() }
  jobs.kickStaleJobs(container)
  await tick()
  assert.equal(container.db.reads, 0, "nothing registered: no reads")
  jobs.registerTrackingJob("outbox", { staleAfterMs: 180_000, run: async () => {} })
  container.db.state.set("job:outbox", { last_run_at: time.iso() })
  jobs.kickStaleJobs(container)
  await tick()
  const reads = container.db.reads
  assert.equal(reads, 4, "one read per job state")
  time.advance(10_000)
  jobs.kickStaleJobs(container)
  await tick()
  assert.equal(container.db.reads, reads, "cached")
  time.advance(21_000)
  jobs.kickStaleJobs(container)
  await tick()
  assert.equal(container.db.reads, reads * 2)
  const broken = { db: { ...fakeDb(), failReads: true } }
  time.advance(31_000)
  assert.doesNotThrow(() => jobs.kickStaleJobs(broken))
  assert.doesNotThrow(() => jobs.kickStaleJobs({ get db() { throw new Error("no connection") } }))
  await tick()
})

test("jobStates returns every job, null when it never ran", async () => {
  const jobs = loadJobs(clock())
  const container = { db: fakeDb() }
  container.db.state.set("job:outbox", { last_run_at: "2026-09-27T06:00:00.000Z", last_ok_at: null, last_error: null, last_error_at: null })
  assert.deepEqual(plain(await jobs.jobStates(container)), {
    outbox: { last_run_at: "2026-09-27T06:00:00.000Z", last_ok_at: null, last_error: null, last_error_at: null },
    rollup: null, reconcile: null, catalog: null,
  })
})
