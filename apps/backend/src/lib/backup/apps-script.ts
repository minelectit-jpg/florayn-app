/**
 * The Google Apps Script the owner pastes into script.google.com (BACKUP.md).
 * It runs inside the owner's Google account, hourly: it PULLS the encrypted
 * backups from the server into a Drive folder, checks each file's SHA-256,
 * acknowledges it, and thins out old copies. The server never holds a Google
 * credential, so a hacked server cannot delete what is in Drive. Removed
 * copies go to Drive's trash (kept 30 days) rather than being destroyed.
 *
 * Kept as plain ES5-style JavaScript so it runs on Apps Script as written;
 * tests/backup.test.cjs runs it in a sandbox with fake Google services.
 */
export function appsScriptSource(server: string): string {
  const base = server.replace(/\/+$/, "")
  return `/**
 * Florayn backups -> Google Drive.
 * Copies the encrypted hourly backups from the shop server into the Drive
 * folder "Florayn Backups", every hour. Only the owner's private key opens
 * the files.
 *
 * Setup, once:
 *  1. Project Settings (gear icon) > Script Properties > Add script property:
 *     FLORAYN_BACKUP_TOKEN = the token from Admin > Backups.
 *  2. Choose the function "setup" at the top and press Run. Allow the access
 *     Google asks for (Drive and external requests).
 */
var SERVER = ${JSON.stringify(base)};
var FOLDER_NAME = "Florayn Backups";
var HOUR = 3600 * 1000;
var DAY = 24 * HOUR;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "pullBackups") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("pullBackups").timeBased().everyHours(1).create();
  pullBackups();
}

function token_() {
  var t = PropertiesService.getScriptProperties().getProperty("FLORAYN_BACKUP_TOKEN");
  if (!t) throw new Error("Add the FLORAYN_BACKUP_TOKEN script property first (Project Settings).");
  return String(t).trim();
}

function folder_() {
  var found = DriveApp.getFoldersByName(FOLDER_NAME);
  return found.hasNext() ? found.next() : DriveApp.createFolder(FOLDER_NAME);
}

function call_(method, path, payload) {
  var options = { method: method, headers: { Authorization: "Bearer " + token_() }, muteHttpExceptions: true };
  if (payload) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  var response = UrlFetchApp.fetch(SERVER + path, options);
  if (response.getResponseCode() !== 200) throw new Error(method + " " + path + " answered " + response.getResponseCode());
  return response;
}

function hex_(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

function pullBackups() {
  var folder = folder_();
  var have = {};
  var existing = folder.getFiles();
  while (existing.hasNext()) have[existing.next().getName()] = true;
  var list = JSON.parse(call_("get", "/backup-pull/manifest").getContentText()).files || [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (have[item.name]) {
      if (!item.pulled) call_("post", "/backup-pull/ack", { name: item.name, sha256: item.sha256 });
      continue;
    }
    var blob = call_("get", "/backup-pull/files/" + encodeURIComponent(item.name)).getBlob();
    var digest = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, blob.getBytes()));
    if (digest !== item.sha256) throw new Error("Checksum mismatch for " + item.name + "; not saved.");
    folder.createFile(blob.setName(item.name));
    call_("post", "/backup-pull/ack", { name: item.name, sha256: digest });
  }
  prune_(folder, new Date());
}

/** "florayn-db-20261010T0705Z.dump.age" -> { kind, time } or null. */
function parse_(name) {
  var m = /^florayn-(db|env)-(\\d{4})(\\d{2})(\\d{2})(?:T(\\d{2})(\\d{2})Z)?\\.(dump|json)\\.age$/.exec(name);
  if (!m) return null;
  return { kind: m[1], time: Date.UTC(+m[2], +m[3] - 1, +m[4], +(m[5] || 0), +(m[6] || 0)) };
}

/**
 * Which backup names to keep: every database backup from the last 48 hours,
 * then the newest one of each day for 30 days and of each month for a year;
 * settings snapshots: the newest of each day for 30 days and of each month
 * for a year. Everything else is moved to the Drive trash.
 */
function keepNames_(names, now) {
  var keep = {};
  var newestOf = {};
  var parsed = names.map(function (n) { return { name: n, info: parse_(n) }; }).filter(function (x) { return x.info; });
  parsed.sort(function (a, b) { return b.info.time - a.info.time; });
  parsed.forEach(function (x) {
    var age = now.getTime() - x.info.time;
    var d = new Date(x.info.time);
    var day = x.info.kind + ":d:" + d.toISOString().slice(0, 10);
    var month = x.info.kind + ":m:" + d.toISOString().slice(0, 7);
    if (x.info.kind === "db" && age <= 2 * DAY) keep[x.name] = true;
    if (age <= 30 * DAY && !newestOf[day]) { newestOf[day] = x.name; keep[x.name] = true; }
    if (age <= 366 * DAY && !newestOf[month]) { newestOf[month] = x.name; keep[x.name] = true; }
  });
  return keep;
}

function prune_(folder, now) {
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  var keep = keepNames_(files.map(function (f) { return f.getName(); }), now);
  files.forEach(function (f) {
    if (parse_(f.getName()) && !keep[f.getName()]) f.setTrashed(true);
  });
}
`
}
