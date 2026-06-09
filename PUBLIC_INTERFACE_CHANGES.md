# Public Interface Changes

## 2026-06-09 - Initial SaaS import

Initial public contract for the AI image editor SaaS prototype.

### HTTP API

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/folders`
- `POST /api/folders`
- `GET /api/assets`
- `POST /api/assets`
- `PATCH /api/assets/:id`
- `DELETE /api/assets/:id`
- `GET /api/generations`
- `POST /api/generate`
- `GET /api/billing/plans`
- `POST /api/billing/checkout`
- `POST /api/billing/mock-pay/:id`

### Environment Variables

- `HOST`
- `PORT`
- `IMAGE_API_KEY`
- `IMAGE_API_ENDPOINT`
- `IMAGE_API_MODEL`
- `IMAGE_STUDIO_STORAGE`
- `IMAGE_STUDIO_DB`
- `FREE_QUOTA_CREDITS`
- `CREDITS_PER_IMAGE`
- `SESSION_DAYS`
- `CORS_ORIGIN`
- `MOCK_BILLING_AUTOGRANT`
- `ALLOW_CLIENT_IMAGE_CONFIG`

### Storage Contract

- SQLite database defaults to `storage/image_studio.sqlite`.
- Media files default to `storage/media`.
- `storage/` is intentionally git-ignored.
