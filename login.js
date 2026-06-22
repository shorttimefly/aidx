"use strict";

const APP_BASE_PATH = detectAppBasePath();
const AUTH_TOKEN_KEY = "imageStudio.authToken";

const state = {
  token: localStorage.getItem(AUTH_TOKEN_KEY) || "",
  mode: "login"
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
  bindEvents();
});

function cacheElements() {
  Object.assign(els, {
    emailInput: document.getElementById("loginEmailInput"),
    passwordInput: document.getElementById("loginPasswordInput"),
    submitBtn: document.getElementById("loginSubmitBtn"),
    loginTab: document.getElementById("authLoginTab"),
    registerTab: document.getElementById("authRegisterTab"),
    message: document.getElementById("loginMessage"),
    toast: document.getElementById("toast")
  });
}

function bindEvents() {
  els.submitBtn.addEventListener("click", handleSubmit);
  els.passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleSubmit();
  });
  els.loginTab.addEventListener("click", () => switchMode("login"));
  els.registerTab.addEventListener("click", () => switchMode("register"));
}

function switchMode(mode) {
  state.mode = mode;
  els.loginTab.classList.toggle("active", mode === "login");
  els.loginTab.setAttribute("aria-selected", mode === "login" ? "true" : "false");
  els.registerTab.classList.toggle("active", mode === "register");
  els.registerTab.setAttribute("aria-selected", mode === "register" ? "true" : "false");
  els.submitBtn.textContent = mode === "register" ? "注册并进入" : "登录";
}

async function handleSubmit() {
  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value;
  els.message.textContent = "";
  if (!email || !password) {
    els.message.textContent = "请输入邮箱和密码";
    els.message.className = "form-message error";
    return;
  }
  if (state.mode === "register" && password.length < 8) {
    els.message.textContent = "密码至少 8 位";
    els.message.className = "form-message error";
    return;
  }
  setBusy(true);
  try {
    const endpoint = state.mode === "register" ? "/auth/register" : "/auth/login";
    const body = state.mode === "register"
      ? { email, password, source: collectUserSource() }
      : { email, password };
    const response = await fetch(appRoute(`/api${endpoint}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.message || "请求失败");
    }
    state.token = payload.token || "";
    localStorage.setItem(AUTH_TOKEN_KEY, state.token);
    els.passwordInput.value = "";
    window.location.replace("./index.html");
  } catch (error) {
    els.message.textContent = error.message;
    els.message.className = "form-message error";
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  els.submitBtn.disabled = busy;
  els.submitBtn.textContent = busy
    ? (state.mode === "register" ? "注册中..." : "登录中...")
    : (state.mode === "register" ? "注册并进入" : "登录");
}

function collectUserSource() {
  try {
    const ref = document.referrer || "";
    const params = new URLSearchParams(window.location.search);
    return {
      source: params.get("utm_source") || params.get("source") || "direct",
      referrer: ref ? new URL(ref).hostname : "",
      utmSource: params.get("utm_source") || "",
      utmMedium: params.get("utm_medium") || "",
      utmCampaign: params.get("utm_campaign") || "",
      sourcePath: window.location.pathname || "/"
    };
  } catch {
    return { source: "direct", referrer: "", utmSource: "", utmMedium: "", utmCampaign: "", sourcePath: "/" };
  }
}
