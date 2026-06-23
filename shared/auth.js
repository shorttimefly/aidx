/**
 * Shared Auth Module — unified token management + auth verification.
 * Used by ALL pages (C-end and B-end).
 */
"use strict";

const AUTH_TOKEN_KEY = "imageStudio.authToken";
const APP_BASE = (function () {
  const marker = "/aidx-runtime";
  const pathname = window.location.pathname || "";
  return pathname === marker || pathname.startsWith(marker + "/") ? marker : "";
})();

function appRoute(path) {
  return APP_BASE + path;
}
/* Fix relative image URLs from the server */
function fixImageUrl(url) {
  if (!url) return url;
  var parts = url.split("||");
  url = parts[0];
  if (url.startsWith("/api/generated-images/")) return APP_BASE + url;
  return url;
}
function fixImageThumb(url) {
  if (!url) return url;
  var parts = url.split("||");
  var thumb = parts[1] || parts[0];
  if (thumb.startsWith("/api/generated-images/")) return APP_BASE + thumb;
  if (parts[0].startsWith("/api/generated-images/")) return APP_BASE + parts[0];
  return thumb;
}

const Auth = {
  /** Read token from localStorage */
  get token() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
  },

  /** Store token */
  set token(value) {
    if (value) localStorage.setItem(AUTH_TOKEN_KEY, value);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  },

  /** Current user object (set after verify) */
  _user: null,
  get user() { return this._user; },
  set user(u) { this._user = u; },

  /** True if user has admin role */
  get isAdmin() {
    return String(this._user?.role || "").toLowerCase() === "admin";
  },

  /**
   * Verify session and load user.
   * @param {"user"|"admin"} requiredRole
   * @returns {Promise<object>} user object
   */
  async verify(requiredRole) {
    const token = this.token;
    if (!token) {
      this.redirect(requiredRole);
      throw new Error("NO_TOKEN");
    }

    const endpoint = requiredRole === "admin" ? "/admin/me" : "/me";
    let resp;
    try {
      resp = await fetch(appRoute("/api" + endpoint), {
        headers: { Authorization: "Bearer " + token }
      });
    } catch (e) {
      this.clear();
      this.redirect(requiredRole);
      throw new Error("NETWORK_ERROR");
    }

    if (!resp.ok) {
      this.clear();
      this.redirect(requiredRole);
      throw new Error("AUTH_FAILED");
    }

    const data = await resp.json();
    if (requiredRole === "admin") {
      this.user = data.admin || data.user;
    } else {
      this.user = data.user;
    }
    return this.user;
  },

  /** Clear auth state */
  clear() {
    this.token = "";
    this.user = null;
  },

  /** Redirect to appropriate login page */
  redirect(requiredRole) {
    const loginPage = requiredRole === "admin"
      ? "/admin/login.html"
      : "/login.html";
    const target = APP_BASE + loginPage;
    if (window.location.pathname !== target && !window.location.pathname.endsWith(loginPage)) {
      window.location.replace(target);
    }
  },

  /**
   * Initialize page auth — call at page load.
   * Redirects if not authenticated for requiredRole.
   */
  async init(requiredRole) {
    try {
      await this.verify(requiredRole);
      return this.user;
    } catch (e) {
      if (e.message !== "NO_TOKEN" && e.message !== "AUTH_FAILED") {
        console.error("[AUTH] init error:", e.message);
      }
      throw e;
    }
  },

  /** Full login flow (for login.html) */
  async login(email, password, isAdmin) {
    const endpoint = isAdmin ? "/admin/login" : "/auth/login";
    const body = isAdmin
      ? { email, password }
      : { email, password };

    const resp = await fetch(appRoute("/api" + endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || data.message || "登录失败");
    }

    this.token = data.token;
    if (isAdmin) {
      this.user = data.admin;
    } else {
      this.user = data.user;
    }
    return this.user;
  },

  /** Register */
  async register(email, password) {
    const resp = await fetch(appRoute("/api/auth/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || data.message || "注册失败");
    }
    this.token = data.token;
    this.user = data.user;
    return this.user;
  },

  /** Logout */
  async logout() {
    try {
      if (this.token) {
        await fetch(appRoute("/api/auth/logout"), {
          method: "POST",
          headers: { Authorization: "Bearer " + this.token }
        });
      }
    } catch (e) { /* ignore */ }
    this.clear();
    window.location.replace(APP_BASE + "/login.html");
  }
};
