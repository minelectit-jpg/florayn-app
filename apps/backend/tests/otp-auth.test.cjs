const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")

// --- module loader (mirrors the other backend regression tests) ---------------
const OTP_SECRET = "test-otp-secret"
const jwtCalls = []
const workflowRuns = []

function load(file, dependencies = {}) {
  const filename = path.join(__dirname, "../src", file)
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      console,
      Buffer,
      Date,
      process,
      require: (name) => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name]
        throw new Error(`Unexpected import ${name}`)
      },
    },
    { filename }
  )
  return exports
}

const utils = {
  Modules: { AUTH: "auth", CUSTOMER: "customer" },
  ContainerRegistrationKeys: { CONFIG_MODULE: "configModule" },
  generateJwtToken: (payload, cfg) => {
    jwtCalls.push({ payload, cfg })
    return "signed.jwt.token"
  },
}

const coreFlows = {
  // The real workflow creates the customer AND links the identity; emulate the
  // link so verifyOtp can read customer_id back off the identity afterwards.
  createCustomerAccountWorkflow: (container) => ({
    run: async ({ input }) => {
      workflowRuns.push(input)
      const auth = container.resolve("auth")
      await auth.updateAuthIdentities([
        { id: input.authIdentityId, app_metadata: { customer_id: "cus_new" } },
      ])
      return { result: { id: "cus_new" } }
    },
  }),
}

const otp = load("lib/otp.ts", {
  "node:crypto": crypto,
  "@medusajs/framework/utils": utils,
  "@medusajs/medusa/core-flows": coreFlows,
  "../modules/auth-otp": { AUTH_OTP_MODULE: "auth_otp" },
  "./send-email": { sendEmail: async () => ({ ok: true }), emailConfigured: () => true },
})

function activeCodeRow(email, code) {
  return {
    id: "otp_1",
    email,
    code_hash: crypto.createHmac("sha256", OTP_SECRET).update(code).digest("hex"),
    expires_at: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
    consumed_at: null,
    created_at: new Date(),
  }
}

// Container whose auth module FAILS LOUDLY if a password is ever written.
function makeContainer({ identity = null, customers = [], code, email }) {
  const state = { identity }
  const spies = { updateProvider: 0, register: 0, updateAuthIdentities: 0, createCustomers: 0 }
  const rows = [activeCodeRow(email, code)]

  const authModule = {
    listAuthIdentities: async () => (state.identity ? [state.identity] : []),
    retrieveAuthIdentity: async () => state.identity,
    register: async () => {
      spies.register++
      state.identity = {
        id: "authid_new",
        app_metadata: null,
        provider_identities: [{ provider: "emailpass", user_metadata: {} }],
      }
      return { success: true, authIdentity: { id: "authid_new" } }
    },
    updateProvider: async () => {
      spies.updateProvider++
      throw new Error("updateProvider must NEVER be called in the passwordless flow")
    },
    updateAuthIdentities: async (arr) => {
      spies.updateAuthIdentities++
      const patch = arr[0]
      if (state.identity && state.identity.id === patch.id) {
        state.identity.app_metadata = { ...(state.identity.app_metadata ?? {}), ...patch.app_metadata }
      }
      return arr
    },
  }
  const customerModule = {
    listCustomers: async () => customers,
    createCustomers: async (arr) => {
      spies.createCustomers++
      return arr.map((c) => ({ id: "cus_created", ...c }))
    },
  }
  const configModule = {
    projectConfig: { http: { jwtSecret: "jwt-secret", jwtExpiresIn: "1d" } },
  }
  const otpModule = {
    listOtpCodes: async () => rows,
    updateOtpCodes: async () => {},
    createOtpCodes: async () => {},
  }

  const container = {
    resolve: (key) => {
      if (key === "auth") return authModule
      if (key === "customer") return customerModule
      if (key === "configModule") return configModule
      if (key === "auth_otp") return otpModule
      throw new Error("unexpected resolve " + key)
    },
  }
  return { container, spies, state }
}

test.beforeEach(() => {
  process.env.OTP_SECRET = OTP_SECRET
  jwtCalls.length = 0
  workflowRuns.length = 0
})

test("shared admin+customer identity: mints a customer token WITHOUT touching the password", async () => {
  const email = "owner@florayn.com"
  const identity = {
    id: "authid_admin",
    app_metadata: { user_id: "usr_1", customer_id: "cus_1" },
    provider_identities: [{ provider: "emailpass", user_metadata: {} }],
  }
  const { container, spies } = makeContainer({ identity, code: "123456", email })

  const result = await otp.verifyOtp(container, email, "123456")

  assert.equal(result.ok, true)
  assert.equal(result.token, "signed.jwt.token")
  assert.equal(result.customerId, "cus_1")
  // The regression that locked the owner out of admin: NO password mutation.
  assert.equal(spies.updateProvider, 0, "must never reset an emailpass password")
  assert.equal(spies.register, 0, "an existing identity is never re-registered")
  assert.equal(spies.updateAuthIdentities, 0, "an already-linked identity is left untouched")
  // A real customer session token, and the admin's user_id is preserved.
  assert.equal(jwtCalls.length, 1)
  assert.equal(jwtCalls[0].payload.actor_type, "customer")
  assert.equal(jwtCalls[0].payload.actor_id, "cus_1")
  assert.equal(jwtCalls[0].payload.app_metadata.user_id, "usr_1")
  assert.equal(jwtCalls[0].payload.app_metadata.customer_id, "cus_1")
})

test("imported customer with an unlinked identity: links it, still no password write", async () => {
  const email = "imported@florayn.com"
  const identity = {
    id: "authid_2",
    app_metadata: null,
    provider_identities: [{ provider: "emailpass", user_metadata: {} }],
  }
  const { container, spies } = makeContainer({
    identity,
    customers: [{ id: "cus_imported" }],
    code: "222333",
    email,
  })

  const result = await otp.verifyOtp(container, email, "222333")

  assert.equal(result.ok, true)
  assert.equal(result.customerId, "cus_imported")
  assert.equal(spies.updateProvider, 0)
  assert.equal(spies.register, 0)
  assert.equal(spies.updateAuthIdentities, 1, "links the imported customer once")
  assert.equal(jwtCalls[0].payload.actor_id, "cus_imported")
})

test("brand-new signup: registers an identity + creates a customer, no password returned", async () => {
  const email = "newbie@florayn.com"
  const { container, spies } = makeContainer({ identity: null, customers: [], code: "999888", email })

  const result = await otp.verifyOtp(container, email, "999888")

  assert.equal(result.ok, true)
  assert.equal(result.customerId, "cus_new")
  assert.equal(result.token, "signed.jwt.token")
  assert.ok(!("password" in result), "the flow never hands back a password")
  assert.equal(spies.updateProvider, 0)
  assert.equal(spies.register, 1, "one identity created for a new email")
  assert.equal(workflowRuns.length, 1)
})

test("a wrong code never reaches the auth module", async () => {
  const email = "owner@florayn.com"
  const identity = {
    id: "authid_admin",
    app_metadata: { user_id: "usr_1", customer_id: "cus_1" },
    provider_identities: [{ provider: "emailpass", user_metadata: {} }],
  }
  const { container, spies } = makeContainer({ identity, code: "123456", email })

  const result = await otp.verifyOtp(container, email, "000000")

  assert.equal(result.ok, false)
  assert.equal(spies.updateProvider, 0)
  assert.equal(spies.register, 0)
  assert.equal(jwtCalls.length, 0)
})

test("normalizeEmail lowercases/trims and rejects junk", () => {
  assert.equal(otp.normalizeEmail("  Owner@Florayn.COM "), "owner@florayn.com")
  assert.equal(otp.normalizeEmail("not-an-email"), null)
  assert.equal(otp.normalizeEmail(123), null)
})
