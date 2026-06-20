const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const handleRefine =
  app.match(/async function handleRefine\(\) \{[\s\S]*?\n\}/)?.[0] || "";

assert.ok(handleRefine.includes("renderEditResults([refined]);"));
assert.ok(
  !handleRefine.includes("state.selectedImage = refined;"),
  "二次编辑生成结果不应自动替换左侧当前基图"
);
assert.ok(
  !handleRefine.includes("renderEditSelection();"),
  "二次编辑生成结果不应自动回填基图预览"
);
assert.ok(app.includes("container.querySelectorAll(\"[data-action='edit']\")"));
assert.ok(app.includes("state.selectedImage = item;"));

console.log("refine selection UI tests passed");
