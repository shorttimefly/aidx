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
assert.ok(!html.includes('value="custom"'));
assert.ok(html.includes('<option value="aplus" selected>Amazon A+</option>'));

assert.ok(app.includes("selectedTemplateId"));
assert.ok(app.includes('const DEFAULT_SINGLE_TEMPLATE_CATEGORY = "aplus";'));
assert.ok(app.includes('const DEFAULT_SINGLE_TEMPLATE_ID = "aplus-brand-story";'));
assert.ok(app.includes("requestBody.templateId = templateId"));
assert.ok(app.includes("body: sanitizeRequestPayload(requestBody)"));
assert.ok(!app.includes("PROMPT_CONFIG_DEFAULTS_URL"));
assert.ok(!app.includes("平台合规白底主图，【产品名称/品类】"));

console.log("single template UI tests passed");
