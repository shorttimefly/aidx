"use strict";

const ADMIN_TOKEN_KEY = "imageStudio.adminToken";

const state = {
  token: localStorage.getItem(ADMIN_TOKEN_KEY) || ""
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  bindEvents();
  showRouteMessage();

  if (!state.token) return;

  try {
    await adminFetch("/me");
    redirectToAdmin();
  } catch {
    clearAdmin();
  }
});

function cacheElements() {
  Object.assign(els, {
    adminEmailInput: document.getElementById("adminEmailInput"),
    adminPasswordInput: document.getElementById("adminPasswordInput"),
    adminLoginBtn: document.getElementById("adminLoginBtn"),
    toast: document.getElementById("toast")
  });
}

function bindEvents() {
  els.adminLoginBtn.addEventListener("click", handleAdminLogin);
  els.adminPasswordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleAdminLogin();
  });
}

function showRouteMessage() {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get("reason");
  const messages = {
    expired: "登录已过期，请重新登录",
    required: "请先登录 B 端管理台",
    logout: "已退出 B 端"
  };
  if (messages[reason]) showToast(messages[reason], reason !== "logout");
}

async function handleAdminLogin() {
  const account = els.adminEmailInput.value.trim();
  const password = els.adminPasswordInput.value;
  if (!account || !password) {
    showToast("请输入管理员账号和密码", true);
    return;
  }

  setBusy(els.adminLoginBtn, "登录中", true);
  try {
    const payload = await adminFetch("/login", {
      method: "POST",
      body: JSON.stringify({ name: account, password }),
      skipAuth: true
    });
    state.token = payload.token || "";
    if (!state.token) throw new Error("登录响应缺少 token");
    localStorage.setItem(ADMIN_TOKEN_KEY, state.token);
    redirectToAdmin();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(els.adminLoginBtn, "进入管理台", false);
  }
}

async function adminFetch(path, options = {}) {
  const { skipAuth, headers, ...fetchOptions } = options;
  const response = await fetch(`/api/admin${path}`, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
      ...(!skipAuth && state.token ? { Authorization: `Bearer ${state.token}` } : {})
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
    const message = payload?.error || payload?.message || response.statusText || "请求失败";
    throw new Error(message);
  }
  return payload || {};
}

function redirectToAdmin() {
  window.location.replace("./admin.html");
}

function clearAdmin() {
  state.token = "";
  localStorage.removeItem(ADMIN_TOKEN_KEY);
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
