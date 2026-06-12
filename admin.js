"use strict";

const APP_BASE_PATH = detectAppBasePath();
const ADMIN_TOKEN_KEY = "imageStudio.adminToken";
const PROMPT_GROUPS = [
  { id: "single", label: "单图模板" },
  { id: "suite", label: "套图生成" },
  { id: "refinement", label: "二次编辑" },
  { id: "reference", label: "参考图规则" },
  { id: "probe", label: "入参探测" }
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
  activePromptGroup: "single",
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
  els.closeAdminKeyModalBtn.addEventListener("click", closeUserKeyModal);
  els.cancelUserKeyBtn.addEventListener("click", closeUserKeyModal);
  els.saveUserKeyBtn.addEventListener("click", saveUserKey);
  els.clearUserKeyBtn.addEventListener("click", clearUserKey);
}

function renderShell() {
  els.adminDashboard.hidden = !state.token;
  els.adminLogoutBtn.style.display = state.token ? "inline-flex" : "none";
  switchAdminView(state.activeAdminView);
}

function switchAdminView(viewName) {
  state.activeAdminView = viewName || "model";
  els.adminNavItems.forEach((button) => {
    const active = button.dataset.adminView === state.activeAdminView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  els.adminViews.forEach((view) => {
    view.classList.toggle("active", view.dataset.adminViewPanel === state.activeAdminView);
  });
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
    if (response.status === 401 || response.status === 403) {
      const error = new Error("登录已过期，请重新登录");
      error.authFailure = true;
      handleAuthFailure();
      throw error;
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
  const isDefault = modelId && modelId === (modelKind === "video" ? state.defaultVideoModelId : state.defaultImageModelId);
  const isEnabled = provider.enabled !== false && model?.enabled !== false;
  const canSetDefault = Boolean(modelId && isEnabled);
  const defaultLabel = modelKind === "video" ? "默认视频" : "默认图片";
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
  return value === "video" ? "video" : "image";
}

function modelKindText(value) {
  return normalizeModelKind(value) === "video" ? "视频模型" : "图片模型";
}

function providerTypeText(value) {
  return {
    aokapi_gemini: "AOKAPI / Gemini",
    muskapis_image: "Muskapis Image",
    openai_image: "OpenAI Image Compatible"
  }[value] || "OpenAI Image Compatible";
}

function defaultProviderBaseUrl(providerType) {
  return {
    aokapi_gemini: "https://aokapi.com/v1beta/models/{model}:generateContent/",
    muskapis_image: "https://api.muskapis.com/v1",
    openai_image: "https://api.openai.com/v1"
  }[providerType] || "https://api.openai.com/v1";
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
  els.providerModelNameInput.value = model?.modelName || (providerType === "muskapis_image" ? "gpt-image-2" : "");
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

function renderPromptConfigEditor() {
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
    probe: renderProbePromptConfig
  };
  els.promptConfigEditor.innerHTML = (renderers[group] || renderers.single)(state.promptConfig);
}

function renderSinglePromptConfig(config) {
  return [
    promptSection(
      "单图模板分类",
      config.single.templateCategories
        .map((category, index) =>
          promptField(`single.templateCategories.${index}.label`, `${category.id} 显示名`, category.label, { type: "input" })
        )
        .join("")
    ),
    promptSection(
      "单图提示词模板",
      config.single.templates
        .map(
          (template, index) => `
            <article class="admin-prompt-card">
              <div class="admin-prompt-card-head">
                <strong>${escapeHtml(template.title)}</strong>
                <span>${escapeHtml(template.id)} / ${escapeHtml(template.category)}</span>
              </div>
              ${promptField(`single.templates.${index}.title`, "模板标题", template.title, { type: "input" })}
              ${promptField(`single.templates.${index}.prompt`, "模板提示词", template.prompt)}
            </article>
          `
        )
        .join("")
    ),
    promptSection(
      "补图变体提示词",
      promptField("single.supplementalVariantPrompt", "补图变体文案", config.single.supplementalVariantPrompt)
    )
  ].join("");
}

function renderSuitePromptConfig(config) {
  return [
    promptSection(
      "套图类型与图位",
      config.suite.presets
        .map(
          (preset, presetIndex) => `
            <article class="admin-prompt-card">
              <div class="admin-prompt-card-head">
                <strong>${escapeHtml(preset.title)}</strong>
                <span>${escapeHtml(preset.id)}</span>
              </div>
              <div class="admin-prompt-grid two">
                ${promptField(`suite.presets.${presetIndex}.title`, "套图标题", preset.title, { type: "input" })}
              </div>
              ${preset.shots
                .map(
                  (shot, shotIndex) => `
                    <div class="admin-prompt-subcard">
                      <div class="admin-prompt-card-head">
                        <strong>${escapeHtml(shot.name)}</strong>
                        <span>${escapeHtml(shot.id)}</span>
                      </div>
                      <div class="admin-prompt-grid two">
                        ${promptField(`suite.presets.${presetIndex}.shots.${shotIndex}.name`, "图位名称", shot.name, { type: "input" })}
                        ${promptField(`suite.presets.${presetIndex}.shots.${shotIndex}.size`, "推荐尺寸", shot.size, { type: "input" })}
                      </div>
                      ${promptField(`suite.presets.${presetIndex}.shots.${shotIndex}.description`, "图位说明", shot.description, { type: "input" })}
                      ${promptField(`suite.presets.${presetIndex}.shots.${shotIndex}.prompt`, "图位提示词", shot.prompt)}
                    </div>
                  `
                )
                .join("")}
            </article>
          `
        )
        .join("")
    ),
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
    els.adminUserTable.innerHTML = `<tr><td colspan="11">暂无注册用户</td></tr>`;
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
