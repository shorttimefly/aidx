const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.join(__dirname, "..", "server.py"), "utf8");

for (const route of [
  'path == "/api/admin/prompt-assets" and method == "GET"',
  'path == "/api/admin/prompt-assets" and method == "POST"',
  'path.startswith("/api/admin/prompt-assets/") and method == "PATCH"',
  'path.startswith("/api/admin/prompt-assets/") and method == "DELETE"',
  'path.endswith("/generate")',
  'path.endswith("/publish")'
]) {
  assert.ok(server.includes(route), `${route} should be routed`);
}

for (const handler of [
  "def handle_admin_prompt_assets",
  "def handle_admin_create_prompt_assets",
  "def handle_admin_update_prompt_asset",
  "def handle_admin_delete_prompt_asset",
  "def handle_admin_generate_prompt_asset",
  "def handle_admin_publish_prompt_asset"
]) {
  assert.ok(server.includes(handler), `${handler} should exist`);
}

console.log("admin prompt asset API route tests passed");
