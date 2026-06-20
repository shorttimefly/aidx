const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
const admin = fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8");
const keyModal = html.match(/<div class="modal-backdrop" id="adminKeyModal"[\s\S]*?<div id="toast"/)?.[0] || "";

assert.ok(keyModal.includes('id="adminAllowedImageModelList"'));
assert.ok(keyModal.includes('id="adminAllowedVideoModelList"'));
assert.ok(keyModal.includes("选择图片模型"));
assert.ok(keyModal.includes("选择视频模型"));
assert.ok(keyModal.includes("图片模型"));
assert.ok(keyModal.includes("视频模型"));
assert.ok(keyModal.includes("恢复默认模型"));

for (const removedId of [
  "adminApiKeyInput",
  "adminImageEndpointInput",
  "adminImageModelInput",
  "adminVideoModelInput",
  "adminVideoEndpointPrimaryInput",
  "adminVideoEndpointSecondaryInput"
]) {
  assert.ok(!keyModal.includes(`id="${removedId}"`), `${removedId} should not be in user model modal`);
}

assert.ok(admin.includes("allowedImageModelIds: selectedAllowedModelIds(\"image\")"));
assert.ok(admin.includes("allowedVideoModelIds: selectedAllowedModelIds(\"video\")"));
assert.ok(admin.includes("defaultImageModelId"));
assert.ok(admin.includes("defaultVideoModelId"));
assert.ok(admin.includes("function renderAllowedModelList"));
assert.ok(admin.includes("function providerModelOptions"));
assert.ok(admin.includes("function userAllowedModelSummary"));
assert.ok(!admin.includes("imageModel: els.adminImageModelInput.value.trim()"));
assert.ok(!admin.includes("videoModel: els.adminVideoModelInput.value.trim()"));
assert.ok(!admin.includes("const apiKey = els.adminApiKeyInput"));
assert.ok(!admin.includes("clearImageApiKey"));
assert.ok(!admin.includes("clearVideoApiKey"));

console.log("admin key config UI tests passed");
