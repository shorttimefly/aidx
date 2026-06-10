# Public Interface Changes

## 2026-06-10 - C端 username/email auth modes

C端 registration and login now let users choose username plus password or email plus password.

### C端 HTTP API

- `POST /api/auth/register` accepts `authType: "username"` with `name`/`username`, or `authType: "email"` with `email`.
- Username-mode registrations keep `email` empty. Email-mode registrations store the supplied email and derive the display name from the email prefix when no separate name is provided.
- Username-mode registration rejects email-formatted identifiers and asks the user to switch to email auth, preventing accidental duplicate accounts for existing email users.
- `POST /api/auth/login` accepts the same auth modes. Requests without `authType` remain compatible: identifiers containing `@` are treated as email, otherwise username.
- Registered users promoted to B端 admin can log into `POST /api/admin/login` with username or email; the built-in `ADMIN_EMAIL` login remains unchanged.

### C端 UI

- The registration/login modal splits `登录` and `注册` into tabs, keeps only one submit action visible, and includes a `登录方式` selector for `用户名登录` or `邮箱登录`.

### Storage Contract

- The historical unique constraint on `users.email` is removed during initialization so username-mode users can have empty email values. Email-mode duplicate checks are enforced in application code.

## 2026-06-10 - C端 suite style display labels

Suite visual style configuration now separates the internal prompt wording from the customer-facing label.

### Prompt Config Contract

- `suite.visualStyles[]` now includes editable `displayLabel`.
- C端 suite style selectors display `displayLabel` when present, falling back to built-in safe display names instead of internal prompt labels.
- Suite prompt composition continues to use the internal `label`, so B端 can keep prompt-specific style wording hidden from customers.

### B端 UI

- 提示词配置 > 套图生成 > 视觉风格与套图拼接文案 now edits each style as separate `内部提示词` and `前台显示` fields.

## 2026-06-10 - B端 image and video user credentials

B端 user credential configuration now distinguishes image and video model settings per registered user.

### B端 HTTP API

- `GET /api/admin/users` now returns image-specific fields `imageApiKeyConfigured`, `imageApiKeyMasked`, and `imageEndpoint`, while keeping legacy `apiKeyConfigured` and `apiKeyMasked` for compatibility.
- `GET /api/admin/users` now returns image-specific `imageModel` and video-specific `videoModel`.
- `GET /api/admin/users` now returns video-specific fields `videoApiKeyConfigured`, `videoApiKeyMasked`, `videoEndpointPrimary`, and `videoEndpointSecondary`.
- `PATCH /api/admin/users/:id` now accepts `imageApiKey`, `imageEndpoint`, `imageModel`, `clearImageApiKey`, `videoApiKey`, `videoModel`, `videoEndpointPrimary`, `videoEndpointSecondary`, and `clearVideoApiKey`.
- Existing `apiKey` and `clearApiKey` payloads remain compatible aliases for the image key.
- `GET /api/settings` returns image-specific fields `imageApiKeyConfigured`, `imageApiKeyMasked`, `imageEndpoint`, and `imageModel`, while keeping legacy `apiKeyConfigured` and `apiKeyMasked` as image-key aliases.
- `GET /api/settings` returns video-specific fields `videoApiKeyConfigured`, `videoApiKeyMasked`, `videoModel`, `videoEndpointPrimary`, and `videoEndpointSecondary`.
- `GET /api/settings` and backend image generation now use the user's configured image address when present, falling back to the B端 default endpoint.
- The built-in AOKAPI image endpoint default now uses `{model}`: `https://aokapi.com/v1beta/models/{model}:generateContent/`. Existing built-in default endpoint values are migrated to this placeholder form.

### B端 UI

- The registered user table renamed `API Key` to `图片 Key` and added a `视频 Key` column.
- User actions now expose separate image and video configuration controls. Image configuration includes image model and Base URL/address; video configuration includes one API Key, video model, and two addresses.
- C端 account status now lists `图片 Key` and `视频 Key` separately, so a missing video key no longer hides an already configured image key.

### Storage Contract

- SQLite `user_settings.video_api_key`, `user_settings.video_model`, `user_settings.video_endpoint_primary`, and `user_settings.video_endpoint_secondary` were added.
- Existing `user_settings.api_key`, `user_settings.model`, and `user_settings.endpoint` are now treated as image API Key, image model, and image address.

## 2026-06-10 - B端 user role assignment

B端 now distinguishes registered user roles. Newly registered users are ordinary `user` accounts by default; only the built-in admin credentials or registered users promoted to `admin` can create B端 admin sessions.

### B端 HTTP API

- `GET /api/admin/users` now returns `role` for each registered user.
- `PATCH /api/admin/users/:id` now accepts `role: "user" | "admin"` to revoke or grant B端 administrator access.
- `POST /api/admin/login` still accepts the built-in `ADMIN_EMAIL` / `ADMIN_PASSWORD`; it also accepts registered users whose `role` is `admin`.
- Registered ordinary users remain limited to C端 user sessions and cannot access `/api/admin/*`.

### Storage Contract

- SQLite `users.role` was added with default `user`.

## 2026-06-10 - B端 login route split

B端 login is now a dedicated page. `admin.html` is only the authenticated management console, while `admin-login.html` owns the administrator login form.

### B端 UI

- `admin-login.html` was added as the standalone administrator login entry.
- `admin.html` redirects unauthenticated or expired sessions to `admin-login.html`.
- Logging out from `admin.html` clears the admin token and returns to `admin-login.html`.

## 2026-06-10 - B端 prompt preset configuration

B端 can now manage the prompt presets and prompt composition copy used by C端 image generation. The edit surface is stable-scope: administrators can edit titles, display labels, prompt text, composition text, suite shot descriptions, and recommended sizes, while structural IDs remain fixed.

### C端 HTTP API

- `GET /api/settings` now includes `promptConfig`, which C端 uses for single-image templates, suite prompts, refinement prompts, reference-image guardrails, and reference-input probe prompts.

### B端 HTTP API

- `GET /api/admin/prompt-config` was added. It returns the normalized global prompt configuration.
- `PUT /api/admin/prompt-config` was added. It accepts `{ "promptConfig": ... }`, persists admin-editable prompt fields, locks structural IDs/categories, and rejects invalid image size strings.

### Storage Contract

- Global prompt configuration is stored in SQLite `app_settings` under `prompt_config_json`.
- Built-in defaults are seeded from `prompt-config-defaults.json` and remain the fallback when the stored JSON is missing or invalid.

## 2026-06-10 - B端 user API Key ownership and backend generation proxy

C端 no longer receives or edits the real model API Key, endpoint, or model. B端 configures each registered user's API Key, and image generation calls are proxied through the backend with the user's stored key plus the B端 default endpoint/model.

### C端 HTTP API

- `GET /api/settings` now returns `apiKeyConfigured` and `apiKeyMasked`; it no longer returns the real `apiKey`.
- `PUT /api/settings` is compatibility-only for C端 size preference and ignores client-supplied `apiKey`, `endpoint`, and `model`.
- `POST /api/generate` was added. The request body accepts `prompt`, `count`, `size`, and optional `referenceImages`. It requires a logged-in user with a B端 configured API Key and returns generated images plus a sanitized request snapshot.
- `POST /api/generation-logs` remains for compatibility, but normal C端 generation logging is now written by the backend proxy.

### B端 HTTP API

- `GET /api/admin/users` now returns `apiKeyMasked` in addition to `apiKeyConfigured`.
- `PATCH /api/admin/users/:id` now supports `apiKey` to save a user's model API Key and `clearApiKey: true` to clear it. `disabled` remains a partial update field.

### C端 UI

- The model config modal shows a read-only masked API Key status and a read-only model field.
- The API Key reveal button, endpoint address field, and C端 save-config action were removed.

### Storage Contract

- User API Keys remain stored in `user_settings.api_key` and are never returned to C端 as plaintext.
- Backend generation logs store sanitized model request/response JSON and do not store API Keys.

## 2026-06-10 - Account-gated C端 and B端 admin console

The app introduced C端 registration/login and a B端 admin page for user management, model defaults, and generation input/output logs. The newer section above supersedes the original C端 self-configured API Key behavior. There is still no package, recharge, or quota deduction flow.

### C端 HTTP API

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/generation-logs`
- `POST /api/image-feedback`

### B端 HTTP API

- `POST /api/admin/login`
- `GET /api/admin/me`
- `GET /api/admin/summary`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id`
- `GET /api/admin/logs`
- `GET /api/admin/feedback`
- `GET /api/admin/downvotes`
- `GET /api/admin/model-config`
- `PUT /api/admin/model-config`

### C端 UI

- Left navigation keeps the reserved `AI视频` entry with a placeholder `view-video` workspace.

### Environment Variables

- `HOST`
- `PORT`
- `IMAGE_STUDIO_STORAGE`
- `IMAGE_STUDIO_DB`
- `SESSION_DAYS`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

### Storage Contract

- SQLite database defaults to `storage/image_studio.sqlite`.
- C端 local folders and image assets remain in browser IndexedDB.
- User API Keys are stored per registered user and are not exposed on the B端 user table.
- Generation logs store sanitized request/response JSON plus call count, image count, duration, and token usage.
