const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const authModal =
  html.match(/<div class="modal-backdrop auth-backdrop" id="authModal"[\s\S]*?<div id="toast"/)?.[0] || "";
const handleAuth = app.match(/async function handleAuth\(\) \{[\s\S]*?\n\}/)?.[0] || "";

assert.ok(authModal.includes("用户名"));
assert.ok(authModal.includes('role="tablist"'));
assert.ok(authModal.includes('data-auth-mode="login"'));
assert.ok(authModal.includes('data-auth-mode="register"'));
assert.ok(authModal.includes("登录方式"));
assert.ok(authModal.includes('id="authTypeInput"'));
assert.ok(authModal.includes('value="username"'));
assert.ok(authModal.includes('value="email"'));
assert.ok(authModal.includes('id="authNameInput"'));
assert.ok(authModal.includes('autocomplete="username"'));
assert.ok(authModal.includes('id="authPasswordInput"'));
assert.ok(authModal.includes('id="authSubmitBtn"'));
assert.ok(!authModal.includes('id="loginBtn"'));
assert.ok(!authModal.includes('id="registerBtn"'));
assert.ok(!authModal.includes("authEmailInput"));
assert.ok(html.includes('id="accountKeyStatus"'));
assert.ok(html.includes("图片 Key"));
assert.ok(html.includes("视频 Key"));

assert.ok(!app.includes("authEmailInput"));
assert.ok(!app.includes("accountMetaText"));
assert.ok(app.includes('activeAuthMode: "login"'));
assert.ok(app.includes("videoApiKeyConfigured"));
assert.ok(app.includes("renderAccountKeyStatus"));
assert.ok(app.includes("authTypeInput: document.getElementById(\"authTypeInput\")"));
assert.ok(app.includes("authSubmitBtn: document.getElementById(\"authSubmitBtn\")"));
assert.ok(app.includes("switchAuthMode"));
assert.ok(handleAuth.includes("const name = els.authNameInput.value.trim();"));
assert.ok(handleAuth.includes("const authType = els.authTypeInput.value === \"email\" ? \"email\" : \"username\";"));
assert.ok(handleAuth.includes("authType === \"email\" ? { authType, email: name, password } : { authType, name, password }"));
assert.ok(handleAuth.includes("const mode = state.activeAuthMode;"));
assert.ok(handleAuth.includes("请输入邮箱和密码"));
assert.ok(handleAuth.includes("请输入用户名和密码"));

console.log("auth UI structure tests passed");
