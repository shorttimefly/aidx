(function initVideoMockService(root, factory) {
  const service = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = service;
  }
  root.VideoMockService = service;
})(typeof globalThis !== "undefined" ? globalThis : window, function createVideoMockService() {
  function createMockVideoJob(input = {}) {
    const now = input.now || new Date().toISOString();
    return {
      id: input.id || `mock_video_${Math.random().toString(16).slice(2, 10)}`,
      provider: "mock",
      status: "queued",
      progress: 0,
      title: input.title || "商品视频",
      aspectRatio: input.aspectRatio || "16:9",
      durationSeconds: Number(input.durationSeconds) || 20,
      sceneCount: Number(input.sceneCount) || 1,
      presetTitle: input.presetTitle || "视频",
      createdAt: now,
      updatedAt: now,
      completedAt: "",
      videoUrl: "",
      downloadName: ""
    };
  }

  function advanceMockVideoJob(job, progress, options = {}) {
    const nextProgress = clamp(Number(progress), 0, 100);
    const next = {
      ...job,
      status: nextProgress >= 100 ? "completed" : "processing",
      progress: nextProgress,
      updatedAt: options.now || new Date().toISOString()
    };
    if (next.status === "completed") {
      next.completedAt = next.updatedAt;
      next.downloadName = `${safeFileName(next.title)}-${next.aspectRatio.replace(":", "x")}-${next.durationSeconds}s.html`;
    }
    return next;
  }

  function videoJobSummary(job) {
    return `${job.presetTitle} · ${job.aspectRatio} · ${job.durationSeconds}秒 · ${job.sceneCount}个镜头`;
  }

  function safeFileName(value) {
    return String(value || "video")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
      .trim()
      .slice(0, 80) || "video";
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  return {
    createMockVideoJob,
    advanceMockVideoJob,
    videoJobSummary
  };
});
