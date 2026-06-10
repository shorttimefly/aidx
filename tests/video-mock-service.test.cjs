const assert = require("node:assert/strict");
const { createMockVideoJob, advanceMockVideoJob, videoJobSummary } = require("../video-mock-service.js");

const job = createMockVideoJob({
  id: "mock_video_test",
  title: "指夹式血氧仪",
  presetTitle: "广告视频",
  aspectRatio: "16:9",
  durationSeconds: 6,
  sceneCount: 1,
  now: "2026-06-09T00:00:00Z"
});

assert.equal(job.status, "queued");
assert.equal(job.progress, 0);
assert.equal(videoJobSummary(job), "广告视频 · 16:9 · 6秒 · 1个镜头");

const processing = advanceMockVideoJob(job, 45, { now: "2026-06-09T00:00:01Z" });
assert.equal(processing.status, "processing");
assert.equal(processing.progress, 45);
assert.equal(processing.videoUrl, "");

const completed = advanceMockVideoJob(processing, 100, { now: "2026-06-09T00:00:02Z" });
assert.equal(completed.status, "completed");
assert.equal(completed.progress, 100);
assert.equal(completed.completedAt, "2026-06-09T00:00:02Z");
assert.equal(completed.downloadName, "指夹式血氧仪-16x9-6s.html");

console.log("video mock service tests passed");
