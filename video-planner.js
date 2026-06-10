(function initVideoPlanner(root, factory) {
  const planner = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = planner;
  }
  root.VideoPlanner = planner;
})(typeof globalThis !== "undefined" ? globalThis : window, function createVideoPlanner() {
  const constraintsApi =
    typeof require === "function"
      ? require("./video-constraints.js")
      : (typeof globalThis !== "undefined" ? globalThis.VideoConstraints : window.VideoConstraints);

  const presets = {
    shoppable: {
      id: "shoppable",
      title: "商品详情页 Shoppable Video",
      badge: "自然视频",
      placement: "商品详情页顶部主媒体区、详情页视频区、部分搜索结果",
      objective: "展示产品功能、使用方式、开箱和核心卖点",
      aspectRatio: "16:9 / 9:16",
      aspectOptions: [
        { value: "16:9", label: "16:9 横版", output: "1920x1080" },
        { value: "9:16", label: "9:16 竖版", output: "1080x1920" }
      ],
      defaultAspectRatio: "16:9",
      duration: "1-12 分钟",
      recommendedDuration: "30-90 秒",
      durationOptions: [30, 45, 60, 90],
      defaultDurationSeconds: 60,
      sceneCountOptions: [4, 6, 8],
      defaultSceneCount: 6,
      fileSize: "≤5GB",
      format: ".mov / .mp4",
      output: "1920x1080 横版或 1080x1920 竖版",
      notes: [
        "每个 ASIN 最多 4 个视频",
        "主媒体区展示通常要求商品图片少于 6 张",
        "适合产品概览、开箱、操作演示、设置和故障排查"
      ]
    },
    "sponsored-brands": {
      id: "sponsored-brands",
      title: "Sponsored Brands Video",
      badge: "广告素材",
      placement: "搜索结果广告位、部分商品详情页广告位",
      objective: "付费推广，引流到商品详情页或品牌 Store",
      aspectRatio: "16:9 only",
      aspectOptions: [{ value: "16:9", label: "16:9 横版", output: "1920x1080" }],
      defaultAspectRatio: "16:9",
      duration: "6-45 秒",
      recommendedDuration: "≤20 秒",
      durationOptions: [6, 15, 20, 30, 45],
      defaultDurationSeconds: 20,
      sceneCountOptions: [1, 3, 4, 6],
      defaultSceneCount: 4,
      fileSize: "≤500MB",
      format: ".MP4 / .MOV",
      output: "1920x1080",
      notes: [
        "H.264/H.265，逐行扫描",
        "不要出现横向或竖向黑边、彩色边、模糊边",
        "右下角避开 Logo、卖点和重要文字"
      ]
    },
    "store-a-plus": {
      id: "store-a-plus",
      title: "Store / A+ 后台模块",
      badge: "后台模块",
      placement: "品牌旗舰店 Store 视频模块，或商品详情页下方 A+ 内容模块",
      objective: "品牌介绍、产品系列展示、场景化说明",
      aspectRatio: "按后台模块",
      aspectOptions: [
        { value: "16:9", label: "16:9 通用横版", output: "1920x1080" },
        { value: "1:1", label: "1:1 模块裁切", output: "1080x1080" }
      ],
      defaultAspectRatio: "16:9",
      duration: "Store ≤5 分钟；A+ 后台为准",
      recommendedDuration: "30-120 秒",
      durationOptions: [30, 60, 90, 120],
      defaultDurationSeconds: 60,
      sceneCountOptions: [4, 6, 8],
      defaultSceneCount: 6,
      fileSize: "后台为准",
      format: "后台为准",
      output: "先按 1920x1080 制作，再按模块裁切",
      notes: [
        "视频必须高清、相关、可正常播放",
        "不要拉伸、模糊、像素化或裁掉关键信息",
        "A+ / Brand Story 不套用 Sponsored Brands 广告规格"
      ]
    }
  };

  const sceneTemplates = [
    {
      name: "01 产品 Hero 展示",
      duration: "3-5 秒",
      prompt: "从干净浅色背景开始，围绕产品做轻微推近和侧向移动，展示主体外观、屏幕、按钮和整体比例。"
    },
    {
      name: "02 使用场景",
      duration: "5-8 秒",
      prompt: "在真实家庭环境中展示目标用户自然使用产品，画面安静可信，强调日常测量或监测场景。"
    },
    {
      name: "03 操作步骤",
      duration: "6-10 秒",
      prompt: "用清晰分步镜头展示准备、佩戴或放置、读取结果、收纳的流程，手部动作自然，产品外观保持一致。"
    },
    {
      name: "04 功能特写",
      duration: "4-7 秒",
      prompt: "切到屏幕读数、按键、传感区域、配件接口等近景，突出易读、便携、清晰结构，不加入未经验证的参数。"
    },
    {
      name: "05 包装配件",
      duration: "4-6 秒",
      prompt: "展示包装盒、说明书、挂绳、电池或收纳袋等随附物，布局整齐，便于用户理解购买内容。"
    },
    {
      name: "06 尺寸与便携",
      duration: "4-6 秒",
      prompt: "用手持、桌面、包内或床头柜场景表达体积小巧和便携性，不夸大产品能力。"
    },
    {
      name: "07 安心购买理由",
      duration: "4-7 秒",
      prompt: "用简洁画面总结清晰读数、易操作、家庭日常使用、配件完整等购买理由，避免绝对化承诺和竞品贬低。"
    },
    {
      name: "08 品牌结尾",
      duration: "3-5 秒",
      prompt: "以产品、品牌名和简洁行动提示收尾，留出字幕空间，整体干净专业。"
    }
  ];

  function getVideoPreset(id) {
    return presets[id] || presets.shoppable;
  }

  function getVideoPresets() {
    return ["shoppable", "sponsored-brands", "store-a-plus"].map((id) => presets[id]);
  }

  function buildVideoScenes(input = {}) {
    const preset = getVideoPreset(input.presetId);
    const productName = clean(input.productName) || "商品";
    const category = clean(input.category) || "医疗健康类产品";
    const sellingPoints = clean(input.sellingPoints) || "根据商品外观和用途提炼核心卖点";
    const style = clean(input.style) || "clean-medical";
    const aspectRatio = clean(input.aspectRatio) || preset.defaultAspectRatio;
    const targetDurationSeconds = normalizeOption(input.targetDurationSeconds, preset.defaultDurationSeconds);
    const sceneCount = normalizeSceneCount(input.sceneCount, preset.defaultSceneCount, preset.sceneCountOptions);
    const sceneDuration = Math.max(3, Math.round(targetDurationSeconds / sceneCount));
    const constraintBlock = constraintsApi.buildVideoConstraintBlock({
      presetId: preset.id,
      hasReference: Boolean(input.hasReference),
      aspectRatio,
      durationSeconds: targetDurationSeconds
    });

    return selectSceneTemplates(sceneCount).map((scene) => ({
      id: scene.name.slice(0, 2),
      name: scene.name,
      duration: `约 ${sceneDuration} 秒`,
      prompt: [
        `用途：${preset.title}（${preset.badge}）。`,
        `画幅：${aspectRatio}。`,
        `目标成片时长：约 ${targetDurationSeconds} 秒。`,
        "成片方式：这些镜头最终合成 1 条视频，不是分别生成多条视频。",
        `产品：${productName}。`,
        `品类：${category}。`,
        `核心卖点：${sellingPoints}。`,
        `视觉风格：${style}。`,
        scene.prompt,
        constraintBlock
      ].join("\n")
    }));
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function normalizeOption(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function normalizeSceneCount(value, fallback, allowed = []) {
    const parsed = Number(value);
    return allowed.includes(parsed) ? parsed : fallback;
  }

  function selectSceneTemplates(count) {
    if (count <= 1) return [sceneTemplates[0]];
    if (count === 2) return [sceneTemplates[0], sceneTemplates[7]];
    if (count <= 3) return [sceneTemplates[0], sceneTemplates[1], sceneTemplates[7]];
    if (count === 4) return [sceneTemplates[0], sceneTemplates[1], sceneTemplates[2], sceneTemplates[7]];
    if (count === 6) {
      return [sceneTemplates[0], sceneTemplates[1], sceneTemplates[2], sceneTemplates[3], sceneTemplates[4], sceneTemplates[7]];
    }
    return sceneTemplates.slice(0, 8);
  }

  return {
    VIDEO_PRESETS: presets,
    getVideoPresets,
    getVideoPreset,
    buildVideoScenes,
    buildVideoConstraintBlock: constraintsApi.buildVideoConstraintBlock
  };
});
