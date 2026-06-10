(function initVideoConstraints(root, factory) {
  const constraints = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = constraints;
  }
  root.VideoConstraints = constraints;
})(typeof globalThis !== "undefined" ? globalThis : window, function createVideoConstraints() {
  const baseConstraints = [
    "商品主体必须以用户上传商品图作为唯一外观参考，保持结构、轮廓、颜色、材质、屏幕内容位置、按钮、接口、Logo、文字和配件比例一致。",
    "不得改变商品外形、品牌标识、包装细节、可见文字、配件关系或屏幕布局，不得重新设计商品本体。",
    "不得添加未经输入确认的新功能、参数、认证、奖项、医生背书、平台标识、竞品 Logo、水印或乱码文字。",
    "不得出现平台 Logo、亚马逊 Logo、竞品商标、虚构认证章、夸张促销文字或误导性购买承诺。",
    "画面必须真实可信，产品主体清晰可辨，不裁掉关键结构，不出现黑边、彩色边、模糊边、拉伸或变形。"
  ];

  const noReferenceConstraints = [
    "没有参考图时，只能按商品名称、品类和用户描述生成可信的通用外观，不虚构品牌、认证、医疗效果或具体参数。",
    "没有参考图时，不要生成带有真实品牌商标或可识别第三方包装的商品。"
  ];

  const medicalConstraints = [
    "医疗健康类内容不要宣称诊断、治疗、治愈或预防疾病，不使用处方、专业医疗或医生背书暗示。",
    "优先使用测量、监测、便携、易读、家庭日常使用、配件完整等安全表达。",
    "避免绝对化承诺、恐吓式健康场景、病患治疗场景、术前术后对比或夸大效果。"
  ];

  const qualityConstraints = [
    "镜头运动自然稳定，避免快速闪烁、明显变形、跳帧、漂移、穿帮和不合理手部动作。",
    "主体曝光均匀，边缘清晰，材质真实，背景干净，视觉风格符合电商商品视频。",
    "如果需要字幕或卖点文字，必须保留安全区，重要文字和 Logo 不贴边、不被控件遮挡。",
    "输出画幅、主体比例和时长必须遵守当前用户选择，不自行改成其他比例或更长时长。"
  ];

  const useCaseConstraints = {
    shoppable: [
      "商品详情页 Shoppable Video 以产品概览、开箱、操作演示、功能说明和使用方式为主，不做强广告式夸张 CTA。",
      "适合产品概览、开箱、操作演示、设置、维护、配件展示和故障排查等自然内容。",
      "允许 16:9 横版或 9:16 竖版，但所有镜头必须统一同一画幅，不混用横竖版。"
    ],
    "sponsored-brands": [
      "Sponsored Brands Video 必须按 16:9 横版制作，不能出现上下或左右黑边。",
      "视频节奏要短、直接、前 2 秒出现商品主体，避免复杂叙事和过长铺垫。",
      "右下角会有静音/控制按钮，重要文字、Logo、价格、卖点和商品关键结构必须避开右下角安全区。",
      "广告素材不能出现未经验证的折扣、排名、最优、唯一、治愈、保证效果等强承诺表达。"
    ],
    "store-a-plus": [
      "Store / A+ 视频以品牌介绍、产品系列展示、场景化说明和模块化内容为主，语气更克制。",
      "A+ / Brand Story 不套用 Sponsored Brands 广告规则，不做强广告位 CTA。",
      "画面必须高清、相关、可正常裁切，不拉伸、不模糊、不像素化，不裁掉关键信息。"
    ]
  };

  function getVideoConstraintGroups(presetId, options = {}) {
    return {
      base: options.hasReference === false ? noReferenceConstraints : baseConstraints,
      medical: medicalConstraints,
      useCase: useCaseConstraints[presetId] || useCaseConstraints.shoppable,
      quality: qualityConstraints
    };
  }

  function buildVideoConstraintBlock(options = {}) {
    const presetId = options.presetId || "shoppable";
    const groups = getVideoConstraintGroups(presetId, { hasReference: options.hasReference });
    const dynamicConstraints = [
      options.aspectRatio ? `画幅必须保持 ${options.aspectRatio}，不得在镜头之间切换比例。` : "",
      options.durationSeconds ? `目标时长必须控制在约 ${Number(options.durationSeconds)} 秒，镜头节奏按该时长分配。` : ""
    ].filter(Boolean);
    return [
      "固定约束：",
      ...prefix("商品一致性与平台安全", groups.base),
      ...prefix("医疗设备合规", groups.medical),
      ...prefix("当前用途规则", groups.useCase),
      ...prefix("输出质量", groups.quality),
      ...prefix("当前输出参数", dynamicConstraints)
    ].join("\n");
  }

  function prefix(label, items) {
    if (!items.length) return [];
    return [`【${label}】`, ...items.map((item) => `- ${item}`)];
  }

  return {
    buildVideoConstraintBlock,
    getVideoConstraintGroups
  };
});
