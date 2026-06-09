"use strict";

const DB_NAME = "pulse-ox-image-studio";
const DB_VERSION = 1;
const STORES = {
  folders: "folders",
  assets: "assets"
};

const DEFAULT_ENDPOINT = "https://aokapi.com/v1beta/models/gemini-2.5-flash-image:generateContent/";
const DEFAULT_MODEL = "gemini-2.5-flash-image";
const DEFAULT_FOLDER_NAME = "未分类素材";
const USER_TEMPLATES_KEY = "imageStudio.userTemplates";
const CLOUD_TOKEN_KEY = "imageStudio.cloudToken";
const CLOUD_API_BASE_KEY = "imageStudio.apiBase";
const IMAGE_SIZE_MULTIPLE = 16;
const REFERENCE_STRATEGY_KEY = "imageStudio.referenceStrategy";
const STRICT_PRODUCT_REFERENCE_RULE = [
  "强限制：商品主体必须以随请求提供的参考图、用户上传的原图、当前基图或上一轮生成结果为唯一外观参考，必须做到 1:1 还原。",
  "只允许改变背景、场景、光线、构图、拍摄角度、留白和后期排版区域；不得重新设计商品本体。",
  "不得改变商品的外形轮廓、比例、颜色、材质、纹理、Logo、文字、图案、按钮、接口、屏幕内容、配件关系、包装细节和任何可见结构。",
  "即使需要改变角度、场景、光线、背景或构图，也必须像同一件真实商品从新角度拍摄；看不清或无法确认的细节必须按参考图延续，不允许自行添加、删除、简化、美化或重新设计商品。"
].join("\n");

const templates = [
  {
    id: "main-white",
    category: "main",
    title: "白底主图",
    prompt:
      "平台合规白底主图，【产品名称/品类】居中展示，产品边缘清晰，纯白背景，真实电商摄影质感，无文字、无图标、无多余道具，准确呈现产品外观、材质、颜色和比例。"
  },
  {
    id: "main-angle",
    category: "main",
    title: "多角度套图",
    prompt:
      "【产品名称/品类】多角度展示，包含正面、侧面、背面和关键细节特写，干净浅灰背景，真实产品摄影，突出材质、结构、工艺和核心卖点，无品牌侵权元素。"
  },
  {
    id: "scene-home",
    category: "scene",
    title: "居家生活场景",
    prompt:
      "为【产品名称/品类】生成居家生活方式图，产品处于真实使用场景中，画面温暖可信，产品清晰可见，自然光，背景整洁，人物和道具只用于说明使用方式，不夸大产品效果。"
  },
  {
    id: "scene-use",
    category: "scene",
    title: "使用场景",
    prompt:
      "【产品名称/品类】真实使用场景，用户正在自然地使用产品，产品靠近视觉中心且细节可辨，背景符合目标人群和使用环境，真实摄影风格，强调便利性、质感和场景价值。"
  },
  {
    id: "info-feature",
    category: "infographic",
    title: "卖点信息图",
    prompt:
      "电商副图信息图构图，【产品名称/品类】位于画面中心，周围预留清晰标注区域，展示 3-5 个核心卖点、材质细节、使用方式或配件，干净浅色背景，少文字或无文字。"
  },
  {
    id: "info-size",
    category: "infographic",
    title: "尺寸与包装",
    prompt:
      "【产品名称/品类】尺寸与包装说明图，产品、包装盒、配件和说明物整齐排列，电商平铺摄影，背景干净，预留尺寸、规格、材质和包装清单标注空间，真实材质。"
  },
  {
    id: "content-banner",
    category: "content",
    title: "内容横幅",
    prompt:
      "电商详情页内容横幅，【产品名称/品类】置于符合品牌调性的场景中，横向构图，一侧留标题和卖点文案空间，真实摄影，高级克制，突出产品定位和使用氛围。"
  },
  {
    id: "content-comparison",
    category: "content",
    title: "对比模块",
    prompt:
      "电商详情页对比模块视觉，【产品名称/品类】与简洁功能图块并列，突出规格差异、材质优势、使用体验和适用场景，版式清晰，留出后期排版空间，不添加未经验证的认证或夸张承诺。"
  },
  {
    id: "season-gift",
    category: "season",
    title: "礼品季",
    prompt:
      "节日礼品季电商场景，【产品名称/品类】作为礼物放在简洁礼盒或节日道具旁，暖色室内光，真实摄影，画面温和有质感，保留产品主体清晰度，避免过度装饰。"
  },
  {
    id: "season-promo",
    category: "season",
    title: "促销活动图",
    prompt:
      "电商促销活动副图背景，【产品名称/品类】清晰居中，视觉风格干净醒目，右侧或下方预留价格、优惠和活动信息排版区，无具体折扣文字，无平台商标，适合后期添加促销信息。"
  }
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
  suiteShotSettings: {},
  cloud: {
    token: "",
    user: null,
    counts: null,
    plans: [],
    generations: [],
    syncing: false
  }
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  document.body.dataset.view = "suite";
  cacheElements();
  bindEvents();
  loadSettings();
  loadCloudSession();
  loadUserTemplates();
  renderSuitePlan();
  renderSuiteReference();
  renderTemplates();
  renderQuickEdits();
  state.db = await openDb();
  await ensureDefaultFolder();
  if (hasCloudSession()) {
    await refreshCloudState({ silent: true });
  } else {
    await refreshLibrary();
  }
  updateConnectionState();
  renderAccountView();
  setDefaultAutoSaveName();
});

function cacheElements() {
  Object.assign(els, {
    navItems: document.querySelectorAll(".nav-item"),
    views: document.querySelectorAll(".view"),
    cloudAccountCard: document.getElementById("cloudAccountCard"),
    cloudAccountTitle: document.getElementById("cloudAccountTitle"),
    cloudQuotaText: document.getElementById("cloudQuotaText"),
    cloudSyncText: document.getElementById("cloudSyncText"),
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
    dropzone: document.getElementById("dropzone"),
    uploadInput: document.getElementById("uploadInput"),
    uploadPreview: document.getElementById("uploadPreview"),
    promptInput: document.getElementById("promptInput"),
    saveTemplateBtn: document.getElementById("saveTemplateBtn"),
    templateFilter: document.getElementById("templateFilter"),
    templateGrid: document.getElementById("templateGrid"),
    countInput: document.getElementById("countInput"),
    sizeInput: document.getElementById("sizeInput"),
    apiKeyInput: document.getElementById("apiKeyInput"),
    apiBaseInput: document.getElementById("apiBaseInput"),
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
    cloudNameInput: document.getElementById("cloudNameInput"),
    cloudEmailInput: document.getElementById("cloudEmailInput"),
    cloudPasswordInput: document.getElementById("cloudPasswordInput"),
    loginBtn: document.getElementById("loginBtn"),
    registerBtn: document.getElementById("registerBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    refreshCloudBtn: document.getElementById("refreshCloudBtn"),
    authPanel: document.getElementById("authPanel"),
    cloudConsolePanel: document.getElementById("cloudConsolePanel"),
    accountStatusText: document.getElementById("accountStatusText"),
    accountQuotaValue: document.getElementById("accountQuotaValue"),
    accountPlanValue: document.getElementById("accountPlanValue"),
    accountAssetValue: document.getElementById("accountAssetValue"),
    accountGenerationValue: document.getElementById("accountGenerationValue"),
    accountEmailText: document.getElementById("accountEmailText"),
    accountCloudBaseText: document.getElementById("accountCloudBaseText"),
    planGrid: document.getElementById("planGrid"),
    generationHistory: document.getElementById("generationHistory"),
    toast: document.getElementById("toast")
  });
}

function bindEvents() {
  els.navItems.forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.templateFilter.addEventListener("change", renderTemplates);
  els.saveTemplateBtn.addEventListener("click", saveCurrentPromptTemplate);
  els.connectionState.addEventListener("click", openSettingsModal);
  els.singleConnectionState.addEventListener("click", openSettingsModal);
  els.cloudAccountCard.addEventListener("click", () => switchView("account"));
  els.loginBtn.addEventListener("click", () => handleCloudAuth("login"));
  els.registerBtn.addEventListener("click", () => handleCloudAuth("register"));
  els.logoutBtn.addEventListener("click", handleCloudLogout);
  els.refreshCloudBtn.addEventListener("click", () => refreshCloudState({ silent: false }));
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
  els.saveApiBtn.addEventListener("click", saveSettings);
  els.testReferenceBtn.addEventListener("click", handleTestReferenceSupport);
  els.toggleKeyBtn.addEventListener("click", toggleApiKey);
  els.sizeInput.addEventListener("change", () => localStorage.setItem("imageStudio.size", els.sizeInput.value));
  els.suiteSizeInput.addEventListener("change", handleSuiteSizeChange);
  els.clearFormBtn.addEventListener("click", clearGenerationForm);
  els.generateBtn.addEventListener("click", handleGenerate);
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.saveModal.classList.contains("active")) closeSaveModal();
    if (event.key === "Escape" && els.settingsModal.classList.contains("active")) closeSettingsModal();
  });
}

function switchView(viewName) {
  document.body.dataset.view = viewName;
  els.navItems.forEach((button) => {
    const isActive = button.dataset.view === viewName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
  els.views.forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
  if (viewName === "library") renderLibrary();
  if (viewName === "account") renderAccountView();
}

function selectedSuitePreset() {
  return suitePresets[els.suitePresetInput.value] || suitePresets.amazon;
}

function renderSuitePlan(activeId = null, doneIds = new Set()) {
  const preset = selectedSuitePreset();
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
  preset.shots.forEach((shot) => {
    if (state.suiteShotSettings[shot.id]) return;
    state.suiteShotSettings[shot.id] = {
      enabled: true,
      size: defaultSuiteShotSize(shot)
    };
  });
}

function resetSuiteShotSettings(preset = selectedSuitePreset()) {
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
  ensureSuiteShotSettings();
  selectedSuitePreset().shots.forEach((shot) => {
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
    prompt: "套图商品基图",
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

function suiteContext() {
  const productName = els.suiteProductNameInput.value.trim() || state.suiteReference?.name || "";
  const category = els.suiteCategoryInput.value.trim();
  const sellingPoints = els.suiteSellingPointsInput.value.trim();
  const styleText = els.suiteStyleInput.options[els.suiteStyleInput.selectedIndex]?.text || "高级简洁";
  return {
    productName,
    productLabel: productName || "商品基图中的产品",
    category: category || "通用电商品类",
    sellingPoints: sellingPoints || "根据商品外观推断核心材质、功能、使用场景和包装价值",
    styleText,
    referenceName: state.suiteReference?.name || ""
  };
}

function buildSuitePrompt(shot, preset, context) {
  const referenceLine = state.suiteReference
    ? `以已上传商品基图「${context.referenceName}」作为唯一商品外观参考，商品主体必须和原图 1:1 还原，不能改变任何可见结构、比例、颜色、材质、文字、Logo、纹理、按钮、接口、配件或包装细节。`
    : "如果没有可见商品基图，则根据商品名称、品类和卖点生成可信的通用电商商品视觉。";

  return [
    `任务：为「${context.productLabel}」生成「${preset.title}」中的「${shot.name}」。`,
    `品类：${context.category}`,
    `核心卖点：${context.sellingPoints}`,
    `视觉风格：${context.styleText}`,
    referenceLine,
    shot.prompt,
    "电商摄影质感，产品真实可信，构图清晰，背景和道具服务于商品表达。",
    "不要添加虚构品牌 Logo、平台商标、未经验证的认证、夸张承诺、不可读乱码文字或误导性效果。"
  ].join("\n");
}

async function handleGenerateSuite() {
  if (!ensureApiReady()) return;

  const preset = selectedSuitePreset();
  const context = suiteContext();
  const activeShots = getSuiteActiveShots(preset);
  if (!activeShots.length) {
    showToast("请至少保留一张套图图位", true);
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
      const prompt = buildSuitePrompt(shot, preset, context);
      const requestedSize = shot.outputSize || shot.size;
      const images = await requestImages({
        prompt,
        count: 1,
        size: requestedSize,
        model: els.modelInput.value.trim() || DEFAULT_MODEL,
        endpoint: els.endpointInput.value.trim() || DEFAULT_ENDPOINT,
        apiKey: els.apiKeyInput.value.trim(),
        referenceImages: state.suiteReference ? [state.suiteReference] : []
      });
      const item = {
        id: createId("suite-img"),
        name: `${shot.name}-${context.productName || timestampName()}`,
        url: images[0].url,
        prompt,
        createdAt: new Date().toISOString(),
        source: "suite",
        suiteId,
        shotId: shot.id,
        shotName: shot.name,
        model: els.modelInput.value.trim() || DEFAULT_MODEL,
        size: requestedSize
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
  const allTemplates = [...userTemplates, ...templates];
  const visibleTemplates = category === "all" ? allTemplates : allTemplates.filter((item) => item.category === category);
  els.templateGrid.innerHTML = visibleTemplates
    .map(
      (template) => `
        <button class="template-card" type="button" data-template-id="${escapeHtml(template.id)}">
          ${template.custom ? `<span class="template-delete" data-delete-template="${escapeHtml(template.id)}" title="删除模板">×</span>` : ""}
          <strong>${escapeHtml(template.title)}</strong>
          <span>${escapeHtml(template.prompt)}</span>
        </button>
      `
    )
    .join("");
  els.templateGrid.querySelectorAll(".template-card").forEach((button) => {
    button.addEventListener("click", () => {
      const template = allTemplates.find((item) => item.id === button.dataset.templateId);
      if (!template) return;
      els.promptInput.value = template.prompt;
      showToast(`已套用：${template.title}`);
    });
  });
  els.templateGrid.querySelectorAll("[data-delete-template]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      deleteUserTemplate(button.dataset.deleteTemplate);
    });
  });
}

function loadUserTemplates() {
  try {
    const saved = JSON.parse(localStorage.getItem(USER_TEMPLATES_KEY) || "[]");
    userTemplates = Array.isArray(saved)
      ? saved.filter((item) => item?.id && item?.prompt).map((item) => ({ ...item, category: "custom", custom: true }))
      : [];
  } catch {
    userTemplates = [];
  }
}

function persistUserTemplates() {
  localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(userTemplates));
}

function saveCurrentPromptTemplate() {
  const promptText = els.promptInput.value.trim();
  if (!promptText) {
    showToast("请先输入提示词", true);
    return;
  }
  const title = window.prompt("模板名称", `我的模板 ${userTemplates.length + 1}`);
  if (!title || !title.trim()) return;
  userTemplates.unshift({
    id: createId("tpl"),
    category: "custom",
    custom: true,
    title: title.trim(),
    prompt: promptText,
    createdAt: new Date().toISOString()
  });
  persistUserTemplates();
  els.templateFilter.value = "custom";
  renderTemplates();
  showToast("提示词模板已保存");
}

function deleteUserTemplate(templateId) {
  userTemplates = userTemplates.filter((item) => item.id !== templateId);
  persistUserTemplates();
  renderTemplates();
  showToast("模板已删除");
}

function renderQuickEdits() {
  els.quickEditGrid.innerHTML = quickEdits
    .map((text) => `<button class="quick-edit" type="button" data-edit="${escapeHtml(text)}">${escapeHtml(text)}</button>`)
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
  els.apiBaseInput.value = localStorage.getItem(CLOUD_API_BASE_KEY) || defaultCloudApiBase();
  els.apiKeyInput.value = localStorage.getItem("imageStudio.apiKey") || "";
  const savedEndpoint = localStorage.getItem("imageStudio.endpoint") || "";
  const savedModel = localStorage.getItem("imageStudio.model") || "";
  const endpoint = isLegacyDefaultEndpoint(savedEndpoint) ? DEFAULT_ENDPOINT : savedEndpoint || DEFAULT_ENDPOINT;
  const model = isLegacyDefaultModel(savedModel) ? DEFAULT_MODEL : savedModel || DEFAULT_MODEL;
  els.endpointInput.value = endpoint;
  els.modelInput.value = model;
  localStorage.setItem("imageStudio.endpoint", endpoint);
  localStorage.setItem("imageStudio.model", model);
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

function saveSettings() {
  localStorage.setItem(CLOUD_API_BASE_KEY, normalizeApiBase(els.apiBaseInput.value) || defaultCloudApiBase());
  localStorage.setItem("imageStudio.apiKey", els.apiKeyInput.value.trim());
  localStorage.setItem("imageStudio.endpoint", els.endpointInput.value.trim() || DEFAULT_ENDPOINT);
  localStorage.setItem("imageStudio.model", els.modelInput.value.trim() || DEFAULT_MODEL);
  localStorage.setItem("imageStudio.size", els.sizeInput.value);
  updateConnectionState();
  renderAccountView();
  closeSettingsModal();
  showToast("配置已保存");
}

function isLegacyDefaultEndpoint(value) {
  const text = normalized(value);
  return text === "https://api.muskapis.com/v1/images/generations";
}

function isLegacyDefaultModel(value) {
  return normalized(value) === "gpt-image-2";
}

function updateConnectionState() {
  renderCloudRail();
  if (hasCloudSession() && state.cloud.user) {
    const text = `云端已登录 · ${state.cloud.user.quotaBalance} 点`;
    [els.connectionState, els.singleConnectionState].forEach((button) => {
      if (!button) return;
      button.textContent = text;
      button.classList.add("ready");
    });
    return;
  }
  const hasKey = Boolean(els.apiKeyInput.value.trim());
  const text = hasKey ? "本地 API 已就绪" : "登录/配置";
  [els.connectionState, els.singleConnectionState].forEach((button) => {
    if (!button) return;
    button.textContent = text;
    button.classList.toggle("ready", hasKey);
  });
}

function toggleApiKey() {
  els.apiKeyInput.type = els.apiKeyInput.type === "password" ? "text" : "password";
}

function ensureApiReady() {
  if (hasCloudSession()) return true;
  if (els.apiKeyInput.value.trim()) return true;
  switchView("account");
  showToast("请先登录云端账号，或在设置中填写本地 API Key", true);
  return false;
}

function openSettingsModal() {
  els.settingsModal.classList.add("active");
  els.settingsModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => els.apiKeyInput.focus(), 0);
}

function closeSettingsModal() {
  els.settingsModal.classList.remove("active");
  els.settingsModal.setAttribute("aria-hidden", "true");
}

function defaultCloudApiBase() {
  if (window.location.protocol === "file:") return "http://localhost:8787";
  return window.location.origin;
}

function normalizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function cloudApiBase() {
  return normalizeApiBase(els.apiBaseInput?.value || localStorage.getItem(CLOUD_API_BASE_KEY) || defaultCloudApiBase());
}

function loadCloudSession() {
  state.cloud.token = localStorage.getItem(CLOUD_TOKEN_KEY) || "";
}

function hasCloudSession() {
  return Boolean(state.cloud.token);
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${cloudApiBase()}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(state.cloud.token ? { Authorization: `Bearer ${state.cloud.token}` } : {})
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
    if (response.status === 401) clearCloudSession();
    throw new Error(payload?.error || payload?.message || response.statusText || "云端请求失败");
  }
  return payload || {};
}

async function handleCloudAuth(mode) {
  const email = els.cloudEmailInput.value.trim();
  const password = els.cloudPasswordInput.value;
  const name = els.cloudNameInput.value.trim();
  if (!email || !password) {
    showToast("请输入邮箱和密码", true);
    return;
  }
  if (mode === "register" && password.length < 8) {
    showToast("注册密码至少 8 位", true);
    return;
  }

  const button = mode === "register" ? els.registerBtn : els.loginBtn;
  setBusy(true, button, mode === "register" ? "注册中" : "登录中");
  try {
    const payload = await apiFetch(mode === "register" ? "/auth/register" : "/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, name })
    });
    state.cloud.token = payload.token;
    state.cloud.user = payload.user;
    localStorage.setItem(CLOUD_TOKEN_KEY, state.cloud.token);
    localStorage.setItem(CLOUD_API_BASE_KEY, cloudApiBase());
    els.cloudPasswordInput.value = "";
    await refreshCloudState({ silent: true });
    switchView("suite");
    showToast(mode === "register" ? "云端账号已创建" : "已登录云端");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false, button, mode === "register" ? "注册新账号" : "登录");
  }
}

async function handleCloudLogout() {
  if (!hasCloudSession()) {
    showToast("当前未登录");
    return;
  }
  try {
    await apiFetch("/auth/logout", { method: "POST", body: "{}" });
  } catch {
    // Token may already be expired; local cleanup is still correct.
  }
  clearCloudSession();
  await refreshLibrary();
  renderAccountView();
  updateConnectionState();
  showToast("已退出云端账号");
}

function clearCloudSession() {
  state.cloud.token = "";
  state.cloud.user = null;
  state.cloud.counts = null;
  state.cloud.generations = [];
  localStorage.removeItem(CLOUD_TOKEN_KEY);
}

async function refreshCloudState({ silent = false } = {}) {
  if (!hasCloudSession()) {
    renderAccountView();
    updateConnectionState();
    return;
  }
  state.cloud.syncing = true;
  renderCloudRail();
  try {
    const [me, folders, assets, generations, plans] = await Promise.all([
      apiFetch("/me"),
      apiFetch("/folders"),
      apiFetch("/assets"),
      apiFetch("/generations"),
      apiFetch("/billing/plans")
    ]);
    state.cloud.user = me.user;
    state.cloud.counts = me.counts;
    state.folders = folders.folders || [];
    state.assets = assets.assets || [];
    state.cloud.generations = generations.generations || [];
    state.cloud.plans = plans.plans || [];
    populateFolderSelects();
    renderLibrary();
    renderAccountView();
    updateConnectionState();
    if (!silent) showToast("云端数据已刷新");
  } catch (error) {
    if (!silent) showToast(error.message, true);
    renderAccountView();
    updateConnectionState();
  } finally {
    state.cloud.syncing = false;
    renderCloudRail();
  }
}

function renderCloudRail() {
  if (!els.cloudAccountTitle) return;
  if (hasCloudSession() && state.cloud.user) {
    els.cloudAccountTitle.textContent = state.cloud.user.name || state.cloud.user.email;
    els.cloudQuotaText.textContent = `${state.cloud.user.quotaBalance} 点生成配额`;
    els.cloudSyncText.textContent = state.cloud.syncing ? "正在同步云端素材..." : "云端素材库与生成记录已启用";
    els.cloudAccountCard.classList.add("ready");
    return;
  }
  els.cloudAccountTitle.textContent = hasCloudSession() ? "正在连接云端" : "未登录云端";
  els.cloudQuotaText.textContent = hasCloudSession() ? "同步中" : "本地素材模式";
  els.cloudSyncText.textContent = hasCloudSession() ? "正在校验登录状态" : "登录后启用账号、配额和云端记录";
  els.cloudAccountCard.classList.toggle("ready", hasCloudSession());
}

function renderAccountView() {
  const loggedIn = hasCloudSession() && state.cloud.user;
  els.authPanel.classList.toggle("muted-panel", loggedIn);
  els.logoutBtn.style.display = loggedIn ? "inline-flex" : "none";
  els.refreshCloudBtn.disabled = !hasCloudSession();
  els.accountStatusText.textContent = loggedIn ? "云端在线" : hasCloudSession() ? "连接中" : "未登录";
  els.accountQuotaValue.textContent = loggedIn ? String(state.cloud.user.quotaBalance) : "--";
  els.accountPlanValue.textContent = loggedIn ? state.cloud.user.plan : "--";
  els.accountAssetValue.textContent = loggedIn ? String(state.cloud.counts?.assets ?? state.assets.length) : "--";
  els.accountGenerationValue.textContent = loggedIn ? String(state.cloud.counts?.generations ?? state.cloud.generations.length) : "--";
  els.accountEmailText.textContent = loggedIn ? state.cloud.user.email : "登录后会在这里显示账号邮箱";
  els.accountCloudBaseText.textContent = `后端：${cloudApiBase()}`;
  renderPlanGrid();
  renderGenerationHistory();
  renderCloudRail();
}

function renderPlanGrid() {
  if (!state.cloud.plans.length) {
    els.planGrid.innerHTML = `
      <div class="empty-copy">
        <strong>${hasCloudSession() ? "套餐加载中" : "登录后查看套餐"}</strong>
        <span>云端后端会返回可购买的配额包。</span>
      </div>
    `;
    return;
  }
  els.planGrid.innerHTML = state.cloud.plans
    .map(
      (plan) => `
        <article class="plan-card">
          <div>
            <strong>${escapeHtml(plan.name)}</strong>
            <span>${escapeHtml(plan.description)}</span>
          </div>
          <div class="plan-meta">
            <b>${plan.credits}</b>
            <small>生成点数 · ¥${(plan.priceCents / 100).toFixed(0)}</small>
          </div>
          <button class="small-button" type="button" data-action="buy-plan" data-plan-id="${escapeAttr(plan.id)}" ${hasCloudSession() ? "" : "disabled"}>购买配额</button>
        </article>
      `
    )
    .join("");
  els.planGrid.querySelectorAll("[data-action='buy-plan']").forEach((button) => {
    button.addEventListener("click", () => handleBuyPlan(button.dataset.planId));
  });
}

async function handleBuyPlan(planId) {
  if (!hasCloudSession()) {
    showToast("请先登录云端账号", true);
    return;
  }
  try {
    const payload = await apiFetch("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ planId })
    });
    state.cloud.user = payload.user || state.cloud.user;
    await refreshCloudState({ silent: true });
    const paid = payload.order?.status === "paid";
    showToast(paid ? "配额已到账" : "订单已创建，请接入真实支付回调");
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderGenerationHistory() {
  const generations = state.cloud.generations || [];
  if (!hasCloudSession()) {
    els.generationHistory.className = "generation-history empty-state";
    els.generationHistory.innerHTML = `<div class="empty-copy"><strong>未登录云端</strong><span>登录后会显示生成记录、消耗配额和输出图片。</span></div>`;
    return;
  }
  if (!generations.length) {
    els.generationHistory.className = "generation-history empty-state";
    els.generationHistory.innerHTML = `<div class="empty-copy"><strong>暂无云端记录</strong><span>登录后生成的图片会记录在这里。</span></div>`;
    return;
  }
  els.generationHistory.className = "generation-history";
  els.generationHistory.innerHTML = generations
    .map(
      (item) => `
        <article class="history-row">
          <div class="history-thumb">
            ${item.images?.[0]?.url ? `<img src="${escapeAttr(item.images[0].url)}" alt="生成记录图片" />` : ""}
          </div>
          <div class="history-copy">
            <strong>${escapeHtml(item.status === "completed" ? `${item.count} 张 · ${item.size}` : item.status)}</strong>
            <span>${escapeHtml(item.prompt || "")}</span>
          </div>
          <div class="history-meta">
            <b>-${item.creditCost}</b>
            <small>${formatTime(item.createdAt)}</small>
          </div>
        </article>
      `
    )
    .join("");
}

async function handleTestReferenceSupport() {
  if (hasCloudSession()) {
    await handleCloudReferenceSupportTest();
    return;
  }

  const apiKey = els.apiKeyInput.value.trim();
  if (!apiKey) {
    showToast("请先填写 API Key", true);
    els.apiKeyInput.focus();
    return;
  }

  const endpoint = els.endpointInput.value.trim() || DEFAULT_ENDPOINT;
  const model = els.modelInput.value.trim() || DEFAULT_MODEL;
  const reference = firstAvailableReferenceImage() || {
    name: "参考图探测",
    size: "1x1",
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
  };
  const references = normalizeReferenceImages([reference]);
  const usingFallbackReference = !firstAvailableReferenceImage();
  const probePrompt = withStrictProductReference(
    withReferenceContext(
      "入参图片生效测试。请生成一张明亮科技感电商商品图，必须保持随请求提供的参考图商品主体一致，只允许改变背景、光线和构图，不添加文字。",
      references
    )
  );
  const body = {
    model,
    prompt: probePrompt,
    n: 1,
    size: "1024x1024"
  };
  const resolvedEndpoint = resolveImageEndpoint(endpoint, model);

  renderReferenceProbeLoading(reference, usingFallbackReference);
  setBusy(true, els.testReferenceBtn, "测试中");
  try {
    if (isGeminiImageEndpoint(resolvedEndpoint, model)) {
      const referenceImages = await requestImages({
        prompt: probePrompt,
        count: 1,
        size: "1024x1024",
        model,
        endpoint: resolvedEndpoint,
        apiKey,
        referenceImages: references
      });
      const controlImages = await requestImages({
        prompt: withStrictProductReference("无入参图片对照测试。请生成一张明亮科技感电商商品图，不添加文字。"),
        count: 1,
        size: "1024x1024",
        model,
        endpoint: resolvedEndpoint,
        apiKey,
        referenceImages: []
      });
      renderReferenceProbeResult({
        reference,
        referenceImage: referenceImages[0],
        controlImage: controlImages[0],
        strategy: "Gemini inlineData",
        usingFallbackReference
      });
      showToast("Gemini 图生图入参已发送：contents.parts.inlineData");
      return;
    }
    const result = await probeReferenceStrategy({ endpoint, apiKey, body, references });
    if (result.accepted) {
      localStorage.setItem(REFERENCE_STRATEGY_KEY, result.strategy);
      const controlImages = await postImageRequest(endpoint, apiKey, {
        ...body,
        prompt: withStrictProductReference("无入参图片对照测试。请生成一张明亮科技感电商商品图，不添加文字。")
      });
      renderReferenceProbeResult({
        reference,
        referenceImage: result.images[0],
        controlImage: controlImages[0],
        strategy: result.strategy,
        usingFallbackReference
      });
      showToast(`入参图片字段已生效：${result.strategy}`);
      return;
    }
    localStorage.removeItem(REFERENCE_STRATEGY_KEY);
    renderReferenceProbeError(`未确认支持入参图片：${result.message}`);
    showToast(`未确认支持参考图：${result.message}`, true);
  } catch (error) {
    renderReferenceProbeError(error.message);
    showToast(error.message, true);
  } finally {
    setBusy(false, els.testReferenceBtn, "测试入参图片");
  }
}

async function handleCloudReferenceSupportTest() {
  const model = els.modelInput.value.trim() || DEFAULT_MODEL;
  const reference = firstAvailableReferenceImage() || {
    name: "参考图探测",
    size: "1x1",
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
  };
  const references = normalizeReferenceImages([reference]);
  const usingFallbackReference = !firstAvailableReferenceImage();
  const probePrompt = withStrictProductReference(
    withReferenceContext(
      "入参图片生效测试。请生成一张明亮科技感电商商品图，必须保持随请求提供的参考图商品主体一致，只允许改变背景、光线和构图，不添加文字。",
      references
    )
  );
  const body = {
    prompt: probePrompt,
    count: 1,
    size: "1024x1024",
    model,
    referenceImages: references
  };

  renderReferenceProbeLoading(reference, usingFallbackReference);
  setBusy(true, els.testReferenceBtn, "测试中");
  try {
    recordRequestPayload(`${cloudApiBase()}/api/generate`, body);
    const result = await apiFetch("/generate", {
      method: "POST",
      body: JSON.stringify(body)
    });
    const control = await apiFetch("/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt: withStrictProductReference("无入参图片对照测试。请生成一张明亮科技感电商商品图，不添加文字。"),
        count: 1,
        size: "1024x1024",
        model,
        referenceImages: []
      })
    });
    if (result.quota && state.cloud.user) state.cloud.user.quotaBalance = control.quota?.balance ?? result.quota.balance;
    if (result.generation || control.generation) {
      state.cloud.generations = [control.generation, result.generation, ...state.cloud.generations]
        .filter(Boolean)
        .filter((item, index, array) => array.findIndex((entry) => entry.id === item.id) === index)
        .slice(0, 80);
    }
    renderReferenceProbeResult({
      reference,
      referenceImage: result.images[0],
      controlImage: control.images[0],
      strategy: "cloud /api/generate",
      usingFallbackReference
    });
    renderAccountView();
    updateConnectionState();
    showToast("云端入参图片测试已完成");
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
  els.promptInput.value = "";
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
      prompt: "本地上传商品参考图",
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
  const prompt = els.promptInput.value.trim();
  if (!prompt) {
    showToast("请先输入提示词", true);
    return;
  }
  if (!ensureApiReady()) return;
  const count = clamp(parseInt(els.countInput.value, 10) || 1, 1, 8);
  els.countInput.value = String(count);

  state.referenceFallbackNotice = "";
  setBusy(true, els.generateBtn, "生成中");
  renderLoadingGrid(els.resultGrid, count);
  try {
    const { images, calls } = await requestImagesExact({
      prompt,
      count,
      size: els.sizeInput.value,
      model: els.modelInput.value.trim() || DEFAULT_MODEL,
      endpoint: els.endpointInput.value.trim() || DEFAULT_ENDPOINT,
      apiKey: els.apiKeyInput.value.trim(),
      referenceImages: state.uploaded
    });
    state.generated = images.map((image, index) => ({
      id: createId("gen"),
      name: `${timestampName()}-${index + 1}`,
      url: image.url,
      prompt,
      createdAt: new Date().toISOString(),
      source: "generation",
      model: els.modelInput.value.trim() || DEFAULT_MODEL,
      size: els.sizeInput.value
    }));
    renderResults();
    showGenerationToast(`已生成 ${state.generated.length} 张图片，API 调用 ${calls} 次`);
  } catch (error) {
    els.resultGrid.className = "result-grid empty-state";
    els.resultGrid.innerHTML = `<div class="empty-copy"><strong>生成失败</strong><span>${escapeHtml(error.message)}</span></div>`;
    showToast(error.message, true);
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
  if (!ensureApiReady()) return;

  state.referenceFallbackNotice = "";
  const composedPrompt = [
    "基于当前界面显示的最新商品图继续生成一个微调版本，不回到最初原图。",
    imageReferenceText(state.selectedImage.url),
    state.selectedImage.size ? `当前基图尺寸：${state.selectedImage.size}` : "",
    state.selectedImage.prompt ? `上一版提示词：${state.selectedImage.prompt}` : "",
    `本次修改要求：${editPrompt}`,
    "商品主体必须和当前基图 1:1 还原，不得改变任何可见结构、比例、颜色、材质、文字、Logo、纹理、按钮、接口、配件或包装细节。适合电商商品图，不添加未经验证的功能、认证、品牌或夸张效果承诺。"
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
      model: els.modelInput.value.trim() || DEFAULT_MODEL,
      endpoint: els.endpointInput.value.trim() || DEFAULT_ENDPOINT,
      apiKey: els.apiKeyInput.value.trim(),
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
      model: els.modelInput.value.trim() || DEFAULT_MODEL,
      size: els.sizeInput.value
    };
    renderEditResults([refined]);
    state.selectedImage = refined;
    renderEditSelection();
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
      showGenerationToast("微调版本已保存，并设为下一轮基图");
    } else {
      showGenerationToast("微调版本已生成，并设为下一轮基图");
    }
  } catch (error) {
    els.editResultGrid.className = "result-grid compact empty-state";
    els.editResultGrid.innerHTML = `<div class="empty-copy"><strong>微调失败</strong><span>${escapeHtml(error.message)}</span></div>`;
    showToast(error.message, true);
  } finally {
    setBusy(false, els.refineBtn, "生成微调版本");
  }
}

async function requestImages({ prompt, count, size, model, endpoint, apiKey, referenceImages = [] }) {
  const references = normalizeReferenceImages(referenceImages);
  const finalPrompt = withStrictProductReference(withReferenceContext(prompt, references));
  const requestSize = normalizeImageSize(size) || "1024x1024";
  const resolvedEndpoint = resolveImageEndpoint(endpoint, model);
  const baseBody = {
    model,
    prompt: finalPrompt,
    n: count,
    size: requestSize
  };

  if (hasCloudSession()) {
    const cloudBody = {
      prompt: finalPrompt,
      count,
      size: requestSize,
      model,
      endpoint: resolvedEndpoint,
      referenceImages: references
    };
    recordRequestPayload(`${cloudApiBase()}/api/generate`, cloudBody);
    const payload = await apiFetch("/generate", {
      method: "POST",
      body: JSON.stringify(cloudBody)
    });
    if (payload.quota && state.cloud.user) {
      state.cloud.user.quotaBalance = payload.quota.balance;
    }
    if (payload.generation) {
      state.cloud.generations = [payload.generation, ...state.cloud.generations.filter((item) => item.id !== payload.generation.id)].slice(0, 80);
      state.cloud.counts = {
        ...(state.cloud.counts || {}),
        generations: (state.cloud.counts?.generations || 0) + 1
      };
    }
    renderAccountView();
    updateConnectionState();
    return payload.images || [];
  }

  if (isGeminiImageEndpoint(resolvedEndpoint, model)) {
    const geminiBody = await buildGeminiImageRequestBody({
      prompt: finalPrompt,
      size: requestSize,
      references
    });
    return postImageRequest(resolvedEndpoint, apiKey, geminiBody);
  }

  if (!references.length) {
    return postImageRequest(resolvedEndpoint, apiKey, baseBody);
  }

  let lastReferenceError = null;
  for (const strategy of referencePayloadStrategies(references)) {
    try {
      const images = await postImageRequest(resolvedEndpoint, apiKey, {
        ...baseBody,
        ...strategy.body
      });
      localStorage.setItem(REFERENCE_STRATEGY_KEY, strategy.id);
      return images;
    } catch (error) {
      if (!canRetryReferencePayload(error)) throw error;
      lastReferenceError = error;
    }
  }

  localStorage.removeItem(REFERENCE_STRATEGY_KEY);
  const fallbackImages = await postImageRequest(resolvedEndpoint, apiKey, baseBody);
  if (lastReferenceError) {
    state.referenceFallbackNotice = "当前接口未接受参考图字段，已降级为提示词锁定";
  }
  return fallbackImages;
}

async function postImageRequest(endpoint, apiKey, body) {
  recordRequestPayload(endpoint, body);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorizationHeaderValue(apiKey, endpoint)
    },
    body: JSON.stringify(body)
  });

  const payloadText = await response.text();
  let payload = null;
  try {
    payload = payloadText ? JSON.parse(payloadText) : null;
  } catch {
    payload = payloadText;
  }

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || response.statusText || "接口请求失败";
    const error = new Error(`API ${response.status}: ${message}`);
    error.status = response.status;
    error.apiMessage = message;
    throw error;
  }

  const images = extractImageResultsFromPayload(payload);

  if (!images.length) {
    throw new Error("接口未返回可识别的图片地址或 b64_json");
  }
  return images;
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
  const seen = new Set();
  return (references || [])
    .filter((reference) => reference?.url)
    .map((reference) => ({
      name: reference.name || "参考图",
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

function recordRequestPayload(endpoint, body) {
  if (!els.requestPayloadPreview || !els.requestPayloadMeta) return;
  const sanitized = sanitizeRequestPayload(body);
  const strategy = localStorage.getItem(REFERENCE_STRATEGY_KEY);
  const imageFields = findImagePayloadFields(body);
  els.requestPayloadMeta.textContent = [
    new Date().toLocaleTimeString(),
    strategy ? `字段策略：${strategy}` : "",
    imageFields.length ? `图片字段：${imageFields.join(", ")}` : "未带图片字段"
  ]
    .filter(Boolean)
    .join(" · ");
  els.requestPayloadPreview.textContent = JSON.stringify(
    {
      endpoint,
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
  const primary = references[0];
  const lines = [
    `参考图已随请求发送。首要参考图：「${primary.name || "参考图 1"}」${primary.size ? `，尺寸 ${primary.size}` : ""}。`,
    references.length > 1 ? `其余 ${references.length - 1} 张参考图只用于补充角度、结构和材质细节，不得引入不同商品特征。` : "",
    "生成时必须先识别参考图中的商品主体，再保持同一件商品的轮廓、比例、颜色、材质、Logo、文字、纹理、接口、配件和包装细节一致。"
  ];
  return [...lines.filter(Boolean), prompt].join("\n");
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
    const supplementalPrompt = [
      options.prompt,
      `请生成第 ${index} 张变体，保持同一商品和同一设计方向，但构图、角度或背景细节与前面图片有区别。`
    ].join("\n");
    const extraBatch = await requestImages({ ...options, prompt: supplementalPrompt, count: 1 });
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
        <img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.name)}" />
      </div>
      <div class="image-meta">
        <div class="image-title-row">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${formatTime(item.createdAt)}</span>
        </div>
        <div class="prompt-preview">${escapeHtml(item.prompt || "")}</div>
        <div class="card-actions three">
          <button class="small-button" type="button" data-action="save" data-id="${escapeHtml(item.id)}">保存</button>
          <button class="small-button" type="button" data-action="edit" data-id="${escapeHtml(item.id)}">编辑</button>
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
  container.querySelectorAll("[data-action='remove-result']").forEach((button) => {
    button.addEventListener("click", () => removeGeneratedImage(button.dataset.id));
  });
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
  if (hasCloudSession()) {
    const payload = await apiFetch("/assets", {
      method: "POST",
      body: JSON.stringify({
        name: options.name || item.name || timestampName(),
        folderId: options.folderId,
        newFolderName: options.newFolderName,
        url: item.url,
        prompt: item.prompt || "",
        source: item.source || "",
        model: item.model || "",
        size: item.size || "",
        createdAt: item.createdAt,
        metadata: {
          parentId: item.parentId || "",
          suiteId: item.suiteId || "",
          shotId: item.shotId || "",
          shotName: item.shotName || ""
        }
      })
    });
    return payload.asset;
  }

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
  return asset;
}

async function refreshLibrary() {
  if (hasCloudSession()) {
    await refreshCloudLibrary();
    return;
  }
  state.folders = await getAll(STORES.folders);
  state.assets = await getAll(STORES.assets);
  state.folders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.assets.sort((a, b) => (b.savedAt || b.createdAt).localeCompare(a.savedAt || a.createdAt));
  populateFolderSelects();
  renderLibrary();
}

async function refreshCloudLibrary() {
  const [folders, assets] = await Promise.all([apiFetch("/folders"), apiFetch("/assets")]);
  state.folders = folders.folders || [];
  state.assets = assets.assets || [];
  populateFolderSelects();
  renderLibrary();
  renderAccountView();
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
            <img src="${escapeAttr(asset.url)}" alt="${escapeAttr(asset.name)}" />
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
  if (hasCloudSession()) {
    const payload = await apiFetch("/folders", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    const folder = payload.folder;
    if (!state.folders.some((entry) => entry.id === folder.id)) {
      state.folders.push(folder);
    }
    populateFolderSelects();
    renderLibrary();
    return folder;
  }

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
  if (hasCloudSession()) {
    await apiFetch(`/assets/${encodeURIComponent(asset.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: nextName.trim(), folderId: asset.folderId })
    });
    await refreshLibrary();
    showToast("图片名称已更新");
    return;
  }
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
  if (hasCloudSession()) {
    await apiFetch(`/assets/${encodeURIComponent(asset.id)}`, {
      method: "DELETE"
    });
    state.selectedAssetId = null;
    await refreshLibrary();
    showToast("素材已删除");
    return;
  }
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
  const labelPrefix = normalizedSize === size ? "原图尺寸" : "API兼容尺寸";
  const exists = Array.from(els.sizeInput.options).some((option) => option.value === normalizedSize);
  if (!exists) {
    const option = document.createElement("option");
    option.value = normalizedSize;
    option.textContent = `${labelPrefix} ${normalizedSize}`;
    option.dataset.detected = "true";
    els.sizeInput.prepend(option);
  }
  els.sizeInput.value = normalizedSize;
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
  localStorage.setItem("imageStudio.size", normalizedSize);
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
  if (!url) return "";
  if (String(url).startsWith("data:")) return "当前基图：界面预览中的最新本地图片。";
  return `当前基图图片地址：${url}`;
}

function withStrictProductReference(prompt) {
  const text = String(prompt || "").trim();
  if (text.includes("商品主体必须以用户上传的原图")) return text;
  return [STRICT_PRODUCT_REFERENCE_RULE, text].filter(Boolean).join("\n\n");
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
