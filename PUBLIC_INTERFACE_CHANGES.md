# Public Interface Changes

## 2026-06-10 - Account-gated C端 and B端 admin console

The app now requires C端 users to register/login before configuring their own model API Key. A B端 admin page was added for user management, model defaults, and generation input/output logs. There is still no package, recharge, or quota deduction flow.

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
