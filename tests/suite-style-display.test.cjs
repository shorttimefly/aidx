const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const styleSelect = html.match(/<select id="suiteStyleInput">[\s\S]*?<\/select>/)?.[0] || "";
const renderSuiteSelectOptions =
  app.match(/function renderSuiteSelectOptions\(\) \{[\s\S]*?\n\}/)?.[0] || "";
const suiteContext = app.match(/function suiteContext\(\) \{[\s\S]*?referenceName:[\s\S]*?\n  \};\n\}/)?.[0] || "";

assert.ok(styleSelect.includes("清爽质感"));
assert.ok(styleSelect.includes("现代冷调"));
assert.ok(styleSelect.includes("自然生活"));
assert.ok(styleSelect.includes("活动吸睛"));
assert.ok(styleSelect.includes("纯净白底"));
assert.ok(!styleSelect.includes("高级简洁"));
assert.ok(!styleSelect.includes("科技冷感"));
assert.ok(!styleSelect.includes("温暖生活"));
assert.ok(!styleSelect.includes("强促销视觉"));
assert.ok(!styleSelect.includes("极简白底"));

assert.ok(renderSuiteSelectOptions.includes("suiteStyleDisplayLabel(style, index)"));
assert.ok(!renderSuiteSelectOptions.includes("style.displayLabel || style.label"));
assert.ok(app.includes("function suiteStyleDisplayLabel"));
assert.ok(app.includes("SUITE_STYLE_DISPLAY_LABELS[style?.id]"));
assert.ok(suiteContext.includes("selectedSuiteVisualStyle()?.label"));
assert.ok(!suiteContext.includes("els.suiteStyleInput.options"));

console.log("suite style display tests passed");
