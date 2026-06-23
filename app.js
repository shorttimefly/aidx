"use strict";

const APP_BASE_PATH = detectAppBasePath();
(function() {
  var path = window.location.pathname || "";
  if (path.endsWith("/login.html") || path.endsWith("/admin-login.html") || path.endsWith("/admin.html")) return;
  var token = localStorage.getItem("imageStudio.authToken");
  if (!token) {
    window.location.replace((APP_BASE_PATH || ".") + "/login.html");
  }
})();
const DB_NAME = "pulse-ox-image-studio";
const DB_VERSION = 1;
const STORES = {
  folders: "folders",
  assets: "assets"
};

const DEFAULT_ENDPOINT = "https://aokapi.com/v1beta/models/{model}:generateContent/";
const DEFAULT_MODEL = "gemini-2.5-flash-image";
const DEFAULT_FOLDER_NAME = "未分类素材";
const DEFAULT_SINGLE_TEMPLATE_CATEGORY = "3c-digital-accessories";
const DEFAULT_SINGLE_TEMPLATE_ID = "";
const AUTH_TOKEN_KEY = "imageStudio.authToken";
const ADMIN_ENTRY_TOKEN_PARAM = "adminToken";
const ADMIN_ROLE = "admin";
const GENERATED_ASSET_IMPORT_KEY_PREFIX = "imageStudio.importedGeneratedAssetIds";
const IMAGE_SIZE_MULTIPLE = 16;
const REFERENCE_STRATEGY_KEY = "imageStudio.referenceStrategy";
const SINGLE_SELECTION_MEMORY_KEY = "imageStudio.singleSelectionMemoryByLeaf";
const SUITE_ENABLED_LABEL = "\u751f\u6210\u6574\u5957\u56fe\u7247";
const SUITE_DISABLED_LABEL = "\u6682\u672a\u5f00\u653e";
const SUITE_STYLE_DISPLAY_LABELS = {
  premium: "清爽质感",
  tech: "现代冷调",
  warm: "自然生活",
  bold: "活动吸睛",
  minimal: "纯净白底"
};
const STRICT_PRODUCT_REFERENCE_RULE = [
  "强限制：商品主体必须以随请求提供的参考图、用户上传的原图、当前基图或上一轮生成结果为唯一外观参考，必须做到 1:1 还原。",
  "只允许改变背景、场景、光线、构图、拍摄角度、留白和后期排版区域；不得重新设计商品本体。",
  "不得改变商品的外形轮廓、比例、颜色、材质、纹理、Logo、文字、图案、按钮、接口、屏幕内容、配件关系、包装细节和任何可见结构。",
  "即使需要改变角度、场景、光线、背景或构图，也必须像同一件真实商品从新角度拍摄；看不清或无法确认的细节必须按参考图延续，不允许自行添加、删除、简化、美化或重新设计商品。"
].join("\n");

function detectAppBasePath() {
  const marker = "/aidx-runtime";
  const pathname = window.location.pathname || "";
  return pathname === marker || pathname.startsWith(`${marker}/`) ? marker : "";
}

function appRoute(path) {
  return `${APP_BASE_PATH}${path}`;
}

const SINGLE_CATEGORY_LABELS = {
  "3c-digital-accessories": "3C数码配件",
  "home-kitchen": "家居厨房",
  "beauty-personal-care": "美妆个护",
  "health-home-care": "健康护理",
  "tools-automotive": "汽摩工具",
  "fashion-accessories": "服饰鞋包配饰",
  "pet-supplies": "宠物用品",
  "food-beverages": "食品饮品",
  "party-decor": "节日礼品/派对装饰"
};

const SINGLE_PLATFORM_DEFS = [
  {
    id: "amazon-aplus",
    label: "Amazon A+",
    categories: ["3c-digital-accessories", "home-kitchen", "beauty-personal-care", "health-home-care", "tools-automotive"]
  },
  {
    id: "tiktok-shop",
    label: "TikTok Shop",
    categories: ["beauty-personal-care", "fashion-accessories", "home-kitchen", "pet-supplies", "food-beverages"]
  },
  {
    id: "shopify-dtc",
    label: "Shopify / DTC 独立站",
    categories: ["beauty-personal-care", "fashion-accessories", "home-kitchen", "health-home-care", "pet-supplies"]
  },
  {
    id: "shopee-lazada",
    label: "Shopee / Lazada",
    categories: ["3c-digital-accessories", "home-kitchen", "beauty-personal-care", "fashion-accessories", "party-decor"]
  },
  {
    id: "temu-aliexpress",
    label: "Temu / AliExpress",
    categories: ["3c-digital-accessories", "home-kitchen", "tools-automotive", "pet-supplies", "party-decor"]
  },
  {
    id: "shein",
    label: "SHEIN",
    categories: ["fashion-accessories", "beauty-personal-care", "home-kitchen", "pet-supplies", "party-decor"]
  }
];

const SINGLE_PLATFORM_SCENES = {
  "amazon-aplus": [
    { id: "brand-story", title: "品牌故事横幅" },
    { id: "lifestyle-module", title: "场景模块" },
    { id: "hotspot-detail", title: "热点细节" },
    { id: "benefit-grid", title: "图文模块" }
  ],
  "tiktok-shop": [
    { id: "strong-scene", title: "强场景" },
    { id: "use-moment", title: "使用瞬间" },
    { id: "trend-seeding", title: "种草感" },
    { id: "quick-sell-point", title: "快节奏卖点" }
  ],
  "shopify-dtc": [
    { id: "hero-visual", title: "首屏视觉" },
    { id: "lifestyle-story", title: "生活方式" },
    { id: "benefit-section", title: "卖点模块" },
    { id: "conversion-module", title: "转化页素材" }
  ],
  "shopee-lazada": [
    { id: "clear-selling-point", title: "清晰卖点" },
    { id: "promo-visual", title: "促销感" },
    { id: "mobile-spec", title: "移动端规格图" },
    { id: "activity-blank", title: "活动留白图" }
  ],
  "temu-aliexpress": [
    { id: "spec-density", title: "高信息密度" },
    { id: "function-detail", title: "功能细节" },
    { id: "bundle-price", title: "套装/价格感" },
    { id: "quick-decision", title: "快速决策" }
  ],
  shein: [
    { id: "trend-look", title: "潮流造型" },
    { id: "value-look", title: "性价比表达" },
    { id: "styling-scene", title: "调性场景" },
    { id: "vibe-detail", title: "氛围细节" }
  ]
};

function buildSingleTemplateCategoriesFromMatrix(matrix) {
  const categories = [{ id: "all", label: "全部模板" }];
  const seen = new Set();
  (matrix.platforms || []).forEach((platform) => {
    (platform.categories || []).forEach((category) => {
      if (!category.id || seen.has(category.id)) return;
      seen.add(category.id);
      categories.push({ id: category.id, label: category.label || category.id });
    });
  });
  return categories;
}

function buildSingleTemplatesFromMatrix(matrix) {
  return (matrix.platforms || []).flatMap((platform) =>
    (platform.categories || []).flatMap((category) =>
      (category.scenarios || []).map((scenario) => ({
        id: scenario.templateId,
        templateId: scenario.templateId,
        platform: platform.id,
        category: category.id,
        scenario: scenario.id,
        title: scenario.title
      }))
    )
  );
}

function buildDefaultSinglePromptConfig() {
  const platforms = SINGLE_PLATFORM_DEFS.map((platform) => ({
    id: platform.id,
    label: platform.label,
    categories: platform.categories.map((categoryId) => ({
      id: categoryId,
      label: SINGLE_CATEGORY_LABELS[categoryId] || categoryId
    }))
  }));
  const defaults = {
    platformId: platforms[0]?.id || "",
    categoryId: platforms[0]?.categories?.[0]?.id || "",
    scenarioId: ""
  };
  const matrix = { defaults, platforms };
  const templatesFromMatrix = buildSingleTemplatesFromMatrix(matrix);
  return {
    defaults,
    matrix,
    defaultTemplateCategory: defaults.categoryId,
    defaultTemplateId: templatesFromMatrix[0]?.id || "",
    templateCategories: buildSingleTemplateCategoriesFromMatrix(matrix),
    templates: templatesFromMatrix,
    supplementalVariantPrompt: ""
  };
}

const templates = [
  { id: "main-white", category: "main", title: "白底主图" },
  { id: "main-angle", category: "main", title: "多角度套图" },
  { id: "scene-home", category: "scene", title: "居家生活场景" },
  { id: "scene-use", category: "scene", title: "使用场景" },
  { id: "info-feature", category: "infographic", title: "卖点信息图" },
  { id: "info-size", category: "infographic", title: "尺寸与包装" },
  { id: "content-banner", category: "content", title: "内容横幅" },
  { id: "content-comparison", category: "content", title: "对比模块" },
  { id: "aplus-brand-story", category: "aplus", title: "A+ 品牌故事横幅" },
  { id: "aplus-lifestyle", category: "aplus", title: "A+ 生活方式模块" },
  { id: "aplus-benefit-grid", category: "aplus", title: "A+ 三栏卖点图" },
  { id: "aplus-hotspot-detail", category: "aplus", title: "A+ 热点细节图" },
  { id: "aplus-comparison-chart", category: "aplus", title: "A+ 对比图模块" },
  { id: "aplus-carousel-series", category: "aplus", title: "A+ 轮播组图" },
  { id: "aplus-qa-trust", category: "aplus", title: "A+ 问答信任图" },
  { id: "season-gift", category: "season", title: "礼品季" },
  { id: "season-promo", category: "season", title: "促销活动图" }
];

let userTemplates = [];

const quickEdits = [
  "保持产品外观不变，只替换为纯白主图背景。",
  "保持构图，增加产品真实使用细节和自然手部互动。",
  "转为详情页横幅比例，左侧留文案空间。",
  "强化产品关键细节清晰度，但不添加未经验证的功能承诺。",
  "替换为目标用户的生活方式场景，光线自然可信。",
  "移除杂乱道具，保留产品、包装和核心配件。"
];

const suitePresets = {
  "amazon-aplus": {
    title: "Amazon A+ 内容套图",
    folder: "Amazon A+内容套图",
    shots: [
      {
        id: "aplus-hero",
        name: "01 A+ 首屏品牌横幅",
        size: "1792x1024",
        description: "品牌故事、增强图片、文案安全区",
        prompt:
          "生成 Amazon A+ Content 首屏品牌故事横幅：横版增强图片，商品作为视觉主角，结合品牌调性的生活方式场景或材质氛围，左侧或右侧保留大面积自定义标题与品牌故事文案安全区。画面高级可信，不生成真实可读文字、不出现 Amazon 标志、平台 UI、排名、认证章、折扣数字或绝对化承诺。"
      },
      {
        id: "aplus-brand-scene",
        name: "02 品牌使命场景图",
        size: "1792x1024",
        description: "品牌价值与目标用户生活场景",
        prompt:
          "生成 Amazon A+ 品牌使命/场景故事图：商品出现在目标用户真实生活或工作场景中，体现品牌价值、使用氛围和场景痛点，产品清晰可辨，人物或道具只辅助说明使用方式，预留短文案区域，不夸大功效。"
      },
      {
        id: "aplus-benefit-module",
        name: "03 三栏核心卖点模块",
        size: "1792x1024",
        description: "3-4 个模块化卖点和图文位置",
        prompt:
          "生成 Amazon A+ 图文模块视觉：三栏或四栏模块化布局，每栏对应一个核心卖点、材质、功能、配件或使用场景，商品或局部细节在每个模块中保持一致，留出后期自定义文本位置，版式清楚、少文字或无文字。"
      },
      {
        id: "aplus-lifestyle",
        name: "04 生活方式使用图",
        size: "1024x1024",
        description: "真实使用场景和情绪代入",
        prompt:
          "生成 Amazon A+ 生活方式模块图：目标用户自然使用商品，产品处于视觉中心附近且细节可辨，环境符合品类和购买人群，光线真实，强调使用场景与购买理由，不生成虚假前后对比或夸张效果。"
      },
      {
        id: "aplus-hotspot-detail",
        name: "05 热点细节特写",
        size: "1024x1024",
        description: "材质、结构、接口、热点留白",
        prompt:
          "生成 Amazon A+ 热点/细节模块图：近景展示商品关键结构、材质、接口、纹理、包装或配件细节，周围预留 3-5 个热点标注安全区，背景干净，细节真实，不添加未经验证的技术参数、认证或图标。"
      },
      {
        id: "aplus-howto-care",
        name: "06 使用步骤/维护图",
        size: "1792x1024",
        description: "步骤说明、安装清洁或维护",
        prompt:
          "生成 Amazon A+ 使用步骤、安装、清洁或维护说明模块：用 3-4 个清晰画面区块展示关键流程，手部互动自然，商品主体 1:1 一致，每个步骤预留文案空间，不生成真实可读文字或未经确认的保修承诺。"
      },
      {
        id: "aplus-comparison",
        name: "07 可购买对比图模块",
        size: "1792x1024",
        description: "同系列规格/颜色/套装对比",
        prompt:
          "生成 Amazon A+ 可购买对比图模块背景：适合展示同系列商品、颜色、规格、套装或适用场景差异，保留清晰表格和产品缩略图区域，视觉中立可信，不写竞品名，不生成最佳、第一、官方认证、销量排名等不可验证内容。"
      },
      {
        id: "aplus-qa-finish",
        name: "08 Q&A 信任收尾图",
        size: "1792x1024",
        description: "问答、包装、适配、信任信息",
        prompt:
          "生成 Amazon A+ Q&A/信任收尾模块视觉：展示商品、包装、配件、适配场景或常见问题说明氛围，画面稳定干净，保留多个问答或说明文案区域，强调真实可理解的信息结构，不出现平台标识、医学/安全功效、保修承诺或认证章。"
      }
    ]
  },
  amazon: {
    title: "Amazon 详情页套图",
    folder: "Amazon详情页套图",
    shots: [
      {
        id: "amazon-main",
        name: "01 白底主图",
        size: "1024x1024",
        description: "白底、主体清晰、无文字",
        prompt:
          "生成平台合规白底主图：纯白背景，只展示售卖商品本体和必要配件，商品占画面主要区域，边缘干净锐利，无文字、无图标、无水印、无人物、无夸张视觉效果。"
      },
      {
        id: "amazon-angle",
        name: "02 多角度展示",
        size: "1024x1024",
        description: "正面、侧面、背面、细节",
        prompt:
          "生成多角度商品展示图：同一产品以正面、侧面、背面和关键细节组合呈现，浅色摄影背景，真实材质和比例一致，强调做工、接口、纹理、结构或配件细节。"
      },
      {
        id: "amazon-lifestyle",
        name: "03 使用场景图",
        size: "1024x1024",
        description: "目标用户真实使用场景",
        prompt:
          "生成生活方式场景图：目标用户在自然场景中使用产品，产品清晰可见，光线自然，背景符合品类和消费人群，人物动作真实，不夸大功能效果。"
      },
      {
        id: "amazon-feature",
        name: "04 核心卖点图",
        size: "1024x1024",
        description: "3-5 个视觉卖点",
        prompt:
          "生成卖点信息图：产品居中，周围预留 3-5 个卖点标注区域，突出材质、功能、结构、适用场景或配件价值，版式清晰、少文字或无文字、适合后期加文案。"
      },
      {
        id: "amazon-howto",
        name: "05 使用步骤图",
        size: "1024x1024",
        description: "分步说明与手部互动",
        prompt:
          "生成使用步骤图：用 3 个清晰步骤表现打开、使用、收纳或维护流程，产品外观保持一致，手部互动自然，背景干净，步骤区域留白充分。"
      },
      {
        id: "amazon-size",
        name: "06 尺寸包装图",
        size: "1024x1024",
        description: "规格、配件、包装清单",
        prompt:
          "生成尺寸与包装清单图：商品、包装盒、说明书和核心配件整齐平铺，预留尺寸、容量、规格、包装内容标注空间，真实电商摄影质感。"
      },
      {
        id: "amazon-compare",
        name: "07 对比决策图",
        size: "1024x1024",
        description: "优势对比与购买理由",
        prompt:
          "生成对比决策图：产品与简洁功能图块、旧方案或竞品抽象轮廓并列，突出选择理由、规格差异和使用体验，不出现未经验证的认证、排名或绝对化承诺。"
      },
      {
        id: "amazon-promo",
        name: "08 促销广告图",
        size: "1792x1024",
        description: "横版广告、活动氛围",
        prompt:
          "生成横版促销广告主视觉：产品清晰居中或偏左，背景有活动氛围但不过度装饰，右侧预留价格、优惠和标题文案区域，无具体折扣数字、无平台商标、适合投放广告或活动副图。"
      }
    ]
  },
  "mall-long": {
    title: "商城详情长图",
    folder: "商城详情长图",
    shots: [
      {
        id: "mall-long-detail",
        name: "01 连贯商详长图",
        size: "1024x1792",
        description: "首屏、场景、卖点、细节、规格",
        prompt:
          "生成一张竖版连贯电商详情长图：从顶部首屏海报开始，向下连续呈现核心卖点、生活场景、产品细节、尺寸规格、包装清单和购买理由。整体像一张完整商城商详页长图，分区清晰但视觉连续，产品主体在各区保持一致。"
      }
    ]
  },
  ads: {
    title: "品牌广告套图",
    folder: "品牌广告套图",
    shots: [
      {
        id: "ads-hero",
        name: "01 广告主视觉",
        size: "1792x1024",
        description: "横版投放主图",
        prompt:
          "生成品牌广告横版主视觉：产品作为画面主角，背景符合品牌调性，留出标题和行动号召空间，视觉高级、干净、有点击欲望。"
      },
      {
        id: "ads-square",
        name: "02 方形广告图",
        size: "1024x1024",
        description: "社媒和站内广告",
        prompt:
          "生成方形广告图：产品居中突出，场景和光影有记忆点，预留短标题区域，构图适合社媒、站内广告和推荐位。"
      },
      {
        id: "ads-promo",
        name: "03 促销活动图",
        size: "1024x1024",
        description: "活动氛围与优惠留白",
        prompt:
          "生成促销活动图：产品清晰，背景有活动氛围，留出优惠信息和价格区域，不出现具体折扣数字或平台商标。"
      },
      {
        id: "ads-retarget",
        name: "04 购买理由图",
        size: "1024x1024",
        description: "卖点、对比、信任感",
        prompt:
          "生成购买理由广告图：用清晰视觉展示产品核心价值、使用场景和差异化卖点，适合再营销广告，不添加未经验证的认证或绝对化承诺。"
      }
    ]
  }
};

const state = {
  db: null,
  folders: [],
  assets: [],
  generated: [],
  suiteGenerated: [],
  uploaded: [],
  suiteReference: null,
  selectedImage: null,
  selectedAssetId: null,
  selectedFolderId: "all",
  pendingSave: null,
  busy: false,
  referenceFallbackNotice: "",
  userSelectedSingleSize: false,
  suiteShotSettings: {},
  lastRequestPayload: null,
  promptConfig: buildRuntimePromptConfig(),
  availableImageModels: [],
  selectedImageModelId: "",
  defaultImageModelId: "",
  selectedTemplateId: DEFAULT_SINGLE_TEMPLATE_ID,
  selectedPlatformId: "",
  selectedCategoryId: "",
  selectedScenarioId: "",
  singleSelectionMemoryByLeaf: {},
  videoReference: null,
  videoScenes: [],
  videoJob: null,
  videoJobTimer: null,
  activeAuthMode: "login",
  auth: {
    token: "",
    user: null,
    apiKeyConfigured: false,
    videoApiKeyConfigured: false,
    modelSettings: {
      endpoint: DEFAULT_ENDPOINT,
      model: DEFAULT_MODEL
    },
    videoModelSettings: {
      model: ""
    }
  }
};

const els = {};

function legacyPromptConfig() {
  return {
    version: 1,
    single: {
      defaultTemplateCategory: DEFAULT_SINGLE_TEMPLATE_CATEGORY,
      defaultTemplateId: DEFAULT_SINGLE_TEMPLATE_ID,
      templateCategories: [
        { id: "all", label: "全部模板" },
        { id: "main", label: "主图" },
        { id: "scene", label: "场景图" },
        { id: "infographic", label: "信息图" },
        { id: "content", label: "内容图" },
        { id: "aplus", label: "Amazon A+" },
        { id: "season", label: "活动图" }
      ],
      templates,
      supplementalVariantPrompt: ""
    },
    refinement: {
      quickEdits: quickEdits.map((text, index) => ({ id: `quick-${index + 1}`, text })),
      compose: {
        prefix: "基于当前界面显示的最新商品图继续生成一个微调版本，不回到最初原图。",
        currentSizeLine: "当前基图尺寸：{size}",
        previousPromptLine: "上一版提示词：{prompt}",
        editRequestLine: "本次修改要求：{prompt}",
        guardrailSuffix:
          "商品主体必须和当前基图 1:1 还原，不得改变任何可见结构、比例、颜色、材质、文字、Logo、纹理、按钮、接口、配件或包装细节。适合电商商品图，不添加未经验证的功能、认证、品牌或夸张效果承诺。"
      },
      imageReferenceText: {
        local: "当前基图：界面预览中的最新本地图片。",
        remote: "当前基图图片地址：{url}"
      }
    },
    suite: {
      visualStyles: [
        { id: "premium", label: "高级简洁", displayLabel: "清爽质感" },
        { id: "tech", label: "科技冷感", displayLabel: "现代冷调" },
        { id: "warm", label: "温暖生活", displayLabel: "自然生活" },
        { id: "bold", label: "强促销视觉", displayLabel: "活动吸睛" },
        { id: "minimal", label: "极简白底", displayLabel: "纯净白底" }
      ],
      contextFallbacks: {
        productLabel: "商品基图中的产品",
        category: "通用电商品类",
        sellingPoints: "根据商品外观推断核心材质、功能、使用场景和包装价值",
        styleText: "高级简洁"
      },
      compose: {
        taskLine: "任务：为「{productLabel}」生成「{presetTitle}」中的「{shotName}」。",
        categoryLine: "品类：{category}",
        sellingPointsLine: "核心卖点：{sellingPoints}",
        styleLine: "视觉风格：{styleText}",
        referenceLine:
          "以已上传商品基图「{referenceName}」作为唯一商品外观参考，商品主体必须和原图 1:1 还原，不能改变任何可见结构、比例、颜色、材质、文字、Logo、纹理、按钮、接口、配件或包装细节。",
        noReferenceLine: "如果没有可见商品基图，则根据商品名称、品类和卖点生成可信的通用电商商品视觉。",
        aplusLine:
          "Amazon A+ Content 重点：增强图片、自定义文本位置、品牌故事、生活方式场景、热点细节、轮播、问答和可购买对比图；图片只负责可信视觉与排版安全区，真实文字与具体参数留给后期人工排版。",
        qualityLine: "电商摄影质感，产品真实可信，构图清晰，背景和道具服务于商品表达。",
        negativeLine: "不要添加虚构品牌 Logo、平台商标、未经验证的认证、夸张承诺、不可读乱码文字或误导性效果。"
      },
      presets: Object.entries(suitePresets).map(([id, preset]) => ({ id, ...preset }))
    },
    reference: {
      strictRule: STRICT_PRODUCT_REFERENCE_RULE,
      strictRuleDedupeNeedles: ["商品主体必须以用户上传的原图", "强限制：商品主体必须以"],
      context: {
        primaryLine: "参考图已随请求发送。首要参考图：「{name}」{sizeText}。",
        sizeText: "，尺寸 {size}",
        extraLine: "其余 {count} 张参考图只用于补充角度、结构和材质细节，不得引入不同商品特征。",
        consistencyLine:
          "生成时必须先识别参考图中的商品主体，再保持同一件商品的轮廓、比例、颜色、材质、Logo、文字、纹理、接口、配件和包装细节一致。",
        defaultName: "参考图 1"
      },
      defaultName: "参考图",
      defaultAssetPromptLabels: {
        suiteReference: "套图商品基图",
        uploaded: "本地上传商品参考图"
      }
    },
    referenceProbe: {
      fallbackReference: {
        name: "参考图探测",
        size: "1x1",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
      },
      withReferencePrompt:
        "入参图片生效测试。请生成一张明亮科技感电商商品图，必须保持随请求提供的参考图商品主体一致，只允许改变背景、光线和构图，不添加文字。",
      controlPrompt: "无入参图片对照测试。请生成一张明亮科技感电商商品图，不添加文字。",
      size: "1024x1024"
    }
  };
}

function buildRuntimePromptConfig() {
  const config = legacyPromptConfig();
  config.version = 2;
  config.single = buildDefaultSinglePromptConfig();
  config.suite.presets = [];
  return config;
}

async function loadPromptConfigDefaults() {
  applyPromptConfig(buildRuntimePromptConfig(), { rerender: false });
}

function currentPromptConfig() {
  return state.promptConfig || buildRuntimePromptConfig();
}

function applyPromptConfig(config, { rerender = true } = {}) {
  state.promptConfig = normalizePromptConfig(config);
  if (rerender && Object.keys(els).length) renderPromptConfigDrivenUi();
}

function normalizePromptConfig(config) {
  return mergePromptConfig(buildRuntimePromptConfig(), config || {});
}

function mergePromptConfig(defaultValue, overrideValue) {
  if (Array.isArray(defaultValue)) {
    if (defaultValue.every((item) => item && typeof item === "object" && "id" in item)) {
      const overrideById = new Map(
        Array.isArray(overrideValue)
          ? overrideValue.filter((item) => item && typeof item === "object").map((item) => [item.id, item])
          : []
      );
      const merged = defaultValue.map((item) => mergePromptConfig(item, overrideById.get(item.id)));
      const defaultIds = new Set(defaultValue.map((item) => item.id));
      if (Array.isArray(overrideValue)) {
        overrideValue.forEach((item) => {
          if (item && typeof item === "object" && item.id && !defaultIds.has(item.id)) merged.push(item);
        });
      }
      return merged;
    }
    return Array.isArray(overrideValue) && overrideValue.length === defaultValue.length ? overrideValue : defaultValue;
  }
  if (defaultValue && typeof defaultValue === "object") {
    const source = overrideValue && typeof overrideValue === "object" ? overrideValue : {};
    return Object.fromEntries(
      Object.entries(defaultValue).map(([key, value]) => [
        key,
        ["id", "category", "url", "templateId", "platform", "scenario"].includes(key)
          ? value
          : mergePromptConfig(value, source[key])
      ])
    );
  }
  if (typeof defaultValue === "string") return typeof overrideValue === "string" ? overrideValue : defaultValue;
  if (typeof defaultValue === "number") return typeof overrideValue === "number" ? overrideValue : defaultValue;
  if (typeof defaultValue === "boolean") return typeof overrideValue === "boolean" ? overrideValue : defaultValue;
  return overrideValue ?? defaultValue;
}

function renderPromptConfigDrivenUi() {
  renderTemplateFilterOptions();
  renderSuiteSelectOptions();
  renderTemplates();
  renderQuickEdits();
  renderSuitePlan();
}

function singleSelectionLeafKey(platformId, categoryId) {
  return `${platformId || ""}::${categoryId || ""}`;
}

function loadSingleSelectionMemory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SINGLE_SELECTION_MEMORY_KEY) || "{}");
    state.singleSelectionMemoryByLeaf = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    state.singleSelectionMemoryByLeaf = {};
  }
}

function persistSingleSelectionMemory() {
  localStorage.setItem(SINGLE_SELECTION_MEMORY_KEY, JSON.stringify(state.singleSelectionMemoryByLeaf || {}));
}

function singleMatrix() {
  return currentPromptConfig().single?.matrix || { defaults: {}, platforms: [] };
}

function singlePlatforms() {
  return singleMatrix().platforms || [];
}

function selectedSinglePlatform() {
  return singlePlatforms().find((platform) => platform.id === state.selectedPlatformId) || null;
}

function selectedSingleCategory() {
  return (selectedSinglePlatform()?.categories || []).find((category) => category.id === state.selectedCategoryId) || null;
}

function selectedSingleScenario() {
  return (selectedSingleCategory()?.scenarios || []).find((scenario) => scenario.id === state.selectedScenarioId) || null;
}

function singleTemplateById(templateId) {
  return (currentPromptConfig().single?.templates || []).find((template) => template.id === templateId) || null;
}

function resolveSingleTemplateSelection({ preferRememberedScenario = true } = {}) {
  const matrix = singleMatrix();
  const defaults = matrix.defaults || {};
  const platforms = matrix.platforms || [];
  const platform =
    platforms.find((item) => item.id === state.selectedPlatformId) ||
    platforms.find((item) => item.id === defaults.platformId) ||
    platforms[0] ||
    null;
  if (!platform) {
    return { platform: null, category: null, scenario: null, template: null };
  }

  const categories = platform.categories || [];
  const category =
    categories.find((item) => item.id === state.selectedCategoryId) ||
    categories.find((item) => item.id === defaults.categoryId) ||
    categories[0] ||
    null;
  if (!category) {
    return { platform, category: null, scenario: null, template: null };
  }

  const scenarios = category.scenarios || [];
  const leafKey = singleSelectionLeafKey(platform.id, category.id);
  const rememberedScenarioId =
    preferRememberedScenario && state.singleSelectionMemoryByLeaf && typeof state.singleSelectionMemoryByLeaf[leafKey] === "string"
      ? state.singleSelectionMemoryByLeaf[leafKey]
      : "";
  const fallbackScenarioId =
    platform.id === defaults.platformId && category.id === defaults.categoryId ? defaults.scenarioId || "" : "";
  const scenario =
    scenarios.find((item) => item.id === state.selectedScenarioId) ||
    scenarios.find((item) => item.id === rememberedScenarioId) ||
    scenarios.find((item) => item.id === fallbackScenarioId) ||
    scenarios[0] ||
    null;
  const template = scenario ? singleTemplateById(scenario.templateId) : null;
  return { platform, category, scenario, template };
}

function syncSingleSelectionState(options = {}) {
  const selection = resolveSingleTemplateSelection(options);
  state.selectedPlatformId = selection.platform?.id || "";
  state.selectedCategoryId = selection.category?.id || "";
  state.selectedScenarioId = selection.scenario?.id || "";
  state.selectedTemplateId = selection.template?.id || "";
  return selection;
}

function rememberSingleScenarioSelection() {
  if (!state.selectedPlatformId || !state.selectedCategoryId || !state.selectedScenarioId) return;
  state.singleSelectionMemoryByLeaf[singleSelectionLeafKey(state.selectedPlatformId, state.selectedCategoryId)] =
    state.selectedScenarioId;
  persistSingleSelectionMemory();
}

function renderTemplateFilterOptions() {
  if (!els.platformSelect || !els.categorySelect || !els.scenarioSelect) return;
  const matrix = singleMatrix();
  const platforms = matrix.platforms || [];
  els.platformSelect.innerHTML = platforms
    .map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.label)}</option>`)
    .join("");

  const selPlatform = platforms.find((p) => p.id === state.selectedPlatformId) || platforms[0] || null;
  if (selPlatform) els.platformSelect.value = selPlatform.id;

  const categories = selPlatform?.categories || [];
  els.categorySelect.innerHTML = categories
    .map((c) => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.label)}</option>`)
    .join("");
  if (categories.length) els.categorySelect.disabled = false;

  const selCategory = categories.find((c) => c.id === state.selectedCategoryId) || categories[0] || null;
  if (selCategory) els.categorySelect.value = selCategory.id;

  const scenarios = selCategory?.scenarios || [];
  els.scenarioSelect.innerHTML = scenarios
    .map((s) => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.title)}</option>`)
    .join("");
  if (scenarios.length) els.scenarioSelect.disabled = false;

  const selScenario = scenarios.find((s) => s.id === state.selectedScenarioId) || scenarios[0] || null;
  if (selScenario) els.scenarioSelect.value = selScenario.id;
}

function renderSuiteSelectOptions() {
  if (!els.suitePresetInput || !els.suiteStyleInput) return;
  const config = currentPromptConfig();
  const selectedPreset = els.suitePresetInput.value;
  const selectedStyle = els.suiteStyleInput.value;
  els.suitePresetInput.innerHTML = (config.suite.presets || [])
    .map((preset) => `<option value="${escapeAttr(preset.id)}">${escapeHtml(preset.title)}</option>`)
    .join("");
  if ((config.suite.presets || []).some((preset) => preset.id === selectedPreset)) {
    els.suitePresetInput.value = selectedPreset;
  }
  els.suiteStyleInput.innerHTML = (config.suite.visualStyles || [])
    .map((style, index) => `<option value="${escapeAttr(style.id)}">${escapeHtml(suiteStyleDisplayLabel(style, index))}</option>`)
    .join("");
  if ((config.suite.visualStyles || []).some((style) => style.id === selectedStyle)) {
    els.suiteStyleInput.value = selectedStyle;
  }
}

function promptText(template, values = {}) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => values[key] ?? "");
}

function suiteStyleDisplayLabel(style, index = 0) {
  const displayLabel = typeof style?.displayLabel === "string" ? style.displayLabel.trim() : "";
  return displayLabel || SUITE_STYLE_DISPLAY_LABELS[style?.id] || `风格 ${index + 1}`;
}

function selectedSuiteVisualStyle() {
  const styles = currentPromptConfig().suite.visualStyles || [];
  return styles.find((style) => style.id === els.suiteStyleInput.value);
}

document.addEventListener("DOMContentLoaded", async () => {
  document.body.dataset.view = "generate";
  cacheElements();
  bindEvents();
  loadAuthSession();
  await loadPromptConfigDefaults();
  state.db = await openDb();
  await ensureDefaultFolder();
  await refreshLibrary();
  await bootstrapAuth();
  renderAuthState();
  loadSettings();
  loadSingleSelectionMemory();
  loadUserTemplates();
  renderSuitePlan();
  renderSuiteReference();
  renderTemplates();
  renderQuickEdits();
  renderVideoOutputControls();
  renderVideoSpecs();
  renderVideoPresetCards();
  renderVideoReference();
  renderVideoScenes();
  updateVideoPlanButton();
  updateConnectionState();
  setDefaultAutoSaveName();
});

function cacheElements() {
  Object.assign(els, {
    navItems: document.querySelectorAll(".nav-item"),
    suiteNavItem: document.querySelector("[data-view='suite']"),
    views: document.querySelectorAll(".view"),
    suiteView: document.getElementById("view-suite"),
    accountTitle: document.getElementById("accountTitle"),
    accountNameText: document.getElementById("accountNameText"),
    accountKeyStatus: document.getElementById("accountKeyStatus"),
    adminEntryBtn: document.getElementById("adminEntryBtn"),
    openAuthBtn: document.getElementById("openAuthBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    connectionState: document.getElementById("connectionState"),
    singleConnectionState: document.getElementById("singleConnectionState"),
    folderCount: document.getElementById("folderCount"),
    assetCount: document.getElementById("assetCount"),
    suiteDropzone: document.getElementById("suiteDropzone"),
    suiteUploadInput: document.getElementById("suiteUploadInput"),
    suiteReferencePreview: document.getElementById("suiteReferencePreview"),
    suiteProductNameInput: document.getElementById("suiteProductNameInput"),
    suiteCategoryInput: document.getElementById("suiteCategoryInput"),
    suiteSellingPointsInput: document.getElementById("suiteSellingPointsInput"),
    suitePresetInput: document.getElementById("suitePresetInput"),
    suiteStyleInput: document.getElementById("suiteStyleInput"),
    suiteSizeInput: document.getElementById("suiteSizeInput"),
    suiteAutoSaveToggle: document.getElementById("suiteAutoSaveToggle"),
    generateSuiteBtn: document.getElementById("generateSuiteBtn"),
    saveSuiteBtn: document.getElementById("saveSuiteBtn"),
    suiteShotList: document.getElementById("suiteShotList"),
    suiteResultGrid: document.getElementById("suiteResultGrid"),
    videoDropzone: document.getElementById("videoDropzone"),
    videoUploadInput: document.getElementById("videoUploadInput"),
    videoReferencePreview: document.getElementById("videoReferencePreview"),
    videoProductNameInput: document.getElementById("videoProductNameInput"),
    videoCategoryInput: document.getElementById("videoCategoryInput"),
    videoSellingPointsInput: document.getElementById("videoSellingPointsInput"),
    videoPresetInput: document.getElementById("videoPresetInput"),
    videoPresetCards: document.getElementById("videoPresetCards"),
    videoStyleInput: document.getElementById("videoStyleInput"),
    videoAspectInput: document.getElementById("videoAspectInput"),
    videoAspectOptions: document.getElementById("videoAspectOptions"),
    videoDurationInput: document.getElementById("videoDurationInput"),
    videoDurationOptions: document.getElementById("videoDurationOptions"),
    videoOutputHint: document.getElementById("videoOutputHint"),
    videoSceneCountInput: document.getElementById("videoSceneCountInput"),
    videoSceneCountOptions: document.getElementById("videoSceneCountOptions"),
    generateVideoPlanBtn: document.getElementById("generateVideoPlanBtn"),
    generateVideoPlanLabel: document.getElementById("generateVideoPlanLabel"),
    videoInlineSummary: document.getElementById("videoInlineSummary"),
    videoResultPreview: document.getElementById("videoResultPreview"),
    videoStoryboardDetails: document.getElementById("videoStoryboardDetails"),
    videoPresetBadge: document.getElementById("videoPresetBadge"),
    videoPresetMeta: document.getElementById("videoPresetMeta"),
    videoSpecCards: document.getElementById("videoSpecCards"),
    videoComplianceList: document.getElementById("videoComplianceList"),
    videoPolicyDetailList: document.getElementById("videoPolicyDetailList"),
    videoSceneCount: document.getElementById("videoSceneCount"),
    videoSceneList: document.getElementById("videoSceneList"),
    dropzone: document.getElementById("dropzone"),
    uploadInput: document.getElementById("uploadInput"),
    uploadPreview: document.getElementById("uploadPreview"),
    platformSelect: document.getElementById("platformSelect"),
    categorySelect: document.getElementById("categorySelect"),
    scenarioSelect: document.getElementById("scenarioSelect"),
    templateSelectionHint: document.getElementById("templateSelectionHint"),
    countInput: document.getElementById("countInput"),
    sizeInput: document.getElementById("sizeInput"),
    apiKeyInput: document.getElementById("apiKeyInput"),
    endpointInput: document.getElementById("endpointInput"),
    modelInput: document.getElementById("modelInput"),
    testReferenceBtn: document.getElementById("testReferenceBtn"),
    referenceProbePanel: document.getElementById("referenceProbePanel"),
    requestPayloadMeta: document.getElementById("requestPayloadMeta"),
    requestPayloadPreview: document.getElementById("requestPayloadPreview"),
    saveApiBtn: document.getElementById("saveApiBtn"),
    toggleKeyBtn: document.getElementById("toggleKeyBtn"),
    clearFormBtn: document.getElementById("clearFormBtn"),
    generateBtn: document.getElementById("generateBtn"),
    resultGrid: document.getElementById("resultGrid"),
    saveAllBtn: document.getElementById("saveAllBtn"),
    selectedImageName: document.getElementById("selectedImageName"),
    editPreview: document.getElementById("editPreview"),
    editPromptInput: document.getElementById("editPromptInput"),
    quickEditGrid: document.getElementById("quickEditGrid"),
    refineBtn: document.getElementById("refineBtn"),
    editResultGrid: document.getElementById("editResultGrid"),
    autoSaveToggle: document.getElementById("autoSaveToggle"),
    autoSaveOptions: document.getElementById("autoSaveOptions"),
    autoSaveNameInput: document.getElementById("autoSaveNameInput"),
    autoSaveFolderSelect: document.getElementById("autoSaveFolderSelect"),
    autoSaveNewFolderInput: document.getElementById("autoSaveNewFolderInput"),
    openLibraryPickBtn: document.getElementById("openLibraryPickBtn"),
    librarySearchInput: document.getElementById("librarySearchInput"),
    folderNameInput: document.getElementById("folderNameInput"),
    folderQuickCreateBtn: document.getElementById("folderQuickCreateBtn"),
    createFolderBtn: document.getElementById("createFolderBtn"),
    folderList: document.getElementById("folderList"),
    libraryHeading: document.getElementById("libraryHeading"),
    assetGrid: document.getElementById("assetGrid"),
    renameSelectedBtn: document.getElementById("renameSelectedBtn"),
    deleteSelectedBtn: document.getElementById("deleteSelectedBtn"),
    saveModal: document.getElementById("saveModal"),
    savePreview: document.getElementById("savePreview"),
    saveNameInput: document.getElementById("saveNameInput"),
    saveFolderSelect: document.getElementById("saveFolderSelect"),
    newFolderInput: document.getElementById("newFolderInput"),
    closeSaveModalBtn: document.getElementById("closeSaveModalBtn"),
    cancelSaveBtn: document.getElementById("cancelSaveBtn"),
    confirmSaveBtn: document.getElementById("confirmSaveBtn"),
    settingsModal: document.getElementById("settingsModal"),
    closeSettingsModalBtn: document.getElementById("closeSettingsModalBtn"),
    cancelSettingsBtn: document.getElementById("cancelSettingsBtn"),
    authModal: document.getElementById("authModal"),
    authModeTabs: document.querySelectorAll("[data-auth-mode]"),
    authNameInput: document.getElementById("authNameInput"),
    authPasswordInput: document.getElementById("authPasswordInput"),
    authSubmitBtn: document.getElementById("authSubmitBtn"),
    toast: document.getElementById("toast")
  });
}

function bindEvents() {
  els.navItems.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled || button.getAttribute("aria-disabled") === "true") return;
      switchView(button.dataset.view);
    });
  });

  els.platformSelect?.addEventListener("change", () => {
    state.selectedPlatformId = els.platformSelect.value;
    state.selectedCategoryId = "";
    state.selectedScenarioId = "";
    renderTemplateFilterOptions();
    renderTemplates();
  });
  els.categorySelect?.addEventListener("change", () => {
    state.selectedCategoryId = els.categorySelect.value;
    state.selectedScenarioId = "";
    renderTemplateFilterOptions();
    renderTemplates();
  });
  els.scenarioSelect?.addEventListener("change", () => {
    state.selectedScenarioId = els.scenarioSelect.value;
    syncSingleSelectionState({ preferRememberedScenario: false });
    rememberSingleScenarioSelection();
    renderTemplates();
  });
  els.connectionState.addEventListener("click", openSettingsModal);
  els.singleConnectionState.addEventListener("click", openSettingsModal);
  els.adminEntryBtn.addEventListener("click", openAdminEntry);
  els.openAuthBtn.addEventListener("click", () => { window.location.replace("./login.html"); });
  els.authSubmitBtn.addEventListener("click", handleAuth);
  els.authModeTabs.forEach((button) => {
    button.addEventListener("click", () => switchAuthMode(button.dataset.authMode));
  });
  els.logoutBtn.addEventListener("click", handleLogout);
  els.suitePresetInput.addEventListener("change", () => {
    resetSuiteShotSettings();
    state.suiteGenerated = [];
    state.generated = [];
    renderSuitePlan();
    renderSuiteResults();
  });
  els.suiteUploadInput.addEventListener("change", (event) => handleSuiteFiles(event.target.files));
  els.generateSuiteBtn.addEventListener("click", handleGenerateSuite);
  els.saveSuiteBtn.addEventListener("click", handleSaveSuite);
  els.videoPresetInput?.addEventListener("change", () => {
    state.videoScenes = [];
    renderVideoOutputControls();
    renderVideoSpecs();
    renderVideoPresetCards();
    renderVideoScenes();
  });
  els.videoStyleInput?.addEventListener("change", refreshVideoPlanDraft);
  els.videoAspectInput?.addEventListener("change", () => {
    handleVideoOutputChange();
    renderVideoOutputControls();
  });
  els.videoDurationInput?.addEventListener("change", () => {
    applyShortAdSceneDefault();
    handleVideoOutputChange();
    renderVideoOutputControls();
  });
  els.videoSceneCountInput?.addEventListener("change", () => {
    handleVideoOutputChange();
    renderVideoOutputControls();
  });
  els.videoProductNameInput?.addEventListener("input", refreshVideoPlanDraft);
  els.videoCategoryInput?.addEventListener("input", refreshVideoPlanDraft);
  els.videoSellingPointsInput?.addEventListener("input", refreshVideoPlanDraft);
  els.videoUploadInput?.addEventListener("change", (event) => handleVideoFiles(event.target.files));
  els.generateVideoPlanBtn?.addEventListener("click", handleVideoPrimaryAction);
  els.saveApiBtn?.addEventListener("click", saveSettings);
  els.modelInput?.addEventListener("change", handleImageModelChange);
  els.testReferenceBtn.addEventListener("click", handleTestReferenceSupport);
  els.toggleKeyBtn?.addEventListener("click", toggleApiKey);
  els.sizeInput.addEventListener("change", () => {
    state.userSelectedSingleSize = true;
    localStorage.setItem("imageStudio.size", els.sizeInput.value);
  });
  els.suiteSizeInput.addEventListener("change", handleSuiteSizeChange);
  els.clearFormBtn.addEventListener("click", clearGenerationForm);
  els.generateBtn.addEventListener("click", handleGenerate);
  els.countInput.addEventListener("change", function () {
    var v = parseInt(els.countInput.value, 10);
    if (!v || v < 1) els.countInput.value = "1";
    else if (v > 8) els.countInput.value = "8";
  });
  els.saveAllBtn.addEventListener("click", handleSaveAll);
  els.refineBtn.addEventListener("click", handleRefine);
  els.openLibraryPickBtn.addEventListener("click", () => switchView("library"));
  els.autoSaveToggle.addEventListener("change", () => {
    els.autoSaveOptions.style.display = els.autoSaveToggle.checked ? "grid" : "none";
  });

  els.dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropzone.classList.add("is-dragging");
  });
  els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("is-dragging"));
  els.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("is-dragging");
    handleFiles(event.dataTransfer.files);
  });
  els.uploadInput.addEventListener("change", (event) => handleFiles(event.target.files));

  els.suiteDropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.suiteDropzone.classList.add("is-dragging");
  });
  els.suiteDropzone.addEventListener("dragleave", () => els.suiteDropzone.classList.remove("is-dragging"));
  els.suiteDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    els.suiteDropzone.classList.remove("is-dragging");
    handleSuiteFiles(event.dataTransfer.files);
  });

  els.videoDropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.videoDropzone.classList.add("is-dragging");
  });
  els.videoDropzone?.addEventListener("dragleave", () => els.videoDropzone.classList.remove("is-dragging"));
  els.videoDropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    els.videoDropzone.classList.remove("is-dragging");
    handleVideoFiles(event.dataTransfer.files);
  });

  els.librarySearchInput.addEventListener("input", renderLibrary);
  els.folderQuickCreateBtn.addEventListener("click", createFolderFromInput);
  els.createFolderBtn.addEventListener("click", createFolderFromInput);
  els.folderNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") createFolderFromInput();
  });
  els.renameSelectedBtn.addEventListener("click", renameSelectedAsset);
  els.deleteSelectedBtn.addEventListener("click", deleteSelectedAsset);

  els.closeSaveModalBtn.addEventListener("click", closeSaveModal);
  els.cancelSaveBtn.addEventListener("click", closeSaveModal);
  els.confirmSaveBtn.addEventListener("click", confirmSave);
  els.closeSettingsModalBtn.addEventListener("click", closeSettingsModal);
  els.cancelSettingsBtn.addEventListener("click", closeSettingsModal);
  els.saveModal.addEventListener("click", (event) => {
    if (event.target === els.saveModal) closeSaveModal();
  });
  els.settingsModal.addEventListener("click", (event) => {
    if (event.target === els.settingsModal) closeSettingsModal();
  });
  els.authModal.addEventListener("click", (event) => {
    if (event.target === els.authModal && els.authModal.dataset.locked !== "true") closeAuthModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.saveModal.classList.contains("active")) closeSaveModal();
    if (event.key === "Escape" && els.settingsModal.classList.contains("active")) closeSettingsModal();
    if (
      event.key === "Escape" &&
      els.authModal.classList.contains("active") &&
      els.authModal.dataset.locked !== "true"
    ) {
      closeAuthModal();
    }
  });
}

function switchView(viewName) {
  const targetButton = Array.from(els.navItems).find((button) => button.dataset.view === viewName);
  if (targetButton?.disabled || targetButton?.getAttribute("aria-disabled") === "true") return;
  document.body.dataset.view = viewName;
  els.navItems.forEach((button) => {
    const isActive = button.dataset.view === viewName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
  els.views.forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
  if (viewName === "library") renderLibrary();
}

function loadAuthSession() {
  state.auth.token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function hasAuthSession() {
  return Boolean(state.auth.token && state.auth.user);
}

function isAdminUser(user = state.auth.user) {
  return String(user?.role || "").toLowerCase() === ADMIN_ROLE;
}

function setButtonLabel(button, label) {
  if (!button) return;
  const svg = button.querySelector("svg")?.outerHTML || "";
  button.innerHTML = `${svg}${escapeHtml(label)}`;
}

function applySuiteAccessState() {
  const admin = isAdminUser();
  els.suiteNavItem?.classList.toggle("disabled", !admin);
  els.suiteNavItem?.toggleAttribute("disabled", !admin);
  els.suiteNavItem?.setAttribute("aria-disabled", admin ? "false" : "true");
  els.suiteView?.classList.toggle("suite-disabled-view", !admin);
  els.suiteView?.setAttribute("aria-disabled", admin ? "false" : "true");
  if (els.generateSuiteBtn?.getAttribute("aria-busy") !== "true") {
    els.generateSuiteBtn.disabled = !admin;
    setButtonLabel(els.generateSuiteBtn, admin ? SUITE_ENABLED_LABEL : SUITE_DISABLED_LABEL);
  }
  if (!admin && document.body.dataset.view === "suite") switchView("generate");
}

function openAdminEntry() {
  if (!state.auth.token) {
    showToast("请先登录账号", true);
    openAuthModal({ locked: false });
    return;
  }
  const target = new URL(appRoute("/admin.html"), window.location.origin);
  target.hash = new URLSearchParams({ [ADMIN_ENTRY_TOKEN_PARAM]: state.auth.token }).toString();
  window.open(target.toString(), "_blank", "noopener");
}

function collectUserSource() {
  const params = new URLSearchParams(window.location.search);
  const sourceParam = params.get("source") || params.get("from") || "";
  const utmSource = params.get("utm_source") || sourceParam;
  const referrer = document.referrer || "";
  let source = utmSource || sourceParam;
  if (!source && referrer) {
    try {
      source = new URL(referrer).hostname || "referrer";
    } catch {
      source = "referrer";
    }
  }
  return {
    source: source || "direct",
    referrer,
    utmSource,
    utmMedium: params.get("utm_medium") || "",
    utmCampaign: params.get("utm_campaign") || "",
    sourcePath: `${window.location.pathname}${window.location.search}`
  };
}

async function bootstrapAuth() {
  console.log("[AUTH] bootstrapAuth token exists:", !!state.auth.token);
  if (!state.auth.token) {
    console.log("[AUTH] bootstrapAuth NO TOKEN, redirecting to login");
    window.location.replace("./login.html");
    return;
  }
  try {
    console.log("[AUTH] bootstrapAuth calling /api/me...");
    const payload = await apiFetch("/me");
    state.auth.user = payload.user;
    console.log("[AUTH] bootstrapAuth user loaded:", state.auth.user.name, "credits:", state.auth.user.creditsRemaining);
    await loadAccountSettings();
    await syncRecoverableGeneratedAssets();
  } catch (error) {
    console.error("[AUTH] bootstrapAuth FAILED:", error.message);
    clearAuthSession();
    window.location.replace("./login.html");
    return;
  } finally {
    console.log("[AUTH] bootstrapAuth calling renderAuthState");
    renderAuthState();
  }
}

async function apiFetch(path, options = {}) {
  const response = await fetch(appRoute(`/api${path}`), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(state.auth.token ? { Authorization: `Bearer ${state.auth.token}` } : {})
    }
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearAuthSession();
      renderAuthState();
      window.location.replace("./login.html");
      throw new Error("请重新登录");
    }
    const message = payload?.error || payload?.message || response.statusText || "请求失败";
    if (response.status === 404 && message === "接口不存在" && path === "/image-feedback") {
      throw new Error(portMismatchMessage());
    }
    const error = new Error(message);
    if (response.status === 429 && payload && (payload.required !== undefined || payload.remaining !== undefined)) {
      error.creditsRequired = payload.required;
      error.creditsRemaining = payload.remaining;
    }
    throw error;
  }
  return payload || {};
}

function portMismatchMessage() {
  const currentPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  if (currentPort === "8787") {
    return "当前页面连接的是旧的 8787 服务；请打开 http://localhost:8788/ 使用新服务，或先执行 kill 48038 后重新启动 8787。";
  }
  return "点踩接口未在当前后端生效；请重启 server.py 后再试。";
}

async function handleAuth() {
  const mode = state.activeAuthMode;
  const email = els.authNameInput.value.trim();
  const password = els.authPasswordInput.value;
  if (!email || !password) {
    showToast("请输入邮箱和密码", true);
    return;
  }
  if (mode === "register" && password.length < 8) {
    showToast("注册密码至少 8 位", true);
    return;
  }
  const button = els.authSubmitBtn;
  setBusy(true, button, mode === "register" ? "注册中" : "登录中");
  try {
    const requestBody = { email, password };
    if (mode === "register") requestBody.source = collectUserSource();
    const payload = await apiFetch(mode === "register" ? "/auth/register" : "/auth/login", {
      method: "POST",
      body: JSON.stringify(requestBody)
    });
    state.auth.token = payload.token;
    state.auth.user = payload.user;
    localStorage.setItem(AUTH_TOKEN_KEY, state.auth.token);
    els.authPasswordInput.value = "";
    await loadAccountSettings();
    closeAuthModal();
    renderAuthState();
    updateConnectionState();
    const recoveredCount = await syncRecoverableGeneratedAssets({ announce: false });
    showToast(
      recoveredCount
        ? `${mode === "register" ? "账号已创建" : "已登录"}，已同步 ${recoveredCount} 张生成图到素材区`
        : mode === "register"
          ? "账号已创建"
          : "已登录"
    );
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false, button, mode === "register" ? "注册并进入" : "登录");
  }
}

async function handleLogout() {
  try {
    if (state.auth.token) {
      await apiFetch("/auth/logout", { method: "POST", body: "{}" });
    }
  } catch {
    // Local cleanup is enough when the server-side session is already gone.
  }
  clearAuthSession();
  window.location.replace("./login.html");
}

function clearAuthSession() {
  state.auth.token = "";
  state.auth.user = null;
  state.auth.apiKeyConfigured = false;
  state.auth.videoApiKeyConfigured = false;
  state.auth.modelSettings = {
    endpoint: DEFAULT_ENDPOINT,
    model: DEFAULT_MODEL
  };
  state.auth.videoModelSettings = {
    model: ""
  };
  state.availableImageModels = [];
  state.selectedImageModelId = "";
  state.defaultImageModelId = "";
  if (els.apiKeyInput) els.apiKeyInput.value = "";
  renderImageModelSelect();
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function renderAuthState() {
  const user = state.auth.user;
  console.log("[AUTH] renderAuthState user:", user ? user.name : "null", "credits:", user ? user.creditsRemaining : "n/a");
  els.accountTitle.textContent = user ? "当前账号" : "未登录";
  els.accountNameText.textContent = user ? user.name || "已登录账号" : "注册后使用工具";
  renderAccountKeyStatus();
  applySuiteAccessState();
  els.logoutBtn.style.display = user ? "inline-flex" : "none";
  els.openAuthBtn.textContent = user ? "切换账号" : "登录";
}

function renderAccountKeyStatus() {
  if (!els.accountKeyStatus) return;
  const loggedIn = Boolean(state.auth.user);
  const imageModelName = accountModelName(state.auth.modelSettings.model);
  const videoModelName = accountModelName(state.auth.videoModelSettings.model);
  const imageReady = loggedIn && Boolean(state.auth.apiKeyConfigured) && Boolean(imageModelName);
  const videoReady = loggedIn && Boolean(state.auth.videoApiKeyConfigured) && Boolean(videoModelName);
  const statusItems = [
    {
      label: "图片 Key",
      ready: imageReady,
      text: accountConfiguredText(loggedIn, state.auth.apiKeyConfigured, imageModelName)
    },
    {
      label: "视频 Key",
      ready: videoReady,
      text: accountConfiguredText(loggedIn, state.auth.videoApiKeyConfigured, videoModelName)
    }
  ];
  els.accountKeyStatus.innerHTML = statusItems
    .map((item) => {
      const statusClass = !loggedIn ? "neutral" : item.ready ? "ready" : "missing";
      return `<span class="${statusClass}" title="${escapeAttr(item.text)}"><b>${escapeHtml(item.label)}</b><em>${escapeHtml(item.text)}</em></span>`;
    })
    .join("");
}

function accountModelName(modelName = "") {
  return String(modelName || "").trim();
}

function accountConfiguredText(loggedIn, keyConfigured, modelName = "") {
  if (!loggedIn) return "登录后查看";
  if (!keyConfigured) return "未配置";
  return accountModelName(modelName) || "未配置";
}

function switchAuthMode(mode) {
  state.activeAuthMode = mode === "register" ? "register" : "login";
  els.authModeTabs.forEach((button) => {
    const active = button.dataset.authMode === state.activeAuthMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  els.authSubmitBtn.textContent = state.activeAuthMode === "register" ? "注册并进入" : "登录";
}

function openAuthModal({ locked = false } = {}) {
  switchAuthMode("login");
  els.authModal.dataset.locked = locked ? "true" : "false";
  els.authModal.classList.add("active");
  els.authModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => els.authNameInput.focus(), 0);
}

function closeAuthModal() {
  els.authModal.classList.remove("active");
  els.authModal.setAttribute("aria-hidden", "true");
  els.authModal.dataset.locked = "false";
}

function normalizeAvailableImageModels(models) {
  return (Array.isArray(models) ? models : [])
    .filter((model) => model && model.enabled !== false && (model.id || model.providerModelId) && model.modelName)
    .map((model) => ({
      ...model,
      id: model.id || model.providerModelId
    }));
}

function imageModelLabel(model) {
  const provider = String(model?.providerName || "").trim();
  const name = String(model?.modelName || DEFAULT_MODEL).trim();
  return provider ? `${provider} / ${name}` : name;
}

function selectedImageModel() {
  return state.availableImageModels.find((model) => model.id === state.selectedImageModelId) || null;
}

function selectedImageModelName() {
  return selectedImageModel()?.modelName || state.auth.modelSettings.model || DEFAULT_MODEL;
}

function renderImageModelSelect() {
  if (!els.modelInput) return;
  if (!state.availableImageModels.length) {
    els.modelInput.innerHTML = `<option value="">${escapeHtml(state.auth.modelSettings.model || DEFAULT_MODEL)}</option>`;
    els.modelInput.value = "";
    els.modelInput.disabled = true;
    return;
  }
  els.modelInput.disabled = false;
  els.modelInput.innerHTML = state.availableImageModels
    .map((model) => {
      const defaultText = model.id === state.defaultImageModelId ? " · 默认" : "";
      return `<option value="${escapeAttr(model.id)}">${escapeHtml(imageModelLabel(model) + defaultText)}</option>`;
    })
    .join("");
  els.modelInput.value = state.availableImageModels.some((model) => model.id === state.selectedImageModelId)
    ? state.selectedImageModelId
    : state.availableImageModels[0].id;
}

function handleImageModelChange() {
  state.selectedImageModelId = els.modelInput.value;
  const model = selectedImageModel();
  if (model) {
    state.auth.modelSettings.model = model.modelName;
    state.auth.modelSettings.endpoint = model.baseUrl || state.auth.modelSettings.endpoint || DEFAULT_ENDPOINT;
  }
  renderAuthState();
  updateConnectionState();
}

async function loadAccountSettings() {
  const payload = await apiFetch("/settings");
  const settings = payload.settings || {};
  state.auth.apiKeyConfigured = Boolean(settings.imageApiKeyConfigured ?? settings.apiKeyConfigured);
  state.auth.videoApiKeyConfigured = Boolean(settings.videoApiKeyConfigured);
  state.availableImageModels = normalizeAvailableImageModels(settings.availableImageModels);
  state.defaultImageModelId =
    settings.defaultImageModelId ||
    state.availableImageModels.find((model) => model.isDefault)?.id ||
    "";
  state.selectedImageModelId = state.availableImageModels.some((model) => model.id === state.defaultImageModelId)
    ? state.defaultImageModelId
    : state.availableImageModels[0]?.id || "";
  const selectedModel = selectedImageModel();
  state.auth.modelSettings = {
    endpoint: selectedModel?.baseUrl || settings.endpoint || settings.defaultEndpoint || DEFAULT_ENDPOINT,
    model: selectedModel?.modelName || settings.model || settings.defaultModel || DEFAULT_MODEL
  };
  state.auth.videoModelSettings = {
    model: settings.videoModel || ""
  };
  applyPromptConfig(settings.promptConfig || currentPromptConfig());
  els.apiKeyInput.value = settings.apiKeyMasked || (state.auth.apiKeyConfigured ? "已配置" : "未配置");
  if (els.endpointInput) els.endpointInput.value = state.auth.modelSettings.endpoint;
  renderImageModelSelect();
  const localSize = normalizeImageSize(localStorage.getItem("imageStudio.size"));
  const savedSize = localSize || normalizeImageSize(settings.size) || "1024x1024";
  applyDetectedSize(savedSize);
  els.sizeInput.value = savedSize;
  renderAuthState();
  updateConnectionState();
}

async function syncRecoverableGeneratedAssets({ announce = true } = {}) {
  if (!state.auth.token || !state.auth.user || !state.db) return 0;
  try {
    const payload = await apiFetch("/generated-assets?limit=50");
    const remoteAssets = Array.isArray(payload.assets) ? payload.assets : [];
    if (!remoteAssets.length) return 0;
    if (!state.folders.length) {
      await ensureDefaultFolder();
      await refreshLibrary();
    }
    const importedIds = loadImportedGeneratedAssetIds();
    const existingRemoteIds = new Set(state.assets.map((asset) => asset.remoteAssetId).filter(Boolean));
    let importedCount = 0;
    for (const remoteAsset of remoteAssets.slice().reverse()) {
      const remoteId = String(remoteAsset.id || "").trim();
      const url = String(remoteAsset.url || "").trim();
      if (!remoteId || !url) continue;
      if (existingRemoteIds.has(remoteId)) {
        importedIds.add(remoteId);
        continue;
      }
      if (importedIds.has(remoteId)) continue;
      const item = libraryItemFromGeneratedAsset(remoteAsset);
      await saveAssetWithFolder(item, {
        name: item.name,
        folderId: state.folders[0]?.id,
        newFolderName: ""
      });
      importedIds.add(remoteId);
      existingRemoteIds.add(remoteId);
      importedCount += 1;
    }
    saveImportedGeneratedAssetIds(importedIds);
    if (importedCount) {
      await refreshLibrary();
      if (announce) showToast(`已同步 ${importedCount} 张生成图到素材区`);
    }
    return importedCount;
  } catch (error) {
    if (error.message !== "接口不存在") {
      console.warn("Failed to sync generated assets", error);
    }
    return 0;
  }
}

function libraryItemFromGeneratedAsset(asset) {
  const createdAt = asset.createdAt || new Date().toISOString();
  return {
    id: createId("asset"),
    name: asset.name || timestampName(),
    url: asset.url,
    prompt: asset.templateTitle ? `模板：${asset.templateTitle}` : (asset.prompt || ""),
    createdAt,
    source: "remote-generation",
    remoteAssetId: asset.id,
    logId: asset.logId || "",
    model: asset.model || state.auth.modelSettings.model || DEFAULT_MODEL,
    size: asset.size || "",
    request: asset.request || null,
    refCount: asset.refCount || 0,
    refThumbs: asset.refThumbs || []
  };
}

function generatedAssetImportKey() {
  return `${GENERATED_ASSET_IMPORT_KEY_PREFIX}:${state.auth.user?.id || "anonymous"}`;
}

function loadImportedGeneratedAssetIds() {
  try {
    const value = JSON.parse(localStorage.getItem(generatedAssetImportKey()) || "[]");
    return new Set(Array.isArray(value) ? value.filter(Boolean).map(String) : []);
  } catch {
    return new Set();
  }
}

function saveImportedGeneratedAssetIds(ids) {
  const values = Array.from(ids).slice(-300);
  localStorage.setItem(generatedAssetImportKey(), JSON.stringify(values));
}

async function verifySessionActive() {
  if (!state.auth.token) throw new Error("请先登录账号");
  const payload = await apiFetch("/me");
  state.auth.user = payload.user;
  renderAuthState();
  return true;
}

function selectedSuitePreset() {
  const presets = currentPromptConfig().suite.presets || [];
  return presets.find((preset) => preset.id === els.suitePresetInput.value) || presets[0] || null;
}

function renderSuitePlan(activeId = null, doneIds = new Set()) {
  const preset = selectedSuitePreset();
  if (!preset) {
    els.suiteShotList.innerHTML = `
      <div class="suite-shot-empty empty-state">
        <div class="empty-copy">
          <strong>套图模板已清空</strong>
          <span>请先在后台重新生成并发布套图模板。</span>
        </div>
      </div>
    `;
    return;
  }
  ensureSuiteShotSettings(preset);
  const activeShots = getSuiteActiveShots(preset);
  if (!activeShots.length) {
    els.suiteShotList.innerHTML = `
      <div class="suite-shot-empty empty-state">
        <div class="empty-copy">
          <strong>套图结构已清空</strong>
          <span>恢复默认结构后再生成。</span>
          <button class="ghost-button mini-button" type="button" data-action="restore-suite-shots">恢复默认</button>
        </div>
      </div>
    `;
    els.suiteShotList
      .querySelector("[data-action='restore-suite-shots']")
      ?.addEventListener("click", () => {
        resetSuiteShotSettings();
        renderSuitePlan(activeId, doneIds);
      });
    return;
  }

  els.suiteShotList.innerHTML = activeShots
    .map((shot, index) => {
      const status = activeId === shot.id ? "active" : doneIds.has(shot.id) ? "done" : "";
      return `
        <article class="suite-shot ${status}">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <div class="suite-shot-copy">
            <strong>${escapeHtml(shot.name)}</strong>
            <small>${escapeHtml(shot.description)}</small>
          </div>
          <div class="suite-shot-controls">
            <select class="suite-shot-size" data-action="suite-shot-size" data-shot-id="${escapeHtml(shot.id)}" aria-label="${escapeAttr(shot.name)} 输出尺寸">
              ${suiteSizeOptionMarkup(shot.outputSize, shot.size)}
            </select>
            <button class="icon-button suite-shot-remove" type="button" data-action="remove-suite-shot" data-shot-id="${escapeHtml(shot.id)}" aria-label="删除 ${escapeAttr(shot.name)}" title="删除">
              <svg viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m10 11 0 6" /><path d="m14 11 0 6" /><path d="M5 6l1 14h12l1-14" /></svg>
            </button>
          </div>
        </article>
      `;
    })
    .join("");
  bindSuitePlanControls();
}

function ensureSuiteShotSettings(preset = selectedSuitePreset()) {
  if (!preset) return;
  preset.shots.forEach((shot) => {
    if (state.suiteShotSettings[shot.id]) return;
    state.suiteShotSettings[shot.id] = {
      enabled: true,
      size: defaultSuiteShotSize(shot)
    };
  });
}

function resetSuiteShotSettings(preset = selectedSuitePreset()) {
  if (!preset) return;
  preset.shots.forEach((shot) => {
    state.suiteShotSettings[shot.id] = {
      enabled: true,
      size: defaultSuiteShotSize(shot)
    };
  });
}

function defaultSuiteShotSize(shot) {
  const selectedSize = els.suiteSizeInput?.value || "preset";
  if (selectedSize !== "preset") return selectedSize;
  return normalizeImageSize(localStorage.getItem("imageStudio.size")) || shot.size;
}

function getSuiteActiveShots(preset = selectedSuitePreset()) {
  if (!preset) return [];
  ensureSuiteShotSettings(preset);
  return preset.shots
    .filter((shot) => state.suiteShotSettings[shot.id]?.enabled !== false)
    .map((shot) => ({
      ...shot,
      outputSize: state.suiteShotSettings[shot.id]?.size || shot.size
    }));
}

function bindSuitePlanControls() {
  els.suiteShotList.querySelectorAll("[data-action='suite-shot-size']").forEach((select) => {
    select.addEventListener("change", () => {
      const setting = state.suiteShotSettings[select.dataset.shotId];
      if (!setting) return;
      setting.size = select.value;
      renderSuitePlan();
    });
  });
  els.suiteShotList.querySelectorAll("[data-action='remove-suite-shot']").forEach((button) => {
    button.addEventListener("click", () => {
      const setting = state.suiteShotSettings[button.dataset.shotId];
      if (!setting) return;
      setting.enabled = false;
      renderSuitePlan();
      showToast("已从套图结构中删除");
    });
  });
}

function suiteSizeOptionMarkup(selectedSize, presetSize) {
  const sizes = uniqueValues([
    selectedSize,
    normalizeImageSize(localStorage.getItem("imageStudio.size")),
    presetSize,
    "1024x1024",
    "1024x1792",
    "1792x1024"
  ]);
  return sizes
    .map((size) => {
      const label = size === presetSize ? `${size} 推荐` : size;
      return `<option value="${escapeAttr(size)}"${size === selectedSize ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function handleSuiteSizeChange() {
  const preset = selectedSuitePreset();
  if (!preset) return;
  ensureSuiteShotSettings(preset);
  if (els.suiteSizeInput.value === "preset") {
    preset.shots.forEach((shot) => {
      const setting = state.suiteShotSettings[shot.id];
      if (setting?.enabled !== false) setting.size = shot.size;
    });
  } else {
    localStorage.setItem("imageStudio.size", els.suiteSizeInput.value);
    applySuiteSizeToShots(els.suiteSizeInput.value);
  }
  renderSuitePlan();
}

function applySuiteSizeToShots(size) {
  const normalizedSize = normalizeImageSize(size);
  if (!normalizedSize) return;
  const preset = selectedSuitePreset();
  if (!preset) return;
  ensureSuiteShotSettings(preset);
  preset.shots.forEach((shot) => {
    const setting = state.suiteShotSettings[shot.id];
    if (setting?.enabled !== false) setting.size = normalizedSize;
  });
}

async function handleSuiteFiles(fileList) {
  const file = Array.from(fileList || []).find((entry) => entry.type.startsWith("image/"));
  if (!file) return;
  const url = await readFileAsDataUrl(file);
  const dimensions = await readImageDimensions(url);
  const detectedSize = dimensions ? `${dimensions.width}x${dimensions.height}` : "";
  const size = normalizeImageSize(detectedSize) || detectedSize;
  state.suiteReference = {
    id: createId("suite-ref"),
    name: file.name.replace(/\.[^.]+$/, ""),
    url,
    width: dimensions?.width || null,
    height: dimensions?.height || null,
    size,
    prompt: currentPromptConfig().reference.defaultAssetPromptLabels?.suiteReference || "套图商品基图",
    createdAt: new Date().toISOString(),
    source: "suite-reference"
  };
  applyDetectedSize(size);
  if (!els.suiteProductNameInput.value.trim()) {
    els.suiteProductNameInput.value = state.suiteReference.name;
  }
  renderSuiteReference();
  applySuiteSizeToShots(size);
  renderSuitePlan();
  showToast("商品基图已载入");
}

function renderSuiteReference() {
  if (!state.suiteReference) {
    els.suiteReferencePreview.className = "suite-reference empty-state";
    els.suiteReferencePreview.innerHTML = `
      <div class="empty-copy">
        <strong>未选择基图</strong>
        <span>可上传商品图片作为参考。</span>
      </div>
    `;
    return;
  }
  els.suiteReferencePreview.className = "suite-reference";
  els.suiteReferencePreview.innerHTML = `
    <img src="${escapeAttr(state.suiteReference.url)}" alt="${escapeAttr(state.suiteReference.name)}" />
    <div>
      <strong>${escapeHtml(state.suiteReference.name)}</strong>
      <span>${escapeHtml(state.suiteReference.size || "用于套图主体一致性")}</span>
    </div>
    <button class="reference-remove" type="button" data-action="clear-suite-reference" aria-label="删除参考图" title="删除参考图">
      <svg viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
    </button>
  `;
  els.suiteReferencePreview
    .querySelector("[data-action='clear-suite-reference']")
    ?.addEventListener("click", clearSuiteReference);
}

function clearSuiteReference() {
  state.suiteReference = null;
  els.suiteUploadInput.value = "";
  renderSuiteReference();
  showToast("参考图已删除");
}

function selectedVideoPreset() {
  return window.VideoPlanner.getVideoPreset(els.videoPresetInput.value);
}

function videoContext() {
  const productName = els.videoProductNameInput.value.trim() || state.videoReference?.name || "";
  const category = els.videoCategoryInput.value.trim();
  const sellingPoints = els.videoSellingPointsInput.value.trim();
  const styleText = els.videoStyleInput.options[els.videoStyleInput.selectedIndex]?.text || "医疗清爽";
  return {
    productName,
    category,
    sellingPoints,
    style: styleText,
    hasReference: Boolean(state.videoReference)
  };
}

async function handleVideoFiles(fileList) {
  const file = Array.from(fileList || []).find((entry) => entry.type.startsWith("image/"));
  if (!file) return;
  const url = await readFileAsDataUrl(file);
  const dimensions = await readImageDimensions(url);
  const detectedSize = dimensions ? `${dimensions.width}x${dimensions.height}` : "";
  state.videoReference = {
    id: createId("video-ref"),
    name: file.name.replace(/\.[^.]+$/, ""),
    url,
    width: dimensions?.width || null,
    height: dimensions?.height || null,
    size: detectedSize,
    createdAt: new Date().toISOString(),
    source: "video-reference"
  };
  if (!els.videoProductNameInput.value.trim()) {
    els.videoProductNameInput.value = state.videoReference.name;
  }
  state.videoScenes = [];
  renderVideoReference();
  renderVideoScenes();
  updateVideoPlanButton();
  showToast("视频商品图已载入");
}

function renderVideoReference() {
  if (!state.videoReference) {
    els.videoReferencePreview.className = "suite-reference video-reference-preview is-empty";
    els.videoReferencePreview.innerHTML = "";
    return;
  }
  els.videoReferencePreview.className = "suite-reference video-reference-preview";
  els.videoReferencePreview.innerHTML = `
    <img src="${escapeAttr(state.videoReference.url)}" alt="${escapeAttr(state.videoReference.name)}" />
    <div>
      <strong>${escapeHtml(state.videoReference.name)}</strong>
      <span>${escapeHtml(state.videoReference.size || "视频外观参考")}</span>
    </div>
    <button class="reference-remove" type="button" data-action="clear-video-reference" aria-label="删除商品图" title="删除商品图">
      <svg viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
    </button>
  `;
  els.videoReferencePreview
    .querySelector("[data-action='clear-video-reference']")
    ?.addEventListener("click", clearVideoReference);
}

function clearVideoReference() {
  state.videoReference = null;
  resetVideoJob();
  els.videoUploadInput.value = "";
  renderVideoReference();
  renderVideoScenes();
  updateVideoPlanButton();
  showToast("视频商品图已删除");
}

function renderVideoOutputControls(options = {}) {
  const preset = selectedVideoPreset();
  if (options.resetToDefaults) {
    els.videoAspectInput.value = preset.defaultAspectRatio;
    els.videoDurationInput.value = String(preset.defaultDurationSeconds);
    els.videoSceneCountInput.value = String(preset.defaultSceneCount);
  }
  const aspectOptions = preset.aspectOptions.map((option) => ({
    value: option.value,
    label: option.label,
    detail: option.output
  }));
  const durationOptions = preset.durationOptions.map((seconds) => ({
    value: String(seconds),
    label: `${seconds} 秒`,
    detail: seconds === preset.defaultDurationSeconds ? "推荐" : ""
  }));
  const sceneCountOptions = preset.sceneCountOptions.map((count) => ({
    value: String(count),
    label: `${count} 个镜头`,
    detail: videoSceneCountDetail(preset, count)
  }));

  renderSelectOptions(
    els.videoAspectInput,
    aspectOptions.map((option) => ({
      value: option.value,
      label: `${option.label} · ${option.detail}`
    })),
    preset.defaultAspectRatio
  );
  renderSelectOptions(
    els.videoDurationInput,
    durationOptions,
    String(preset.defaultDurationSeconds)
  );
  renderSelectOptions(
    els.videoSceneCountInput,
    sceneCountOptions,
    String(preset.defaultSceneCount)
  );

  renderVideoChoiceButtons(els.videoAspectOptions, els.videoAspectInput, aspectOptions, "画幅比例");
  renderVideoChoiceButtons(els.videoDurationOptions, els.videoDurationInput, durationOptions, "目标时长");
  renderVideoChoiceButtons(els.videoSceneCountOptions, els.videoSceneCountInput, sceneCountOptions, "镜头数");
}

function videoSceneCountDetail(preset, count) {
  if (preset.id === "sponsored-brands" && Number(els.videoDurationInput.value) <= 6 && count === 1) {
    return "6秒推荐";
  }
  return count === preset.defaultSceneCount ? "默认" : "";
}

function renderSelectOptions(select, options, preferredValue) {
  const currentValue = select.value;
  const values = options.map((option) => option.value);
  const selectedValue = values.includes(currentValue) ? currentValue : preferredValue;
  select.innerHTML = options
    .map(
      (option) =>
        `<option value="${escapeAttr(option.value)}"${option.value === selectedValue ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )
    .join("");
}

function renderVideoChoiceButtons(container, select, options, groupLabel) {
  container.innerHTML = options
    .map((option) => {
      const isSelected = option.value === select.value;
      const detail = option.detail ? `<small>${escapeHtml(option.detail)}</small>` : "";
      return `
        <button class="video-choice-button${isSelected ? " active" : ""}" type="button" data-value="${escapeAttr(option.value)}" role="radio" aria-checked="${isSelected}" aria-label="${escapeAttr(`${groupLabel}：${option.label}`)}">
          <span>${escapeHtml(option.label)}</span>
          ${detail}
        </button>
      `;
    })
    .join("");

  container.querySelectorAll("[data-value]").forEach((button) => {
    button.addEventListener("click", () => selectVideoOutputOption(select, button.dataset.value));
  });
}

function selectVideoOutputOption(select, value) {
  if (select.value === value) return;
  select.value = value;
  if (select === els.videoDurationInput) applyShortAdSceneDefault();
  handleVideoOutputChange();
  renderVideoOutputControls();
}

function applyShortAdSceneDefault() {
  if (selectedVideoPreset().id === "sponsored-brands" && Number(els.videoDurationInput.value) <= 6) {
    els.videoSceneCountInput.value = "1";
  }
}

function handleVideoOutputChange() {
  state.videoScenes = [];
  resetVideoJob();
  renderVideoSpecs();
  renderVideoScenes();
}

function renderVideoSpecs() {
  const preset = selectedVideoPreset();
  els.videoPresetBadge.textContent = preset.badge;
  els.videoPresetMeta.textContent = `${preset.placement} · ${preset.objective}`;
  const selectedAspect = selectedVideoAspectOption(preset);
  const duration = `${els.videoDurationInput.value} 秒`;
  const sceneCount = `${els.videoSceneCountInput.value} 个镜头`;
  els.videoOutputHint.textContent = `已按「${videoPresetShortTitle(preset)}」筛选可用比例和时长`;
  els.videoInlineSummary.innerHTML = `
    <span>${escapeHtml(videoPresetShortTitle(preset))}</span>
    <span>${escapeHtml(els.videoAspectInput.value)}</span>
    <span>${escapeHtml(duration)}</span>
    <span>${escapeHtml(sceneCount)}</span>
    <span>${escapeHtml(`合规 ${preset.duration}`)}</span>
  `;
  const specs = [
    ["画幅", `${els.videoAspectInput.value} · ${selectedAspect.output}`],
    ["时长", duration],
    ["用途", preset.badge],
    ["文件", preset.fileSize],
    ["合规", preset.duration]
  ];
  els.videoSpecCards.innerHTML = specs
    .map(
      ([label, value]) => `
        <article class="video-spec-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `
    )
    .join("");
  const complianceItems = [
    "医疗设备内容避免诊断、治疗、治愈、预防疾病等功效承诺",
    "优先使用测量、监测、便携、易读、家庭日常使用等安全表达",
    "不要出现未经验证的认证、医生背书或绝对化承诺"
  ];
  els.videoComplianceList.innerHTML = complianceItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  els.videoPolicyDetailList.innerHTML = preset.notes.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function selectedVideoAspectOption(preset = selectedVideoPreset()) {
  return preset.aspectOptions.find((option) => option.value === els.videoAspectInput.value) || preset.aspectOptions[0];
}

function renderVideoPresetCards() {
  const selectedId = els.videoPresetInput.value;
  els.videoPresetCards.innerHTML = window.VideoPlanner.getVideoPresets()
    .map((preset) => {
      const isSelected = preset.id === selectedId;
      return `
        <button class="video-preset-card${isSelected ? " active" : ""}" type="button" data-preset-id="${escapeAttr(preset.id)}" role="option" aria-selected="${isSelected}">
          <strong>${escapeHtml(videoPresetShortTitle(preset))}</strong>
          <small>${escapeHtml(videoPresetCardHint(preset))}</small>
        </button>
      `;
    })
    .join("");
  els.videoPresetCards.querySelectorAll("[data-preset-id]").forEach((button) => {
    button.addEventListener("click", () => selectVideoPreset(button.dataset.presetId));
  });
}

function videoPresetCardHint(preset) {
  const hints = {
    shoppable: "商详页自然视频",
    "sponsored-brands": "搜索和详情广告位",
    "store-a-plus": "品牌 Store 或 A+ 模块"
  };
  return hints[preset.id] || preset.objective;
}

function videoPresetShortTitle(preset) {
  const titles = {
    shoppable: "商详页",
    "sponsored-brands": "广告视频",
    "store-a-plus": "Store / A+"
  };
  return titles[preset.id] || preset.title;
}

function selectVideoPreset(presetId) {
  if (els.videoPresetInput.value === presetId) return;
  els.videoPresetInput.value = presetId;
  state.videoScenes = [];
  resetVideoJob();
  renderVideoOutputControls({ resetToDefaults: true });
  renderVideoSpecs();
  renderVideoPresetCards();
  renderVideoScenes();
}

function handleVideoPrimaryAction() {
  if (!state.videoReference) {
    showToast("请先上传商品图，图生视频需要商品外观参考", true);
    return;
  }
  if (state.videoJob?.status === "processing" || state.videoJob?.status === "queued") {
    showToast("视频正在生成中，请稍候");
    return;
  }
  if (state.videoScenes.length) {
    startMockVideoGeneration();
    return;
  }
  state.videoScenes = buildVideoPlan();
  renderVideoScenes();
  updateVideoPlanButton();
  showToast("视频分镜已生成，可确认后继续生成视频");
}

function refreshVideoPlanDraft() {
  state.videoScenes = [];
  resetVideoJob();
  renderVideoScenes();
}

function updateVideoPlanButton() {
  const hasReference = Boolean(state.videoReference);
  els.generateVideoPlanBtn.disabled = !hasReference;
  if (!hasReference) {
    els.generateVideoPlanLabel.textContent = "生成视频";
    els.generateVideoPlanBtn.title = "请先上传商品图";
    return;
  }
  if (state.videoJob?.status === "processing" || state.videoJob?.status === "queued") {
    els.generateVideoPlanLabel.textContent = `生成中 ${state.videoJob.progress}%`;
    els.generateVideoPlanBtn.title = "视频正在生成中";
    return;
  }
  if (state.videoJob?.status === "completed") {
    els.generateVideoPlanLabel.textContent = "重新生成视频";
    els.generateVideoPlanBtn.title = "用当前分镜重新生成视频";
    return;
  }
  const hasPlan = Boolean(state.videoScenes.length);
  els.generateVideoPlanLabel.textContent = hasPlan ? "确认并生成视频" : "生成视频";
  els.generateVideoPlanBtn.title = hasPlan ? "使用当前分镜生成视频" : "先生成可确认的视频分镜方案";
}

function buildVideoPlan() {
  const context = videoContext();
  return window.VideoPlanner.buildVideoScenes({
    presetId: els.videoPresetInput.value,
    productName: context.productName,
    category: context.category,
    sellingPoints: context.sellingPoints,
    style: context.style,
    hasReference: context.hasReference,
    aspectRatio: els.videoAspectInput.value,
    targetDurationSeconds: Number(els.videoDurationInput.value),
    sceneCount: Number(els.videoSceneCountInput.value)
  });
}

function renderVideoScenes() {
  if (!state.videoReference) {
    els.videoSceneCount.textContent = "待生成";
    els.videoSceneList.innerHTML = "";
    renderVideoResultState();
    updateVideoPlanButton();
    return;
  }
  if (!state.videoScenes.length) {
    els.videoSceneCount.textContent = "待生成";
    els.videoSceneList.innerHTML = "";
    renderVideoResultState();
    updateVideoPlanButton();
    return;
  }
  const scenes = state.videoScenes;
  renderVideoResultState();
  els.videoSceneCount.textContent = `${scenes.length} 个镜头`;
  els.videoSceneList.innerHTML = scenes
    .map(
      (scene, index) => `
        <article class="video-scene-card">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <div>
            <div class="video-scene-head">
              <strong>${escapeHtml(scene.name.replace(/^\d+\s*/, ""))}</strong>
              <small>${escapeHtml(scene.duration)}</small>
            </div>
            <textarea class="video-scene-prompt" data-scene-index="${index}" rows="6" aria-label="${escapeAttr(scene.name)} 场景提示词">${escapeHtml(scene.prompt)}</textarea>
          </div>
        </article>
      `
    )
    .join("");
  els.videoSceneList.querySelectorAll("[data-scene-index]").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const scene = state.videoScenes[Number(textarea.dataset.sceneIndex)];
      if (scene) scene.prompt = textarea.value;
    });
  });
  updateVideoPlanButton();
}

function renderVideoResultState() {
  const hasPlan = Boolean(state.videoScenes.length);
  const job = state.videoJob;
  els.videoStoryboardDetails.hidden = !hasPlan;
  els.videoResultPreview.classList.toggle("is-planned", hasPlan || Boolean(job));
  if (job?.status === "processing" || job?.status === "queued") {
    els.videoResultPreview.innerHTML = `
      <div class="video-job-progress">
        <strong>正在生成视频</strong>
        <span>${escapeHtml(window.VideoMockService.videoJobSummary(job))}</span>
        <div class="video-progress-track" aria-label="视频生成进度">
          <span style="width: ${job.progress}%"></span>
        </div>
        <small>${job.progress}% · Mock provider</small>
      </div>
    `;
    updateVideoPlanButton();
    return;
  }
  if (job?.status === "completed") {
    els.videoResultPreview.innerHTML = `
      <div class="video-mock-player">
        <div class="video-mock-frame">
          <span>MOCK VIDEO</span>
          <strong>${escapeHtml(job.title)}</strong>
          <small>${escapeHtml(window.VideoMockService.videoJobSummary(job))}</small>
        </div>
        <div class="video-result-actions">
          <button class="ghost-button mini-button" type="button" data-action="download-mock-video">下载 Mock 预览</button>
          <button class="ghost-button mini-button" type="button" data-action="rerun-mock-video">重新生成</button>
        </div>
      </div>
    `;
    bindVideoResultActions();
    updateVideoPlanButton();
    return;
  }
  els.videoResultPreview.innerHTML = hasPlan
    ? `
      <div class="video-result-ready">
        <strong>视频方案已生成</strong>
        <span>确认后将用当前商品图和分镜生成成片。</span>
      </div>
    `
    : `
      <div class="empty-copy">
        <strong>${state.videoReference ? "准备生成视频" : "生成后在这里预览视频"}</strong>
        <span>${state.videoReference ? "点击左侧按钮后，会先生成可确认的视频方案。" : "右侧会显示成片预览、规格摘要和可编辑分镜。"}</span>
      </div>
    `;
  updateVideoPlanButton();
}

function startMockVideoGeneration() {
  const context = videoContext();
  const preset = selectedVideoPreset();
  resetVideoJob();
  state.videoJob = window.VideoMockService.createMockVideoJob({
    title: context.productName || state.videoReference?.name || "商品视频",
    presetTitle: videoPresetShortTitle(preset),
    aspectRatio: els.videoAspectInput.value,
    durationSeconds: Number(els.videoDurationInput.value),
    sceneCount: Number(els.videoSceneCountInput.value)
  });
  renderVideoResultState();
  showToast("Mock 视频任务已创建");
  const progressSteps = [18, 42, 68, 100];
  let index = 0;
  state.videoJobTimer = window.setInterval(() => {
    if (!state.videoJob) return resetVideoJob();
    state.videoJob = window.VideoMockService.advanceMockVideoJob(state.videoJob, progressSteps[index]);
    renderVideoResultState();
    index += 1;
    if (index >= progressSteps.length) {
      window.clearInterval(state.videoJobTimer);
      state.videoJobTimer = null;
      showToast("Mock 视频已生成");
    }
  }, 800);
}

function resetVideoJob() {
  if (state.videoJobTimer) {
    window.clearInterval(state.videoJobTimer);
    state.videoJobTimer = null;
  }
  state.videoJob = null;
}

function bindVideoResultActions() {
  els.videoResultPreview
    .querySelector("[data-action='download-mock-video']")
    ?.addEventListener("click", downloadMockVideoPreview);
  els.videoResultPreview
    .querySelector("[data-action='rerun-mock-video']")
    ?.addEventListener("click", startMockVideoGeneration);
}

function downloadMockVideoPreview() {
  if (!state.videoJob) return;
  const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(state.videoJob.title)}</title><style>body{font-family:system-ui,sans-serif;padding:32px;background:#f6fbff;color:#13233a}.card{max-width:720px;margin:auto;padding:24px;border:1px solid #cde3ee;border-radius:12px;background:white}</style><div class="card"><h1>${escapeHtml(state.videoJob.title)}</h1><p>${escapeHtml(window.VideoMockService.videoJobSummary(state.videoJob))}</p><p>这是本地 Mock 视频生成预览文件，用于验证下载链路。</p></div>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = state.videoJob.downloadName || "mock-video.html";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function suiteContext() {
  const config = currentPromptConfig();
  const fallbacks = config.suite.contextFallbacks || {};
  const productName = els.suiteProductNameInput.value.trim() || state.suiteReference?.name || "";
  const category = els.suiteCategoryInput.value.trim();
  const sellingPoints = els.suiteSellingPointsInput.value.trim();
  const styleText = selectedSuiteVisualStyle()?.label || fallbacks.styleText || "高级简洁";
  return {
    productName,
    productLabel: productName || fallbacks.productLabel || "商品基图中的产品",
    category: category || fallbacks.category || "通用电商品类",
    sellingPoints: sellingPoints || fallbacks.sellingPoints || "根据商品外观推断核心材质、功能、使用场景和包装价值",
    styleText,
    referenceName: state.suiteReference?.name || ""
  };
}

async function handleGenerateSuite() {
  if (!(await ensureApiReady())) return;

  const preset = selectedSuitePreset();
  if (!preset) {
    showToast("套图模板已清空，请先在后台重新生成并发布", true);
    return;
  }
  const context = suiteContext();
  const activeShots = getSuiteActiveShots(preset);
  if (!activeShots.length) {
    showToast("请至少保留一张套图图位", true);
    return;
  }
  const credits = state.auth.user ? (state.auth.user.creditsRemaining || 0) : 0;
  if (credits < activeShots.length) {
    showCreditsModal(activeShots.length, credits);
    return;
  }
  const doneIds = new Set();
  const suiteId = createId("suite");
  const suiteFolderName = `${context.productName || preset.folder}-${timestampName()}`;
  let folder = null;
  const generated = [];

  state.referenceFallbackNotice = "";
  state.suiteGenerated = [];
  state.generated = [];
  renderSuiteLoading(activeShots);
  setBusy(true, els.generateSuiteBtn, "生成中");

  try {
    if (els.suiteAutoSaveToggle.checked) {
      folder = await createFolder(suiteFolderName);
    }

    for (const shot of activeShots) {
      renderSuitePlan(shot.id, doneIds);
      const requestedSize = shot.outputSize || shot.size;
      const images = await requestImages({
        suitePresetId: preset.id,
        suiteShotId: shot.id,
        count: 1,
        size: requestedSize,
        referenceImages: state.suiteReference ? [state.suiteReference] : []
      });
      const item = {
        id: createId("suite-img"),
        name: `${shot.name}-${context.productName || timestampName()}`,
        url: images[0].url,
        prompt: `套图模板：${preset.title} / ${shot.name}`,
        createdAt: new Date().toISOString(),
        source: "suite",
        suiteId,
        shotId: shot.id,
	        shotName: shot.name,
	        model: selectedImageModelName(),
	        size: requestedSize,
	        request: images[0].request || state.lastRequestPayload,
	        remoteAssetId: images[0].remoteAssetId || images[0].generatedAssetId || "",
	        generatedAssetId: images[0].generatedAssetId || images[0].remoteAssetId || ""
	      };
      generated.push(item);
      state.suiteGenerated = generated;
      state.generated = generated;
      renderSuiteResults(generated);

      if (folder) {
        await saveAssetWithFolder(item, {
          name: item.name,
          folderId: folder.id,
          newFolderName: ""
        });
      }

      doneIds.add(shot.id);
    }

    renderSuitePlan(null, doneIds);
    if (folder) await refreshLibrary();
    showGenerationToast(`已生成 ${generated.length} 张套图`);
  } catch (error) {
    renderSuiteResults(generated);
    showToast(error.message, true);
  } finally {
    setBusy(false, els.generateSuiteBtn, "生成整套图片");
  }
}

function renderSuiteLoading(shots) {
  els.suiteResultGrid.className = "result-grid suite-result-grid";
  els.suiteResultGrid.innerHTML = shots
    .map(
      (shot) => {
        const requestedSize = shot.outputSize || shot.size;
        return `
        <article class="image-card">
          <div class="image-frame loading"></div>
          <div class="image-meta">
            <div class="image-title-row"><strong>${escapeHtml(shot.name)}</strong><span>${escapeHtml(requestedSize)}</span></div>
            <div class="prompt-preview">排队生成中</div>
          </div>
        </article>
      `;
      }
    )
    .join("");
}

function renderSuiteResults(items = state.suiteGenerated) {
  if (!items.length) {
    els.suiteResultGrid.className = "result-grid suite-result-grid empty-state";
    els.suiteResultGrid.innerHTML = `<div class="empty-copy"><strong>等待生成套图</strong><span>整套商品图会按用途出现在这里。</span></div>`;
    return;
  }
  els.suiteResultGrid.className = "result-grid suite-result-grid";
  els.suiteResultGrid.innerHTML = items.map((item) => renderImageCard(item)).join("");
  bindImageCardActions(els.suiteResultGrid, items);
}

function handleSaveSuite() {
  if (!state.suiteGenerated.length) {
    showToast("暂无可保存套图", true);
    return;
  }
  openSaveModal(state.suiteGenerated[0], state.suiteGenerated);
}

function renderTemplates() {
  const category = els.templateFilter.value || "all";
  const allTemplates = currentPromptConfig().single.templates || [];
  const visibleTemplates = category === "all" ? allTemplates : allTemplates.filter((item) => item.category === category);
  ensureSelectedTemplate(visibleTemplates.length ? visibleTemplates : allTemplates);
  els.templateGrid.innerHTML = visibleTemplates
    .map(
      (template) => `
        <button class="template-card ${state.selectedTemplateId === template.id ? "active" : ""}" type="button" data-template-id="${escapeHtml(template.id)}">
          <strong>${escapeHtml(template.title)}</strong>
        </button>
      `
    )
    .join("");
  els.templateGrid.querySelectorAll(".template-card").forEach((button) => {
    button.addEventListener("click", () => {
      const template = allTemplates.find((item) => item.id === button.dataset.templateId);
      if (!template) return;
      state.selectedTemplateId = template.id;
      renderTemplates();
      showToast(`已套用：${template.title}`);
    });
  });
}

function ensureSelectedTemplate(allTemplates = currentPromptConfig().single.templates || []) {
  if (allTemplates.some((template) => template.id === state.selectedTemplateId)) return;
  state.selectedTemplateId = defaultSingleTemplate(allTemplates)?.id || "";
}

function selectedSingleTemplate() {
  const templates = currentPromptConfig().single.templates || [];
  return templates.find((template) => template.id === state.selectedTemplateId) || defaultSingleTemplate(templates);
}

function defaultSingleTemplate(allTemplates = currentPromptConfig().single.templates || []) {
  const singleConfig = currentPromptConfig().single || {};
  const defaultCategory = singleConfig.defaultTemplateCategory || DEFAULT_SINGLE_TEMPLATE_CATEGORY;
  return (
    allTemplates.find((template) => template.id === singleConfig.defaultTemplateId) ||
    allTemplates.find((template) => template.id === DEFAULT_SINGLE_TEMPLATE_ID) ||
    allTemplates.find((template) => template.category === defaultCategory) ||
    allTemplates[0] ||
    null
  );
}

function renderTemplates() {
  const selection = syncSingleSelectionState({ preferRememberedScenario: true });
  if (!els.templateSelectionHint) return;
  if (!selection.template || !selection.platform || !selection.category || !selection.scenario) {
    els.templateSelectionHint.innerHTML = `<span>请选择平台、品类和场景</span>`;
    return;
  }
  els.templateSelectionHint.innerHTML = `
    <strong>${escapeHtml(selection.scenario.title || selection.template.title || "已选场景")}</strong>
    <span>${escapeHtml(selection.platform.label)} / ${escapeHtml(selection.category.label)}</span>
  `;
}

function selectedSingleTemplate() {
  return resolveSingleTemplateSelection({ preferRememberedScenario: true }).template || defaultSingleTemplate();
}

function defaultSingleTemplate(allTemplates = currentPromptConfig().single.templates || []) {
  const singleConfig = currentPromptConfig().single || {};
  const defaults = singleConfig.matrix?.defaults || singleConfig.defaults || {};
  return (
    allTemplates.find((template) => template.id === singleConfig.defaultTemplateId) ||
    allTemplates.find((template) => template.id === DEFAULT_SINGLE_TEMPLATE_ID) ||
    allTemplates.find(
      (template) =>
        template.platform === defaults.platformId &&
        template.category === defaults.categoryId &&
        template.scenario === defaults.scenarioId
    ) ||
    allTemplates.find((template) => template.category === (singleConfig.defaultTemplateCategory || DEFAULT_SINGLE_TEMPLATE_CATEGORY)) ||
    allTemplates[0] ||
    null
  );
}

function loadUserTemplates() {
  userTemplates = [];
}

function saveCurrentPromptTemplate() {
  showToast("模板由后台统一配置", true);
}

function deleteUserTemplate(templateId) {
  void templateId;
}

function renderQuickEdits() {
  const edits = currentPromptConfig().refinement.quickEdits || [];
  els.quickEditGrid.innerHTML = edits
    .map((edit) => `<button class="quick-edit" type="button" data-edit="${escapeHtml(edit.text)}">${escapeHtml(edit.text)}</button>`)
    .join("");
  els.quickEditGrid.querySelectorAll(".quick-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.edit;
      els.editPromptInput.value = els.editPromptInput.value
        ? `${els.editPromptInput.value.trim()}\n${value}`
        : value;
    });
  });
}

function loadSettings() {
  localStorage.removeItem("imageStudio.apiKey");
  els.apiKeyInput.value = "";
  if (els.endpointInput) els.endpointInput.value = DEFAULT_ENDPOINT;
  state.auth.modelSettings.model = DEFAULT_MODEL;
  renderImageModelSelect();
  const rawSavedSize = localStorage.getItem("imageStudio.size");
  const savedSize = normalizeImageSize(rawSavedSize) || "1024x1024";
  if (rawSavedSize !== savedSize) {
    localStorage.setItem("imageStudio.size", savedSize);
  }
  if (!Array.from(els.sizeInput.options).some((option) => option.value === savedSize)) {
    const option = document.createElement("option");
    option.value = savedSize;
    option.textContent = `自定义尺寸 ${savedSize}`;
    option.dataset.detected = "true";
    els.sizeInput.prepend(option);
  }
  els.sizeInput.value = savedSize;
  if (els.suiteSizeInput && savedSize !== "1024x1024") {
    applyDetectedSize(savedSize);
  }
}

async function saveSettings() {
  if (!hasAuthSession()) {
    openAuthModal({ locked: true });
    showToast("请先登录账号", true);
    return;
  }
  setBusy(true, els.saveApiBtn, "保存中");
  let saved = false;
  try {
    await apiFetch("/settings", {
      method: "PUT",
      body: JSON.stringify({
        size: els.sizeInput.value
      })
    });
    saved = true;
    showToast("尺寸偏好已保存");
    closeSettingsModal();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false, els.saveApiBtn, "保存配置");
  }
  if (!saved) return;
  localStorage.removeItem("imageStudio.apiKey");
  localStorage.setItem("imageStudio.size", els.sizeInput.value);
  updateConnectionState();
}

function isLegacyDefaultEndpoint(value) {
  const text = normalized(value);
  return text === "https://api.muskapis.com/v1/images/generations";
}

function isLegacyDefaultModel(value) {
  return normalized(value) === "gpt-image-2";
}

function updateConnectionState() {
  if (!hasAuthSession()) {
    [els.connectionState, els.singleConnectionState].forEach((button) => {
      if (!button) return;
      button.textContent = "请先登录";
      button.classList.remove("ready");
    });
    return;
  }
  const hasKey = Boolean(state.auth.apiKeyConfigured);
  const text = hasKey ? "API 已就绪" : "等待管理员配置";
  [els.connectionState, els.singleConnectionState].forEach((button) => {
    if (!button) return;
    button.textContent = text;
    button.classList.toggle("ready", hasKey);
  });
}

function toggleApiKey() {
  els.apiKeyInput.type = els.apiKeyInput.type === "password" ? "text" : "password";
}

async function ensureApiReady() {
  if (!hasAuthSession()) {
    openAuthModal({ locked: true });
    showToast("请先登录账号", true);
    return false;
  }
  await verifySessionActive();
  await loadAccountSettings();
  if (state.auth.apiKeyConfigured) return true;
  openSettingsModal();
  showToast("请联系管理员配置 API Key", true);
  return false;
}

function openSettingsModal() {
  if (!hasAuthSession()) {
    openAuthModal({ locked: true });
    showToast("请先登录账号", true);
    return;
  }
  els.settingsModal.classList.add("active");
  els.settingsModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => els.apiKeyInput.focus(), 0);
}

function closeSettingsModal() {
  els.settingsModal.classList.remove("active");
  els.settingsModal.setAttribute("aria-hidden", "true");
}

async function handleTestReferenceSupport() {
  if (!(await ensureApiReady())) return;

  const probeConfig = currentPromptConfig().referenceProbe || {};
  const reference = firstAvailableReferenceImage() || probeConfig.fallbackReference;
  const references = normalizeReferenceImages([reference]);
  const usingFallbackReference = !firstAvailableReferenceImage();
  const probePrompt = withStrictProductReference(
    withReferenceContext(
      probeConfig.withReferencePrompt,
      references
    )
  );

  renderReferenceProbeLoading(reference, usingFallbackReference);
  setBusy(true, els.testReferenceBtn, "测试中");
  try {
    const referenceImages = await requestImages({
      prompt: probePrompt,
      count: 1,
      size: probeConfig.size || "1024x1024",
      referenceImages: references
    });
    const controlImages = await requestImages({
      prompt: withStrictProductReference(probeConfig.controlPrompt),
      count: 1,
      size: probeConfig.size || "1024x1024",
      referenceImages: []
    });
    renderReferenceProbeResult({
      reference,
      referenceImage: referenceImages[0],
      controlImage: controlImages[0],
      strategy: referenceImages[0]?.request?.strategy || "后端代理",
      usingFallbackReference
    });
    showToast("入参图片已通过后端代理发送");
  } catch (error) {
    renderReferenceProbeError(error.message);
    showToast(error.message, true);
  } finally {
    setBusy(false, els.testReferenceBtn, "测试入参图片");
  }
}

function renderReferenceProbeLoading(reference, usingFallbackReference) {
  els.referenceProbePanel.className = "reference-probe-panel active";
  els.referenceProbePanel.innerHTML = `
    <div class="reference-probe-head">
      <strong>正在测试入参图片</strong>
      <span>${usingFallbackReference ? "当前未选择参考图，使用内置测试图。" : `使用参考图：${escapeHtml(reference.name || "参考图")}`}</span>
    </div>
    <div class="reference-probe-grid">
      <article>
        <div class="probe-frame"><img src="${escapeAttr(reference.url)}" alt="${escapeAttr(reference.name || "参考图")}" /></div>
        <span>入参参考图</span>
      </article>
      <article>
        <div class="probe-frame loading"></div>
        <span>带图片入参</span>
      </article>
      <article>
        <div class="probe-frame loading"></div>
        <span>无图对照</span>
      </article>
    </div>
  `;
}

function renderReferenceProbeResult({ reference, referenceImage, controlImage, strategy, usingFallbackReference }) {
  els.referenceProbePanel.className = "reference-probe-panel active";
  els.referenceProbePanel.innerHTML = `
    <div class="reference-probe-head">
      <strong>测试完成：${escapeHtml(strategy)}</strong>
      <span>${usingFallbackReference ? "接口接受图片入参，但当前用的是内置测试图。上传商品图后再测会更准确。" : "对比左侧参考图和中间结果：越像，说明入参图片越生效。"}</span>
    </div>
    <div class="reference-probe-grid">
      <article>
        <div class="probe-frame"><img src="${escapeAttr(reference.url)}" alt="${escapeAttr(reference.name || "参考图")}" /></div>
        <span>入参参考图</span>
      </article>
      <article>
        <div class="probe-frame"><img src="${escapeAttr(referenceImage.url)}" alt="带图片入参结果" /></div>
        <span>带图片入参</span>
      </article>
      <article>
        <div class="probe-frame"><img src="${escapeAttr(controlImage.url)}" alt="无图对照结果" /></div>
        <span>无图对照</span>
      </article>
    </div>
  `;
}

function renderReferenceProbeError(message) {
  els.referenceProbePanel.className = "reference-probe-panel active error";
  els.referenceProbePanel.innerHTML = `
    <div class="reference-probe-head">
      <strong>测试失败</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function clearGenerationForm() {
  state.uploaded = [];
  els.uploadInput.value = "";
  renderUploadPreview();
  showToast("输入已清空");
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  const reads = files.map(readFileAsDataUrl);
  const dataUrls = await Promise.all(reads);
  const dimensions = await Promise.all(dataUrls.map(readImageDimensions));
  const uploaded = files.map((file, index) => {
    const detectedSize = dimensions[index] ? `${dimensions[index].width}x${dimensions[index].height}` : "";
    return {
      id: createId("upload"),
      name: file.name.replace(/\.[^.]+$/, ""),
      url: dataUrls[index],
      width: dimensions[index]?.width || null,
      height: dimensions[index]?.height || null,
      size: normalizeImageSize(detectedSize) || detectedSize,
      prompt: currentPromptConfig().reference.defaultAssetPromptLabels?.uploaded || "本地上传商品参考图",
      createdAt: new Date().toISOString(),
      source: "upload"
    };
  });
  applyDetectedSize(uploaded[0]?.size);
  applySuiteSizeToShots(uploaded[0]?.size);
  renderSuitePlan();
  state.uploaded = [...uploaded, ...state.uploaded].slice(0, 9);
  renderUploadPreview();
  showToast(`已上传 ${uploaded.length} 张参考图`);
}

function renderUploadPreview() {
  if (!state.uploaded.length) {
    els.uploadPreview.innerHTML = "";
    return;
  }
  els.uploadPreview.innerHTML = state.uploaded
    .map(
      (item) => `
        <article class="upload-card" data-id="${escapeHtml(item.id)}" title="${escapeHtml(item.name)}">
          <button class="upload-select" type="button" data-action="select-upload" data-id="${escapeHtml(item.id)}">
            <img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.name)}" />
          </button>
          <button class="upload-remove" type="button" data-action="remove-upload" data-id="${escapeHtml(item.id)}" aria-label="删除 ${escapeAttr(item.name)}" title="删除参考图">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </article>
      `
    )
    .join("");
  els.uploadPreview.querySelectorAll("[data-action='select-upload']").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.uploaded.find((entry) => entry.id === button.dataset.id);
      if (!item) return;
      state.selectedImage = item;
      renderEditSelection();
      switchView("edit");
    });
  });
  els.uploadPreview.querySelectorAll("[data-action='remove-upload']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      removeUploadedImage(button.dataset.id);
    });
  });
}

function removeUploadedImage(id) {
  state.uploaded = state.uploaded.filter((entry) => entry.id !== id);
  els.uploadInput.value = "";
  renderUploadPreview();
  showToast("参考图已删除");
}

async function handleGenerate() {
  const template = selectedSingleTemplate();
  if (!template) {
    showToast("请先选择模板", true);
    return;
  }
  if (!(await ensureApiReady())) return;
  const count = clamp(parseInt(els.countInput.value, 10) || 1, 1, 8);
  els.countInput.value = String(count);

  // ── credit check before entering generation ──
  var credits = state.auth.user ? (state.auth.user.creditsRemaining || 0) : 0;
  if (credits < count) {
    showCreditsModal(count, credits);
    return;
  }

  state.referenceFallbackNotice = "";
  setBusy(true, els.generateBtn, "生成中");
  renderLoadingGrid(els.resultGrid, count);
  try {
    const { images, calls } = await requestImagesExact({
      templateId: template.id,
      count,
      size: els.sizeInput.value,
      referenceImages: state.uploaded
    });
    const refThumbs = await thumbnailRefs(state.uploaded);
    state.generated = images.map((image, index) => ({
      id: createId("gen"),
      name: `${timestampName()}-${index + 1}`,
      url: image.url,
      prompt: `模板：${template.title}`,
      templateTitle: template.title,
      refCount: state.uploaded.length,
      refThumbs: refThumbs,
      createdAt: new Date().toISOString(),
	      source: "generation",
	      model: selectedImageModelName(),
	      size: els.sizeInput.value,
	      request: image.request || state.lastRequestPayload,
	      remoteAssetId: image.remoteAssetId || image.generatedAssetId || "",
	      generatedAssetId: image.generatedAssetId || image.remoteAssetId || ""
	    }));
    renderResults();
    showGenerationToast(`已生成 ${state.generated.length} 张图片，API 调用 ${calls} 次`);
  } catch (error) {
    if (error.creditsRequired !== undefined) {
      showCreditsModal(error.creditsRequired, error.creditsRemaining);
    } else {
      els.resultGrid.className = "result-grid empty-state";
      els.resultGrid.innerHTML = `<div class="empty-copy"><strong>生成失败</strong><span>${escapeHtml(error.message)}</span></div>`;
      showToast(error.message, true);
    }
  } finally {
    setBusy(false, els.generateBtn, "生成图片");
  }
}

async function handleRefine() {
  if (!state.selectedImage) {
    showToast("请先选择基图", true);
    return;
  }
  const editPrompt = els.editPromptInput.value.trim();
  if (!editPrompt) {
    showToast("请输入二次编辑提示词", true);
    return;
  }
  if (!(await ensureApiReady())) return;

  var credits = state.auth.user ? (state.auth.user.creditsRemaining || 0) : 0;
  if (credits < 1) {
    showCreditsModal(1, credits);
    return;
  }

  state.referenceFallbackNotice = "";
  const compose = currentPromptConfig().refinement.compose || {};
  const composedPrompt = [
    compose.prefix,
    imageReferenceText(state.selectedImage.url),
    state.selectedImage.size ? promptText(compose.currentSizeLine, { size: state.selectedImage.size }) : "",
    state.selectedImage.prompt ? promptText(compose.previousPromptLine, { prompt: state.selectedImage.prompt }) : "",
    promptText(compose.editRequestLine, { prompt: editPrompt }),
    compose.guardrailSuffix
  ]
    .filter(Boolean)
    .join("\n");

  setBusy(true, els.refineBtn, "微调中");
  renderLoadingGrid(els.editResultGrid, 1);
  try {
    const images = await requestImages({
      prompt: composedPrompt,
      count: 1,
      size: els.sizeInput.value,
      referenceImages: state.selectedImage ? [state.selectedImage] : []
    });
    const refined = {
      id: createId("edit"),
      name: els.autoSaveNameInput.value.trim() || timestampName(),
      url: images[0].url,
      prompt: composedPrompt,
      createdAt: new Date().toISOString(),
      source: "refinement",
      parentId: state.selectedImage.id,
      model: selectedImageModelName(),
      size: els.sizeInput.value,
      request: images[0].request || state.lastRequestPayload,
      remoteAssetId: images[0].remoteAssetId || images[0].generatedAssetId || "",
      generatedAssetId: images[0].generatedAssetId || images[0].remoteAssetId || ""
    };
    renderEditResults([refined]);
    if (els.autoSaveToggle.checked) {
      const saved = await saveAssetWithFolder(refined, {
        name: refined.name,
        folderId: els.autoSaveFolderSelect.value,
        newFolderName: els.autoSaveNewFolderInput.value.trim()
      });
      state.selectedAssetId = saved.id;
      await refreshLibrary();
      setDefaultAutoSaveName();
      els.autoSaveNewFolderInput.value = "";
      showGenerationToast("微调版本已保存");
    } else {
      showGenerationToast("微调版本已生成");
    }
  } catch (error) {
    els.editResultGrid.className = "result-grid compact empty-state";
    els.editResultGrid.innerHTML = `<div class="empty-copy"><strong>微调失败</strong><span>${escapeHtml(error.message)}</span></div>`;
    showToast(error.message, true);
  } finally {
    setBusy(false, els.refineBtn, "生成微调版本");
  }
}

async function requestImages({ prompt, templateId, suitePresetId, suiteShotId, variantIndex = 0, count, size, referenceImages = [] }) {
  const references = normalizeReferenceImages(referenceImages);
  const requestSize = normalizeImageSize(size) || "1024x1024";
  const requestBody = {
    count,
    size: requestSize,
    referenceImages: references
  };
  if (state.selectedImageModelId) requestBody.imageModelId = state.selectedImageModelId;
  if (templateId) {
    requestBody.templateId = templateId;
    if (variantIndex) requestBody.variantIndex = variantIndex;
  } else if (suitePresetId && suiteShotId) {
    requestBody.suitePresetId = suitePresetId;
    requestBody.suiteShotId = suiteShotId;
  } else {
    requestBody.prompt = withStrictProductReference(withReferenceContext(prompt, references));
  }
  const payload = await apiFetch("/generate", {
    method: "POST",
    body: JSON.stringify(requestBody)
  });
  const images = payload.images || [];
  if (!images.length) {
    throw new Error("接口未返回可识别的图片地址或 b64_json");
  }
  const requestSnapshot = payload.request || {
    model: payload.model || state.auth.modelSettings.model || DEFAULT_MODEL,
    body: sanitizeRequestPayload(requestBody)
  };
  recordRequestPayload(requestSnapshot);
  if (payload.apiKeyConfigured !== undefined) {
    state.auth.apiKeyConfigured = Boolean(payload.apiKeyConfigured);
    updateConnectionState();
  }
  syncCreditsFromPayload(payload);
  return images.map((image) => ({ ...image, request: image.request || requestSnapshot }));
}

function syncCreditsFromPayload(payload = {}) {
  if (!state.auth.user || payload.creditsRemaining === undefined || payload.creditsRemaining === null) return;
  state.auth.user.creditsRemaining = payload.creditsRemaining;
  updateCreditsDisplay(payload.creditsRemaining, state.auth.user.credits);
}

async function postImageRequest(endpoint, apiKey, body) {
  await verifySessionActive();
  recordRequestPayload(endpoint, body);
  const requestSnapshot = {
    endpoint,
    body: sanitizeRequestPayload(body)
  };
  const startedAt = performance.now();
  let response = null;
  let payload = null;
  let payloadText = "";
  let logged = false;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorizationHeaderValue(apiKey, endpoint)
      },
      body: JSON.stringify(body)
    });

    payloadText = await response.text();
    try {
      payload = payloadText ? JSON.parse(payloadText) : null;
    } catch {
      payload = payloadText;
    }

    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || response.statusText || "接口请求失败";
      await logGenerationCall({
        endpoint,
        body,
        payload,
        status: "failed",
        error: `API ${response.status}: ${message}`,
        durationMs: Math.round(performance.now() - startedAt)
      });
      logged = true;
      const error = new Error(`API ${response.status}: ${message}`);
      error.status = response.status;
      error.apiMessage = message;
      throw error;
    }

    const images = extractImageResultsFromPayload(payload);

    if (!images.length) {
      await logGenerationCall({
        endpoint,
        body,
        payload,
        status: "failed",
        error: "接口未返回可识别的图片地址或 b64_json",
        durationMs: Math.round(performance.now() - startedAt)
      });
      logged = true;
      throw new Error("接口未返回可识别的图片地址或 b64_json");
    }
    await logGenerationCall({
      endpoint,
      body,
      payload,
      images,
      status: "completed",
      durationMs: Math.round(performance.now() - startedAt)
    });
    return images.map((image) => ({ ...image, request: requestSnapshot }));
  } catch (error) {
    if (!logged && response) {
      await logGenerationCall({
        endpoint,
        body,
        payload: payload || payloadText,
        status: "failed",
        error: error.message,
        durationMs: Math.round(performance.now() - startedAt)
      });
    }
    throw error;
  }
}

async function logGenerationCall({ endpoint, body, payload, images = [], status, error = "", durationMs = 0 }) {
  if (!state.auth.token) return;
  const usage = extractTokenUsage(body, payload);
  try {
    await apiFetch("/generation-logs", {
      method: "POST",
      body: JSON.stringify({
        endpoint,
        model: extractModelFromBody(body),
        prompt: extractPromptFromBody(body),
        size: extractSizeFromBody(body),
        count: extractCountFromBody(body),
        imageCount: images.length,
        status,
        error,
        requestBody: sanitizeRequestPayload(body),
        responseBody: sanitizeRequestPayload(payload),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        durationMs
      })
    });
  } catch {
    // Logging should not mask the model response/error the user is waiting for.
  }
}

function extractTokenUsage(body, payload) {
  const geminiUsage = payload?.usageMetadata || payload?.usage_metadata;
  const openAiUsage = payload?.usage;
  const inputTokens =
    Number(geminiUsage?.promptTokenCount ?? geminiUsage?.prompt_token_count ?? openAiUsage?.prompt_tokens) ||
    estimateTokens(sanitizeRequestPayload(body));
  const outputTokens =
    Number(geminiUsage?.candidatesTokenCount ?? geminiUsage?.candidates_token_count ?? openAiUsage?.completion_tokens) ||
    estimateTokens(sanitizeRequestPayload(payload));
  const totalTokens =
    Number(geminiUsage?.totalTokenCount ?? geminiUsage?.total_token_count ?? openAiUsage?.total_tokens) ||
    inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function estimateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  return Math.max(0, Math.ceil(text.length / 4));
}

function extractModelFromBody(body) {
  return body?.model || selectedImageModelName();
}

function extractSizeFromBody(body) {
  const imageConfig = body?.generationConfig?.imageConfig || body?.generation_config?.image_config;
  return body?.size || imageConfig?.aspectRatio || imageConfig?.aspect_ratio || els.sizeInput?.value || "";
}

function extractCountFromBody(body) {
  return Number(body?.n || body?.count || 1);
}

function extractPromptFromBody(body) {
  if (body?.prompt) return String(body.prompt);
  const parts = body?.contents?.flatMap((content) => content.parts || []) || [];
  return parts
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n");
}

function resolveImageEndpoint(endpoint, model) {
  const selectedModel = encodeURIComponent(model || DEFAULT_MODEL);
  const value = String(endpoint || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;
  if (value.includes("{model}")) return value.replaceAll("{model}", selectedModel);
  if (isGeminiImageEndpoint(value, model)) {
    return value.replace(/\/v1beta\/models\/[^/:]+:generateContent\/?$/, `/v1beta/models/${selectedModel}:generateContent/`);
  }
  return value;
}

function isGeminiImageEndpoint(endpoint, model = "") {
  const value = `${endpoint || ""} ${model || ""}`.toLowerCase();
  return value.includes("generatecontent") || value.includes("gemini-2.5-flash-image") || value.includes("gemini-3-pro-image");
}

function authorizationHeaderValue(apiKey, endpoint) {
  const value = String(apiKey || "").trim();
  if (/^Bearer\s+/i.test(value)) return value;
  if (isGeminiImageEndpoint(endpoint) || /aokapi\.com/i.test(endpoint)) return value;
  return `Bearer ${value}`;
}

async function buildGeminiImageRequestBody({ prompt, size, references }) {
  const parts = [{ text: prompt }];
  for (const reference of references) {
    const inlineData = await referenceToInlineData(reference);
    if (inlineData) parts.push({ inlineData });
  }
  return {
    contents: [
      {
        role: "user",
        parts
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: geminiImageConfigFromSize(size)
    }
  };
}

async function referenceToInlineData(reference) {
  const url = reference?.url || "";
  if (!url) return null;
  if (url.startsWith("data:")) {
    return {
      data: stripDataUrlPrefix(url),
      mimeType: dataUrlMimeType(url) || "image/png"
    };
  }
  const dataUrl = await fetchReferenceAsDataUrl(url);
  return {
    data: stripDataUrlPrefix(dataUrl),
    mimeType: dataUrlMimeType(dataUrl) || "image/png"
  };
}

function fetchReferenceAsDataUrl(url) {
  return fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`参考图读取失败：${response.status}`);
      return response.blob();
    })
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        })
    );
}

function dataUrlMimeType(value) {
  const match = String(value || "").match(/^data:([^;,]+)[;,]/);
  return match ? match[1] : "";
}

function geminiImageConfigFromSize(size) {
  const parsed = parseImageSize(size);
  if (!parsed) {
    return {
      aspectRatio: "1:1",
      imageSize: "1K"
    };
  }
  return {
    aspectRatio: nearestGeminiAspectRatio(parsed.width, parsed.height),
    imageSize: Math.max(parsed.width, parsed.height) > 1200 ? "2K" : "1K"
  };
}

function nearestGeminiAspectRatio(width, height) {
  const ratio = width / height;
  const options = [
    ["1:1", 1],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4]
  ];
  return options.reduce((best, option) => {
    return Math.abs(option[1] - ratio) < Math.abs(best[1] - ratio) ? option : best;
  }, options[0])[0];
}

function extractImageResultsFromPayload(payload) {
  const images = [];
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.images) ? payload.images : [];
  data.forEach((item) => {
    if (typeof item === "string") images.push({ url: item });
    else if (item?.url) images.push({ url: item.url });
    else if (item?.b64_json) images.push({ url: `data:image/png;base64,${item.b64_json}` });
    else if (item?.image) images.push({ url: item.image });
  });

  (payload?.candidates || []).forEach((candidate) => {
    (candidate?.content?.parts || []).forEach((part) => {
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data) {
        images.push({ url: `data:${inline.mimeType || inline.mime_type || "image/png"};base64,${inline.data}` });
      }
    });
  });

  (payload?.choices || []).forEach((choice) => {
    extractDataUrlsFromText(choice?.message?.content || choice?.text || "").forEach((url) => images.push({ url }));
  });

  return images.filter((image) => image?.url);
}

function extractDataUrlsFromText(text) {
  return Array.from(String(text || "").matchAll(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g)).map(
    (match) => match[0]
  );
}

function referencePayloadStrategies(references) {
  const urls = references.map((reference) => reference.url);
  const base64Images = references.map((reference) => stripDataUrlPrefix(reference.url));
  const objects = references.map((reference) => ({
    type: "input_image",
    image_url: reference.url
  }));
  const strategies = [
    { id: "reference_images", body: { reference_images: urls } },
    { id: "images", body: { images: urls } },
    { id: "image_urls", body: { image_urls: urls } },
    { id: "input_images", body: { input_images: objects } },
    { id: "image", body: { image: urls[0] } },
    { id: "reference_images_base64", body: { reference_images: base64Images } },
    { id: "images_base64", body: { images: base64Images } },
    { id: "image_base64", body: { image: base64Images[0] } }
  ];
  const savedStrategy = localStorage.getItem(REFERENCE_STRATEGY_KEY);
  if (!savedStrategy) return strategies;
  const savedIndex = strategies.findIndex((strategy) => strategy.id === savedStrategy);
  if (savedIndex < 0) return strategies;
  return [strategies[savedIndex], ...strategies.filter((_, index) => index !== savedIndex)];
}

async function probeReferenceStrategy({ endpoint, apiKey, body, references }) {
  let lastMessage = "接口未接受任何参考图字段";
  for (const strategy of referencePayloadStrategies(references)) {
    try {
      const images = await postImageRequest(endpoint, apiKey, {
        ...body,
        ...strategy.body
      });
      return {
        accepted: true,
        strategy: strategy.id,
        images,
        message: "accepted"
      };
    } catch (error) {
      lastMessage = error.apiMessage || error.message;
      if (!canRetryReferencePayload(error)) throw error;
    }
  }
  return {
    accepted: false,
    strategy: "",
    images: [],
    message: lastMessage
  };
}

function canRetryReferencePayload(error) {
  const status = Number(error?.status);
  if (![400, 404, 415, 422].includes(status)) return false;
  const message = normalized(error?.apiMessage || error?.message);
  return [
    "unknown",
    "unsupported",
    "invalid",
    "unrecognized",
    "unexpected",
    "reference",
    "image",
    "param",
    "field",
    "format"
  ].some((keyword) => message.includes(keyword));
}

function normalizeReferenceImages(references) {
  const defaultName = currentPromptConfig().reference.defaultName || "参考图";
  const seen = new Set();
  return (references || [])
    .filter((reference) => reference?.url)
    .map((reference) => ({
      name: reference.name || defaultName,
      size: reference.size || "",
      url: reference.url
    }))
    .filter((reference) => {
      if (seen.has(reference.url)) return false;
      seen.add(reference.url);
      return true;
    })
    .slice(0, 3);
}

function stripDataUrlPrefix(value) {
  const text = String(value || "");
  const match = text.match(/^data:[^,]+,(.+)$/);
  return match ? match[1] : text;
}

function recordRequestPayload(endpointOrRequest, maybeBody) {
  const request =
    maybeBody === undefined
      ? endpointOrRequest || {}
      : {
          endpoint: endpointOrRequest,
          body: maybeBody
        };
  const body = request.body || {};
  const sanitized = sanitizeRequestPayload(body);
  state.lastRequestPayload = {
    model: request.model || state.auth.modelSettings.model || DEFAULT_MODEL,
    strategy: request.strategy || "",
    body: sanitized,
    recordedAt: new Date().toISOString()
  };
  if (!els.requestPayloadPreview || !els.requestPayloadMeta) return;
  const strategy = localStorage.getItem(REFERENCE_STRATEGY_KEY);
  const imageFields = findImagePayloadFields(body);
  els.requestPayloadMeta.textContent = [
    new Date().toLocaleTimeString(),
    request.strategy || strategy ? `字段策略：${request.strategy || strategy}` : "",
    imageFields.length ? `图片字段：${imageFields.join(", ")}` : "未带图片字段"
  ]
    .filter(Boolean)
    .join(" · ");
  els.requestPayloadPreview.textContent = JSON.stringify(
    {
      model: request.model || state.auth.modelSettings.model || DEFAULT_MODEL,
      body: sanitized
    },
    null,
    2
  );
}

function sanitizeRequestPayload(value) {
  if (Array.isArray(value)) return value.map(sanitizeRequestPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeRequestPayload(entry)]));
  }
  if (typeof value !== "string") return value;
  if (value.startsWith("data:image/")) {
    const [prefix, data = ""] = value.split(",");
    return `${prefix},[base64 图片数据已截断，长度 ${data.length}]`;
  }
  if (/^[A-Za-z0-9+/=]{400,}$/.test(value)) {
    return `[base64 图片数据已截断，长度 ${value.length}]`;
  }
  return value;
}

function findImagePayloadFields(body) {
  const fields = [];
  ["referenceImages", "reference_images", "images", "image_urls", "input_images", "image"].forEach((field) => {
    if (body && Object.prototype.hasOwnProperty.call(body, field)) fields.push(field);
  });
  if (hasInlineDataImagePart(body)) fields.push("contents.parts.inlineData");
  return fields;
}

function hasInlineDataImagePart(value) {
  if (Array.isArray(value)) return value.some(hasInlineDataImagePart);
  if (!value || typeof value !== "object") return false;
  if (value.inlineData?.data || value.inline_data?.data) return true;
  return Object.values(value).some(hasInlineDataImagePart);
}

function firstAvailableReferenceImage() {
  return state.suiteReference || state.selectedImage || state.uploaded[0] || state.generated[0] || state.suiteGenerated[0] || null;
}

function withReferenceContext(prompt, references) {
  if (!references.length) return prompt;
  const context = currentPromptConfig().reference.context || {};
  const primary = references[0];
  const sizeText = primary.size ? promptText(context.sizeText, { size: primary.size }) : "";
  const lines = [
    promptText(context.primaryLine, {
      name: primary.name || context.defaultName || "参考图 1",
      sizeText
    }),
    references.length > 1 ? promptText(context.extraLine, { count: references.length - 1 }) : "",
    context.consistencyLine
  ];
  return [...lines.filter(Boolean), prompt].join("\n");
}

/** Generate 160x160 thumbnails from reference image data URLs (low-fidelity, low storage). */
async function thumbnailRefs(refs) {
  if (!refs || !refs.length) return [];
  const SIZE = 160;
  const thumbs = [];
  for (const ref of refs) {
    try {
      const thumb = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = function () {
          const canvas = document.createElement("canvas");
          canvas.width = SIZE;
          canvas.height = SIZE;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, SIZE, SIZE);
          resolve(canvas.toDataURL("image/jpeg", 0.6));
        };
        img.onerror = function () { resolve(null); };
        img.src = ref.dataUrl || ref.url;
      });
      if (thumb) thumbs.push(thumb);
    } catch {
      // skip failed thumb
    }
  }
  return thumbs;
}

async function requestImagesExact(options) {
  const targetCount = clamp(parseInt(options.count, 10) || 1, 1, 8);
  let calls = 0;
  const images = [];

  const firstBatch = await requestImages({ ...options, count: targetCount });
  calls += 1;
  images.push(...firstBatch);

  while (images.length < targetCount) {
    const index = images.length + 1;
    const extraOptions = options.templateId
      ? { ...options, variantIndex: index, count: 1 }
      : {
          ...options,
          prompt: [options.prompt, promptText(currentPromptConfig().single.supplementalVariantPrompt, { index })].join("\n"),
          count: 1
        };
    const extraBatch = await requestImages(extraOptions);
    calls += 1;
    images.push(...extraBatch);
  }

  return {
    images: images.slice(0, targetCount),
    calls
  };
}

function renderLoadingGrid(container, count) {
  container.className = container.id === "editResultGrid" ? "result-grid compact" : "result-grid";
  container.innerHTML = Array.from({ length: count })
    .map(
      () => `
        <article class="image-card">
          <div class="image-frame loading"></div>
          <div class="image-meta">
            <div class="image-title-row"><strong>生成中</strong><span>...</span></div>
            <div class="prompt-preview">正在等待模型返回图片</div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderResults() {
  if (!state.generated.length) {
    els.resultGrid.className = "result-grid empty-state";
    els.resultGrid.innerHTML = `<div class="empty-copy"><strong>等待生成</strong><span>图片会出现在这里，可保存或进入二次编辑。</span></div>`;
    return;
  }
  els.resultGrid.className = "result-grid";
  els.resultGrid.innerHTML = state.generated.map((item) => renderImageCard(item)).join("");
  bindImageCardActions(els.resultGrid, state.generated);
}

function renderEditResults(items) {
  els.editResultGrid.className = "result-grid compact";
  els.editResultGrid.innerHTML = items.map((item) => renderImageCard(item)).join("");
  bindImageCardActions(els.editResultGrid, items);
}

function renderImageCard(item) {
  return `
    <article class="image-card" data-id="${escapeHtml(item.id)}">
      <div class="image-frame">
        <img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.name)}" loading="lazy" />
      </div>
      <div class="image-meta">
        <div class="image-title-row">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${formatTime(item.createdAt)}</span>
        </div>
        <div class="prompt-preview">${escapeHtml(item.prompt || "")}</div>
        <div class="card-meta-row">
          ${escapeHtml(item.model || "")} · ${escapeHtml(item.size || "")}${item.refCount ? ` · ` : ""}
          ${(item.refThumbs || []).length ? item.refThumbs.map((thumb, i) => `
            <span class="ref-thumb-badge" data-thumb="${escapeAttr(thumb)}">
              🖼${i + 1}
              <span class="ref-thumb-pop"><img src="${escapeAttr(thumb)}" alt="参考图${i + 1}" width="160" height="160" /></span>
            </span>
          `).join(" ") : item.refCount ? `${item.refCount}张参考图` : ""}
        </div>
        <div class="card-actions five">
          <button class="small-button" type="button" data-action="save" data-id="${escapeHtml(item.id)}">保存</button>
          <button class="small-button" type="button" data-action="edit" data-id="${escapeHtml(item.id)}">编辑</button>
          <button class="small-button icon-only feedback-button positive ${item.feedback === "upvoted" ? "is-active" : ""}" type="button" data-action="upvote" data-id="${escapeHtml(item.id)}" aria-label="点赞 ${escapeAttr(item.name)}" title="${item.feedback === "upvoted" ? "已点赞" : "点赞"}" ${item.feedback ? "disabled" : ""}>
            <svg viewBox="0 0 24 24"><path d="M14 9V4a2 2 0 0 0-2-2L8 9" /><path d="M6 21h10.2a2 2 0 0 0 2-1.4L21 12V9H6z" /><path d="M6 21H3V9h3" /></svg>
          </button>
          <button class="small-button icon-only feedback-button negative ${item.feedback === "downvoted" ? "is-active" : ""}" type="button" data-action="downvote" data-id="${escapeHtml(item.id)}" aria-label="点踩 ${escapeAttr(item.name)}" title="${item.feedback === "downvoted" ? "已点踩" : "点踩"}" ${item.feedback ? "disabled" : ""}>
            <svg viewBox="0 0 24 24"><path d="M10 15v5a2 2 0 0 0 2 2l4-7" /><path d="M18 3H7.8a2 2 0 0 0-2 1.4L3 12v3h15z" /><path d="M18 3h3v12h-3" /></svg>
          </button>
          <button class="small-button icon-only danger" type="button" data-action="remove-result" data-id="${escapeHtml(item.id)}" aria-label="删除 ${escapeAttr(item.name)}" title="删除">
            <svg viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m10 11 0 6" /><path d="m14 11 0 6" /><path d="M5 6l1 14h12l1-14" /></svg>
          </button>
        </div>
      </div>
    </article>
  `;
}

function bindImageCardActions(container, items) {
  container.querySelectorAll("[data-action='save']").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items.find((entry) => entry.id === button.dataset.id);
      if (item) openSaveModal(item);
    });
  });
  container.querySelectorAll("[data-action='edit']").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items.find((entry) => entry.id === button.dataset.id);
      if (!item) return;
      state.selectedImage = item;
      renderEditSelection();
      switchView("edit");
    });
  });
  container.querySelectorAll("[data-action='upvote']").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items.find((entry) => entry.id === button.dataset.id);
      if (item) submitImageFeedback(item, button, "upvote");
    });
  });
  container.querySelectorAll("[data-action='downvote']").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items.find((entry) => entry.id === button.dataset.id);
      if (item) submitImageFeedback(item, button, "downvote");
    });
  });
  container.querySelectorAll("[data-action='remove-result']").forEach((button) => {
    button.addEventListener("click", () => removeGeneratedImage(button.dataset.id));
  });
}

async function submitImageFeedback(item, button, feedbackType) {
  if (!hasAuthSession()) {
    openAuthModal({ locked: true });
    showToast("请先登录后再提交反馈", true);
    return;
  }
  const isUpvote = feedbackType === "upvote";
  button.disabled = true;
  button.classList.add("is-active");
  try {
    const imageUrl = await feedbackImageUrl(item.url);
    await apiFetch("/image-feedback", {
      method: "POST",
      body: JSON.stringify({
        feedbackType,
        imageUrl,
        imageName: item.name || "",
        imageSource: item.source || "",
        prompt: item.prompt || "",
        model: item.model || "",
        size: item.size || "",
        requestBody: item.request || state.lastRequestPayload || {},
        item: feedbackItemSnapshot(item)
      })
    });
    item.feedback = isUpvote ? "upvoted" : "downvoted";
    button.setAttribute("title", isUpvote ? "已点赞" : "已点踩");
    button.closest(".card-actions")?.querySelectorAll("[data-action='upvote'], [data-action='downvote']").forEach((feedbackButton) => {
      feedbackButton.disabled = true;
    });
    showToast(isUpvote ? "已记录点赞反馈" : "已记录点踩反馈");
  } catch (error) {
    button.disabled = false;
    button.classList.remove("is-active");
    showToast(error.message, true);
  }
}

async function feedbackImageUrl(url) {
  if (!String(url || "").startsWith("data:image/")) return url;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 520;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(url);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => resolve(url);
    image.src = url;
  });
}

function feedbackItemSnapshot(item) {
  return {
    id: item.id,
    name: item.name,
    source: item.source,
    suiteId: item.suiteId,
    shotId: item.shotId,
    shotName: item.shotName,
    parentId: item.parentId,
    model: item.model,
    size: item.size,
    createdAt: item.createdAt
  };
}

function removeGeneratedImage(id) {
  const before = state.generated.length + state.suiteGenerated.length;
  state.generated = state.generated.filter((entry) => entry.id !== id);
  state.suiteGenerated = state.suiteGenerated.filter((entry) => entry.id !== id);
  const after = state.generated.length + state.suiteGenerated.length;
  if (state.selectedImage?.id === id) {
    state.selectedImage = null;
    renderEditSelection();
  }
  renderResults();
  renderSuiteResults();
  if (after < before) showToast("图片已删除");
}

function renderEditSelection() {
  if (!state.selectedImage) {
    els.selectedImageName.textContent = "未选择";
    els.editPreview.className = "edit-preview empty-state";
    els.editPreview.innerHTML = `<div class="empty-copy"><strong>选择一张图片</strong><span>可从生成结果或素材库进入二次编辑。</span></div>`;
    return;
  }
  els.selectedImageName.textContent = state.selectedImage.name;
  els.editPreview.className = "edit-preview";
  applyDetectedSize(state.selectedImage.size);
  els.editPreview.innerHTML = `
    <img src="${escapeAttr(state.selectedImage.url)}" alt="${escapeAttr(state.selectedImage.name)}" />
    <div class="edit-base-note">
      <strong>当前基图</strong>
      <span>${escapeHtml(state.selectedImage.size || "沿用当前尺寸设置")}</span>
    </div>
  `;
  setDefaultAutoSaveName();
}

function handleSaveAll() {
  if (!state.generated.length) {
    showToast("暂无可保存图片", true);
    return;
  }
  openSaveModal(state.generated[0], state.generated);
}

function openSaveModal(item, batch = null) {
  state.pendingSave = batch || item;
  const first = Array.isArray(state.pendingSave) ? state.pendingSave[0] : state.pendingSave;
  els.savePreview.innerHTML = `<img src="${escapeAttr(first.url)}" alt="${escapeAttr(first.name)}" />`;
  els.saveNameInput.value = Array.isArray(state.pendingSave) ? timestampName() : first.name || timestampName();
  els.newFolderInput.value = "";
  populateFolderSelects();
  els.saveModal.classList.add("active");
  els.saveModal.setAttribute("aria-hidden", "false");
  els.saveNameInput.focus();
}

function closeSaveModal() {
  state.pendingSave = null;
  els.saveModal.classList.remove("active");
  els.saveModal.setAttribute("aria-hidden", "true");
}

async function confirmSave() {
  if (!state.pendingSave) return;
  const name = els.saveNameInput.value.trim() || timestampName();
  const folderId = els.saveFolderSelect.value;
  const newFolderName = els.newFolderInput.value.trim();

  try {
    if (Array.isArray(state.pendingSave)) {
      for (let index = 0; index < state.pendingSave.length; index += 1) {
        const item = state.pendingSave[index];
        await saveAssetWithFolder(item, {
          name: `${name}-${index + 1}`,
          folderId,
          newFolderName: index === 0 ? newFolderName : ""
        });
      }
      showToast(`已保存 ${state.pendingSave.length} 张图片`);
    } else {
      const saved = await saveAssetWithFolder(state.pendingSave, { name, folderId, newFolderName });
      state.selectedAssetId = saved.id;
      showToast("图片已保存");
    }
    closeSaveModal();
    await refreshLibrary();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveAssetWithFolder(item, options) {
  const folder = options.newFolderName
    ? await createFolder(options.newFolderName)
    : state.folders.find((entry) => entry.id === options.folderId) || state.folders[0];

  if (!folder) throw new Error("未找到可用文件夹");

  const asset = {
    ...item,
    id: createId("asset"),
    name: options.name || item.name || timestampName(),
    folderId: folder.id,
    folderName: folder.name,
    savedAt: new Date().toISOString()
  };
  await putStore(STORES.assets, asset);
  if (asset.remoteAssetId && state.auth.user) {
    const importedIds = loadImportedGeneratedAssetIds();
    importedIds.add(asset.remoteAssetId);
    saveImportedGeneratedAssetIds(importedIds);
  }
  return asset;
}

async function refreshLibrary() {
  state.folders = await getAll(STORES.folders);
  state.assets = await getAll(STORES.assets);
  state.folders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.assets.sort((a, b) => (b.savedAt || b.createdAt).localeCompare(a.savedAt || a.createdAt));
  populateFolderSelects();
  renderLibrary();
}

function populateFolderSelects() {
  const options = state.folders
    .map((folder) => `<option value="${escapeAttr(folder.id)}">${escapeHtml(folder.name)}</option>`)
    .join("");
  els.saveFolderSelect.innerHTML = options;
  els.autoSaveFolderSelect.innerHTML = options;
}

function renderLibrary() {
  els.folderCount.textContent = String(state.folders.length);
  els.assetCount.textContent = String(state.assets.length);
  renderFolderList();
  renderAssetGrid();
}

function renderFolderList() {
  const query = normalized(els.librarySearchInput.value);
  const folderCounts = new Map();
  state.assets.forEach((asset) => folderCounts.set(asset.folderId, (folderCounts.get(asset.folderId) || 0) + 1));
  const matchedAssetFolderIds = new Set(
    state.assets.filter((asset) => assetMatches(asset, query)).map((asset) => asset.folderId)
  );
  const folders = state.folders.filter((folder) => {
    if (!query) return true;
    return normalized(folder.name).includes(query) || matchedAssetFolderIds.has(folder.id);
  });

  const allActive = state.selectedFolderId === "all";
  const allItem = `
    <button class="folder-item ${allActive ? "active" : ""}" type="button" data-folder-id="all">
      <svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
      <strong>全部素材</strong>
      <span>${state.assets.length}</span>
    </button>
  `;

  els.folderList.innerHTML =
    allItem +
    folders
      .map(
        (folder) => `
          <button class="folder-item ${state.selectedFolderId === folder.id ? "active" : ""}" type="button" data-folder-id="${escapeAttr(folder.id)}">
            <svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            <strong>${escapeHtml(folder.name)}</strong>
            <span>${folderCounts.get(folder.id) || 0}</span>
          </button>
        `
      )
      .join("");

  els.folderList.querySelectorAll(".folder-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedFolderId = button.dataset.folderId;
      state.selectedAssetId = null;
      renderLibrary();
    });
  });
}

function renderAssetGrid() {
  const query = normalized(els.librarySearchInput.value);
  const folder = state.folders.find((entry) => entry.id === state.selectedFolderId);
  els.libraryHeading.textContent = folder ? folder.name : "全部素材";

  const assets = state.assets.filter((asset) => {
    const inFolder = state.selectedFolderId === "all" || asset.folderId === state.selectedFolderId;
    return inFolder && assetMatches(asset, query);
  });

  if (!assets.length) {
    els.assetGrid.className = "asset-grid empty-state";
    els.assetGrid.innerHTML = `<div class="empty-copy"><strong>没有匹配素材</strong><span>换个关键词或保存新图片。</span></div>`;
    return;
  }

  els.assetGrid.className = "asset-grid";
  els.assetGrid.innerHTML = assets
    .map(
      (asset) => `
        <article class="asset-card ${state.selectedAssetId === asset.id ? "selected" : ""}" data-id="${escapeAttr(asset.id)}">
          <div class="image-frame">
            <img src="${escapeAttr(asset.url)}" alt="${escapeAttr(asset.name)}" loading="lazy" />
            <button class="asset-check" type="button" data-action="select" data-id="${escapeAttr(asset.id)}" aria-label="选择 ${escapeAttr(asset.name)}">
              <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 7" /></svg>
            </button>
          </div>
          <div class="image-meta">
            <div class="image-title-row">
              <strong>${escapeHtml(asset.name)}</strong>
              <span>${formatTime(asset.savedAt || asset.createdAt)}</span>
            </div>
            <div class="prompt-preview">${escapeHtml(asset.prompt || "")}</div>
            <div class="card-meta-row">
              ${escapeHtml(asset.model || "")} · ${escapeHtml(asset.size || "")}${asset.refCount ? ` · ` : ""}
              ${(asset.refThumbs || []).length ? asset.refThumbs.map((thumb, i) => `
                <span class="ref-thumb-badge" data-thumb="${escapeAttr(thumb)}">
                  🖼${i + 1}
                  <span class="ref-thumb-pop"><img src="${escapeAttr(thumb)}" alt="参考图${i + 1}" width="160" height="160" /></span>
                </span>
              `).join(" ") : asset.refCount ? `${asset.refCount}张参考图` : ""}
            </div>
            <div class="card-actions three">
              <button class="small-button" type="button" data-action="edit" data-id="${escapeAttr(asset.id)}">编辑</button>
              <button class="small-button" type="button" data-action="download" data-id="${escapeAttr(asset.id)}">下载</button>
              <button class="small-button" type="button" data-action="rename" data-id="${escapeAttr(asset.id)}" aria-label="重命名 ${escapeAttr(asset.name)}">
                <svg viewBox="0 0 24 24"><path d="m14.7 6.3 3 3L8 19H5v-3z" /><path d="m13 8 3 3" /></svg>
              </button>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  els.assetGrid.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const asset = state.assets.find((entry) => entry.id === button.dataset.id);
      if (!asset) return;
      const action = button.dataset.action;
      if (action === "select") {
        state.selectedAssetId = asset.id;
        renderAssetGrid();
      }
      if (action === "edit") {
        state.selectedImage = asset;
        renderEditSelection();
        switchView("edit");
      }
      if (action === "download") downloadAsset(asset);
      if (action === "rename") renameAsset(asset);
    });
  });
}

function assetMatches(asset, query) {
  if (!query) return true;
  return [asset.name, asset.folderName, asset.prompt, asset.source, asset.model]
    .filter(Boolean)
    .some((value) => normalized(value).includes(query));
}

async function createFolderFromInput() {
  const name = els.folderNameInput.value.trim();
  if (!name) {
    showToast("请输入文件夹名称", true);
    return;
  }
  await createFolder(name);
  els.folderNameInput.value = "";
  await refreshLibrary();
  showToast("文件夹已创建");
}

async function createFolder(name) {
  const existing = state.folders.find((folder) => normalized(folder.name) === normalized(name));
  if (existing) return existing;
  const folder = {
    id: createId("folder"),
    name,
    createdAt: new Date().toISOString()
  };
  await putStore(STORES.folders, folder);
  state.folders.push(folder);
  populateFolderSelects();
  return folder;
}

async function renameSelectedAsset() {
  const asset = state.assets.find((entry) => entry.id === state.selectedAssetId);
  if (!asset) {
    showToast("请先选择素材", true);
    return;
  }
  await renameAsset(asset);
}

async function renameAsset(asset) {
  const nextName = window.prompt("图片名称", asset.name);
  if (!nextName || !nextName.trim()) return;
  asset.name = nextName.trim();
  await putStore(STORES.assets, asset);
  await refreshLibrary();
  showToast("图片名称已更新");
}

async function deleteSelectedAsset() {
  const asset = state.assets.find((entry) => entry.id === state.selectedAssetId);
  if (!asset) {
    showToast("请先选择素材", true);
    return;
  }
  const ok = window.confirm(`删除素材「${asset.name}」？`);
  if (!ok) return;
  await deleteStore(STORES.assets, asset.id);
  state.selectedAssetId = null;
  await refreshLibrary();
  showToast("素材已删除");
}

async function downloadAsset(asset) {
  const link = document.createElement("a");
  link.href = asset.url;
  link.download = `${sanitizeFileName(asset.name || timestampName())}.png`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function setDefaultAutoSaveName() {
  els.autoSaveNameInput.value = timestampName();
}

function setBusy(isBusy, button, label) {
  if (!button) return;
  state.busy = isBusy;
  button.disabled = isBusy;
  button.setAttribute("aria-busy", isBusy ? "true" : "false");
  if (isBusy) {
    button.dataset.originalText = button.textContent.trim();
    const svg = button.querySelector("svg")?.outerHTML || "";
    button.innerHTML = `${svg}${label}`;
  } else {
    const svg = button.querySelector("svg")?.outerHTML || "";
    button.innerHTML = `${svg}${label}`;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.folders)) {
        db.createObjectStore(STORES.folders, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.assets)) {
        const store = db.createObjectStore(STORES.assets, { keyPath: "id" });
        store.createIndex("folderId", "folderId");
        store.createIndex("savedAt", "savedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function ensureDefaultFolder() {
  const folders = await getAll(STORES.folders);
  if (folders.length) return;
  await putStore(STORES.folders, {
    id: createId("folder"),
    name: DEFAULT_FOLDER_NAME,
    createdAt: new Date().toISOString()
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function putStore(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

function deleteStore(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function applyDetectedSize(size) {
  const normalizedSize = normalizeImageSize(size);
  if (!normalizedSize) return;
  const preserveSingleSize = state.userSelectedSingleSize;
  const labelPrefix = normalizedSize === size ? "原图尺寸" : "API兼容尺寸";
  const exists = Array.from(els.sizeInput.options).some((option) => option.value === normalizedSize);
  if (!exists) {
    const option = document.createElement("option");
    option.value = normalizedSize;
    option.textContent = `${labelPrefix} ${normalizedSize}`;
    option.dataset.detected = "true";
    els.sizeInput.prepend(option);
  }
  if (!preserveSingleSize) {
    els.sizeInput.value = normalizedSize;
    localStorage.setItem("imageStudio.size", normalizedSize);
  }
  if (els.suiteSizeInput) {
    const suiteExists = Array.from(els.suiteSizeInput.options).some((option) => option.value === normalizedSize);
    if (!suiteExists) {
      const option = document.createElement("option");
      option.value = normalizedSize;
      option.textContent = `${labelPrefix} ${normalizedSize}`;
      option.dataset.detected = "true";
      els.suiteSizeInput.insertBefore(option, els.suiteSizeInput.options[1] || null);
    }
    els.suiteSizeInput.value = normalizedSize;
  }
}

function normalizeImageSize(size) {
  const parsed = parseImageSize(size);
  if (!parsed) return "";
  const width = roundToMultiple(parsed.width, IMAGE_SIZE_MULTIPLE);
  const height = roundToMultiple(parsed.height, IMAGE_SIZE_MULTIPLE);
  return `${width}x${height}`;
}

function parseImageSize(size) {
  if (!size || typeof size !== "string") return null;
  const match = size.trim().match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function roundToMultiple(value, multiple) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.classList.add("active");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("active"), 2600);
}

function showGenerationToast(message) {
  if (!state.referenceFallbackNotice) {
    showToast(message);
    return;
  }
  showToast(`${message}；${state.referenceFallbackNotice}`, true);
  state.referenceFallbackNotice = "";
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function timestampName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueValues(values) {
  return values.filter((value, index, array) => value && array.indexOf(value) === index);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeFileName(value) {
  return String(value).replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
}

function imageReferenceText(url) {
  const textConfig = currentPromptConfig().refinement.imageReferenceText || {};
  if (!url) return "";
  if (String(url).startsWith("data:")) return textConfig.local || "当前基图：界面预览中的最新本地图片。";
  return promptText(textConfig.remote, { url });
}

function withStrictProductReference(prompt) {
  const text = String(prompt || "").trim();
  const referenceConfig = currentPromptConfig().reference || {};
  const needles = referenceConfig.strictRuleDedupeNeedles || [];
  if (needles.some((needle) => needle && text.includes(needle))) return text;
  return [referenceConfig.strictRule || STRICT_PRODUCT_REFERENCE_RULE, text].filter(Boolean).join("\n\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function renderTemplates() {
  const selection = syncSingleSelectionState({ preferRememberedScenario: true });
  if (!els.templateSelectionHint) return;
  if (!selection.template || !selection.platform || !selection.category || !selection.scenario) {
    els.templateSelectionHint.innerHTML = `<span>请选择平台、品类和场景</span>`;
    return;
  }
  els.templateSelectionHint.innerHTML = `
    <strong>${escapeHtml(selection.scenario.title || selection.template.title || "已选场景")}</strong>
    <span>${escapeHtml(selection.platform.label)} / ${escapeHtml(selection.category.label)}</span>
  `;
}

function selectedSingleTemplate() {
  return resolveSingleTemplateSelection({ preferRememberedScenario: true }).template || defaultSingleTemplate();
}

function defaultSingleTemplate(allTemplates = currentPromptConfig().single.templates || []) {
  const singleConfig = currentPromptConfig().single || {};
  const defaults = singleConfig.matrix?.defaults || singleConfig.defaults || {};
  return (
    allTemplates.find((template) => template.id === singleConfig.defaultTemplateId) ||
    allTemplates.find((template) => template.id === DEFAULT_SINGLE_TEMPLATE_ID) ||
    allTemplates.find(
      (template) =>
        template.platform === defaults.platformId &&
        template.category === defaults.categoryId &&
        template.scenario === defaults.scenarioId
    ) ||
    allTemplates.find((template) => template.category === (singleConfig.defaultTemplateCategory || DEFAULT_SINGLE_TEMPLATE_CATEGORY)) ||
    allTemplates[0] ||
    null
  );
}

async function handleGenerate() {
  const selection = resolveSingleTemplateSelection({ preferRememberedScenario: true });
  const template = selection.template;
  if (!template || template.id !== state.selectedTemplateId) {
    showToast("请先选择平台、品类和场景", true);
    return;
  }
  if (!(await ensureApiReady())) return;
  const verifiedSelection = resolveSingleTemplateSelection({ preferRememberedScenario: true });
  if (!verifiedSelection.template || verifiedSelection.template.id !== template.id) {
    showToast("请先完成三级筛选选择", true);
    return;
  }
  const count = clamp(parseInt(els.countInput.value, 10) || 1, 1, 8);
  els.countInput.value = String(count);

  var credits = state.auth.user ? (state.auth.user.creditsRemaining || 0) : 0;
  if (credits < count) {
    showCreditsModal(count, credits);
    return;
  }

  state.referenceFallbackNotice = "";
  setBusy(true, els.generateBtn, "生成中");
  renderLoadingGrid(els.resultGrid, count);
  try {
    const { images, calls } = await requestImagesExact({
      templateId: template.id,
      count,
      size: els.sizeInput.value,
      referenceImages: state.uploaded
    });
    const refThumbs = await thumbnailRefs(state.uploaded);
    state.generated = images.map((image, index) => ({
      id: createId("gen"),
      name: `${timestampName()}-${index + 1}`,
      url: image.url,
      prompt: `模板：${template.title}`,
      templateTitle: template.title,
      refCount: state.uploaded.length,
      refThumbs: refThumbs,
      createdAt: new Date().toISOString(),
      source: "generation",
      model: selectedImageModelName(),
      size: els.sizeInput.value,
      request: image.request || state.lastRequestPayload,
      remoteAssetId: image.remoteAssetId || image.generatedAssetId || "",
      generatedAssetId: image.generatedAssetId || image.remoteAssetId || ""
    }));
    renderResults();
    showGenerationToast(`已生成 ${state.generated.length} 张图片，API 调用 ${calls} 次`);
  } catch (error) {
    if (error.creditsRequired !== undefined) {
      showCreditsModal(error.creditsRequired, error.creditsRemaining);
    } else {
      els.resultGrid.className = "result-grid empty-state";
      els.resultGrid.innerHTML = `<div class="empty-copy"><strong>生成失败</strong><span>${escapeHtml(error.message)}</span></div>`;
      showToast(error.message, true);
    }
  } finally {
    setBusy(false, els.generateBtn, "生成图片");
  }
}

// ── Credits modal ──────────────────────────────────────────────────────────

function showCreditsModal(required, remaining) {
  var modal = document.getElementById("creditsModal");
  if (!modal) return;
  var isUrgent = required > 0;
  // title
  var title = document.getElementById("creditsModalTitle");
  if (title) title.textContent = isUrgent ? "积分不足" : "兑换积分";
  // required line
  var requiredP = document.getElementById("creditsRequiredText").parentNode;
  if (requiredP) requiredP.style.display = isUrgent ? "" : "none";
  document.getElementById("creditsRequiredText").textContent = required || 0;
  // remaining
  if (remaining == null) {
    remaining = state.auth.user ? (state.auth.user.creditsRemaining || 0) : 0;
  }
  document.getElementById("creditsRemainingModalText").textContent = remaining;
  document.getElementById("creditsRedeemInput").value = "";
  document.getElementById("creditsRedeemMessage").textContent = "";
  modal.setAttribute("aria-hidden", "false");
  modal.classList.add("active");
  document.getElementById("creditsRedeemInput").focus();
}

function closeCreditsModal() {
  var modal = document.getElementById("creditsModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "true");
  modal.classList.remove("active");
}

async function handleSubmitRedeem() {
  var input = document.getElementById("creditsRedeemInput");
  var msgEl = document.getElementById("creditsRedeemMessage");
  var btn = document.getElementById("submitRedeemBtn");
  var code = input.value.trim();
  if (!code) {
    msgEl.textContent = "请输入兑换码";
    msgEl.className = "form-message error";
    return;
  }
  btn.disabled = true;
  btn.textContent = "兑换中...";
  msgEl.textContent = "";
  msgEl.className = "form-message";
  try {
    var payload = await apiFetch("/redeem", {
      method: "POST",
      body: JSON.stringify({ code: code }),
    });
    msgEl.textContent = "兑换成功，已增加 " + payload.creditsAdded + " 积分";
    msgEl.className = "form-message success";
    input.value = "";
    // update credits display
    updateCreditsDisplay(payload.creditsRemaining, payload.creditsTotal);
    // update remaining in modal
    document.getElementById("creditsRemainingModalText").textContent = payload.creditsRemaining;
    document.getElementById("creditsRequiredText").textContent = Math.max(0, parseInt(document.getElementById("creditsRequiredText").textContent) - payload.creditsAdded);
  } catch (error) {
    msgEl.textContent = error.message;
    msgEl.className = "form-message error";
  } finally {
    btn.disabled = false;
    btn.textContent = "兑换积分";
  }
}

function updateCreditsDisplay(remaining, total) {
  var el = document.getElementById("creditsRemainingText");
  var container = document.getElementById("accountCredits");
  if (el) {
    el.textContent = remaining != null ? remaining : (total != null ? total : "0");
  }
  if (container && remaining != null && remaining >= 0) {
    container.hidden = false;
  }
}

// ── Bind credits modal events ──────────────────────────────────────────────

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var closeBtn = document.getElementById("closeCreditsModalBtn");
    var submitBtn = document.getElementById("submitRedeemBtn");
    var openBtn = document.getElementById("openCreditsModalBtn");
    var modal = document.getElementById("creditsModal");
    var input = document.getElementById("creditsRedeemInput");

    if (closeBtn) closeBtn.addEventListener("click", closeCreditsModal);
    if (submitBtn) submitBtn.addEventListener("click", handleSubmitRedeem);
    if (openBtn) openBtn.addEventListener("click", function () { showCreditsModal(0); });
    if (modal) modal.addEventListener("click", function (event) {
      if (event.target === modal) closeCreditsModal();
    });
    if (input) input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") handleSubmitRedeem();
    });
  });
})();

// Override renderAuthState to also update credits display
(function () {
  var _origRenderAuthState = renderAuthState;
  renderAuthState = function () {
    _origRenderAuthState();
    if (state.auth.user) {
      var credits = state.auth.user.creditsRemaining;
      if (credits === undefined) credits = state.auth.user.credits;
      updateCreditsDisplay(credits, state.auth.user.credits);
    } else {
      document.getElementById("accountCredits").hidden = true;
    }
  };
})();
