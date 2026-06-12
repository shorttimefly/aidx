const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
const admin = fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const index = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const modelView = html.match(/<section class="admin-view active" data-admin-view-panel="model">[\s\S]*?<section class="admin-view" data-admin-view-panel="feedback">/)?.[0] || "";
const keyModal = html.match(/<div class="modal-backdrop" id="adminKeyModal"[\s\S]*?<div id="toast"/)?.[0] || "";

assert.ok(modelView.includes("模型供应商"));
assert.ok(modelView.includes('id="addModelProviderBtn"'));
assert.ok(modelView.includes('id="modelProviderList"'));
assert.ok(!modelView.includes("模型默认配置"));
assert.ok(!modelView.includes('id="saveModelConfigBtn"'));
assert.ok(!modelView.includes('id="defaultEndpointInput"'));
assert.ok(!modelView.includes('id="defaultModelInput"'));
assert.ok(!modelView.includes('id="usageNoteInput"'));
assert.ok(html.includes('id="providerConfigModal"'));
assert.ok(html.includes('id="providerBaseUrlInput"'));
assert.ok(html.includes('id="providerTokenInput"'));
assert.ok(html.includes('id="providerModelNameInput"'));
assert.ok(html.includes('id="providerModelKindInput"'));
assert.ok(html.includes("图片模型"));
assert.ok(html.includes("视频模型"));
assert.ok(keyModal.includes("选择图片模型"));
assert.ok(keyModal.includes("选择视频模型"));
assert.ok(keyModal.includes('id="adminAllowedImageModelList"'));
assert.ok(keyModal.includes('id="adminAllowedVideoModelList"'));

assert.ok(admin.includes("modelProviders: []"));
assert.ok(admin.includes("selectedProviderIndex"));
assert.ok(admin.includes("function renderModelProviders"));
assert.ok(admin.includes("renderProviderTable"));
assert.ok(admin.includes("function collectModelProviders"));
assert.ok(admin.includes("function openProviderConfigModal"));
assert.ok(admin.includes("function saveProviderFromModal"));
assert.ok(admin.includes("defaultImageModelId"));
assert.ok(admin.includes("defaultVideoModelId"));
assert.ok(admin.includes("modelKind"));
assert.ok(admin.includes("modelKindText"));
assert.ok(admin.includes('data-provider-action="edit-provider"'));
assert.ok(admin.includes('data-provider-action="set-default-model"'));
assert.ok(admin.includes("allowedImageModelIds"));
assert.ok(admin.includes("allowedVideoModelIds"));
assert.ok(admin.includes("aokapi_gemini"));
assert.ok(admin.includes("muskapis_image"));
assert.ok(admin.includes("openai_image"));

assert.ok(styles.includes(".admin-provider-list"));
assert.ok(styles.includes(".admin-provider-table"));
assert.ok(styles.includes(".admin-provider-card"));
assert.ok(styles.includes(".admin-model-row"));
assert.ok(styles.includes(".admin-allowed-model-list"));

assert.ok(!index.includes('id="imageModelSelect"'));
assert.ok(!index.includes('id="providerModelSelect"'));

console.log("admin model provider UI tests passed");
