const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

assert.ok(app.includes("GENERATED_ASSET_IMPORT_KEY_PREFIX"));
assert.ok(app.includes("async function syncRecoverableGeneratedAssets"));
assert.ok(app.includes('apiFetch("/generated-assets?limit=50")'));
assert.ok(app.includes("libraryItemFromGeneratedAsset"));
assert.ok(app.includes("remoteAssetId"));
assert.ok(app.includes("已同步 ${importedCount} 张生成图到素材区"));

console.log("generated assets UI tests passed");
