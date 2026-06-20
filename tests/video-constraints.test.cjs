const assert = require("node:assert/strict");
const {
  buildVideoConstraintBlock,
  getVideoConstraintGroups
} = require("../video-constraints.js");

const groups = getVideoConstraintGroups("sponsored-brands");
assert.ok(groups.base.length >= 5);
assert.ok(groups.medical.length >= 3);
assert.ok(groups.quality.length >= 4);
assert.ok(groups.useCase.some((item) => item.includes("16:9")));
assert.ok(groups.useCase.some((item) => item.includes("右下角")));

const adBlock = buildVideoConstraintBlock({
  presetId: "sponsored-brands",
  hasReference: true,
  aspectRatio: "16:9",
  durationSeconds: 6
});

assert.ok(adBlock.includes("固定约束"));
assert.ok(adBlock.includes("唯一外观参考"));
assert.ok(adBlock.includes("不得改变商品外形"));
assert.ok(adBlock.includes("不得出现平台 Logo"));
assert.ok(adBlock.includes("不要宣称诊断、治疗、治愈或预防疾病"));
assert.ok(adBlock.includes("Sponsored Brands Video 必须按 16:9 横版"));
assert.ok(adBlock.includes("右下角"));
assert.ok(adBlock.includes("画幅必须保持 16:9"));
assert.ok(adBlock.includes("目标时长必须控制在约 6 秒"));

const shoppableBlock = buildVideoConstraintBlock({
  presetId: "shoppable",
  hasReference: true,
  aspectRatio: "9:16",
  durationSeconds: 45
});

assert.ok(shoppableBlock.includes("适合产品概览、开箱、操作演示"));
assert.ok(shoppableBlock.includes("画幅必须保持 9:16"));

const storeBlock = buildVideoConstraintBlock({
  presetId: "store-a-plus",
  hasReference: false,
  aspectRatio: "1:1",
  durationSeconds: 60
});

assert.ok(storeBlock.includes("没有参考图时"));
assert.ok(storeBlock.includes("A+ / Brand Story 不套用 Sponsored Brands 广告规则"));

console.log("video constraints tests passed");
