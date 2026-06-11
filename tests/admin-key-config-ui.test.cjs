const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
const admin = fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8");
const keyModal = html.match(/<div class="modal-backdrop" id="adminKeyModal"[\s\S]*?<div id="toast"/)?.[0] || "";

assert.ok(keyModal.includes('id="adminImageModelInput"'));
assert.ok(keyModal.includes('id="adminVideoModelInput"'));
assert.ok(keyModal.includes("图片模型"));
assert.ok(keyModal.includes("视频模型"));

assert.ok(admin.includes("adminImageModelInput: document.getElementById(\"adminImageModelInput\")"));
assert.ok(admin.includes("adminVideoModelInput: document.getElementById(\"adminVideoModelInput\")"));
assert.ok(admin.includes("imageModel: els.adminImageModelInput.value.trim()"));
assert.ok(admin.includes("videoModel: els.adminVideoModelInput.value.trim()"));

console.log("admin key config UI tests passed");
