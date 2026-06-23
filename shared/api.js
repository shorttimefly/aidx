/**
 * Shared API Module — fetch wrapper with auth, error handling.
 */
"use strict";

const Api = {
  /**
   * Fetch with automatic auth header.
   * @param {string} path - API path (e.g. "/me", "/generate")
   * @param {object} options - fetch options
   * @returns {Promise<object>} parsed JSON
   */
  async fetch(path, options = {}) {
    const token = Auth.token;
    const url = appRoute("/api" + path);
    const resp = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(options.headers || {})
      },
      body: options.body !== undefined && typeof options.body === "string"
        ? options.body
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined
    });

    const text = await resp.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { error: text }; }

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        Auth.clear();
        Auth.redirect(options._admin ? "admin" : "user");
        const err = new Error(data.error || "请重新登录");
        err.authFailure = true;
        throw err;
      }
      const err = new Error(data.error || data.message || "请求失败");
      err.status = resp.status;
      err.data = data;
      throw err;
    }

    return data;
  },

  /** C-end API calls */
  async get(path) { return this.fetch(path); },
  async post(path, body) { return this.fetch(path, { method: "POST", body }); },

  /** B-end API calls (automatic redirect to admin login on auth failure) */
  async admin(path, options = {}) {
    return this.fetch(path.startsWith("/admin/") ? path : "/admin" + path, { ...options, _admin: true });
  }
};
