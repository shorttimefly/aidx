const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const admin = fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(__dirname, "..", "admin.html"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

assert.ok(
  adminHtml.includes('data-admin-view="factory"') && adminHtml.includes("图片提示词工厂"),
  "image prompt factory should be visible as a top-level B-side navigation item"
);
assert.ok(admin.includes('{ id: "factory", label: "图片提示词工厂" }'));
assert.ok(admin.includes("promptAssets: []"));
assert.ok(admin.includes("factoryProductImage"));
assert.ok(admin.includes("factoryReferenceImages"));
assert.ok(admin.includes("function renderPromptFactoryConfig"));
assert.ok(admin.includes('id="factoryProductImageInput"'));
assert.ok(admin.includes('id="factoryReferenceImagesInput"'));
assert.ok(admin.includes('id="generateFactoryAssetsBtn"'));
assert.ok(admin.includes('id="promptFactoryAssetList"'));
assert.ok(admin.includes('id="promptFactoryAssetDetail"'));
assert.ok(admin.includes('data-factory-action="publish"'));
assert.ok(admin.includes('data-factory-action="retry"'));
assert.ok(admin.includes('data-factory-action="save"'));
assert.ok(admin.includes('data-factory-action="delete"'));
assert.ok(admin.includes("loadPromptAssets"));
assert.ok(admin.includes("createPromptAssets"));
assert.ok(admin.includes("generatePromptAsset"));
assert.ok(admin.includes("publishPromptAsset"));
assert.ok(admin.includes("deletePromptAsset"));
assert.ok(admin.includes("factoryGenerationJobs"));
assert.ok(admin.includes("factorySimilarityScoreText"));
assert.ok(admin.includes("相似度"));
assert.ok(admin.includes("function startFactoryGenerationJob"));
assert.ok(admin.includes("function renderFactoryGenerationProgress"));
assert.ok(admin.includes("function renderFactoryValidationStatus"));
assert.ok(admin.includes("function openFactoryImagePreview"));
assert.ok(admin.includes("function downloadFactoryImage"));
assert.ok(admin.includes("function isLikelyTruncatedFactoryImage"));
assert.ok(admin.includes("function isFactoryStageStale"));
assert.ok(admin.includes("thresholdMs = 300000"));
assert.ok(admin.includes("可能卡住"));
assert.ok(admin.includes("factoryImagePreviewModal"));
assert.ok(admin.includes("data-factory-preview-image"));
assert.ok(admin.includes("data-factory-download-image"));
assert.ok(admin.includes("下载图片"));
assert.ok(admin.includes("图片数据不完整"));
assert.ok(admin.includes("正在生成参考辅助图"));
assert.ok(admin.includes("正在生成 Prompt-only 验证图"));
assert.ok(admin.includes("等待验证图生成"));
assert.ok(admin.includes("分析参考图风格"));
assert.ok(admin.includes("生成 Image A"));
assert.ok(admin.includes("生成 Image B"));
assert.ok(admin.includes("对比验证图"));

for (const selector of [
  ".prompt-factory-shell",
  ".prompt-factory-create",
  ".prompt-factory-library",
  ".prompt-factory-asset-list",
  ".prompt-factory-preview-grid",
  ".prompt-factory-publish-row",
  ".prompt-factory-progress",
  ".prompt-factory-step",
  ".prompt-factory-validation.generating",
  ".prompt-factory-validation-state",
  ".prompt-factory-preview-button",
  ".prompt-factory-image-actions",
  ".prompt-factory-download-button",
  ".prompt-factory-preview-frame",
  ".prompt-factory-score",
  ".prompt-factory-delete-button",
  ".factory-image-preview-modal",
  ".prompt-factory-asset-row.generating",
  "@keyframes factoryPulse"
]) {
  assert.ok(styles.includes(selector), `${selector} should be styled`);
}

assert.ok(styles.includes("max-height: 420px"), "validation images should not be trapped in a square crop");

for (const fn of [
  "function bindPromptFactoryEvents",
  "function fileToFactoryImage",
  "function readFactoryImageFiles",
  "function runFactoryBatchGeneration",
  "function handlePromptFactoryClick",
  "function handlePromptFactoryChange"
]) {
  assert.ok(admin.includes(fn), `${fn} should exist`);
}

assert.ok(admin.includes('els.promptConfigEditor.addEventListener("click", handlePromptFactoryClick)'));
assert.ok(admin.includes('els.promptConfigEditor.addEventListener("change", handlePromptFactoryChange)'));
assert.ok(admin.includes("await generatePromptAsset(asset.id"));

console.log("admin prompt factory UI tests passed");
