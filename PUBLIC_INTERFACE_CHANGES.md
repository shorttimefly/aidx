# Public Interface Changes

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
