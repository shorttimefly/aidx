const assert = require("node:assert/strict");
const { getVideoPresets, getVideoPreset, buildVideoScenes } = require("../video-planner.js");

assert.deepEqual(
  getVideoPresets().map((preset) => preset.id),
  ["shoppable", "sponsored-brands", "store-a-plus"]
);

const sponsored = getVideoPreset("sponsored-brands");
assert.equal(sponsored.aspectRatio, "16:9 only");
assert.equal(sponsored.duration, "6-45 秒");
assert.equal(sponsored.fileSize, "≤500MB");
assert.ok(sponsored.durationOptions.includes(6));
assert.ok(sponsored.sceneCountOptions.includes(1));

const shoppable = getVideoPreset("shoppable");
assert.deepEqual(
  shoppable.aspectOptions.map((option) => option.value),
  ["16:9", "9:16"]
);

const scenes = buildVideoScenes({
  presetId: "shoppable",
  productName: "指夹式血氧仪",
  category: "家用健康监测设备",
  sellingPoints: "大屏读数、便携、适合家庭日常测量",
  style: "clean-medical",
  hasReference: true,
  aspectRatio: "9:16",
  targetDurationSeconds: 45,
  sceneCount: 4
});

assert.equal(scenes.length, 4);
assert.ok(scenes[0].prompt.includes("指夹式血氧仪"));
assert.ok(scenes[0].prompt.includes("画幅：9:16"));
assert.ok(scenes[0].prompt.includes("成片方式：这些镜头最终合成 1 条视频"));
assert.ok(scenes[0].prompt.includes("固定约束"));
assert.ok(scenes[0].prompt.includes("唯一外观参考"));
assert.ok(scenes[0].prompt.includes("不得改变商品外形"));
assert.ok(scenes[0].prompt.includes("画幅必须保持 9:16"));
assert.ok(scenes.every((scene) => scene.prompt.includes("不要宣称诊断、治疗、治愈或预防疾病")));

const shortAdScenes = buildVideoScenes({
  presetId: "sponsored-brands",
  productName: "指夹式血氧仪",
  hasReference: true,
  aspectRatio: "16:9",
  targetDurationSeconds: 6,
  sceneCount: 1
});

assert.equal(shortAdScenes.length, 1);
assert.ok(shortAdScenes[0].prompt.includes("目标成片时长：约 6 秒"));
assert.ok(shortAdScenes[0].prompt.includes("Sponsored Brands Video 必须按 16:9 横版"));
assert.ok(shortAdScenes[0].prompt.includes("右下角"));

console.log("video planner tests passed");
