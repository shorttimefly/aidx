const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

const suiteNav = html.match(/<button class="nav-item disabled"[\s\S]*?data-view="suite"[\s\S]*?<\/button>/)?.[0] || "";
const generateNav = html.match(/<button class="nav-item active"[\s\S]*?data-view="generate"[\s\S]*?<\/button>/)?.[0] || "";
const singleView = html.match(/<section id="view-generate"[\s\S]*?<\/section>/)?.[0] || "";

assert.ok(suiteNav.includes("disabled"));
assert.ok(suiteNav.includes('aria-disabled="true"'));
assert.ok(generateNav.includes("单图"));
assert.ok(singleView.includes('class="view active"'));
assert.ok(!html.includes('id="promptInput"'));
assert.ok(!html.includes('id="saveTemplateBtn"'));
assert.ok(html.includes('id="platformSelect"'));
assert.ok(html.includes('id="categorySelect"'));
assert.ok(html.includes('id="scenarioSelect"'));
assert.ok(html.includes('id="templateSelectionHint"'));
assert.ok(!html.includes('id="templateFilter"'));
assert.ok(!html.includes('id="templateGrid"'));

assert.ok(app.includes("selectedPlatformId"));
assert.ok(app.includes("selectedCategoryId"));
assert.ok(app.includes("selectedScenarioId"));
assert.ok(app.includes("singleSelectionMemoryByLeaf"));
assert.ok(app.includes("const SINGLE_SELECTION_MEMORY_KEY"));
assert.ok(app.includes("requestBody.templateId = templateId"));
assert.ok(app.includes("body: sanitizeRequestPayload(requestBody)"));
assert.ok(!app.includes("PROMPT_CONFIG_DEFAULTS_URL"));

console.log("single template UI tests passed");
