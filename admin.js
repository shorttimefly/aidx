"use strict";

const ADMIN_TOKEN_KEY = "imageStudio.adminToken";

const state = {
  token: localStorage.getItem(ADMIN_TOKEN_KEY) || "",
  users: [],
  logs: [],
  feedbacks: [],
  feedbackSources: [],
  feedbackImageSources: [],
  summary: null
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  bindEvents();
  renderShell();
  if (state.token) {
    try {
      await adminFetch("/me");
      await loadDashboard();
    } catch (error) {
      clearAdmin();
      showToast(error.message, true);
    }
  }
  renderShell();
});

function cacheElements() {
  Object.assign(els, {
    adminLoginPanel: document.getElementById("adminLoginPanel"),
    adminDashboard: document.getElementById("adminDashboard"),
    adminEmailInput: document.getElementById("adminEmailInput"),
    adminPasswordInput: document.getElementById("adminPasswordInput"),
    adminLoginBtn: document.getElementById("adminLoginBtn"),
    adminLogoutBtn: document.getElementById("adminLogoutBtn"),
    adminSummaryGrid: document.getElementById("adminSummaryGrid"),
    defaultEndpointInput: document.getElementById("defaultEndpointInput"),
    defaultModelInput: document.getElementById("defaultModelInput"),
    usageNoteInput: document.getElementById("usageNoteInput"),
    saveModelConfigBtn: document.getElementById("saveModelConfigBtn"),
    refreshUsersBtn: document.getElementById("refreshUsersBtn"),
    refreshLogsBtn: document.getElementById("refreshLogsBtn"),
    refreshFeedbackBtn: document.getElementById("refreshFeedbackBtn"),
    feedbackTypeFilter: document.getElementById("feedbackTypeFilter"),
    feedbackSourceFilter: document.getElementById("feedbackSourceFilter"),
    feedbackImageSourceFilter: document.getElementById("feedbackImageSourceFilter"),
    adminUserTable: document.getElementById("adminUserTable"),
    adminLogTable: document.getElementById("adminLogTable"),
    adminFeedbackTable: document.getElementById("adminFeedbackTable"),
    toast: document.getElementById("toast")
  });
}

function bindEvents() {
  els.adminLoginBtn.addEventListener("click", handleAdminLogin);
  els.adminLogoutBtn.addEventListener("click", handleAdminLogout);
  els.saveModelConfigBtn.addEventListener("click", saveModelConfig);
  els.refreshUsersBtn.addEventListener("click", loadUsers);
  els.refreshLogsBtn.addEventListener("click", loadLogs);
  els.refreshFeedbackBtn.addEventListener("click", () => loadFeedbacks(true));
  els.feedbackTypeFilter.addEventListener("change", () => loadFeedbacks());
  els.feedbackSourceFilter.addEventListener("change", () => loadFeedbacks());
  els.feedbackImageSourceFilter.addEventListener("change", () => loadFeedbacks());
  els.adminPasswordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleAdminLogin();
  });
}

function renderShell() {
  const loggedIn = Boolean(state.token);
  els.adminLoginPanel.hidden = loggedIn;
  els.adminDashboard.hidden = !loggedIn;
  els.adminLogoutBtn.style.display = loggedIn ? "inline-flex" : "none";
}

async function adminFetch(path, options = {}) {
  const response = await fetch(`/api/admin${path}`, {
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
    if (response.status === 401 || response.status === 403) clearAdmin();
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
    return "当前 B 端连接的是旧的 8787 服务；请打开 http://localhost:8788/admin.html，或先执行 kill 48038 后重新启动 8787。";
  }
  return "点踩反馈接口未在当前后端生效；请重启 server.py 后再试。";
}

async function handleAdminLogin() {
  const email = els.adminEmailInput.value.trim();
  const password = els.adminPasswordInput.value;
  if (!email || !password) {
    showToast("请输入管理员邮箱和密码", true);
    return;
  }
  setBusy(els.adminLoginBtn, "登录中", true);
  try {
    const payload = await adminFetch("/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    state.token = payload.token;
    localStorage.setItem(ADMIN_TOKEN_KEY, state.token);
    await loadDashboard();
    renderShell();
    showToast("已进入管理台");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(els.adminLoginBtn, "进入管理台", false);
  }
}

function handleAdminLogout() {
  clearAdmin();
  renderShell();
  showToast("已退出 B 端");
}

function clearAdmin() {
  state.token = "";
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function loadDashboard() {
  await Promise.all([loadSummary(), loadUsers(), loadLogs(), loadFeedbacks()]);
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

function renderSummary(summary = {}) {
  const cards = [
    ["注册用户", summary.users || 0],
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
  els.defaultEndpointInput.value = config.defaultEndpoint || "";
  els.defaultModelInput.value = config.defaultModel || "";
  els.usageNoteInput.value = config.usageNote || "";
}

async function saveModelConfig() {
  setBusy(els.saveModelConfigBtn, "保存中", true);
  try {
    await adminFetch("/model-config", {
      method: "PUT",
      body: JSON.stringify({
        defaultEndpoint: els.defaultEndpointInput.value.trim(),
        defaultModel: els.defaultModelInput.value.trim(),
        usageNote: els.usageNoteInput.value.trim()
      })
    });
    await loadSummary();
    showToast("模型默认配置已保存");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(els.saveModelConfigBtn, "保存默认配置", false);
  }
}

function renderUsers() {
  if (!state.users.length) {
    els.adminUserTable.innerHTML = `<tr><td colspan="9">暂无注册用户</td></tr>`;
    return;
  }
  els.adminUserTable.innerHTML = state.users
    .map(
      (user) => `
        <tr>
          <td>
            <strong>${escapeHtml(user.name)}</strong>
            <small>${escapeHtml(user.email)}</small>
          </td>
          <td>
            <strong>${escapeHtml(sourceLabel(user.source))}</strong>
            <small>${escapeHtml(user.source?.utmCampaign || user.source?.referrer || user.source?.sourcePath || "")}</small>
          </td>
          <td><span class="status-chip ${user.disabled ? "danger" : "ready"}">${user.disabled ? "已禁用" : "正常"}</span></td>
          <td>${user.apiKeyConfigured ? "已配置" : "未配置"}</td>
          <td>${formatNumber(user.usage.calls)}</td>
          <td>${formatNumber(user.usage.images)}</td>
          <td>${formatNumber(user.usage.totalTokens)}</td>
          <td>
            <small>注册：${formatTime(user.createdAt)}</small>
            <small>登录：${formatTime(user.lastLoginAt)}</small>
          </td>
          <td>
            <button class="small-button ${user.disabled ? "" : "danger"}" type="button" data-action="toggle-user" data-user-id="${escapeAttr(user.id)}">
              ${user.disabled ? "启用" : "禁用"}
            </button>
          </td>
        </tr>
      `
    )
    .join("");
  els.adminUserTable.querySelectorAll("[data-action='toggle-user']").forEach((button) => {
    button.addEventListener("click", () => toggleUser(button.dataset.userId));
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
