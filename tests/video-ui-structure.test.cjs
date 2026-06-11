const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

assert.ok(html.includes("当前规格摘要"));
assert.ok(html.includes("视频分镜预览"));
assert.ok(html.includes('id="videoInlineSummary"'));
assert.ok(html.includes('class="panel video-result-panel"'));
assert.ok(html.includes("生成结果"));
assert.ok(html.includes("生成后在这里预览视频"));
assert.ok(html.includes('id="videoOutputHint"'));
assert.ok(html.includes("视频描述"));
assert.ok(html.includes("更多设置"));
assert.ok(html.includes("医疗设备合规已开启"));
assert.ok(!html.includes("<h3>Amazon 规格</h3>"));
assert.ok(!html.includes("视频场景结构"));
assert.ok(!html.includes("video-step-index"));
assert.ok(html.includes("video-mock-service.js"));
assert.ok(app.includes("startMockVideoGeneration"));
assert.ok(app.includes("正在生成视频"));
assert.ok(app.includes("下载 Mock 预览"));
assert.ok(app.includes("重新生成"));

console.log("video UI structure tests passed");
