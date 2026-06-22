"use strict";

const APP_BASE_PATH = detectAppBasePath();
const ADMIN_TOKEN_KEY = "imageStudio.authToken";
const ADMIN_ENTRY_TOKEN_PARAM = "adminToken";
const PROMPT_GROUPS = [
  { id: "single", label: "单图模板" },
  { id: "suite", label: "套图生成" },
  { id: "refinement", label: "二次编辑" },
  { id: "reference", label: "参考图规则" },
  { id: "probe", label: "入参探测" }
];
const FACTORY_GENERATION_STEPS = [
  { id: "prepare", label: "准备请求", detail: "选择文本理解模型和验证出图模型" },
  { id: "analysis", label: "分析参考图风格", detail: "读取参考图构图、文字层级和电商模块" },
  { id: "prompt", label: "生成提示词", detail: "输出中文和英文可复用 Prompt" },
  { id: "imageB", label: "生成 Prompt + 原图图片", detail: "只用商品原图和 Prompt 验证复用效果" }
];

const state = {
  token: localStorage.getItem(ADMIN_TOKEN_KEY) || "",
  users: [],
  logs: [],
  feedbacks: [],
  feedbackSources: [],
  feedbackImageSources: [],
  summary: null,
  modelProviders: [],
  defaultImageModelId: "",
  defaultVideoModelId: "",
  legacyModelConfig: {
    defaultEndpoint: "",
    defaultModel: "",
    usageNote: ""
  },
  activeAdminView: "model",
  promptConfig: null,
  promptAssets: [],
  suitePromptAssets: [],
  factoryModelOptions: [],
  factoryProductImage: null,
  factoryReferenceImages: [],
  suiteFactoryProductImage: null,
  suiteFactoryReferenceImages: [],
  factoryGenerationJobs: new Map(),
  suiteFactoryGenerationJobs: new Map(),
  activePromptAssetId: "",
  activeSuitePromptAssetId: "",
  factoryStatusFilter: "",
  suiteFactoryStatusFilter: "",
  activePromptGroup: "single",
  promptTreeSelection: {},
  selectedKeyUserId: "",
  selectedKeyMode: "image",
  selectedProviderIndex: -1,
  selectedProviderModelIndex: -1
};

const els = {};

function detectAppBasePath() {
  const marker = "/aidx-runtime";
  const pathname = window.location.pathname || "";
  return pathname === marker || pathname.startsWith(`${marker}/`) ? marker : "";
}

function appRoute(path) {
  return `${APP_BASE_PATH}${path}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  adoptTransferredAdminToken();
  if (!state.token) {
    redirectToAdminLogin("required");
    return;
  }

  bindEvents();
  renderShell();
  try {
    await adminFetch("/me");
    await loadDashboard();
  } catch (error) {
    if (state.token) showToast(error.message, true);
  }
  renderShell();
});

function cacheElements() {
  Object.assign(els, {
    adminDashboard: document.getElementById("adminDashboard"),
    adminAccessDenied: document.getElementById("adminAccessDenied"),
    adminLogoutBtn: document.getElementById("adminLogoutBtn"),
    adminNavItems: document.querySelectorAll(".admin-nav-item"),
    adminViews: document.querySelectorAll("[data-admin-view-panel]"),
    adminSummaryGrid: document.getElementById("adminSummaryGrid"),
    addModelProviderBtn: document.getElementById("addModelProviderBtn"),
    saveProviderConfigBtn: document.getElementById("saveProviderConfigBtn"),
    modelProviderList: document.getElementById("modelProviderList"),
    providerConfigModal: document.getElementById("providerConfigModal"),
    providerConfigModalTitle: document.getElementById("providerConfigModalTitle"),
    closeProviderConfigModalBtn: document.getElementById("closeProviderConfigModalBtn"),
    cancelProviderConfigBtn: document.getElementById("cancelProviderConfigBtn"),
    providerNameInput: document.getElementById("providerNameInput"),
    providerTypeInput: document.getElementById("providerTypeInput"),
    providerBaseUrlInput: document.getElementById("providerBaseUrlInput"),
    providerTokenInput: document.getElementById("providerTokenInput"),
    providerModelNameInput: document.getElementById("providerModelNameInput"),
    providerModelKindInput: document.getElementById("providerModelKindInput"),
    providerModelPriorityInput: document.getElementById("providerModelPriorityInput"),
    providerEnabledInput: document.getElementById("providerEnabledInput"),
    refreshUsersBtn: document.getElementById("refreshUsersBtn"),
    refreshLogsBtn: document.getElementById("refreshLogsBtn"),
    refreshFeedbackBtn: document.getElementById("refreshFeedbackBtn"),
    feedbackTypeFilter: document.getElementById("feedbackTypeFilter"),
    feedbackSourceFilter: document.getElementById("feedbackSourceFilter"),
    feedbackImageSourceFilter: document.getElementById("feedbackImageSourceFilter"),
    adminUserTable: document.getElementById("adminUserTable"),
    adminLogTable: document.getElementById("adminLogTable"),
    adminFeedbackTable: document.getElementById("adminFeedbackTable"),
    savePromptConfigBtn: document.getElementById("savePromptConfigBtn"),
    promptPanelTitle: document.getElementById("promptPanelTitle"),
    promptGroupList: document.getElementById("promptGroupList"),
    promptConfigEditor: document.getElementById("promptConfigEditor"),
    adminKeyModal: document.getElementById("adminKeyModal"),
    adminKeyModalTitle: document.getElementById("adminKeyModalTitle"),
    adminKeyUserText: document.getElementById("adminKeyUserText"),
    adminKeyHelpText: document.getElementById("adminKeyHelpText"),
    adminAllowedImageModelSection: document.getElementById("adminAllowedImageModelSection"),
    adminAllowedImageModelList: document.getElementById("adminAllowedImageModelList"),
    adminAllowedVideoModelSection: document.getElementById("adminAllowedVideoModelSection"),
    adminAllowedVideoModelList: document.getElementById("adminAllowedVideoModelList"),
    closeAdminKeyModalBtn: document.getElementById("closeAdminKeyModalBtn"),
    cancelUserKeyBtn: document.getElementById("cancelUserKeyBtn"),
    saveUserKeyBtn: document.getElementById("saveUserKeyBtn"),
    clearUserKeyBtn: document.getElementById("clearUserKeyBtn"),
    factoryImagePreviewModal: document.getElementById("factoryImagePreviewModal"),
    factoryImagePreviewTitle: document.getElementById("factoryImagePreviewTitle"),
    factoryImagePreviewImg: document.getElementById("factoryImagePreviewImg"),
    closeFactoryImagePreviewBtn: document.getElementById("closeFactoryImagePreviewBtn"),
    toast: document.getElementById("toast")
  });
}

function bindEvents() {
  els.adminNavItems.forEach((button) => {
    button.addEventListener("click", () => switchAdminView(button.dataset.adminView));
  });
  els.adminLogoutBtn.addEventListener("click", handleAdminLogout);
  els.addModelProviderBtn.addEventListener("click", addModelProvider);
  els.modelProviderList.addEventListener("click", handleModelProviderAction);
  els.closeProviderConfigModalBtn.addEventListener("click", closeProviderConfigModal);
  els.cancelProviderConfigBtn.addEventListener("click", closeProviderConfigModal);
  els.saveProviderConfigBtn.addEventListener("click", saveProviderFromModal);
  els.providerConfigModal.addEventListener("click", (event) => {
    if (event.target === els.providerConfigModal) closeProviderConfigModal();
  });
  els.providerTypeInput.addEventListener("change", refreshProviderModalDefaults);
  els.providerModelKindInput.addEventListener("change", refreshProviderModalDefaults);
  els.refreshUsersBtn.addEventListener("click", loadUsers);
  els.refreshLogsBtn.addEventListener("click", loadLogs);
  els.refreshFeedbackBtn.addEventListener("click", () => loadFeedbacks(true));
  els.feedbackTypeFilter.addEventListener("change", () => loadFeedbacks());
  els.feedbackSourceFilter.addEventListener("change", () => loadFeedbacks());
  els.feedbackImageSourceFilter.addEventListener("change", () => loadFeedbacks());
  els.savePromptConfigBtn.addEventListener("click", savePromptConfig);
  els.promptGroupList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-prompt-group]");
    if (button) switchPromptGroup(button.dataset.promptGroup);
  });
  els.promptConfigEditor.addEventListener("input", (event) => {
    const field = event.target.closest("[data-prompt-path]");
    if (field) setPromptConfigValue(field.dataset.promptPath, field.value);
  });
  els.promptConfigEditor.addEventListener("click", handlePromptConfigTreeClick);
  bindPromptFactoryEvents();
  els.closeAdminKeyModalBtn.addEventListener("click", closeUserKeyModal);
  els.cancelUserKeyBtn.addEventListener("click", closeUserKeyModal);
  els.saveUserKeyBtn.addEventListener("click", saveUserKey);
  els.clearUserKeyBtn.addEventListener("click", clearUserKey);
  els.closeFactoryImagePreviewBtn.addEventListener("click", closeFactoryImagePreview);
  els.factoryImagePreviewModal.addEventListener("click", (event) => {
    if (event.target === els.factoryImagePreviewModal) closeFactoryImagePreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.factoryImagePreviewModal?.classList.contains("active")) closeFactoryImagePreview();
  });
}

function renderShell() {
  if (els.adminAccessDenied && !els.adminAccessDenied.hidden) return;
  els.adminDashboard.hidden = !state.token;
  els.adminLogoutBtn.style.display = state.token ? "inline-flex" : "none";
  switchAdminView(state.activeAdminView);
}

function adoptTransferredAdminToken() {
  const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search || "");
  const transferredToken =
    hashParams.get(ADMIN_ENTRY_TOKEN_PARAM) ||
    searchParams.get(ADMIN_ENTRY_TOKEN_PARAM) ||
    hashParams.get("token") ||
    searchParams.get("token");
  if (!transferredToken) return;

  state.token = transferredToken;
  localStorage.setItem(ADMIN_TOKEN_KEY, transferredToken);

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete(ADMIN_ENTRY_TOKEN_PARAM);
  cleanUrl.searchParams.delete("token");
  cleanUrl.hash = "";
  window.history.replaceState(null, "", cleanUrl.toString());
}

function renderAccessDenied() {
  clearAdmin();
  document.querySelector(".admin-header")?.setAttribute("hidden", "");
  els.adminDashboard.hidden = true;
  els.adminLogoutBtn.style.display = "none";
  if (els.adminAccessDenied) {
    els.adminAccessDenied.hidden = false;
  }
}

function switchAdminView(viewName) {
  state.activeAdminView = viewName || "model";
  if (state.activeAdminView === "factory") state.activePromptGroup = "factory";
  if (state.activeAdminView === "suite-factory") state.activePromptGroup = "suiteFactory";
  if (state.activeAdminView === "prompts" && !PROMPT_GROUPS.some((group) => group.id === state.activePromptGroup)) {
    state.activePromptGroup = "single";
  }
  els.adminNavItems.forEach((button) => {
    const active = button.dataset.adminView === state.activeAdminView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  els.adminViews.forEach((view) => {
    const activePanel = ["factory", "suite-factory"].includes(state.activeAdminView) ? "prompts" : state.activeAdminView;
    view.classList.toggle("active", view.dataset.adminViewPanel === activePanel);
  });
  renderPromptWorkspaceMode();
  if (["factory", "suite-factory", "prompts"].includes(state.activeAdminView)) renderPromptConfigEditor();
}

async function adminFetch(path, options = {}) {
  const response = await fetch(appRoute(`/api/admin${path}`), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
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
    if (response.status === 403) {
      clearAdmin();
      redirectToAdminLogin("forbidden");
      throw new Error("你不是管理员");
    }
    if (response.status === 401) {
      clearAdmin();
      redirectToAdminLogin("expired");
      throw new Error("登录已过期，请重新登录");
    }
    const message = payload?.error || payload?.message || response.statusText || "请求失败";
    if (response.status === 404 && message === "接口不存在" && path.startsWith("/downvotes")) {
      throw new Error(portMismatchMessage());
    }
    throw new Error(message);
  }
  return payload || {};
}

function portMismatchMessage() {
  const currentPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  if (currentPort === "8787") {
    return "当前 B 端连接的是旧的 8787 服务；请打开 http://localhost:8788/admin-login.html，或先执行 kill 48038 后重新启动 8787。";
  }
  return "点踩反馈接口未在当前后端生效；请重启 server.py 后再试。";
}

function handleAdminLogout() {
  clearAdmin();
  redirectToAdminLogin("logout");
}

function clearAdmin() {
  state.token = "";
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

function handleAuthFailure() {
  clearAdmin();
  redirectToAdminLogin("expired");
}

function redirectToAdminLogin(reason) {
  const target = new URL("./admin-login.html", window.location.href);
  if (reason) target.searchParams.set("reason", reason);
  window.location.replace(target.toString());
}

async function loadDashboard() {
  await Promise.all([loadSummary(), loadUsers(), loadLogs(), loadFeedbacks(), loadPromptConfig()]);
  await loadPromptAssets();
  await loadSuitePromptAssets();
}

async function loadSummary() {
  const payload = await adminFetch("/summary");
  state.summary = payload.summary;
  renderSummary(payload.summary);
  renderModelConfig(payload.modelConfig);
}

async function loadUsers() {
  const payload = await adminFetch("/users");
  state.users = payload.users || [];
  renderUsers();
  showToast("用户信息已刷新");
}

async function loadLogs() {
  const payload = await adminFetch("/logs?limit=200");
  state.logs = payload.logs || [];
  renderLogs();
}

async function loadFeedbacks(showRefreshed = false) {
  const params = new URLSearchParams({ limit: "200" });
  if (els.feedbackTypeFilter.value) params.set("feedbackType", els.feedbackTypeFilter.value);
  if (els.feedbackSourceFilter.value) params.set("source", els.feedbackSourceFilter.value);
  if (els.feedbackImageSourceFilter.value) params.set("imageSource", els.feedbackImageSourceFilter.value);
  const payload = await adminFetch(`/downvotes?${params.toString()}`);
  state.feedbacks = payload.feedbacks || [];
  state.feedbackSources = payload.sources || [];
  state.feedbackImageSources = payload.imageSources || [];
  renderFeedbackFilters();
  renderFeedbacks();
  if (showRefreshed) showToast("图片反馈已刷新");
}

async function loadPromptConfig() {
  const payload = await adminFetch("/prompt-config");
  state.promptConfig = payload.promptConfig;
  renderPromptGroups();
  renderPromptConfigEditor();
}

async function loadPromptAssets() {
  const params = new URLSearchParams({ limit: "100" });
  params.set("assetKind", "single");
  if (state.factoryStatusFilter) params.set("status", state.factoryStatusFilter);
  const payload = await adminFetch(`/prompt-assets?${params.toString()}`);
  state.promptAssets = mergePromptAssetsWithLocalJobs(payload.assets || []);
  state.factoryModelOptions = payload.modelOptions || [];
  if (!state.activePromptAssetId && state.promptAssets[0]) state.activePromptAssetId = state.promptAssets[0].id;
  renderPromptConfigEditor();
}

async function loadSuitePromptAssets() {
  const params = new URLSearchParams({ limit: "100", assetKind: "suite" });
  if (state.suiteFactoryStatusFilter) params.set("status", state.suiteFactoryStatusFilter);
  const payload = await adminFetch(`/prompt-assets?${params.toString()}`);
  state.suitePromptAssets = mergePromptAssetsWithLocalJobs(payload.assets || [], "suite");
  state.factoryModelOptions = payload.modelOptions || state.factoryModelOptions || [];
  if (!state.activeSuitePromptAssetId && state.suitePromptAssets[0]) state.activeSuitePromptAssetId = state.suitePromptAssets[0].id;
  renderPromptConfigEditor();
}

function mergePromptAssetsWithLocalJobs(assets, scope = "single") {
  const jobs = scope === "suite" ? state.suiteFactoryGenerationJobs : state.factoryGenerationJobs;
  return assets.map((asset) => {
    const job = jobs.get(asset.id);
    if (job?.status === "running" && asset.status !== "generated" && asset.status !== "published" && asset.status !== "failed") {
      return { ...asset, status: "generating", error: "" };
    }
    if (job?.status === "success" && asset.status === "draft") return { ...asset, status: "generating" };
    return asset;
  });
}

async function createPromptAssets(scope = "single") {
  const suiteMode = scope === "suite";
  const referenceImages = suiteMode ? state.suiteFactoryReferenceImages : state.factoryReferenceImages;
  const productImage = suiteMode ? state.suiteFactoryProductImage : state.factoryProductImage;
  if (!referenceImages.length) {
    showToast(suiteMode ? "请先上传套图参考图" : "请先上传参考图", true);
    return;
  }
  const modelSelect = document.getElementById(suiteMode ? "suiteFactoryModelSelect" : "factoryModelSelect");
  const titleInput = document.getElementById("suiteFactoryTitleInput");
  const payload = await adminFetch("/prompt-assets", {
    method: "POST",
    body: JSON.stringify({
      assetKind: suiteMode ? "suite" : "single",
      productImage: productImage || {},
      referenceImages,
      providerModelId: modelSelect?.value || "",
      title: suiteMode ? titleInput?.value || "同款电商套图" : ""
    })
  });
  if (suiteMode) {
    state.suitePromptAssets = [...(payload.assets || []), ...state.suitePromptAssets];
    state.activeSuitePromptAssetId = payload.assets?.[0]?.id || state.activeSuitePromptAssetId;
  } else {
    state.promptAssets = [...(payload.assets || []), ...state.promptAssets];
    state.activePromptAssetId = payload.assets?.[0]?.id || state.activePromptAssetId;
  }
  renderPromptConfigEditor();
  showToast(suiteMode ? "已创建 1 套提示词素材" : `已创建 ${(payload.assets || []).length} 条提示词素材`);
  return payload.assets || [];
}

async function createSuitePromptAsset() {
  return createPromptAssets("suite");
}

async function savePromptAsset(assetId, scope = "single") {
  const suiteMode = scope === "suite";
  const detail = document.getElementById(suiteMode ? "suitePromptFactoryAssetDetail" : "promptFactoryAssetDetail");
  if (!detail) return;
  const body = {
    title: detail.querySelector("[data-factory-field='title']")?.value || "",
    referenceAnalysis: detail.querySelector("[data-factory-field='referenceAnalysis']")?.value || "",
    chinesePrompt: detail.querySelector("[data-factory-field='chinesePrompt']")?.value || "",
    englishPrompt: detail.querySelector("[data-factory-field='englishPrompt']")?.value || "",
    comparison: detail.querySelector("[data-factory-field='comparison']")?.value ?? promptFactoryActiveAssetFromDetail(detail)?.comparison ?? "",
    targetPlatformId: detail.querySelector("[data-factory-field='targetPlatformId']")?.value || "",
    targetCategoryId: detail.querySelector("[data-factory-field='targetCategoryId']")?.value || "",
    targetScenarioId: detail.querySelector("[data-factory-field='targetScenarioId']")?.value || "",
    publishMode: detail.querySelector("[data-factory-field='publishMode']")?.value || "append"
  };
  if (suiteMode) body.suiteShots = collectSuiteFactoryShots(detail);
  const payload = await adminFetch(`/prompt-assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  replacePromptAsset(payload.asset, scope);
  renderPromptConfigEditor();
  showToast(suiteMode ? "套图提示词素材已保存" : "提示词素材已保存");
}

async function generatePromptAsset(assetId, button = null, scope = "single") {
  const suiteMode = scope === "suite";
  const modelSelect = document.getElementById(suiteMode ? "suiteFactoryModelSelect" : "factoryModelSelect");
  startFactoryGenerationJob(assetId, { modelLabel: selectedFactoryModelLabel(modelSelect?.value || ""), scope });
  setBusy(button, "生成中", true);
  try {
    const payload = await adminFetch(`/prompt-assets/${encodeURIComponent(assetId)}/generate`, {
      method: "POST",
      body: JSON.stringify({ providerModelId: modelSelect?.value || "" })
    });
    finishFactoryGenerationJob(assetId, "success", suiteMode ? "生成完成，已拿到套图提示词和 Prompt + 原图图片。" : "生成完成，已拿到提示词和 Prompt + 原图图片。", scope);
    replacePromptAsset(payload.asset, scope);
    renderPromptConfigEditor();
    showToast(suiteMode ? "套图提示词与 Prompt + 原图图片已生成" : "提示词与 Prompt + 原图图片已生成");
  } catch (error) {
    finishFactoryGenerationJob(assetId, "failed", error.message || "生成失败", scope);
    if (suiteMode) await loadSuitePromptAssets();
    else await loadPromptAssets();
    showToast(error.message, true);
  } finally {
    setBusy(button, "重试当前素材", false);
  }
}

async function publishPromptAsset(assetId, button = null, scope = "single") {
  const suiteMode = scope === "suite";
  const detail = document.getElementById(suiteMode ? "suitePromptFactoryAssetDetail" : "promptFactoryAssetDetail");
  if (!detail) return;
  const mode = detail.querySelector("[data-factory-field='publishMode']")?.value || "append";
  if (mode === "overwrite" && !window.confirm(suiteMode ? "覆盖已有 C 端套图？这个操作会替换整套图位和提示词。" : "覆盖已有 C 端场景？这个操作会替换原场景标题和提示词。")) return;
  setBusy(button, "发布中", true);
  try {
    await savePromptAsset(assetId, scope);
    const body = {
      platformId: detail.querySelector("[data-factory-field='targetPlatformId']")?.value || "",
      categoryId: detail.querySelector("[data-factory-field='targetCategoryId']")?.value || "",
      scenarioId: detail.querySelector("[data-factory-field='targetScenarioId']")?.value || "",
      presetId: detail.querySelector("[data-factory-field='targetPresetId']")?.value || "",
      mode,
      title: detail.querySelector("[data-factory-field='title']")?.value || "",
      factoryScope: suiteMode ? "suite" : "single"
    };
    if (suiteMode) Object.assign(body, { factoryScope: "suite" });
    const payload = await adminFetch(`/prompt-assets/${encodeURIComponent(assetId)}/publish`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    replacePromptAsset(payload.asset, scope);
    if (payload.promptConfig) state.promptConfig = payload.promptConfig;
    renderPromptConfigEditor();
    showToast(suiteMode ? "已发布整套图到 C 端" : "已发布到 C 端模板");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, suiteMode ? "发布整套图到 C 端" : "发布到 C 端", false);
  }
}

async function publishSuitePromptAsset(assetId, button = null) {
  return publishPromptAsset(assetId, button, "suite");
}

async function deletePromptAsset(assetId, button = null, scope = "single") {
  const suiteMode = scope === "suite";
  const list = suiteMode ? state.suitePromptAssets : state.promptAssets;
  const asset = list.find((entry) => entry.id === assetId);
  if (!assetId || !window.confirm(`删除「${asset?.title || "这条提示词素材"}」？历史提示词、验证图和发布状态都会从 B 端列表移除。`)) return;
  setBusy(button, "删除中", true);
  try {
    await adminFetch(`/prompt-assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
    const jobs = suiteMode ? state.suiteFactoryGenerationJobs : state.factoryGenerationJobs;
    jobs.delete(assetId);
    if (suiteMode) {
      state.suitePromptAssets = state.suitePromptAssets.filter((entry) => entry.id !== assetId);
      state.activeSuitePromptAssetId = state.suitePromptAssets[0]?.id || "";
    } else {
      state.promptAssets = state.promptAssets.filter((entry) => entry.id !== assetId);
      state.activePromptAssetId = state.promptAssets[0]?.id || "";
    }
    renderPromptConfigEditor();
    showToast(suiteMode ? "套图提示词素材已删除" : "提示词素材已删除");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, "删除", false);
  }
}

function replacePromptAsset(asset, scope = "single") {
  if (!asset?.id) return;
  const list = scope === "suite" ? state.suitePromptAssets : state.promptAssets;
  const index = list.findIndex((entry) => entry.id === asset.id);
  if (index >= 0) list.splice(index, 1, asset);
  else list.unshift(asset);
}

function collectSuiteFactoryShots(detail) {
  const active = promptFactoryActiveAssetFromDetail(detail);
  return Array.from(detail.querySelectorAll("[data-suite-shot-index]")).map((row, index) => {
    const existing = Array.isArray(active?.suiteShots) ? active.suiteShots[index] || {} : {};
    return {
      id: row.querySelector("[data-suite-shot-field='id']")?.value || `shot-${index + 1}`,
      name: row.querySelector("[data-suite-shot-field='name']")?.value || `0${index + 1} 套图图位`,
      size: row.querySelector("[data-suite-shot-field='size']")?.value || "1024x1024",
      description: row.querySelector("[data-suite-shot-field='description']")?.value || "",
      chinesePrompt: row.querySelector("[data-suite-shot-field='chinesePrompt']")?.value || "",
      englishPrompt: row.querySelector("[data-suite-shot-field='englishPrompt']")?.value || "",
      promptOnlyImageUrl: existing.promptOnlyImageUrl || "",
      referenceImageUrl: existing.referenceImageUrl || "",
      imageError: existing.imageError || ""
    };
  });
}

function selectedFactoryModelLabel(providerModelId) {
  const option = state.factoryModelOptions.find((item) => item.providerModelId === providerModelId) || state.factoryModelOptions[0];
  if (!option) return "未选择模型";
  return `${option.providerName || "模型"} / ${option.modelName || ""}`.trim();
}

function factoryJobStore(scope = "single") {
  return scope === "suite" ? state.suiteFactoryGenerationJobs : state.factoryGenerationJobs;
}

function factoryAssetList(scope = "single") {
  return scope === "suite" ? state.suitePromptAssets : state.promptAssets;
}

function promptFactoryActiveAsset(scope = "single") {
  const suiteMode = scope === "suite";
  const activeId = suiteMode ? state.activeSuitePromptAssetId : state.activePromptAssetId;
  return factoryAssetList(scope).find((asset) => asset.id === activeId) || null;
}

function promptFactoryActiveAssetFromDetail(detail) {
  if (!detail) return null;
  return promptFactoryActiveAsset(detail.id === "suitePromptFactoryAssetDetail" ? "suite" : "single");
}

function factoryScopeForAsset(asset) {
  return asset?.assetKind === "suite" ? "suite" : "single";
}

function startFactoryGenerationJob(assetId, options = {}) {
  const scope = options.scope === "suite" ? "suite" : "single";
  const jobs = factoryJobStore(scope);
  const existing = jobs.get(assetId);
  if (existing?.timer) window.clearInterval(existing.timer);
  if (existing?.pollTimer) window.clearInterval(existing.pollTimer);
  const job = {
    assetId,
    scope,
    status: "running",
    startedAt: Date.now(),
    modelLabel: options.modelLabel || "文本理解模型",
    message: "请求已提交，正在等待远端模型响应。",
    timer: null,
    pollTimer: null,
  };
  job.timer = window.setInterval(() => {
    if (state.activeAdminView === (scope === "suite" ? "suite-factory" : "factory") || state.activePromptGroup === (scope === "suite" ? "suiteFactory" : "factory")) renderPromptConfigEditor();
  }, 1000);
  job.pollTimer = window.setInterval(() => {
    (scope === "suite" ? loadSuitePromptAssets() : loadPromptAssets()).catch(() => {});
  }, 3000);
  jobs.set(assetId, job);
  const asset = factoryAssetList(scope).find((entry) => entry.id === assetId);
  if (asset) {
    asset.status = "generating";
    asset.error = "";
  }
  renderPromptConfigEditor();
}

function finishFactoryGenerationJob(assetId, status, message, scope = "single") {
  const jobs = factoryJobStore(scope);
  const job = jobs.get(assetId);
  if (!job) return;
  if (job.timer) window.clearInterval(job.timer);
  if (job.pollTimer) window.clearInterval(job.pollTimer);
  job.status = status;
  job.message = message;
  job.finishedAt = Date.now();
  jobs.set(assetId, job);
  window.setTimeout(() => {
    const latest = jobs.get(assetId);
    if (latest?.finishedAt === job.finishedAt) {
      jobs.delete(assetId);
      renderPromptConfigEditor();
    }
  }, 2600);
}

function factoryGenerationJob(asset) {
  if (!asset?.id) return null;
  return factoryJobStore(factoryScopeForAsset(asset)).get(asset.id) || null;
}

function factoryProgressFromAsset(asset) {
  const progress = asset?.request?.progress;
  return progress && typeof progress === "object" ? progress : null;
}

function factoryCurrentStep(asset, job) {
  const remoteStep = factoryProgressFromAsset(asset)?.step;
  if (remoteStep) return remoteStep;
  if (!job?.startedAt) return asset?.status === "generated" || asset?.status === "published" ? "done" : "prepare";
  const seconds = Math.floor((Date.now() - job.startedAt) / 1000);
  const index = Math.min(FACTORY_GENERATION_STEPS.length - 1, Math.floor(seconds / 8));
  return FACTORY_GENERATION_STEPS[index].id;
}

function factoryElapsedText(job) {
  if (!job?.startedAt) return "--";
  const end = job.finishedAt || Date.now();
  const seconds = Math.max(0, Math.floor((end - job.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}分${String(rest).padStart(2, "0")}秒` : `${rest}秒`;
}

function isFactoryStageStale(asset, job, thresholdMs = 300000) {
  if (asset?.status !== "generating" && job?.status !== "running") return false;
  const progress = factoryProgressFromAsset(asset);
  const updatedAt = progress?.updatedAt ? new Date(progress.updatedAt).getTime() : job?.startedAt || 0;
  if (!updatedAt || Number.isNaN(updatedAt)) return false;
  return Date.now() - updatedAt > thresholdMs;
}

function renderSummary(summary = {}) {
  const cards = [
    ["注册用户", summary.users || 0],
    ["注册管理员", summary.admin_users || 0],
    ["禁用用户", summary.disabled_users || 0],
    ["模型调用", summary.calls || 0],
    ["生成图片", summary.images || 0],
    ["输入 Token", summary.input_tokens || 0],
    ["输出 Token", summary.output_tokens || 0],
    ["总 Token", summary.total_tokens || 0],
    ["点赞图片", summary.upvotes || 0],
    ["点踩图片", summary.downvotes || 0]
  ];
  els.adminSummaryGrid.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="metric admin-metric">
          <span>${formatNumber(value)}</span>
          <label>${escapeHtml(label)}</label>
        </article>
      `
    )
    .join("");
}

function renderModelConfig(config = {}) {
  state.legacyModelConfig = {
    defaultEndpoint: config.defaultEndpoint || "",
    defaultModel: config.defaultModel || "",
    usageNote: config.usageNote || ""
  };
  state.defaultImageModelId = config.defaultImageModelId || "";
  state.defaultVideoModelId = config.defaultVideoModelId || "";
  state.modelProviders = Array.isArray(config.modelProviders) ? config.modelProviders : [];
  renderModelProviders();
}

function addModelProvider() {
  openProviderConfigModal();
}

function nextProviderPriority() {
  const priorities = state.modelProviders.flatMap((provider) =>
    (provider.models || []).map((model) => Number(model.priority) || 0)
  );
  return (Math.max(0, ...priorities) || 0) + 10;
}

function renderModelProviders() {
  if (!state.modelProviders.length) {
    els.modelProviderList.innerHTML = `
      <div class="empty-state compact-empty">
        <strong>暂无模型供应商</strong>
      </div>
    `;
    return;
  }
  const entries = providerTableEntries();
  els.modelProviderList.innerHTML = entries.length
    ? renderProviderTable(entries)
    : `<div class="empty-state compact-empty">暂无可用模型</div>`;
}

function providerTableEntries() {
  return state.modelProviders.flatMap((provider, providerIndex) => {
    const models = Array.isArray(provider.models) ? provider.models : [];
    if (!models.length) {
      return [{ provider, providerIndex, model: null, modelIndex: -1 }];
    }
    return models.map((model, modelIndex) => ({ provider, providerIndex, model, modelIndex }));
  });
}

function renderProviderTable(entries) {
  return `
    <div class="admin-provider-table-wrap">
      <table class="admin-provider-table">
        <thead>
          <tr>
            <th>默认</th>
            <th>供应商</th>
            <th>URL</th>
            <th>Token</th>
            <th>模型</th>
            <th>类型</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((entry) => renderProviderTableRow(entry)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderProviderTableRow({ provider, providerIndex, model, modelIndex }) {
  const modelId = model?.id || "";
  const modelKind = normalizeModelKind(model?.modelKind);
  const isDefault = modelId && modelKind !== "text" && modelId === (modelKind === "video" ? state.defaultVideoModelId : state.defaultImageModelId);
  const isEnabled = provider.enabled !== false && model?.enabled !== false;
  const canSetDefault = Boolean(modelId && isEnabled && modelKind !== "text");
  const defaultLabel = modelKind === "text" ? "提示词模型" : modelKind === "video" ? "默认视频" : "默认图片";
  const defaultActiveLabel = modelKind === "video" ? "视频默认" : "图片默认";
  return `
    <tr class="${isDefault ? "default-provider-row" : ""}">
      <td>
        <span class="status-chip ${isDefault ? "ready" : "neutral"}">${isDefault ? "当前默认" : "未设定"}</span>
      </td>
      <td>
        <strong>${escapeHtml(provider.name || "未命名供应商")}</strong>
        <small>${escapeHtml(providerTypeText(provider.providerType))}</small>
      </td>
      <td><small>${escapeHtml(provider.baseUrl || "--")}</small></td>
      <td><span class="status-chip ${provider.apiKeyConfigured ? "ready" : "danger"}">${provider.apiKeyConfigured ? "已配置" : "未配置"}</span></td>
      <td>
        <strong>${escapeHtml(model?.modelName || "未命名模型")}</strong>
        <small>优先级 ${escapeHtml(model?.priority || 100)}</small>
      </td>
      <td><span class="status-chip neutral">${escapeHtml(modelKindText(modelKind))}</span></td>
      <td>
        <span class="status-chip ${isEnabled ? "ready" : "neutral"}">${isEnabled ? "启用" : "停用"}</span>
      </td>
      <td>
        <div class="admin-action-row">
          <button class="small-button ${isDefault ? "primary" : ""}" type="button" data-provider-action="set-default-model" data-provider-index="${providerIndex}" data-model-index="${modelIndex}" ${canSetDefault && !isDefault ? "" : "disabled"}>${isDefault ? defaultActiveLabel : defaultLabel}</button>
          <button class="small-button" type="button" data-provider-action="edit-provider" data-provider-index="${providerIndex}" data-model-index="${modelIndex}">修改</button>
          <button class="small-button danger" type="button" data-provider-action="remove-provider" data-provider-index="${providerIndex}" data-model-index="${modelIndex}">删除</button>
        </div>
      </td>
    </tr>
  `;
}

function normalizeModelKind(value) {
  if (value === "video") return "video";
  if (value === "text") return "text";
  return "image";
}

function modelKindText(value) {
  const kind = normalizeModelKind(value);
  if (kind === "video") return "视频模型";
  if (kind === "text") return "文本理解模型";
  return "图片模型";
}

function providerTypeText(value) {
  return {
    aokapi_gemini: "AOKAPI / Gemini",
    muskapis_image: "Muskapis Image",
    openai_image: "OpenAI Compatible"
  }[value] || "OpenAI Compatible";
}

function defaultProviderBaseUrl(providerType) {
  return {
    aokapi_gemini: "https://aokapi.com/v1beta/models/{model}:generateContent/",
    muskapis_image: "https://api.muskapis.com/v1",
    openai_image: "https://api.openai.com/v1"
  }[providerType] || "https://api.openai.com/v1";
}

function isPromptFactoryCompatibleModelConfig(providerType, baseUrl, modelName) {
  if (providerType !== "aokapi_gemini") return true;
  const endpoint = `${baseUrl || ""} ${modelName || ""}`.toLowerCase();
  return endpoint.includes("generatecontent") || endpoint.includes("gemini-2.5-flash-image") || endpoint.includes("gemini-3-pro-image");
}

function defaultModelNameForProvider(providerType, modelKind) {
  if (normalizeModelKind(modelKind) === "text") return "gpt-5.5";
  if (providerType === "muskapis_image") return "gpt-image-2";
  return "";
}

function snapshotModelProviderState() {
  return {
    defaultImageModelId: state.defaultImageModelId,
    defaultVideoModelId: state.defaultVideoModelId,
    modelProviders: JSON.parse(JSON.stringify(state.modelProviders))
  };
}

function restoreModelProviderState(snapshot) {
  state.defaultImageModelId = snapshot.defaultImageModelId;
  state.defaultVideoModelId = snapshot.defaultVideoModelId || "";
  state.modelProviders = snapshot.modelProviders;
  renderModelProviders();
}

function openProviderConfigModal(providerIndex = -1, modelIndex = -1) {
  const provider = state.modelProviders[providerIndex] || null;
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const resolvedModelIndex = modelIndex >= 0 ? modelIndex : 0;
  const model = models[resolvedModelIndex] || null;
  const providerType = provider?.providerType || "muskapis_image";

  state.selectedProviderIndex = provider ? providerIndex : -1;
  state.selectedProviderModelIndex = provider ? resolvedModelIndex : -1;
  els.providerConfigModalTitle.textContent = provider ? "修改供应商" : "增加供应商";
  els.providerNameInput.value = provider?.name || "";
  els.providerTypeInput.value = providerType;
  els.providerBaseUrlInput.value = provider?.baseUrl || defaultProviderBaseUrl(providerType);
  els.providerTokenInput.value = provider?.apiKeyMasked || provider?.apiKey || "";
  els.providerTokenInput.placeholder = provider?.apiKeyConfigured
    ? `已配置：${provider.apiKeyMasked || "******"}`
    : "粘贴供应商 Token";
  els.providerModelNameInput.value = model?.modelName || defaultModelNameForProvider(providerType, model?.modelKind || "image");
  els.providerModelKindInput.value = normalizeModelKind(model?.modelKind);
  els.providerModelPriorityInput.value = model?.priority || nextProviderPriority();
  els.providerEnabledInput.checked = provider?.enabled !== false;
  els.providerConfigModal.classList.add("active");
  els.providerConfigModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => els.providerBaseUrlInput.focus(), 0);
}

function closeProviderConfigModal() {
  state.selectedProviderIndex = -1;
  state.selectedProviderModelIndex = -1;
  els.providerNameInput.value = "";
  els.providerTypeInput.value = "muskapis_image";
  els.providerBaseUrlInput.value = "";
  els.providerTokenInput.value = "";
  els.providerModelNameInput.value = "";
  els.providerModelKindInput.value = "image";
  els.providerModelPriorityInput.value = "100";
  els.providerEnabledInput.checked = true;
  els.providerConfigModal.classList.remove("active");
  els.providerConfigModal.setAttribute("aria-hidden", "true");
}

function refreshProviderModalDefaults() {
  const providerType = els.providerTypeInput.value || "muskapis_image";
  const modelKind = normalizeModelKind(els.providerModelKindInput.value);
  if (!els.providerBaseUrlInput.value.trim()) els.providerBaseUrlInput.value = defaultProviderBaseUrl(providerType);
  if (!els.providerModelNameInput.value.trim() || ["gpt-image-2", "gpt-5.5"].includes(els.providerModelNameInput.value.trim())) {
    els.providerModelNameInput.value = defaultModelNameForProvider(providerType, modelKind);
  }
}

async function saveProviderFromModal() {
  const providerIndex = state.selectedProviderIndex;
  const modelIndex = state.selectedProviderModelIndex;
  const existingProvider = state.modelProviders[providerIndex] || null;
  const providerType = els.providerTypeInput.value || "muskapis_image";
  const baseUrl = els.providerBaseUrlInput.value.trim();
  const tokenValue = els.providerTokenInput.value.trim();
  const modelName = els.providerModelNameInput.value.trim();
  const modelKind = normalizeModelKind(els.providerModelKindInput.value);
  const priority = Number(els.providerModelPriorityInput.value) || nextProviderPriority();
  if (!baseUrl || !modelName) {
    showToast("URL 和模型名不能为空", true);
    return;
  }
  if (!isPromptFactoryCompatibleModelConfig(providerType, baseUrl, modelName)) {
    showToast("AOKAPI / Gemini 需要填写 Gemini generateContent URL 和 Gemini 图片模型名", true);
    return;
  }
  if (!tokenValue && (!existingProvider || !existingProvider.apiKeyConfigured)) {
    showToast("新增供应商需要填写 Token", true);
    return;
  }

  const previousState = snapshotModelProviderState();
  const nextProvider = existingProvider || {
    id: "",
    apiKeyConfigured: false,
    apiKeyMasked: "",
    models: []
  };
  nextProvider.name = els.providerNameInput.value.trim() || providerTypeText(providerType);
  nextProvider.providerType = providerType;
  nextProvider.baseUrl = baseUrl;
  nextProvider.enabled = els.providerEnabledInput.checked;
  const maskedToken = existingProvider?.apiKeyMasked || "";
  if (tokenValue && tokenValue !== maskedToken) {
    nextProvider.apiKey = tokenValue;
    nextProvider.apiKeyConfigured = true;
  } else {
    delete nextProvider.apiKey;
  }
  nextProvider.models = Array.isArray(nextProvider.models) ? nextProvider.models : [];
  const targetModelIndex = modelIndex >= 0 ? modelIndex : 0;
  const nextModel = nextProvider.models[targetModelIndex] || { id: "", enabled: true };
  nextModel.modelName = modelName;
  nextModel.modelKind = modelKind;
  nextModel.priority = priority;
  nextModel.enabled = true;
  nextProvider.models[targetModelIndex] = nextModel;
  if (!existingProvider) state.modelProviders.push(nextProvider);

  const saved = await persistModelConfig("供应商已保存", els.saveProviderConfigBtn);
  if (saved) {
    closeProviderConfigModal();
  } else {
    restoreModelProviderState(previousState);
  }
}

async function handleModelProviderAction(event) {
  const button = event.target.closest("[data-provider-action]");
  if (!button) return;
  const providerIndex = Number(button.dataset.providerIndex);
  const modelIndex = Number(button.dataset.modelIndex);
  const provider = state.modelProviders[providerIndex];
  if (!provider) return;
  if (button.dataset.providerAction === "edit-provider") {
    openProviderConfigModal(providerIndex, Number.isNaN(modelIndex) ? 0 : modelIndex);
    return;
  }
  if (button.dataset.providerAction === "set-default-model") {
    await setDefaultProviderModel(providerIndex, Number.isNaN(modelIndex) ? 0 : modelIndex, button);
    return;
  }
  if (button.dataset.providerAction === "remove-provider") {
    await removeProviderModel(providerIndex, Number.isNaN(modelIndex) ? 0 : modelIndex, button);
  }
}

async function setDefaultProviderModel(providerIndex, modelIndex, button) {
  const provider = state.modelProviders[providerIndex];
  const model = (provider?.models || [])[modelIndex];
  if (!model?.id) {
    showToast("请先保存供应商后再设为默认模型", true);
    return;
  }
  const previousState = snapshotModelProviderState();
  if (normalizeModelKind(model.modelKind) === "video") {
    state.defaultVideoModelId = model.id;
  } else {
    state.defaultImageModelId = model.id;
  }
  const saved = await persistModelConfig(`${modelKindText(model.modelKind)}默认模型已设置`, button);
  if (!saved) restoreModelProviderState(previousState);
}

async function removeProviderModel(providerIndex, modelIndex, button) {
  const provider = state.modelProviders[providerIndex];
  if (!provider) return;
  const models = Array.isArray(provider.models) ? provider.models : [];
  const model = models[modelIndex] || null;
  if (!window.confirm("删除这个模型供应商配置？")) return;
  const previousState = snapshotModelProviderState();
  if (model?.id && state.defaultImageModelId === model.id) state.defaultImageModelId = "";
  if (model?.id && state.defaultVideoModelId === model.id) state.defaultVideoModelId = "";
  if (models.length <= 1) {
    state.modelProviders.splice(providerIndex, 1);
  } else {
    models.splice(modelIndex, 1);
  }
  const saved = await persistModelConfig("供应商已删除", button);
  if (!saved) restoreModelProviderState(previousState);
}

function collectModelProviders() {
  return state.modelProviders.map((provider) => ({
    id: provider.id || "",
    name: String(provider.name || "").trim(),
    providerType: provider.providerType || "openai_image",
    baseUrl: String(provider.baseUrl || "").trim(),
    apiKey: String(provider.apiKey || "").trim(),
    enabled: provider.enabled !== false,
    models: (provider.models || []).map((model) => ({
      id: model.id || "",
      modelName: String(model.modelName || "").trim(),
      modelKind: normalizeModelKind(model.modelKind),
      priority: Number(model.priority) || 100,
      enabled: model.enabled !== false
    }))
  }));
}

async function persistModelConfig(successMessage = "模型配置已保存", busyButton = null) {
  setBusy(busyButton, "保存中", true);
  try {
    await adminFetch("/model-config", {
      method: "PUT",
      body: JSON.stringify({
        defaultEndpoint: state.legacyModelConfig.defaultEndpoint,
        defaultModel: state.legacyModelConfig.defaultModel,
        usageNote: state.legacyModelConfig.usageNote,
        defaultImageModelId: state.defaultImageModelId || "",
        defaultVideoModelId: state.defaultVideoModelId || "",
        modelProviders: collectModelProviders()
      })
    });
    await loadSummary();
    showToast(successMessage);
    return true;
  } catch (error) {
    showToast(error.message, true);
    return false;
  } finally {
    setBusy(busyButton, "", false);
  }
}

async function savePromptConfig() {
  if (!state.promptConfig) return;
  setBusy(els.savePromptConfigBtn, "保存中", true);
  try {
    const payload = await adminFetch("/prompt-config", {
      method: "PUT",
      body: JSON.stringify({ promptConfig: state.promptConfig })
    });
    state.promptConfig = payload.promptConfig || state.promptConfig;
    renderPromptConfigEditor();
    showToast("提示词配置已保存");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(els.savePromptConfigBtn, "保存提示词配置", false);
  }
}

function switchPromptGroup(groupId) {
  state.activePromptGroup = PROMPT_GROUPS.some((group) => group.id === groupId) ? groupId : "single";
  renderPromptGroups();
  renderPromptConfigEditor();
}

function renderPromptGroups() {
  els.promptGroupList.innerHTML = PROMPT_GROUPS.map(
    (group) => `
      <button class="admin-prompt-tab ${group.id === state.activePromptGroup ? "active" : ""}" type="button" data-prompt-group="${escapeAttr(group.id)}">
        ${escapeHtml(group.label)}
      </button>
    `
  ).join("");
}

function renderPromptWorkspaceMode() {
  if (!els.promptGroupList || !els.promptPanelTitle || !els.savePromptConfigBtn) return;
  const directFactoryMode = state.activeAdminView === "factory" || state.activeAdminView === "suite-factory";
  els.promptPanelTitle.textContent = state.activeAdminView === "suite-factory" ? "套图提示词工厂" : directFactoryMode ? "图片提示词工厂" : "提示词配置";
  els.promptGroupList.hidden = directFactoryMode;
  els.savePromptConfigBtn.hidden = directFactoryMode;
  els.promptConfigEditor?.classList.toggle("factory-direct-mode", directFactoryMode);
}

function renderPromptConfigEditor() {
  preservePromptFactoryEditorState(() => {
    renderPromptWorkspaceMode();
    if (!state.promptConfig) {
      els.promptConfigEditor.innerHTML = `<div class="empty-copy"><strong>正在加载提示词配置</strong><span>请稍候。</span></div>`;
      return;
    }
    const group = state.activePromptGroup;
    const renderers = {
      single: renderSinglePromptConfig,
      suite: renderSuitePromptConfig,
      refinement: renderRefinementPromptConfig,
      reference: renderReferencePromptConfig,
      probe: renderProbePromptConfig,
      factory: renderPromptFactoryConfig,
      suiteFactory: renderSuitePromptFactoryConfig
    };
    els.promptConfigEditor.innerHTML = (renderers[group] || renderers.single)(state.promptConfig);
  });
}

function preservePromptFactoryEditorState(renderFn) {
  const snapshot = capturePromptFactoryEditorState();
  renderFn();
  restorePromptFactoryEditorState(snapshot);
}

function capturePromptFactoryEditorState() {
  if (!els.promptConfigEditor) return null;
  const active = els.promptConfigEditor.contains(document.activeElement) ? document.activeElement : null;
  const fields = Array.from(els.promptConfigEditor.querySelectorAll("input, textarea, select"))
    .map((field) => ({ key: promptFactoryEditorFieldKey(field), scrollTop: field.scrollTop || 0 }))
    .filter((entry) => entry.key);
  return {
    editorScrollTop: els.promptConfigEditor.scrollTop || 0,
    activeKey: promptFactoryEditorFieldKey(active),
    activeScrollTop: active?.scrollTop || 0,
    selectionStart: typeof active?.selectionStart === "number" ? active.selectionStart : null,
    selectionEnd: typeof active?.selectionEnd === "number" ? active.selectionEnd : null,
    fields
  };
}

function restorePromptFactoryEditorState(snapshot) {
  if (!snapshot || !els.promptConfigEditor) return;
  const restore = () => {
    els.promptConfigEditor.scrollTop = snapshot.editorScrollTop || 0;
    snapshot.fields.forEach((entry) => {
      const field = findPromptFactoryEditorField(entry.key);
      if (field) field.scrollTop = entry.scrollTop || 0;
    });
    const active = findPromptFactoryEditorField(snapshot.activeKey);
    if (!active) return;
    active.focus({ preventScroll: true });
    if (typeof active.setSelectionRange === "function" && snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
      active.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
    active.scrollTop = snapshot.activeScrollTop || 0;
  };
  restore();
  window.requestAnimationFrame?.(restore);
}

function promptFactoryEditorFieldKey(field) {
  if (!field || !field.dataset) return "";
  if (field.dataset.promptPath) return `prompt:${field.dataset.promptPath}`;
  if (field.dataset.factoryField) {
    const detail = field.closest("#suitePromptFactoryAssetDetail, #promptFactoryAssetDetail");
    return `factory:${detail?.id || ""}:${field.dataset.factoryField}`;
  }
  if (field.dataset.suiteShotField) {
    const shot = field.closest("[data-suite-shot-index]");
    return `suite-shot:${shot?.dataset.suiteShotIndex || ""}:${field.dataset.suiteShotField}`;
  }
  return field.id ? `id:${field.id}` : "";
}

function findPromptFactoryEditorField(key) {
  if (!key || !els.promptConfigEditor) return null;
  return Array.from(els.promptConfigEditor.querySelectorAll("input, textarea, select"))
    .find((field) => promptFactoryEditorFieldKey(field) === key) || null;
}

function renderPromptConfigTreeManager(scope, config) {
  ensurePromptTreeSelection(scope, config);
  const selection = state.promptTreeSelection[scope] || "";
  return `
    <section class="prompt-tree-manager" data-prompt-tree-scope="${escapeAttr(scope)}">
      <aside class="prompt-tree-sidebar" aria-label="${scope === "suite" ? "套图生成" : "单图模板"}左侧树">
        <div class="prompt-tree-sidebar-head">
          <strong>左侧树</strong>
          <small>${scope === "suite" ? "套图类型 > 图位" : "平台 > 品类 > 场景/模板"}</small>
        </div>
        <button class="ghost-button prompt-tree-root-add" type="button" data-prompt-tree-action="add-root" data-prompt-tree-scope="${escapeAttr(scope)}">
          新增${scope === "suite" ? "套图类型" : "平台"}
        </button>
        <div class="prompt-tree-list">
          ${scope === "suite" ? renderSuitePromptTree(config, selection) : renderSinglePromptTree(config, selection)}
        </div>
      </aside>
      <div class="prompt-tree-detail">
        <div class="prompt-tree-sidebar-head">
          <strong>右侧详情</strong>
          <small>新增同级 / 新增子级 / 删除节点均会修改当前提示词配置，保存后生效。</small>
        </div>
        ${renderPromptTreeDetail(scope, config, selection)}
      </div>
    </section>
  `;
}

function renderSinglePromptTree(config, selection) {
  const platforms = config.single?.matrix?.platforms || [];
  if (!platforms.length) return `<div class="empty-state compact-empty">暂无平台，点击新增平台创建。</div>`;
  return platforms.map((platform, platformIndex) => `
    ${renderPromptTreeNode({ scope: "single", type: "platform", key: promptTreeSelectionKey("single", "platform", [platformIndex]), label: platform.label || platform.id || "未命名平台", meta: platform.id, selection, depth: 0 })}
    ${(platform.categories || []).map((category, categoryIndex) => `
      ${renderPromptTreeNode({ scope: "single", type: "category", key: promptTreeSelectionKey("single", "category", [platformIndex, categoryIndex]), label: category.label || category.id || "未命名品类", meta: category.id, selection, depth: 1 })}
      ${(category.scenarios || []).map((scenario, scenarioIndex) => renderPromptTreeNode({ scope: "single", type: "scenario", key: promptTreeSelectionKey("single", "scenario", [platformIndex, categoryIndex, scenarioIndex]), label: scenario.title || scenario.id || "未命名场景", meta: scenario.id, selection, depth: 2 })).join("")}
    `).join("")}
  `).join("");
}

function renderSuitePromptTree(config, selection) {
  const presets = config.suite?.presets || [];
  if (!presets.length) return `<div class="empty-state compact-empty">暂无套图类型，点击新增套图类型创建。</div>`;
  return presets.map((preset, presetIndex) => `
    ${renderPromptTreeNode({ scope: "suite", type: "preset", key: promptTreeSelectionKey("suite", "preset", [presetIndex]), label: preset.title || preset.id || "未命名套图", meta: preset.id, selection, depth: 0 })}
    ${(preset.shots || []).map((shot, shotIndex) => renderPromptTreeNode({ scope: "suite", type: "shot", key: promptTreeSelectionKey("suite", "shot", [presetIndex, shotIndex]), label: shot.name || shot.id || "未命名图位", meta: shot.size || shot.id, selection, depth: 1 })).join("")}
  `).join("");
}

function renderPromptTreeNode({ scope, type, key, label, meta, selection, depth }) {
  const canAddChild = ["platform", "category", "preset"].includes(type);
  return `
    <button class="prompt-tree-node ${selection === key ? "active" : ""}" type="button" data-prompt-tree-action="select" data-prompt-tree-scope="${escapeAttr(scope)}" data-prompt-tree-key="${escapeAttr(key)}" style="--tree-depth:${Number(depth) || 0}">
      <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(meta || type)}</small></span>
      <span class="prompt-tree-actions">
        <i data-prompt-tree-action="add-sibling" data-prompt-tree-scope="${escapeAttr(scope)}" data-prompt-tree-key="${escapeAttr(key)}" title="新增同级">+</i>
        ${canAddChild ? `<i data-prompt-tree-action="add-child" data-prompt-tree-scope="${escapeAttr(scope)}" data-prompt-tree-key="${escapeAttr(key)}" title="新增子级">＋</i>` : ""}
        <i data-prompt-tree-action="delete" data-prompt-tree-scope="${escapeAttr(scope)}" data-prompt-tree-key="${escapeAttr(key)}" title="删除节点">×</i>
      </span>
    </button>
  `;
}

function renderPromptTreeDetail(scope, config, key) {
  const target = promptTreeTarget(scope, config, key);
  if (!target) return `<div class="empty-state"><strong>选择节点</strong><span>从左侧树选择一个节点后，在这里快速增删改查。</span></div>`;
  const path = target.path;
  const item = target.item;
  if (scope === "single" && target.type === "platform") {
    return promptTreeDetailCard("平台", [
      promptField(`${path}.label`, "平台名称", item.label, { type: "input" }),
      promptField(`${path}.id`, "平台 ID", item.id, { type: "input" })
    ].join(""));
  }
  if (scope === "single" && target.type === "category") {
    return promptTreeDetailCard("品类", [
      promptField(`${path}.label`, "品类名称", item.label, { type: "input" }),
      promptField(`${path}.id`, "品类 ID", item.id, { type: "input" })
    ].join(""));
  }
  if (scope === "single" && target.type === "scenario") {
    return promptTreeDetailCard("场景/模板", [
      `<div class="admin-prompt-grid two">${promptField(`${path}.title`, "场景标题", item.title, { type: "input" })}${promptField(`${path}.id`, "场景 ID", item.id, { type: "input" })}</div>`,
      promptField(`${path}.templateId`, "模板 ID", item.templateId, { type: "input" }),
      promptField(`${path}.prompt`, "场景提示词", item.prompt, { rows: 8 })
    ].join(""));
  }
  if (scope === "suite" && target.type === "preset") {
    return promptTreeDetailCard("套图类型", [
      `<div class="admin-prompt-grid two">${promptField(`${path}.title`, "套图标题", item.title, { type: "input" })}${promptField(`${path}.id`, "套图 ID", item.id, { type: "input" })}</div>`
    ].join(""));
  }
  if (scope === "suite" && target.type === "shot") {
    return promptTreeDetailCard("图位", [
      `<div class="admin-prompt-grid two">${promptField(`${path}.name`, "图位名称", item.name, { type: "input" })}${promptField(`${path}.size`, "推荐尺寸", item.size, { type: "input" })}</div>`,
      promptField(`${path}.id`, "图位 ID", item.id, { type: "input" }),
      promptField(`${path}.description`, "图位说明", item.description, { type: "input" }),
      promptField(`${path}.prompt`, "图位提示词", item.prompt, { rows: 8 })
    ].join(""));
  }
  return "";
}

function promptTreeDetailCard(title, body) {
  return `<article class="admin-prompt-card"><div class="admin-prompt-card-head"><strong>${escapeHtml(title)}</strong><span>直接删除 / 快速编辑</span></div>${body}</article>`;
}

function promptTreeSelectionKey(scope, type, indexes) {
  return `${scope}:${type}:${indexes.join(".")}`;
}

function parsePromptTreeKey(key) {
  const [scope, type, rawIndexes = ""] = String(key || "").split(":");
  return { scope, type, indexes: rawIndexes ? rawIndexes.split(".").map((item) => Number(item)) : [] };
}

function ensurePromptTreeSelection(scope, config) {
  const current = state.promptTreeSelection[scope];
  if (promptTreeTarget(scope, config, current)) return;
  if (scope === "suite") {
    const presets = config.suite?.presets || [];
    state.promptTreeSelection[scope] = presets[0] ? promptTreeSelectionKey("suite", "preset", [0]) : "";
    return;
  }
  const platforms = config.single?.matrix?.platforms || [];
  state.promptTreeSelection[scope] = platforms[0] ? promptTreeSelectionKey("single", "platform", [0]) : "";
}

function promptTreeTarget(scope, config, key) {
  const parsed = parsePromptTreeKey(key);
  if (!key || parsed.scope !== scope) return null;
  if (scope === "single") {
    const platforms = config.single?.matrix?.platforms || [];
    const [platformIndex, categoryIndex, scenarioIndex] = parsed.indexes;
    const platform = platforms[platformIndex];
    if (parsed.type === "platform" && platform) return { type: parsed.type, item: platform, path: `single.matrix.platforms.${platformIndex}` };
    const category = platform?.categories?.[categoryIndex];
    if (parsed.type === "category" && category) return { type: parsed.type, item: category, path: `single.matrix.platforms.${platformIndex}.categories.${categoryIndex}` };
    const scenario = category?.scenarios?.[scenarioIndex];
    if (parsed.type === "scenario" && scenario) return { type: parsed.type, item: scenario, path: `single.matrix.platforms.${platformIndex}.categories.${categoryIndex}.scenarios.${scenarioIndex}` };
  }
  if (scope === "suite") {
    const presets = config.suite?.presets || [];
    const [presetIndex, shotIndex] = parsed.indexes;
    const preset = presets[presetIndex];
    if (parsed.type === "preset" && preset) return { type: parsed.type, item: preset, path: `suite.presets.${presetIndex}` };
    const shot = preset?.shots?.[shotIndex];
    if (parsed.type === "shot" && shot) return { type: parsed.type, item: shot, path: `suite.presets.${presetIndex}.shots.${shotIndex}` };
  }
  return null;
}

function handlePromptConfigTreeClick(event) {
  const actionTarget = event.target.closest("[data-prompt-tree-action]");
  if (!actionTarget || !els.promptConfigEditor.contains(actionTarget)) return;
  const action = actionTarget.dataset.promptTreeAction;
  const scope = actionTarget.dataset.promptTreeScope;
  const key = actionTarget.dataset.promptTreeKey;
  if (!scope || !["single", "suite"].includes(scope)) return;
  event.preventDefault();
  event.stopPropagation();
  if (action === "add-root") {
    addPromptTreeRootNode(scope);
    renderPromptConfigEditor();
    return;
  }
  if (!key) return;
  if (action === "select") {
    state.promptTreeSelection[scope] = key;
    renderPromptConfigEditor();
    return;
  }
  if (action === "add-child" || action === "add-sibling") {
    addPromptTreeNode(scope, key, action === "add-child" ? "child" : "sibling");
    renderPromptConfigEditor();
    return;
  }
  if (action === "delete") {
    deletePromptTreeNode(scope, key);
    renderPromptConfigEditor();
  }
}

function addPromptTreeNode(scope, key, mode = "child") {
  if (!state.promptConfig) return;
  const parsed = parsePromptTreeKey(key);
  const stamp = Date.now().toString(36).slice(-5);
  if (scope === "single") {
    const platforms = state.promptConfig.single.matrix.platforms;
    if (mode === "child" && parsed.type === "platform") {
      const platform = platforms[parsed.indexes[0]];
      platform.categories = platform.categories || [];
      platform.categories.push({ id: `category-${stamp}`, label: "新建品类", scenarios: [] });
      state.promptTreeSelection.single = promptTreeSelectionKey("single", "category", [parsed.indexes[0], platform.categories.length - 1]);
      return;
    }
    if (mode === "child" && parsed.type === "category") {
      const category = platforms[parsed.indexes[0]]?.categories?.[parsed.indexes[1]];
      category.scenarios = category.scenarios || [];
      category.scenarios.push(newSingleScenario(stamp));
      state.promptTreeSelection.single = promptTreeSelectionKey("single", "scenario", [parsed.indexes[0], parsed.indexes[1], category.scenarios.length - 1]);
      return;
    }
    if (mode === "sibling" && parsed.type === "platform") {
      platforms.splice(parsed.indexes[0] + 1, 0, { id: `platform-${stamp}`, label: "新建平台", categories: [] });
      state.promptTreeSelection.single = promptTreeSelectionKey("single", "platform", [parsed.indexes[0] + 1]);
      return;
    }
    if (mode === "sibling" && parsed.type === "category") {
      const categories = platforms[parsed.indexes[0]]?.categories || [];
      categories.splice(parsed.indexes[1] + 1, 0, { id: `category-${stamp}`, label: "新建品类", scenarios: [] });
      state.promptTreeSelection.single = promptTreeSelectionKey("single", "category", [parsed.indexes[0], parsed.indexes[1] + 1]);
      return;
    }
    if (mode === "sibling" && parsed.type === "scenario") {
      const scenarios = platforms[parsed.indexes[0]]?.categories?.[parsed.indexes[1]]?.scenarios || [];
      scenarios.splice(parsed.indexes[2] + 1, 0, newSingleScenario(stamp));
      state.promptTreeSelection.single = promptTreeSelectionKey("single", "scenario", [parsed.indexes[0], parsed.indexes[1], parsed.indexes[2] + 1]);
    }
  }
  if (scope === "suite") {
    const presets = state.promptConfig.suite.presets;
    if (mode === "child" && parsed.type === "preset") {
      const preset = presets[parsed.indexes[0]];
      preset.shots = preset.shots || [];
      preset.shots.push(newSuiteShot(stamp));
      state.promptTreeSelection.suite = promptTreeSelectionKey("suite", "shot", [parsed.indexes[0], preset.shots.length - 1]);
      return;
    }
    if (mode === "sibling" && parsed.type === "preset") {
      presets.splice(parsed.indexes[0] + 1, 0, { id: `suite-${stamp}`, title: "新建套图", shots: [] });
      state.promptTreeSelection.suite = promptTreeSelectionKey("suite", "preset", [parsed.indexes[0] + 1]);
      return;
    }
    if (mode === "sibling" && parsed.type === "shot") {
      const shots = presets[parsed.indexes[0]]?.shots || [];
      shots.splice(parsed.indexes[1] + 1, 0, newSuiteShot(stamp));
      state.promptTreeSelection.suite = promptTreeSelectionKey("suite", "shot", [parsed.indexes[0], parsed.indexes[1] + 1]);
    }
  }
}

function addPromptTreeRootNode(scope) {
  if (!state.promptConfig) return;
  const stamp = Date.now().toString(36).slice(-5);
  if (scope === "single") {
    const platforms = state.promptConfig.single.matrix.platforms;
    platforms.push({ id: `platform-${stamp}`, label: "新建平台", categories: [] });
    state.promptTreeSelection.single = promptTreeSelectionKey("single", "platform", [platforms.length - 1]);
    return;
  }
  if (scope === "suite") {
    const presets = state.promptConfig.suite.presets;
    presets.push({ id: `suite-${stamp}`, title: "新建套图", shots: [] });
    state.promptTreeSelection.suite = promptTreeSelectionKey("suite", "preset", [presets.length - 1]);
  }
}

function deletePromptTreeNode(scope, key) {
  if (!state.promptConfig || !window.confirm("直接删除这个节点？保存后 C 端将不再显示，历史生成记录不会删除。")) return;
  const parsed = parsePromptTreeKey(key);
  if (scope === "single") {
    const platforms = state.promptConfig.single.matrix.platforms;
    if (parsed.type === "platform") platforms.splice(parsed.indexes[0], 1);
    if (parsed.type === "category") platforms[parsed.indexes[0]]?.categories?.splice(parsed.indexes[1], 1);
    if (parsed.type === "scenario") platforms[parsed.indexes[0]]?.categories?.[parsed.indexes[1]]?.scenarios?.splice(parsed.indexes[2], 1);
    state.promptTreeSelection.single = "";
  }
  if (scope === "suite") {
    const presets = state.promptConfig.suite.presets;
    if (parsed.type === "preset") presets.splice(parsed.indexes[0], 1);
    if (parsed.type === "shot") presets[parsed.indexes[0]]?.shots?.splice(parsed.indexes[1], 1);
    state.promptTreeSelection.suite = "";
  }
}

function newSingleScenario(stamp) {
  const id = `scenario-${stamp}`;
  return { id, title: "新建场景", templateId: `template-${stamp}`, prompt: "" };
}

function newSuiteShot(stamp) {
  return { id: `shot-${stamp}`, name: "新建图位", size: "1024x1024", description: "", prompt: "" };
}

function renderSinglePromptConfig(config) {
  return [
    renderPromptConfigTreeManager("single", config),
    promptSection(
      "补图变体提示词",
      promptField("single.supplementalVariantPrompt", "补图变体文案", config.single.supplementalVariantPrompt)
    )
  ].join("");
}

function renderSuitePromptConfig(config) {
  return [
    renderPromptConfigTreeManager("suite", config),
    promptSection(
      "视觉风格与套图拼接文案",
      [
        config.suite.visualStyles
          .map(
            (style, index) => `
              <article class="admin-prompt-subcard">
                <div class="admin-prompt-card-head">
                  <strong>${escapeHtml(style.id)}</strong>
                  <span>视觉风格</span>
                </div>
                <div class="admin-prompt-grid two">
                  ${promptField(`suite.visualStyles.${index}.label`, "内部提示词", style.label, { type: "input" })}
                  ${promptField(`suite.visualStyles.${index}.displayLabel`, "前台显示", style.displayLabel || style.label, { type: "input" })}
                </div>
              </article>
            `
          )
          .join(""),
        `<div class="admin-prompt-grid two">
          ${promptField("suite.contextFallbacks.productLabel", "默认商品称呼", config.suite.contextFallbacks.productLabel, { type: "input" })}
          ${promptField("suite.contextFallbacks.category", "默认品类", config.suite.contextFallbacks.category, { type: "input" })}
          ${promptField("suite.contextFallbacks.sellingPoints", "默认卖点", config.suite.contextFallbacks.sellingPoints)}
          ${promptField("suite.contextFallbacks.styleText", "默认风格", config.suite.contextFallbacks.styleText, { type: "input" })}
        </div>`,
        ...Object.entries(config.suite.compose).map(([key, value]) =>
          promptField(`suite.compose.${key}`, `套图拼接：${key}`, value)
        )
      ].join("")
    )
  ].join("");
}

function renderRefinementPromptConfig(config) {
  return [
    promptSection(
      "快捷编辑按钮",
      config.refinement.quickEdits
        .map((edit, index) => promptField(`refinement.quickEdits.${index}.text`, edit.id, edit.text))
        .join("")
    ),
    promptSection(
      "二次编辑组合提示词",
      Object.entries(config.refinement.compose)
        .map(([key, value]) => promptField(`refinement.compose.${key}`, key, value))
        .join("")
    ),
    promptSection(
      "当前基图引用文案",
      Object.entries(config.refinement.imageReferenceText)
        .map(([key, value]) => promptField(`refinement.imageReferenceText.${key}`, key, value))
        .join("")
    )
  ].join("");
}

function renderReferencePromptConfig(config) {
  return [
    promptSection("全局商品一致性强约束", promptField("reference.strictRule", "强约束提示词", config.reference.strictRule, { rows: 7 })),
    promptSection(
      "参考图上下文包装",
      [
        promptField("reference.context.primaryLine", "首要参考图行", config.reference.context.primaryLine),
        promptField("reference.context.sizeText", "尺寸片段", config.reference.context.sizeText, { type: "input" }),
        promptField("reference.context.extraLine", "多参考图说明", config.reference.context.extraLine),
        promptField("reference.context.consistencyLine", "一致性说明", config.reference.context.consistencyLine),
        promptField("reference.context.defaultName", "首图默认名", config.reference.context.defaultName, { type: "input" }),
        promptField("reference.defaultName", "通用默认参考图名", config.reference.defaultName, { type: "input" }),
        promptField("reference.defaultAssetPromptLabels.suiteReference", "套图基图标签", config.reference.defaultAssetPromptLabels.suiteReference, { type: "input" }),
        promptField("reference.defaultAssetPromptLabels.uploaded", "单图上传标签", config.reference.defaultAssetPromptLabels.uploaded, { type: "input" })
      ].join("")
    ),
    promptSection(
      "重复包装识别词",
      config.reference.strictRuleDedupeNeedles
        .map((needle, index) => promptField(`reference.strictRuleDedupeNeedles.${index}`, `识别词 ${index + 1}`, needle, { type: "input" }))
        .join("")
    )
  ].join("");
}

function renderProbePromptConfig(config) {
  return [
    promptSection(
      "参考图入参探测",
      [
        promptField("referenceProbe.size", "探测生成尺寸", config.referenceProbe.size, { type: "input" }),
        promptField("referenceProbe.withReferencePrompt", "带参考图测试提示词", config.referenceProbe.withReferencePrompt),
        promptField("referenceProbe.controlPrompt", "无图对照提示词", config.referenceProbe.controlPrompt)
      ].join("")
    )
  ].join("");
}

function renderPromptFactoryConfig(config) {
  const activeAsset = state.promptAssets.find((asset) => asset.id === state.activePromptAssetId) || state.promptAssets[0] || null;
  const counts = promptAssetCounts();
  return `
    <section class="prompt-factory-shell">
      <div class="prompt-factory-create">
        <h4>生成提示词素材</h4>
        <label class="field admin-prompt-field">
          <span>商品原图（可选）</span>
          <input id="factoryProductImageInput" type="file" accept="image/*" />
        </label>
        <div class="prompt-factory-upload-preview">${renderFactoryImagePreview(state.factoryProductImage, "未上传商品原图")}</div>
        <label class="field admin-prompt-field">
          <span>参考图（可多选）</span>
          <input id="factoryReferenceImagesInput" type="file" accept="image/*" multiple />
        </label>
        <div class="prompt-factory-reference-list">${renderFactoryReferenceImages()}</div>
        <label class="field admin-prompt-field">
          <span>生成模型</span>
          <select id="factoryModelSelect">
            ${state.factoryModelOptions.length ? state.factoryModelOptions.map((option) => `<option value="${escapeAttr(option.providerModelId)}">${escapeHtml(option.providerName)} / ${escapeHtml(option.modelName)} / ${escapeHtml(modelKindText(option.modelKind))}</option>`).join("") : `<option value="">请配置 Muskapis gpt-5.5 文本理解模型</option>`}
          </select>
        </label>
        <button class="primary-button" id="generateFactoryAssetsBtn" type="button" ${state.factoryModelOptions.length ? "" : "disabled"}>生成提示词与验证图</button>
      </div>
      <div class="prompt-factory-library">
        <div class="prompt-factory-toolbar">
          ${renderFactoryStatusButton("", "全部", counts.all)}
          ${renderFactoryStatusButton("draft", "草稿", counts.draft)}
          ${renderFactoryStatusButton("generated", "待发布", counts.generated)}
          ${renderFactoryStatusButton("failed", "失败", counts.failed)}
          ${renderFactoryStatusButton("published", "已发布", counts.published)}
        </div>
        <div class="prompt-factory-workspace">
          <div class="prompt-factory-asset-list" id="promptFactoryAssetList">${renderPromptFactoryAssetList()}</div>
          <div class="prompt-factory-asset-detail" id="promptFactoryAssetDetail">${activeAsset ? renderPromptFactoryAssetDetail(activeAsset, config) : renderPromptFactoryEmptyDetail()}</div>
        </div>
      </div>
    </section>
  `;
}

function renderSuitePromptFactoryConfig(config) {
  const activeAsset = state.suitePromptAssets.find((asset) => asset.id === state.activeSuitePromptAssetId) || state.suitePromptAssets[0] || null;
  const counts = promptAssetCounts("suite");
  return `
    <section class="suite-prompt-factory-shell prompt-factory-shell">
      <div class="prompt-factory-create">
        <h4>生成套图提示词</h4>
        <label class="field admin-prompt-field">
          <span>套图名称</span>
          <input id="suiteFactoryTitleInput" type="text" value="同款电商套图" placeholder="例如：A+ 同款套图" />
        </label>
        <label class="field admin-prompt-field">
          <span>商品原图（可选）</span>
          <input id="suiteFactoryProductImageInput" type="file" accept="image/*" />
        </label>
        <div class="prompt-factory-upload-preview">${renderFactoryImagePreview(state.suiteFactoryProductImage, "未上传商品原图")}</div>
        <label class="field admin-prompt-field">
          <span>套图参考图（多选）</span>
          <input id="suiteFactoryReferenceImagesInput" type="file" accept="image/*" multiple />
        </label>
        <p class="prompt-factory-field-note">上传几张参考图，就生成几个套图图位。图位名称会根据对应参考图理解生成。</p>
        <div class="suite-factory-reference-strip prompt-factory-reference-list">${renderSuiteFactoryReferenceImages()}</div>
        <label class="field admin-prompt-field">
          <span>生成模型</span>
          <select id="suiteFactoryModelSelect">
            ${state.factoryModelOptions.length ? state.factoryModelOptions.map((option) => `<option value="${escapeAttr(option.providerModelId)}">${escapeHtml(option.providerName)} / ${escapeHtml(option.modelName)} / ${escapeHtml(modelKindText(option.modelKind))}</option>`).join("") : `<option value="">请配置 Muskapis gpt-5.5 文本理解模型</option>`}
          </select>
        </label>
        <button class="primary-button" id="generateSuiteFactoryAssetBtn" type="button" ${state.factoryModelOptions.length ? "" : "disabled"}>生成套图提示词与 Prompt + 原图</button>
      </div>
      <div class="prompt-factory-library">
        <div class="prompt-factory-toolbar">
          ${renderFactoryStatusButton("", "全部", counts.all, "suite")}
          ${renderFactoryStatusButton("draft", "草稿", counts.draft, "suite")}
          ${renderFactoryStatusButton("generated", "待发布", counts.generated, "suite")}
          ${renderFactoryStatusButton("failed", "失败", counts.failed, "suite")}
          ${renderFactoryStatusButton("published", "已发布", counts.published, "suite")}
        </div>
        <div class="prompt-factory-workspace">
          <div class="prompt-factory-asset-list" id="suitePromptFactoryAssetList">${renderPromptFactoryAssetList("suite")}</div>
          <div class="prompt-factory-asset-detail" id="suitePromptFactoryAssetDetail">${activeAsset ? renderSuitePromptFactoryAssetDetail(activeAsset, config) : renderSuitePromptFactoryEmptyDetail()}</div>
        </div>
      </div>
    </section>
  `;
}

function promptAssetCounts(scope = "single") {
  return factoryAssetList(scope).reduce(
    (counts, asset) => {
      counts.all += 1;
      counts[asset.status] = (counts[asset.status] || 0) + 1;
      return counts;
    },
    { all: 0, draft: 0, generated: 0, failed: 0, published: 0 }
  );
}

function renderFactoryStatusButton(status, label, count, scope = "single") {
  const active = ((scope === "suite" ? state.suiteFactoryStatusFilter : state.factoryStatusFilter) || "") === status;
  return `<button class="small-button ${active ? "primary" : ""}" type="button" data-factory-status="${escapeAttr(status)}" data-factory-scope="${escapeAttr(scope)}">${escapeHtml(label)} ${Number(count || 0)}</button>`;
}

function renderFactoryImagePreview(image, emptyText) {
  if (!image?.url) return `<div class="empty-state compact-empty">${escapeHtml(emptyText)}</div>`;
  return `<figure class="prompt-factory-thumb"><img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.name || "图片")}" /><figcaption>${escapeHtml(image.name || "图片")}</figcaption></figure>`;
}

function renderFactoryReferenceImages() {
  if (!state.factoryReferenceImages.length) return `<div class="empty-state compact-empty">未上传参考图</div>`;
  return state.factoryReferenceImages.map((image) => renderFactoryImagePreview(image, "")).join("");
}

function renderSuiteFactoryReferenceImages() {
  if (!state.suiteFactoryReferenceImages.length) return `<div class="empty-state compact-empty">未上传套图参考图</div>`;
  return state.suiteFactoryReferenceImages.map((image) => renderFactoryImagePreview(image, "")).join("");
}

function factoryAssetSummaryText(asset) {
  const value = String(asset?.comparison || "").trim();
  if (asset?.status === "failed") return asset.error || "生成失败";
  if (value) return value.length > 28 ? `${value.slice(0, 28)}...` : value;
  if (asset?.assetKind === "suite") {
    const shots = Array.isArray(asset.suiteShots) ? asset.suiteShots : [];
    const generated = shots.filter((shot) => shot.promptOnlyImageUrl).length;
    if (asset?.status === "generated" || asset?.status === "published") return generated ? `已生成 ${generated} 张 Prompt + 原图` : "等待图位验证图生成";
  }
  if (asset?.status === "generated" || asset?.status === "published") return asset.imageBUrl ? "Prompt + 原图已生成" : "等待验证图生成";
  return "等待生成";
}

function renderPromptFactoryAssetList(scope = "single") {
  const list = factoryAssetList(scope);
  const activeId = scope === "suite" ? state.activeSuitePromptAssetId : state.activePromptAssetId;
  if (!list.length) return `<div class="empty-state compact-empty">暂无提示词素材</div>`;
  return list
    .map((asset) => {
      const job = factoryGenerationJob(asset);
      const generating = asset.status === "generating" || job?.status === "running";
      const progress = factoryProgressFromAsset(asset);
      const step = FACTORY_GENERATION_STEPS.find((item) => item.id === factoryCurrentStep(asset, job)) || FACTORY_GENERATION_STEPS[0];
      const summary = generating
        ? `${progress?.label || step.label} · 已等待 ${factoryElapsedText(job)}`
        : factoryAssetSummaryText(asset);
      return `
        <button class="prompt-factory-asset-row ${asset.id === activeId ? "active" : ""} ${generating ? "generating" : ""}" type="button" data-factory-asset-id="${escapeAttr(asset.id)}" data-factory-scope="${escapeAttr(scope)}">
          <strong>${escapeHtml(asset.title || "未命名素材")}</strong>
          <span class="status-chip ${promptAssetStatusClass(asset.status)}">${escapeHtml(promptAssetStatusLabel(asset.status))}</span>
          ${generating ? `<span class="prompt-factory-mini-progress"><span style="width:${escapeAttr(String(factoryStepPercent(step.id)))}%"></span></span>` : ""}
          <small class="prompt-factory-score">${escapeHtml(summary)}</small>
        </button>
      `;
    })
    .join("");
}

function factoryStepPercent(stepId) {
  const index = FACTORY_GENERATION_STEPS.findIndex((step) => step.id === stepId);
  if (stepId === "done") return 100;
  return Math.max(8, Math.round(((index < 0 ? 0 : index) + 1) / FACTORY_GENERATION_STEPS.length * 100));
}

function renderPromptFactoryEmptyDetail() {
  return `<div class="empty-state"><strong>选择或创建提示词素材</strong><span>上传参考图后会在这里审核提示词、验证图和发布目标。</span></div>`;
}

function renderSuitePromptFactoryEmptyDetail() {
  return `<div class="empty-state"><strong>选择或创建套图提示词素材</strong><span>上传多张参考图后会在这里审核整套提示词、图位和发布状态。</span></div>`;
}

function renderPromptFactoryAssetDetail(asset, config) {
  const platforms = config.single?.matrix?.platforms || [];
  const selectedPlatform = platforms.find((platform) => platform.id === asset.targetPlatformId) || platforms[0] || { categories: [] };
  const selectedCategory = (selectedPlatform.categories || []).find((category) => category.id === asset.targetCategoryId) || selectedPlatform.categories?.[0] || { scenarios: [] };
  const publishMode = asset.publishMode || "append";
  const progressPanel = renderFactoryGenerationProgress(asset);
  return `
    <div class="prompt-factory-detail-head">
      <label class="field admin-prompt-field">
        <span>素材标题</span>
        <input type="text" data-factory-field="title" value="${escapeAttr(asset.title || "")}" />
      </label>
      <span class="status-chip ${promptAssetStatusClass(asset.status)}">${escapeHtml(promptAssetStatusLabel(asset.status))}</span>
    </div>
    ${progressPanel}
    <section class="prompt-factory-section">
      <h4>参考分析</h4>
      <p class="prompt-factory-field-note">用于记录模型对参考图的版式、构图、文字层级和电商风格的中文分析，帮助把参考图转换成可复用 Prompt，不会作为 C 端最终提示词直接发布。</p>
      <textarea rows="4" data-factory-field="referenceAnalysis">${escapeHtml(asset.referenceAnalysis || "")}</textarea>
    </section>
    <section class="prompt-factory-section">
      <h4>中文 Prompt</h4>
      <textarea rows="7" data-factory-field="chinesePrompt">${escapeHtml(asset.chinesePrompt || "")}</textarea>
    </section>
    <section class="prompt-factory-section">
      <h4>English Prompt</h4>
      <textarea rows="7" data-factory-field="englishPrompt">${escapeHtml(asset.englishPrompt || "")}</textarea>
    </section>
    <div class="prompt-factory-preview-grid">
      ${renderFactoryValidationImage("Prompt + 原图", asset.imageBUrl, asset, "imageB")}
    </div>
    <section class="prompt-factory-publish-row">
      <label class="field compact-field"><span>平台</span><select data-factory-field="targetPlatformId">${platforms.map((platform) => `<option value="${escapeAttr(platform.id)}" ${platform.id === selectedPlatform.id ? "selected" : ""}>${escapeHtml(platform.label || platform.id)}</option>`).join("")}</select></label>
      <label class="field compact-field"><span>品类</span><select data-factory-field="targetCategoryId">${(selectedPlatform.categories || []).map((category) => `<option value="${escapeAttr(category.id)}" ${category.id === selectedCategory.id ? "selected" : ""}>${escapeHtml(category.label || category.id)}</option>`).join("")}</select></label>
      <label class="field compact-field"><span>方式</span><select data-factory-field="publishMode"><option value="append" ${publishMode === "append" ? "selected" : ""}>追加新场景</option><option value="overwrite" ${publishMode === "overwrite" ? "selected" : ""}>覆盖已有场景</option></select></label>
      <label class="field compact-field"><span>${publishMode === "overwrite" ? "覆盖场景" : "新场景名"}</span>${publishMode === "overwrite" ? `<select data-factory-field="targetScenarioId">${(selectedCategory.scenarios || []).map((scenario) => `<option value="${escapeAttr(scenario.id)}" ${scenario.id === asset.targetScenarioId ? "selected" : ""}>${escapeHtml(scenario.title || scenario.id)}</option>`).join("")}</select>` : `<input type="text" data-factory-field="targetScenarioId" value="${escapeAttr(asset.targetScenarioId || "")}" aria-label="留空则按标题生成" />`}</label>
    </section>
    <div class="admin-action-row prompt-factory-actions">
      <button class="small-button" type="button" data-factory-action="save" data-asset-id="${escapeAttr(asset.id)}">保存草稿</button>
      <button class="small-button" type="button" data-factory-action="retry" data-asset-id="${escapeAttr(asset.id)}">重试当前素材</button>
      <button class="small-button danger prompt-factory-delete-button" type="button" data-factory-action="delete" data-asset-id="${escapeAttr(asset.id)}">删除</button>
      <button class="primary-button" type="button" data-factory-action="publish" data-asset-id="${escapeAttr(asset.id)}">发布到 C 端</button>
    </div>
  `;
}

function renderSuitePromptFactoryAssetDetail(asset, config) {
  const suitePresets = config.suite?.presets || [];
  const publishMode = asset.publishMode || "append";
  const selectedPresetId = asset.publishedTemplateId || suitePresets[0]?.id || "";
  return `
    <div class="prompt-factory-detail-head">
      <label class="field admin-prompt-field">
        <span>套图标题</span>
        <input type="text" data-factory-field="title" value="${escapeAttr(asset.title || "")}" />
      </label>
      <span class="status-chip ${promptAssetStatusClass(asset.status)}">${escapeHtml(promptAssetStatusLabel(asset.status))}</span>
    </div>
    ${renderFactoryGenerationProgress(asset)}
    <section class="prompt-factory-section">
      <h4>参考分析</h4>
      <p class="prompt-factory-field-note">用于记录模型对参考图的版式、构图、文字层级和电商风格的中文分析，帮助生成整套可复用图位 Prompt。</p>
      <textarea rows="4" data-factory-field="referenceAnalysis">${escapeHtml(asset.referenceAnalysis || "")}</textarea>
    </section>
    <section class="prompt-factory-section">
      <h4>套图中文总 Prompt</h4>
      <textarea rows="7" data-factory-field="chinesePrompt">${escapeHtml(asset.chinesePrompt || "")}</textarea>
    </section>
    <section class="prompt-factory-section">
      <h4>Suite English Prompt</h4>
      <textarea rows="6" data-factory-field="englishPrompt">${escapeHtml(asset.englishPrompt || "")}</textarea>
    </section>
    <section class="prompt-factory-section">
      <h4>套图图位提示词</h4>
      <div class="suite-factory-shot-list">${renderSuiteFactoryShotList(asset)}</div>
    </section>
    <section class="prompt-factory-publish-row suite-factory-publish-row">
      <label class="field compact-field"><span>方式</span><select data-factory-field="publishMode"><option value="append" ${publishMode === "append" ? "selected" : ""}>追加新套图</option><option value="overwrite" ${publishMode === "overwrite" ? "selected" : ""}>覆盖已有套图</option></select></label>
      ${publishMode === "overwrite" ? `<label class="field compact-field"><span>覆盖套图</span><select data-factory-field="targetPresetId">${suitePresets.map((preset) => `<option value="${escapeAttr(preset.id)}" ${preset.id === selectedPresetId ? "selected" : ""}>${escapeHtml(preset.title || preset.id)}</option>`).join("")}</select></label>` : `<div class="suite-factory-publish-note"><strong>发布整套图到 C 端</strong><span>会在 C 端“套图类型”里新增一个同名预设。</span></div>`}
    </section>
    <div class="admin-action-row prompt-factory-actions">
      <button class="small-button" type="button" data-suite-factory-action="save" data-asset-id="${escapeAttr(asset.id)}">保存草稿</button>
      <button class="small-button" type="button" data-suite-factory-action="retry" data-asset-id="${escapeAttr(asset.id)}">重试当前素材</button>
      <button class="small-button danger prompt-factory-delete-button" type="button" data-suite-factory-action="delete" data-asset-id="${escapeAttr(asset.id)}">删除</button>
      <button class="primary-button" type="button" data-suite-factory-action="publish" data-asset-id="${escapeAttr(asset.id)}">发布整套图到 C 端</button>
    </div>
  `;
}

function renderSuiteFactoryShotList(asset) {
  const shots = Array.isArray(asset.suiteShots) && asset.suiteShots.length ? asset.suiteShots : [];
  if (!shots.length) return `<div class="empty-state compact-empty">等待模型生成套图图位</div>`;
  return shots.map((shot, index) => `
    <article class="suite-factory-shot-card" data-suite-shot-index="${index}">
      <input type="hidden" data-suite-shot-field="id" value="${escapeAttr(shot.id || `shot-${index + 1}`)}" />
      <div class="admin-prompt-grid two">
        <label class="field admin-prompt-field"><span>图位名称</span><input type="text" data-suite-shot-field="name" value="${escapeAttr(shot.name || `0${index + 1} 套图图位`)}" /></label>
        <label class="field admin-prompt-field"><span>输出尺寸</span><input type="text" data-suite-shot-field="size" value="${escapeAttr(shot.size || "1024x1024")}" /></label>
      </div>
      <label class="field admin-prompt-field"><span>图位说明</span><input type="text" data-suite-shot-field="description" value="${escapeAttr(shot.description || "")}" /></label>
      <label class="field admin-prompt-field"><span>中文图位 Prompt</span><textarea rows="5" data-suite-shot-field="chinesePrompt">${escapeHtml(shot.chinesePrompt || "")}</textarea></label>
      <label class="field admin-prompt-field"><span>English Shot Prompt</span><textarea rows="4" data-suite-shot-field="englishPrompt">${escapeHtml(shot.englishPrompt || "")}</textarea></label>
      <div class="suite-factory-shot-validation">
        ${renderFactoryValidationImage(`${shot.name || `0${index + 1} 套图图位`} · Prompt + 原图`, shot.promptOnlyImageUrl || "", asset, "imageB")}
      </div>
      ${shot.imageError ? `<div class="empty-state compact-empty danger-empty">${escapeHtml(shot.imageError)}</div>` : ""}
    </article>
  `).join("");
}

function renderFactoryGenerationProgress(asset) {
  const job = factoryGenerationJob(asset);
  const progress = factoryProgressFromAsset(asset);
  const shouldShow = asset.status === "generating" || job || progress;
  if (!shouldShow) return "";
  const currentStepId = factoryCurrentStep(asset, job);
  const currentIndex = FACTORY_GENERATION_STEPS.findIndex((step) => step.id === currentStepId);
  const currentStep = FACTORY_GENERATION_STEPS[currentIndex >= 0 ? currentIndex : 0];
  const done = asset.status === "generated" || asset.status === "published" || job?.status === "success";
  const failed = asset.status === "failed" || job?.status === "failed";
  const stale = isFactoryStageStale(asset, job);
  const percent = done ? 100 : factoryStepPercent(currentStep.id);
  const modelText = progress?.textModel || job?.modelLabel || selectedFactoryModelLabel(asset.providerModelId);
  const imageText = progress?.imageModel ? `验证图：${progress.imageModel}` : "验证图：按图片模型配置自动执行";
  const message = failed
    ? job?.message || asset.error || "生成失败，请检查模型配置或远端接口返回。"
    : stale
      ? "当前阶段可能卡住，远端图片接口长时间没有返回。可以稍等片刻，或点击“重试当前素材”。"
    : done
      ? job?.message || "生成完成，可以审核提示词和验证图。"
      : progress?.detail || currentStep.detail;
  return `
    <section class="prompt-factory-progress ${failed || stale ? "failed" : done ? "done" : "running"}" aria-live="polite">
      <div class="prompt-factory-progress-head">
        <div>
          <strong>${escapeHtml(done ? "生成完成" : failed ? "生成失败" : stale ? "可能卡住" : progress?.label || currentStep.label)}</strong>
          <span>${escapeHtml(message)}</span>
        </div>
        <div class="prompt-factory-runtime">
          <span>${escapeHtml(job ? `已等待 ${factoryElapsedText(job)}` : formatTime(progress?.updatedAt))}</span>
          <span>${escapeHtml(`提示词：${modelText}`)}</span>
          <span>${escapeHtml(imageText)}</span>
        </div>
      </div>
      <div class="prompt-factory-progress-bar"><span style="width:${escapeAttr(String(percent))}%"></span></div>
      <div class="prompt-factory-step-list">
        ${FACTORY_GENERATION_STEPS.map((step, index) => {
          const complete = done || index < currentIndex;
          const active = !done && !failed && step.id === currentStep.id;
          return `
            <div class="prompt-factory-step ${complete ? "complete" : ""} ${active ? "active" : ""} ${failed && step.id === currentStep.id ? "failed" : ""}">
              <span></span>
              <strong>${escapeHtml(step.label)}</strong>
              <small>${escapeHtml(step.detail)}</small>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderFactoryValidationImage(label, url, asset = null, slot = "") {
  const imageBroken = isLikelyTruncatedFactoryImage(url);
  const status = renderFactoryValidationStatus(asset, slot, Boolean(url));
  const safeTitle = `${asset?.title || "提示词素材"}-${label}`;
  return `
    <figure class="prompt-factory-validation ${imageBroken ? "failed" : status.className}">
      <div class="prompt-factory-validation-head">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(imageBroken ? "数据不完整" : status.badge)}</span>
      </div>
      ${url && !imageBroken ? `
        <div class="prompt-factory-preview-frame">
          <button class="prompt-factory-preview-button" type="button" data-factory-preview-image="${escapeAttr(url)}" data-factory-preview-title="${escapeAttr(label)}">
            <img src="${escapeAttr(url)}" alt="${escapeAttr(label)}" data-factory-preview-img="1" />
            <span>点击全屏查看</span>
          </button>
          <div class="prompt-factory-validation-state prompt-factory-preview-fallback" data-factory-preview-fallback hidden>
            <span></span>
            <strong>远程图片暂时无法预览</strong>
            <small>图片链接可能已过期或远端不可访问。可以点击“重试当前素材”重新生成稳定预览。</small>
          </div>
          <div class="prompt-factory-image-actions">
            <button class="small-button" type="button" data-factory-preview-image="${escapeAttr(url)}" data-factory-preview-title="${escapeAttr(label)}">全屏查看</button>
            <button class="small-button prompt-factory-download-button" type="button" data-factory-download-image="${escapeAttr(url)}" data-factory-download-name="${escapeAttr(safeTitle)}">下载图片</button>
          </div>
        </div>
      ` : `<div class="prompt-factory-validation-state"><span></span><strong>${escapeHtml(imageBroken ? "图片数据不完整" : status.title)}</strong><small>${escapeHtml(imageBroken ? "这张历史图的 base64 数据已被截断，浏览器只能显示顶部残片。请点击重试当前素材重新生成。" : status.detail)}</small></div>`}
    </figure>
  `;
}

function isLikelyTruncatedFactoryImage(url) {
  const value = String(url || "");
  if (!value.startsWith("data:image/")) return false;
  const commaIndex = value.indexOf(",");
  const data = commaIndex >= 0 ? value.slice(commaIndex + 1) : "";
  if (!data) return false;
  if (data.length % 4 !== 0) return true;
  return value.length === 180000 || value.endsWith("[base64 图片数据已截断") || value.includes("base64 图片数据已截断");
}

function renderFactoryValidationStatus(asset, slot, hasImage) {
  if (hasImage) {
    return { className: "ready", badge: "已生成", title: "Prompt + 原图图片已生成", detail: "可以检查产品一致性和提示词复用效果。" };
  }
  const job = factoryGenerationJob(asset);
  const currentStep = factoryCurrentStep(asset, job);
  const failed = asset?.status === "failed" || job?.status === "failed";
  const stale = isFactoryStageStale(asset, job);
  if (stale) {
    return { className: "failed", badge: "可能卡住", title: "Prompt + 原图图片生成等待过久", detail: "远端图片接口长时间没有返回，可稍等或点击重试当前素材。" };
  }
  if (failed) {
    return { className: "failed", badge: "失败", title: "验证图未生成", detail: asset?.error || job?.message || "远端请求失败，请重试当前素材。" };
  }
  const generating = asset?.status === "generating" || job?.status === "running";
  if (generating && slot === "imageB") {
    if (currentStep === "imageB") {
      return { className: "generating", badge: "生成中", title: "正在生成 Prompt + 原图图片", detail: "只使用商品原图和生成 Prompt，验证是否可下发复用。" };
    }
  }
  if (generating) {
    return { className: "queued", badge: "排队", title: "等待验证图生成", detail: "提示词分析完成后会自动进入图片验证。" };
  }
  return { className: "empty", badge: "未生成", title: "等待验证图生成", detail: "点击生成后这里会显示 Prompt + 原图图片的实时状态。" };
}

function promptAssetStatusLabel(status) {
  return { draft: "草稿", generating: "生成中", generated: "待发布", published: "已发布", failed: "失败" }[status] || "草稿";
}

function promptAssetStatusClass(status) {
  return { generated: "ready", published: "ready", failed: "danger", generating: "neutral", draft: "neutral" }[status] || "neutral";
}

function bindPromptFactoryEvents() {
  els.promptConfigEditor.addEventListener("click", handlePromptFactoryClick);
  els.promptConfigEditor.addEventListener("change", handlePromptFactoryChange);
  els.promptConfigEditor.addEventListener("input", handlePromptFactoryInput);
  els.promptConfigEditor.addEventListener("error", handleFactoryPreviewImageError, true);
}

function handleFactoryPreviewImageError(event) {
  const image = event.target.closest?.("[data-factory-preview-img]");
  if (!image) return;
  const frame = image.closest(".prompt-factory-preview-frame");
  const fallback = frame?.querySelector("[data-factory-preview-fallback]");
  image.closest(".prompt-factory-preview-button")?.setAttribute("hidden", "");
  if (fallback) fallback.hidden = false;
}

function handlePromptFactoryInput(event) {
  const factoryField = event.target.closest("[data-factory-field]");
  if (factoryField) {
    const detail = factoryField.closest("#suitePromptFactoryAssetDetail, #promptFactoryAssetDetail");
    const active = promptFactoryActiveAssetFromDetail(detail);
    if (!active) return;
    active[factoryField.dataset.factoryField] = factoryField.value;
    return;
  }

  const shotField = event.target.closest("[data-suite-shot-field]");
  if (!shotField) return;
  const detail = shotField.closest("#suitePromptFactoryAssetDetail");
  const active = promptFactoryActiveAssetFromDetail(detail);
  const shotRow = shotField.closest("[data-suite-shot-index]");
  const index = Number(shotRow?.dataset.suiteShotIndex);
  if (!active || !Array.isArray(active.suiteShots) || !Number.isInteger(index) || !active.suiteShots[index]) return;
  active.suiteShots[index][shotField.dataset.suiteShotField] = shotField.value;
}

async function handlePromptFactoryClick(event) {
  const downloadButton = event.target.closest("[data-factory-download-image]");
  if (downloadButton) {
    downloadFactoryImage(downloadButton.dataset.factoryDownloadImage || "", downloadButton.dataset.factoryDownloadName || "factory-image");
    return;
  }

  const previewButton = event.target.closest("[data-factory-preview-image]");
  if (previewButton) {
    openFactoryImagePreview(previewButton.dataset.factoryPreviewImage || "", previewButton.dataset.factoryPreviewTitle || "验证图预览");
    return;
  }

  const statusButton = event.target.closest("[data-factory-status]");
  if (statusButton) {
    const scope = statusButton.dataset.factoryScope === "suite" ? "suite" : "single";
    if (scope === "suite") {
      state.suiteFactoryStatusFilter = statusButton.dataset.factoryStatus || "";
      await loadSuitePromptAssets();
    } else {
      state.factoryStatusFilter = statusButton.dataset.factoryStatus || "";
      await loadPromptAssets();
    }
    return;
  }

  const assetButton = event.target.closest("[data-factory-asset-id]");
  if (assetButton) {
    if (assetButton.dataset.factoryScope === "suite") state.activeSuitePromptAssetId = assetButton.dataset.factoryAssetId;
    else state.activePromptAssetId = assetButton.dataset.factoryAssetId;
    renderPromptConfigEditor();
    return;
  }

  const suiteGenerateButton = event.target.closest("#generateSuiteFactoryAssetBtn");
  if (suiteGenerateButton) {
    const createdAssets = await createSuitePromptAsset();
    await runFactoryBatchGeneration(suiteGenerateButton, createdAssets, "suite");
    return;
  }

  const generateButton = event.target.closest("#generateFactoryAssetsBtn");
  if (generateButton) {
    const createdAssets = await createPromptAssets();
    await runFactoryBatchGeneration(generateButton, createdAssets);
    return;
  }

  const suiteActionButton = event.target.closest("[data-suite-factory-action]");
  if (suiteActionButton) {
    const assetId = suiteActionButton.dataset.assetId;
    if (suiteActionButton.dataset.suiteFactoryAction === "save") await savePromptAsset(assetId, "suite");
    if (suiteActionButton.dataset.suiteFactoryAction === "retry") await generatePromptAsset(assetId, suiteActionButton, "suite");
    if (suiteActionButton.dataset.suiteFactoryAction === "delete") await deletePromptAsset(assetId, suiteActionButton, "suite");
    if (suiteActionButton.dataset.suiteFactoryAction === "publish") await publishSuitePromptAsset(assetId, suiteActionButton);
    return;
  }

  const actionButton = event.target.closest("[data-factory-action]");
  if (!actionButton) return;
  const assetId = actionButton.dataset.assetId;
  if (actionButton.dataset.factoryAction === "save") await savePromptAsset(assetId);
  if (actionButton.dataset.factoryAction === "retry") await generatePromptAsset(assetId, actionButton);
  if (actionButton.dataset.factoryAction === "delete") await deletePromptAsset(assetId, actionButton);
  if (actionButton.dataset.factoryAction === "publish") await publishPromptAsset(assetId, actionButton);
}

function openFactoryImagePreview(url, title = "验证图预览") {
  if (!url || !els.factoryImagePreviewModal || !els.factoryImagePreviewImg) return;
  els.factoryImagePreviewTitle.textContent = title;
  els.factoryImagePreviewImg.src = url;
  els.factoryImagePreviewImg.alt = title;
  els.factoryImagePreviewModal.classList.add("active");
  els.factoryImagePreviewModal.setAttribute("aria-hidden", "false");
}

function closeFactoryImagePreview() {
  if (!els.factoryImagePreviewModal || !els.factoryImagePreviewImg) return;
  els.factoryImagePreviewModal.classList.remove("active");
  els.factoryImagePreviewModal.setAttribute("aria-hidden", "true");
  els.factoryImagePreviewImg.removeAttribute("src");
}

function downloadFactoryImage(url, name = "factory-image") {
  if (!url) return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = factoryImageDownloadName(name, url);
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function factoryImageDownloadName(name, url) {
  const safeBase = String(name || "factory-image")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "factory-image";
  const mimeMatch = String(url || "").match(/^data:image\/([^;,]+)/i);
  const ext = mimeMatch ? (mimeMatch[1].toLowerCase() === "jpeg" ? "jpg" : mimeMatch[1].toLowerCase()) : "png";
  return `${safeBase}.${ext}`;
}

async function handlePromptFactoryChange(event) {
  if (event.target.id === "suiteFactoryProductImageInput") {
    const images = await readFactoryImageFiles(event.target.files, 1);
    state.suiteFactoryProductImage = images[0] || null;
    renderPromptConfigEditor();
    return;
  }

  if (event.target.id === "suiteFactoryReferenceImagesInput") {
    state.suiteFactoryReferenceImages = await readFactoryImageFiles(event.target.files, 20);
    renderPromptConfigEditor();
    return;
  }

  if (event.target.id === "factoryProductImageInput") {
    const images = await readFactoryImageFiles(event.target.files, 1);
    state.factoryProductImage = images[0] || null;
    renderPromptConfigEditor();
    return;
  }

  if (event.target.id === "factoryReferenceImagesInput") {
    state.factoryReferenceImages = await readFactoryImageFiles(event.target.files, 20);
    renderPromptConfigEditor();
    return;
  }

  if (
    event.target.dataset.factoryField === "targetPlatformId" ||
    event.target.dataset.factoryField === "targetCategoryId" ||
    event.target.dataset.factoryField === "publishMode" ||
    event.target.dataset.factoryField === "targetPresetId"
  ) {
    const detail = event.target.closest("#suitePromptFactoryAssetDetail, #promptFactoryAssetDetail");
    const active = promptFactoryActiveAssetFromDetail(detail);
    if (!active) return;
    if (event.target.dataset.factoryField === "targetPlatformId") {
      active.targetPlatformId = event.target.value;
      active.targetCategoryId = "";
      active.targetScenarioId = "";
    }
    if (event.target.dataset.factoryField === "targetCategoryId") {
      active.targetCategoryId = event.target.value;
      active.targetScenarioId = "";
    }
    if (event.target.dataset.factoryField === "publishMode") active.publishMode = event.target.value;
    if (event.target.dataset.factoryField === "targetPresetId") active.publishedTemplateId = event.target.value;
    renderPromptConfigEditor();
  }
}

async function readFactoryImageFiles(fileList, limit) {
  const files = Array.from(fileList || [])
    .filter((file) => file.type.startsWith("image/"))
    .slice(0, limit);
  const images = [];
  for (const file of files) {
    images.push(await fileToFactoryImage(file));
  }
  return images;
}

function fileToFactoryImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({ name: file.name || "图片", size: "", url: String(reader.result || "") });
    };
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function runFactoryBatchGeneration(button, assets = state.promptAssets, scope = "single") {
  const pendingAssets = assets.filter((asset) => asset.status === "draft");
  if (!pendingAssets.length) return;
  setBusy(button, "批量生成中", true);
  try {
    for (const asset of pendingAssets) {
      await generatePromptAsset(asset.id, null, scope);
    }
  } finally {
    setBusy(button, scope === "suite" ? "生成套图提示词与 Prompt + 原图" : "生成提示词与验证图", false);
  }
}

function promptSection(title, body) {
  return `
    <section class="admin-prompt-section">
      <h4>${escapeHtml(title)}</h4>
      ${body}
    </section>
  `;
}

function promptField(path, label, value, { type = "textarea", rows = 3 } = {}) {
  const escapedPath = escapeAttr(path);
  const escapedLabel = escapeHtml(label);
  const text = String(value ?? "");
  if (type === "input") {
    return `
      <label class="field admin-prompt-field">
        <span>${escapedLabel}</span>
        <input type="text" data-prompt-path="${escapedPath}" value="${escapeAttr(text)}" />
      </label>
    `;
  }
  return `
    <label class="field admin-prompt-field">
      <span>${escapedLabel}</span>
      <textarea rows="${rows}" data-prompt-path="${escapedPath}">${escapeHtml(text)}</textarea>
    </label>
  `;
}

function setPromptConfigValue(path, value) {
  const parts = String(path || "").split(".");
  let target = state.promptConfig;
  for (const part of parts.slice(0, -1)) {
    target = target?.[Number.isNaN(Number(part)) ? part : Number(part)];
  }
  const key = parts.at(-1);
  if (!target || !key) return;
  target[Number.isNaN(Number(key)) ? key : Number(key)] = value;
}

function userDisplayName(user) {
  return user?.name || user?.email || "未命名用户";
}

function userMetaText(user) {
  return user?.email || "邮箱未设置";
}

function renderUsers() {
  if (!state.users.length) {
    els.adminUserTable.innerHTML = `<tr><td colspan="12">暂无注册用户</td></tr>`;
    return;
  }
  els.adminUserTable.innerHTML = state.users
    .map(
      (user) => `
        <tr>
          <td>
            <strong>${escapeHtml(userDisplayName(user))}</strong>
            <small>${escapeHtml(userMetaText(user))}</small>
          </td>
          <td>
            <strong>${escapeHtml(sourceLabel(user.source))}</strong>
            <small>${escapeHtml(user.source?.utmCampaign || user.source?.referrer || user.source?.sourcePath || "")}</small>
          </td>
          <td><span class="status-chip ${user.disabled ? "danger" : "ready"}">${user.disabled ? "已禁用" : "正常"}</span></td>
          <td><span class="status-chip ${user.role === "admin" ? "ready" : "neutral"}">${escapeHtml(userRoleLabel(user.role))}</span></td>
          <td>
            <div class="credits-tooltip-wrapper">
              <span>剩余 <strong>${user.creditsRemaining}</strong> / ${user.credits}</span>
              ${user.recentDeductions && user.recentDeductions.length ? `
              <div class="credits-tooltip">
                <div class="credits-tooltip-title">最近扣减记录</div>
                ${user.recentDeductions.slice(0, 20).map(function(d) {
                  return '<div class="credits-tooltip-row">' +
                    '<span>' + formatTime(d.createdAt) + '</span>' +
                    '<span>' + (d.hasTemplate ? '单图' : '手动') + ' -' + d.count + '分</span>' +
                    '</div>';
                }).join('')}
              </div>` : ''}
            </div>
          </td>
          <td>
            <span class="status-chip ${(user.allowedImageModels || []).length ? "ready" : "neutral"}">${(user.allowedImageModels || []).length ? "已指定" : "默认模型"}</span>
            <small>${escapeHtml(userAllowedModelSummary(user.allowedImageModels, state.defaultImageModelId))}</small>
          </td>
          <td>
            <span class="status-chip ${(user.allowedVideoModels || []).length ? "ready" : "neutral"}">${(user.allowedVideoModels || []).length ? "已指定" : "默认模型"}</span>
            <small>${escapeHtml(userAllowedModelSummary(user.allowedVideoModels, state.defaultVideoModelId))}</small>
          </td>
          <td>${formatNumber(user.usage.calls)}</td>
          <td>${formatNumber(user.usage.images)}</td>
          <td>${formatNumber(user.usage.totalTokens)}</td>
          <td>
            <small>注册：${formatTime(user.createdAt)}</small>
            <small>登录：${formatTime(user.lastLoginAt)}</small>
          </td>
          <td>
            <div class="admin-action-row">
              <button class="small-button" type="button" data-action="config-image-key" data-user-id="${escapeAttr(user.id)}">
                图片模型
              </button>
              <button class="small-button" type="button" data-action="config-video-key" data-user-id="${escapeAttr(user.id)}">
                视频模型
              </button>
              <button class="small-button" type="button" data-action="toggle-role" data-user-id="${escapeAttr(user.id)}">
                ${user.role === "admin" ? "设为普通用户" : "设为管理员"}
              </button>
              <button class="small-button ${user.disabled ? "" : "danger"}" type="button" data-action="toggle-user" data-user-id="${escapeAttr(user.id)}">
                ${user.disabled ? "启用" : "禁用"}
              </button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
  els.adminUserTable.querySelectorAll("[data-action='toggle-user']").forEach((button) => {
    button.addEventListener("click", () => toggleUser(button.dataset.userId));
  });
  els.adminUserTable.querySelectorAll("[data-action='config-image-key']").forEach((button) => {
    button.addEventListener("click", () => openUserKeyModal(button.dataset.userId, "image"));
  });
  els.adminUserTable.querySelectorAll("[data-action='config-video-key']").forEach((button) => {
    button.addEventListener("click", () => openUserKeyModal(button.dataset.userId, "video"));
  });
  els.adminUserTable.querySelectorAll("[data-action='toggle-role']").forEach((button) => {
    button.addEventListener("click", () => toggleUserRole(button.dataset.userId));
  });
}

async function toggleUser(userId) {
  const user = state.users.find((entry) => entry.id === userId);
  if (!user) return;
  const disabled = !user.disabled;
  try {
    await adminFetch(`/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify({ disabled })
    });
    await Promise.all([loadUsers(), loadSummary()]);
    showToast(disabled ? "用户已禁用" : "用户已启用");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function toggleUserRole(userId) {
  const user = state.users.find((entry) => entry.id === userId);
  if (!user) return;
  const role = user.role === "admin" ? "user" : "admin";
  const ok = window.confirm(`${role === "admin" ? "授予" : "撤销"} ${userDisplayName(user)} 的 B 端管理员权限？`);
  if (!ok) return;
  try {
    await adminFetch(`/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify({ role })
    });
    await Promise.all([loadUsers(), loadSummary()]);
    showToast(role === "admin" ? "用户已设为管理员" : "用户已设为普通用户");
  } catch (error) {
    showToast(error.message, true);
  }
}

function defaultModelIdForKind(kind) {
  return normalizeModelKind(kind) === "video" ? state.defaultVideoModelId : state.defaultImageModelId;
}

function userModelsForKind(user, kind) {
  return normalizeModelKind(kind) === "video" ? user?.allowedVideoModels || [] : user?.allowedImageModels || [];
}

function providerModelOptions(kind) {
  const targetKind = normalizeModelKind(kind);
  return state.modelProviders
    .map((provider) => ({
      provider,
      models: (provider.models || []).filter((model) => normalizeModelKind(model.modelKind) === targetKind)
    }))
    .filter((entry) => entry.models.length);
}

function resolveModelLabel(modelId) {
  for (const provider of state.modelProviders) {
    const model = (provider.models || []).find((entry) => entry.id === modelId);
    if (model) {
      return `${provider.name || providerTypeText(provider.providerType)} / ${model.modelName || "未命名模型"}`;
    }
  }
  return "";
}

function userAllowedModelSummary(models = [], defaultModelId = "") {
  if (models.length) {
    return models
      .map((model) => model.displayName || `${model.providerName || "供应商"} / ${model.modelName || "未命名模型"}`)
      .join("、");
  }
  const defaultLabel = resolveModelLabel(defaultModelId);
  return defaultLabel ? `默认：${defaultLabel}` : "未设置默认模型";
}

function selectedAllowedModelIds(kind) {
  const list = normalizeModelKind(kind) === "video" ? els.adminAllowedVideoModelList : els.adminAllowedImageModelList;
  if (!list) return [];
  return Array.from(list.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => input.value)
    .filter(Boolean);
}

function renderAllowedModelList(user, kind) {
  const targetKind = normalizeModelKind(kind);
  const list = targetKind === "video" ? els.adminAllowedVideoModelList : els.adminAllowedImageModelList;
  if (!list) return;
  const explicitModels = userModelsForKind(user, targetKind);
  const explicitIds = explicitModels.map((model) => model.id).filter(Boolean);
  const defaultModelId = defaultModelIdForKind(targetKind);
  const selectedIds = new Set(explicitIds.length ? explicitIds : defaultModelId ? [defaultModelId] : []);
  const providerGroups = providerModelOptions(targetKind);
  if (!providerGroups.length) {
    list.innerHTML = `<div class="empty-state compact-empty">暂无可授权${targetKind === "video" ? "视频" : "图片"}模型</div>`;
    return;
  }
  list.innerHTML = providerGroups
    .map(({ provider, models }) => {
      const rows = models.map((model) => {
        const modelId = model.id || "";
        const disabled = !provider.enabled || model.enabled === false || !modelId;
        const isDefault = defaultModelId && modelId === defaultModelId;
        return `
          <label class="checkbox-row admin-allowed-model-row ${disabled ? "muted" : ""}">
            <input type="checkbox" value="${escapeAttr(modelId)}" ${selectedIds.has(modelId) ? "checked" : ""} ${disabled ? "disabled" : ""} />
            <span>
              <strong>${escapeHtml(model.modelName || "未命名模型")}</strong>
              <small>优先级 ${escapeHtml(model.priority || 100)} · ${isDefault ? "默认模型" : disabled ? "不可用" : "可用"}</small>
            </span>
          </label>
        `;
      });
      return `
        <section class="admin-allowed-provider-group">
          <h4>${escapeHtml(provider.name || "未命名供应商")}</h4>
          ${rows.join("")}
        </section>
      `;
    })
    .join("");
}

function openUserKeyModal(userId, mode = "image") {
  const user = state.users.find((entry) => entry.id === userId);
  if (!user) return;
  state.selectedKeyUserId = userId;
  state.selectedKeyMode = mode === "video" ? "video" : "image";
  delete els.saveUserKeyBtn.dataset.originalText;
  delete els.clearUserKeyBtn.dataset.originalText;
  const isVideo = state.selectedKeyMode === "video";
  const selectedModels = userModelsForKind(user, state.selectedKeyMode);
  els.adminKeyUserText.textContent = `${userDisplayName(user)} / ${userMetaText(user)}`;
  els.adminKeyModalTitle.textContent = isVideo ? "配置视频模型" : "配置图片模型";
  els.adminKeyHelpText.textContent = isVideo
    ? "勾选该用户可用的视频模型；未指定时使用模型配置里的默认视频模型。"
    : "勾选该用户可用的图片模型；未指定时使用模型配置里的默认图片模型。";
  els.adminAllowedImageModelSection.hidden = isVideo;
  els.adminAllowedVideoModelSection.hidden = !isVideo;
  renderAllowedModelList(user, state.selectedKeyMode);
  els.clearUserKeyBtn.disabled = !selectedModels.length;
  els.clearUserKeyBtn.textContent = "恢复默认模型";
  els.saveUserKeyBtn.textContent = isVideo ? "保存视频模型" : "保存图片模型";
  els.adminKeyModal.classList.add("active");
  els.adminKeyModal.setAttribute("aria-hidden", "false");
  const firstCheckbox = (isVideo ? els.adminAllowedVideoModelList : els.adminAllowedImageModelList)?.querySelector("input[type='checkbox']:not(:disabled)");
  if (firstCheckbox) window.setTimeout(() => firstCheckbox.focus(), 0);
}

function closeUserKeyModal() {
  state.selectedKeyUserId = "";
  state.selectedKeyMode = "image";
  els.adminAllowedImageModelList.innerHTML = "";
  els.adminAllowedVideoModelList.innerHTML = "";
  els.adminKeyModal.classList.remove("active");
  els.adminKeyModal.setAttribute("aria-hidden", "true");
}

async function saveUserKey() {
  const userId = state.selectedKeyUserId;
  const isVideo = state.selectedKeyMode === "video";
  if (!userId) return;
  const body = isVideo
    ? { allowedVideoModelIds: selectedAllowedModelIds("video") }
    : { allowedImageModelIds: selectedAllowedModelIds("image") };
  setBusy(els.saveUserKeyBtn, "保存中", true);
  try {
    await adminFetch(`/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    closeUserKeyModal();
    await Promise.all([loadUsers(), loadSummary()]);
    showToast(isVideo ? "用户视频模型已保存" : "用户图片模型已保存");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(els.saveUserKeyBtn, isVideo ? "保存视频模型" : "保存图片模型", false);
  }
}

async function clearUserKey() {
  const userId = state.selectedKeyUserId;
  if (!userId) return;
  const isVideo = state.selectedKeyMode === "video";
  const user = state.users.find((entry) => entry.id === userId);
  const ok = window.confirm(`恢复 ${userDisplayName(user)} 的${isVideo ? "视频" : "图片"}默认模型？`);
  if (!ok) return;
  setBusy(els.clearUserKeyBtn, "恢复中", true);
  try {
    const body = isVideo ? { allowedVideoModelIds: [] } : { allowedImageModelIds: [] };
    await adminFetch(`/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    closeUserKeyModal();
    await Promise.all([loadUsers(), loadSummary()]);
    showToast(isVideo ? "已恢复默认视频模型" : "已恢复默认图片模型");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(els.clearUserKeyBtn, "恢复默认模型", false);
  }
}

function renderLogs() {
  if (!state.logs.length) {
    els.adminLogTable.innerHTML = `<tr><td colspan="6">暂无生成日志</td></tr>`;
    return;
  }
  els.adminLogTable.innerHTML = state.logs
    .map(
      (log) => `
        <tr>
          <td>${formatTime(log.createdAt)}</td>
          <td>
            <strong>${escapeHtml(log.userName)}</strong>
            <small>${escapeHtml(log.userEmail)}</small>
          </td>
          <td>
            <strong>${escapeHtml(log.model)}</strong>
            <small>${escapeHtml(log.size)}</small>
          </td>
          <td><span class="status-chip ${log.status === "completed" ? "ready" : "danger"}">${escapeHtml(log.status)}</span></td>
          <td>
            <small>${formatNumber(log.imageCount)} 图 · ${formatNumber(log.durationMs)}ms</small>
            <small>in ${formatNumber(log.inputTokens)} / out ${formatNumber(log.outputTokens)}</small>
          </td>
          <td class="log-detail-cell">
            <div class="prompt-preview">${escapeHtml(log.prompt || log.error || "")}</div>
            <details>
              <summary>查看出入参</summary>
              <pre>${escapeHtml(JSON.stringify({ request: log.requestBody, response: log.responseBody }, null, 2))}</pre>
            </details>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderFeedbackFilters() {
  const selectedSource = els.feedbackSourceFilter.value;
  const selectedImageSource = els.feedbackImageSourceFilter.value;
  els.feedbackSourceFilter.innerHTML = [
    `<option value="">全部来源</option>`,
    ...state.feedbackSources.map(
      (entry) =>
        `<option value="${escapeAttr(entry.source)}">${escapeHtml(entry.source)} (${formatNumber(entry.count)})</option>`
    )
  ].join("");
  els.feedbackImageSourceFilter.innerHTML = [
    `<option value="">全部来源</option>`,
    ...state.feedbackImageSources.map(
      (entry) =>
        `<option value="${escapeAttr(entry.imageSource)}">${escapeHtml(imageSourceLabel(entry.imageSource))} (${formatNumber(entry.count)})</option>`
    )
  ].join("");
  els.feedbackSourceFilter.value = selectedSource;
  els.feedbackImageSourceFilter.value = selectedImageSource;
}

function renderFeedbacks() {
  if (!state.feedbacks.length) {
    els.adminFeedbackTable.innerHTML = `<tr><td colspan="6">暂无图片反馈</td></tr>`;
    return;
  }
  els.adminFeedbackTable.innerHTML = state.feedbacks
    .map(
      (feedback) => `
        <tr>
          <td>
            <div class="feedback-thumb">
              <img src="${escapeAttr(feedback.imageUrl)}" alt="${escapeAttr(feedback.imageName || "反馈图片")}" loading="lazy" />
            </div>
            <small>${escapeHtml(feedback.imageName || "--")}</small>
          </td>
          <td>
            <strong>${escapeHtml(feedback.userName)}</strong>
            <small>${escapeHtml(feedback.userEmail)}</small>
            <span class="source-chip">${escapeHtml(sourceLabel(feedback.userSource))}</span>
            <small>${escapeHtml(feedback.userSource?.utmCampaign || feedback.userSource?.referrer || "")}</small>
          </td>
          <td>
            <span class="status-chip ${feedback.feedbackType === "downvote" ? "danger" : "ready"}">${escapeHtml(feedbackTypeLabel(feedback.feedbackType))}</span>
            <strong>${escapeHtml(imageSourceLabel(feedback.imageSource))}</strong>
            <small>${escapeHtml(feedback.model || "--")}</small>
            <small>${escapeHtml(feedback.size || "--")}</small>
          </td>
          <td class="log-detail-cell">
            <div class="prompt-preview">${escapeHtml(feedback.prompt || "")}</div>
          </td>
          <td class="log-detail-cell">
            <details>
              <summary>查看入参</summary>
              <pre>${escapeHtml(JSON.stringify({ request: feedback.requestBody, image: feedback.item }, null, 2))}</pre>
            </details>
          </td>
          <td>${formatTime(feedback.createdAt)}</td>
        </tr>
      `
    )
    .join("");
}

function setBusy(button, text, busy) {
  if (!button) return;
  button.disabled = busy;
  button.dataset.originalText = button.dataset.originalText || button.textContent;
  button.textContent = busy ? text : button.dataset.originalText;
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.classList.add("active");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("active"), 2600);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sourceLabel(source) {
  const value = typeof source === "string" ? source : source?.source;
  return value || "direct";
}

function imageSourceLabel(value) {
  return (
    {
      generation: "单图生成",
      suite: "套图生成",
      refinement: "二次编辑",
      unknown: "未知来源"
    }[value] || value || "未知来源"
  );
}

function feedbackTypeLabel(value) {
  return (
    {
      upvote: "点赞",
      downvote: "点踩"
    }[value] || "反馈"
  );
}

function userRoleLabel(value) {
  return value === "admin" ? "管理员" : "普通用户";
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

// ── Redeem code manager ────────────────────────────────────────────────────

(function () {
  const els_redeem = {};
  const redeemState = {
    batches: [],
    expandedBatch: null,
    batchCodes: {},
  };

  function cacheRedeemElements() {
    Object.assign(els_redeem, {
      countInput: document.getElementById("redeemCountInput"),
      creditsInput: document.getElementById("redeemCreditsInput"),
      expiresInput: document.getElementById("redeemExpiresInput"),
      noteInput: document.getElementById("redeemNoteInput"),
      generateBtn: document.getElementById("generateRedeemCodesBtn"),
      generatedArea: document.getElementById("redeemGeneratedArea"),
      generatedCodes: document.getElementById("redeemGeneratedCodes"),
      copyBtn: document.getElementById("copyRedeemCodesBtn"),
      refreshBtn: document.getElementById("refreshRedeemBatchesBtn"),
      batchList: document.getElementById("redeemBatchList"),
    });
  }

  function bindRedeemEvents() {
    if (!els_redeem.generateBtn) return;
    els_redeem.generateBtn.addEventListener("click", handleGenerate);
    els_redeem.copyBtn.addEventListener("click", handleCopyAll);
    els_redeem.refreshBtn.addEventListener("click", () => { redeemState.batches = []; loadBatches(); });
  }

  async function handleGenerate() {
    const count = parseInt(els_redeem.countInput.value, 10) || 5;
    const credits = parseInt(els_redeem.creditsInput.value, 10) || 5;
    const expiresAt = els_redeem.expiresInput.value || null;
    const note = els_redeem.noteInput.value.trim() || null;
    setRedeemBusy(els_redeem.generateBtn, "生成中...", true);
    try {
      const payload = await adminFetch("/redeem/batches", {
        method: "POST",
        body: JSON.stringify({ count, credits, expiresAt, note }),
      });
      els_redeem.generatedCodes.textContent = payload.codes.join("\n");
      els_redeem.generatedArea.hidden = false;
      showRedeemToast("已生成 " + payload.count + " 个兑换码", false);
      setTimeout(() => loadBatches(), 100);
    } catch (error) {
      showRedeemToast(error.message, true);
    } finally {
      setRedeemBusy(els_redeem.generateBtn, "生成兑换码", false);
    }
  }

  async function handleCopyAll() {
    const text = els_redeem.generatedCodes.textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showRedeemToast("已复制到剪贴板", false);
    } catch {
      showRedeemToast("复制失败，请手动复制", true);
    }
  }

  async function loadBatches() {
    try {
      const payload = await adminFetch("/redeem/batches");
      redeemState.batches = payload.batches || [];
      renderBatches();
    } catch {
      // silent
    }
  }

  function renderBatches() {
    if (!els_redeem.batchList) return;
    const batches = redeemState.batches;
    if (!batches.length) {
      els_redeem.batchList.innerHTML = '<p class="empty-copy">暂无批次</p>';
      return;
    }
    els_redeem.batchList.innerHTML = batches
      .map(function (b) {
        var timeStr = formatRedeemTime(b.createdAt);
        var label = b.note || timeStr;
        var isExpanded = redeemState.expandedBatch === b.batchId;
        return (
          '<div class="admin-redeem-batch">' +
          '<button class="admin-redeem-batch-header" data-batch-id="' + b.batchId + '">' +
          '<span class="admin-redeem-chevron">' + (isExpanded ? '\u25BE' : '\u25B8') + '</span>' +
          '<span class="admin-redeem-batch-label">' + escapeHtml(label) + '</span>' +
          '<span class="admin-redeem-batch-meta">' + b.credits + '积分/码 \u00B7 共' + b.total + ' \u00B7 已兑' + b.redeemed +
          (b.revoked > 0 ? ' \u00B7 作废' + b.revoked : '') + '</span>' +
          '</button>' +
          '<div class="admin-redeem-batch-detail" data-batch-id="' + b.batchId + '"' + (isExpanded ? '' : ' hidden') + '>' +
          (isExpanded ? renderBatchCodes(b.batchId) : '') +
          '</div></div>'
        );
      })
      .join("");
    els_redeem.batchList.querySelectorAll(".admin-redeem-batch-header").forEach(function (btn) {
      btn.addEventListener("click", function () { toggleBatch(btn.dataset.batchId); });
    });
  }

  function renderBatchCodes(batchId) {
    var codes = redeemState.batchCodes[batchId];
    if (!codes) return '<p class="empty-copy">加载中...</p>';
    if (!codes.length) return '<p class="empty-copy">无数据</p>';
    var labels = { active: "未使用", redeemed: "已兑换", revoked: "已作废", expired: "已过期" };
    return '<table class="admin-table"><thead><tr><th>码前缀</th><th>积分</th><th>状态</th><th>兑换者</th><th>兑换时间</th><th>操作</th></tr></thead><tbody>' +
      codes.map(function (c) {
        return '<tr><td><code>' + escapeHtml(c.codePrefix) + '****</code></td><td>' + c.credits + '</td><td>' + escapeHtml(labels[c.status] || c.status) +
          '</td><td>' + escapeHtml(c.redeemedBy || "-") + '</td><td>' + (c.redeemedAt ? formatRedeemTime(c.redeemedAt) : "-") + '</td><td>' +
          (c.status === "active" ? '<button class="ghost-button danger mini-button" data-revoke-id="' + c.id + '" data-batch-id="' + batchId + '">作废</button>' : "") +
          '</td></tr>';
      }).join("") + '</tbody></table>';
  }

  async function toggleBatch(batchId) {
    if (redeemState.expandedBatch === batchId) {
      redeemState.expandedBatch = null;
      renderBatches();
      return;
    }
    redeemState.expandedBatch = batchId;
    if (!redeemState.batchCodes[batchId]) {
      try {
        var payload = await adminFetch("/redeem/batches/" + encodeURIComponent(batchId) + "/codes");
        redeemState.batchCodes[batchId] = payload.codes || [];
      } catch {
        redeemState.batchCodes[batchId] = [];
      }
    }
    renderBatches();
    els_redeem.batchList.querySelectorAll("[data-revoke-id]").forEach(function (btn) {
      btn.addEventListener("click", function () { revokeCode(btn.dataset.revokeId, btn.dataset.batchId); });
    });
  }

  async function revokeCode(codeId, batchId) {
    try {
      await adminFetch("/redeem/codes/" + encodeURIComponent(codeId), { method: "DELETE" });
      showRedeemToast("已作废", false);
      delete redeemState.batchCodes[batchId];
      toggleBatch(batchId);
      setTimeout(function () { loadBatches(); }, 200);
    } catch (error) {
      showRedeemToast(error.message, true);
    }
  }

  function formatRedeemTime(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    var yy = String(d.getFullYear()).slice(2);
    var mo = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    var hh = String(d.getHours()).padStart(2, "0");
    var mi = String(d.getMinutes()).padStart(2, "0");
    return yy + mo + dd + " " + hh + ":" + mi;
  }

  function setRedeemBusy(button, text, busy) {
    button.disabled = busy;
    button.dataset.originalText = button.dataset.originalText || button.textContent;
    button.textContent = busy ? text : button.dataset.originalText;
  }

  var redeemToastTimer = 0;
  function showRedeemToast(message, isError) {
    var toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("active");
    window.clearTimeout(redeemToastTimer);
    redeemToastTimer = window.setTimeout(function () { toast.classList.remove("active"); }, 2600);
  }

  // Hook into switchAdminView
  var _origSwitchAdminView = switchAdminView;
  switchAdminView = function (viewName) {
    _origSwitchAdminView(viewName);
    if (viewName === "redeem") {
      cacheRedeemElements();
      bindRedeemEvents();
      loadBatches();
    }
  };
})();
