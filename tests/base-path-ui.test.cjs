const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

for (const file of ["app.js", "admin.js", "admin-login.js"]) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  assert.ok(source.includes('const APP_BASE_PATH = detectAppBasePath();'), `${file} detects the runtime base path`);
  assert.ok(source.includes('const marker = "/aidx-runtime";'), `${file} recognizes the AIDX runtime prefix`);
  assert.ok(source.includes("function appRoute(path)"), `${file} builds prefixed local routes`);
}

assert.ok(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").includes("fetch(appRoute(`/api${path}`)"));
assert.ok(fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8").includes("fetch(appRoute(`/api/admin${path}`)"));
assert.ok(fs.readFileSync(path.join(__dirname, "..", "admin-login.js"), "utf8").includes("fetch(appRoute(`/api/admin${path}`)"));

console.log("base path UI tests passed");
