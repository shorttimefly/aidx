const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const admin = fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

assert.ok(
  adminHtml.includes('data-admin-view="suite-factory"') && adminHtml.includes("套图提示词工厂"),
  "suite prompt factory should be visible as an independent B-side navigation item"
);
assert.ok(admin.includes('{ id: "suiteFactory", label: "套图提示词工厂" }'));
assert.ok(admin.includes("suitePromptAssets: []"));
assert.ok(admin.includes("suiteFactoryReferenceImages"));
assert.ok(admin.includes("function renderSuitePromptFactoryConfig"));
assert.ok(admin.includes('id="suiteFactoryProductImageInput"'));
assert.ok(admin.includes('id="suiteFactoryReferenceImagesInput"'));
assert.ok(admin.includes('id="generateSuiteFactoryAssetBtn"'));
assert.ok(admin.includes('id="suitePromptFactoryAssetList"'));
assert.ok(admin.includes('id="suitePromptFactoryAssetDetail"'));
assert.ok(admin.includes("createSuitePromptAsset"));
assert.ok(admin.includes("publishSuitePromptAsset"));
assert.ok(admin.includes('factoryScope: "suite"'));
assert.ok(admin.includes('data-suite-factory-action="publish"'));
assert.ok(admin.includes("发布整套图到 C 端"));
assert.ok(admin.includes("套图图位提示词"));
assert.ok(admin.includes("Prompt-only 图"));
assert.ok(admin.includes("参考辅助图"));
assert.ok(admin.includes("generateSuiteShotReferenceImage"));
assert.ok(admin.includes("data-suite-shot-action=\"reference-image\""));
assert.ok(admin.includes("promptOnlyImageUrl"));
assert.ok(admin.includes("referenceImageUrl"));

for (const selector of [
  ".suite-prompt-factory-shell",
  ".suite-factory-shot-list",
  ".suite-factory-shot-card",
  ".suite-factory-shot-images",
  ".suite-factory-shot-image",
  ".suite-factory-reference-strip"
]) {
  assert.ok(styles.includes(selector), `${selector} should be styled`);
}

console.log("admin suite prompt factory UI tests passed");
