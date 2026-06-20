import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

import server


class UsernameAuthSchemaTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temp_dir.cleanup)
        self.original_storage_dir = server.STORAGE_DIR
        self.original_db_path = server.DB_PATH
        self.addCleanup(lambda: setattr(server, "STORAGE_DIR", self.original_storage_dir))
        self.addCleanup(lambda: setattr(server, "DB_PATH", self.original_db_path))
        server.STORAGE_DIR = Path(self.temp_dir.name)
        server.DB_PATH = server.STORAGE_DIR / "image_studio.sqlite"

    def test_init_db_migrates_legacy_unique_email_schema(self):
        salt, password_hash = server.hash_password("password123")
        with server.connect() as conn:
            conn.execute(
                """
                CREATE TABLE users (
                  id TEXT PRIMARY KEY,
                  email TEXT NOT NULL UNIQUE,
                  name TEXT NOT NULL,
                  password_salt TEXT NOT NULL,
                  password_hash TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  last_login_at TEXT
                )
                """
            )
            conn.execute(
                """
                INSERT INTO users (id, email, name, password_salt, password_hash, created_at, last_login_at)
                VALUES ('legacy_user', 'legacy@example.com', 'LegacyUser', ?, ?, ?, ?)
                """,
                (salt, password_hash, server.now_iso(), server.now_iso()),
            )

        server.init_db()

        with server.connect() as conn:
            for name in ("BlankEmailOne", "BlankEmailTwo"):
                salt, password_hash = server.hash_password("password123")
                conn.execute(
                    """
                    INSERT INTO users
                      (id, email, name, password_salt, password_hash, disabled, role, source, referrer,
                       utm_source, utm_medium, utm_campaign, source_path, created_at, last_login_at)
                    VALUES (?, '', ?, ?, ?, 0, 'user', 'direct', '', '', '', '', '', ?, ?)
                    """,
                    (server.make_id("user"), name, salt, password_hash, server.now_iso(), server.now_iso()),
                )
            count = conn.execute("SELECT COUNT(*) AS count FROM users WHERE email=''").fetchone()["count"]

        self.assertEqual(count, 2)

    def test_init_db_migrates_builtin_model_endpoint_to_model_placeholder(self):
        server.init_db()
        salt, password_hash = server.hash_password("password123")
        with server.connect() as conn:
            conn.execute(
                "UPDATE app_settings SET value=? WHERE key='default_endpoint'",
                (server.OLD_DEFAULT_ENDPOINT,),
            )
            conn.execute(
                """
                INSERT INTO users
                  (id, email, name, password_salt, password_hash, disabled, role, source, referrer,
                   utm_source, utm_medium, utm_campaign, source_path, created_at, last_login_at)
                VALUES ('legacy_user', '', 'LegacyUser', ?, ?, 0, 'user', 'direct', '', '', '', '', '', ?, ?)
                """,
                (salt, password_hash, server.now_iso(), server.now_iso()),
            )
            conn.execute(
                """
                INSERT INTO user_settings (user_id, api_key, endpoint, model, size, updated_at)
                VALUES ('legacy_user', '', ?, 'gemini-2.5-flash-image', '1024x1024', ?)
                """,
                (server.OLD_DEFAULT_ENDPOINT, server.now_iso()),
            )

        server.init_db()

        with server.connect() as conn:
            endpoint = conn.execute(
                "SELECT value FROM app_settings WHERE key='default_endpoint'"
            ).fetchone()["value"]
            user_endpoint = conn.execute(
                "SELECT endpoint FROM user_settings WHERE user_id='legacy_user'"
            ).fetchone()["endpoint"]

        self.assertEqual(endpoint, server.DEFAULT_ENDPOINT)
        self.assertEqual(user_endpoint, server.DEFAULT_ENDPOINT)

    def test_init_db_migrates_preview_image_model_to_available_model(self):
        server.init_db()
        salt, password_hash = server.hash_password("password123")
        with server.connect() as conn:
            conn.execute(
                "UPDATE app_settings SET value=? WHERE key='default_endpoint'",
                (server.OLD_GEMINI3_PREVIEW_ENDPOINT,),
            )
            conn.execute(
                "UPDATE app_settings SET value=? WHERE key='default_model'",
                (server.OLD_GEMINI3_PREVIEW_MODEL,),
            )
            conn.execute(
                """
                INSERT INTO users
                  (id, email, name, password_salt, password_hash, disabled, role, source, referrer,
                   utm_source, utm_medium, utm_campaign, source_path, created_at, last_login_at)
                VALUES ('preview_user', '', 'PreviewUser', ?, ?, 0, 'user', 'direct', '', '', '', '', '', ?, ?)
                """,
                (salt, password_hash, server.now_iso(), server.now_iso()),
            )
            conn.execute(
                """
                INSERT INTO user_settings (user_id, api_key, endpoint, model, size, updated_at)
                VALUES ('preview_user', '', ?, ?, '1024x1024', ?)
                """,
                (server.OLD_GEMINI3_PREVIEW_ENDPOINT, server.OLD_GEMINI3_PREVIEW_MODEL, server.now_iso()),
            )

        server.init_db()

        with server.connect() as conn:
            settings = {
                row["key"]: row["value"]
                for row in conn.execute(
                    "SELECT key, value FROM app_settings WHERE key IN ('default_endpoint', 'default_model')"
                ).fetchall()
            }
            user_settings = conn.execute(
                "SELECT endpoint, model FROM user_settings WHERE user_id='preview_user'"
            ).fetchone()

        self.assertEqual(settings["default_endpoint"], server.DEFAULT_ENDPOINT)
        self.assertEqual(settings["default_model"], server.GEMINI3_IMAGE_MODEL)
        self.assertEqual(user_settings["endpoint"], server.DEFAULT_ENDPOINT)
        self.assertEqual(user_settings["model"], server.GEMINI3_IMAGE_MODEL)

    def test_init_db_creates_model_provider_tables_without_changing_legacy_settings(self):
        server.init_db()

        with server.connect() as conn:
            tables = {
                row["name"]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?, ?, ?)",
                    ("model_providers", "provider_models", "user_model_access", "user_settings"),
                ).fetchall()
            }
            user_settings_columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(user_settings)").fetchall()
            }
            provider_columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(model_providers)").fetchall()
            }
            model_columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(provider_models)").fetchall()
            }
            access_columns = {
                row["name"] for row in conn.execute("PRAGMA table_info(user_model_access)").fetchall()
            }

        self.assertEqual(
            tables,
            {"model_providers", "provider_models", "user_model_access", "user_settings"},
        )
        self.assertGreaterEqual(
            user_settings_columns,
            {"user_id", "api_key", "endpoint", "model", "video_api_key", "size", "updated_at"},
        )
        self.assertGreaterEqual(
            provider_columns,
            {"id", "name", "provider_type", "base_url", "api_key", "enabled", "created_at", "updated_at"},
        )
        self.assertGreaterEqual(
            model_columns,
            {"id", "provider_id", "model_name", "model_kind", "priority", "enabled", "created_at", "updated_at"},
        )
        self.assertGreaterEqual(access_columns, {"user_id", "provider_model_id", "enabled", "created_at"})

    def test_call_upstream_model_wraps_low_level_connection_errors(self):
        with mock.patch("urllib.request.urlopen", side_effect=ConnectionResetError("connection reset")):
            with self.assertRaises(server.UpstreamError) as caught:
                server.call_upstream_model(
                    "https://image.example.com/v1/generate",
                    "test-key",
                    {"contents": [{"role": "user", "parts": [{"text": "test"}]}]},
                )

        self.assertEqual(caught.exception.status, 502)
        self.assertIn("connection reset", caught.exception.message)

    def test_upstream_model_default_timeout_waits_five_minutes(self):
        self.assertEqual(server.UPSTREAM_TIMEOUT_SECONDS, 300)

    def test_call_upstream_model_wraps_curl_timeout_errors(self):
        with mock.patch("server.should_use_curl_transport", return_value=True):
            with mock.patch(
                "server.call_upstream_model_curl",
                side_effect=server.subprocess.TimeoutExpired("curl", server.UPSTREAM_TIMEOUT_SECONDS),
            ):
                with self.assertRaises(server.UpstreamError) as caught:
                    server.call_upstream_model(
                        "https://aokapi.com/v1beta/models/gemini-2.5-flash-image:generateContent/",
                        "test-key",
                        {"contents": [{"role": "user", "parts": [{"text": "test"}]}]},
                    )

        self.assertEqual(caught.exception.status, 504)
        self.assertIn("超时", caught.exception.message)


class AdminRoleTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temp_dir.cleanup)
        self.original_storage_dir = server.STORAGE_DIR
        self.original_db_path = server.DB_PATH
        self.original_admin_email = server.ADMIN_EMAIL
        self.original_admin_password = server.ADMIN_PASSWORD
        self.addCleanup(self.restore_globals)
        server.STORAGE_DIR = Path(self.temp_dir.name)
        server.DB_PATH = server.STORAGE_DIR / "image_studio.sqlite"
        server.ADMIN_EMAIL = "admin@example.com"
        server.ADMIN_PASSWORD = "change-me"
        server.init_db()

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.addCleanup(self.stop_server)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def restore_globals(self):
        server.STORAGE_DIR = self.original_storage_dir
        server.DB_PATH = self.original_db_path
        server.ADMIN_EMAIL = self.original_admin_email
        server.ADMIN_PASSWORD = self.original_admin_password

    def stop_server(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)

    def request(self, method, path, body=None, token=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(f"{self.base_url}{path}", data=data, method=method)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                payload = json.loads(resp.read().decode("utf-8") or "{}")
                return resp.status, payload
        except urllib.error.HTTPError as error:
            payload = json.loads(error.read().decode("utf-8") or "{}")
            return error.code, payload

    def register_user(self, name="User"):
        status, payload = self.request(
            "POST",
            "/api/auth/register",
            {"name": name, "password": "password123"},
        )
        self.assertEqual(status, 200)
        return payload

    def builtin_admin_token(self):
        status, payload = self.request(
            "POST",
            "/api/admin/login",
            {"email": "admin@example.com", "password": "change-me"},
        )
        self.assertEqual(status, 200)
        return payload["token"]

    def save_model_providers(self, admin_token):
        status, _ = self.request(
            "PUT",
            "/api/admin/model-config",
            {
                "defaultEndpoint": "https://legacy.example.com/v1/images",
                "defaultModel": "legacy-image-model",
                "usageNote": "provider routing test",
                "modelProviders": [
                    {
                        "name": "Muskapis",
                        "providerType": "muskapis_image",
                        "baseUrl": "https://api.muskapis.com/v1",
                        "apiKey": "musk-secret-key",
                        "enabled": True,
                        "models": [
                            {"modelName": "musk-first", "modelKind": "image", "priority": 5, "enabled": True},
                            {"modelName": "musk-disabled", "modelKind": "image", "priority": 50, "enabled": False},
                            {"modelName": "musk-video", "modelKind": "video", "priority": 60, "enabled": True},
                        ],
                    },
                    {
                        "name": "OpenAI Compatible",
                        "providerType": "openai_image",
                        "baseUrl": "https://compatible.example.com/v1",
                        "apiKey": "openai-secret-key",
                        "enabled": True,
                        "models": [
                            {"modelName": "stable-success", "modelKind": "image", "priority": 10, "enabled": True},
                        ],
                    },
                ],
            },
            token=admin_token,
        )
        self.assertEqual(status, 200)
        status, payload = self.request("GET", "/api/admin/model-config", token=admin_token)
        self.assertEqual(status, 200)
        return payload["modelConfig"]["modelProviders"]

    def test_registered_user_defaults_to_user_and_cannot_access_admin(self):
        payload = self.register_user()
        self.assertEqual(payload["user"]["role"], "user")

        status, _ = self.request("GET", "/api/admin/me", token=payload["token"])
        self.assertEqual(status, 401)

        status, error = self.request(
            "POST",
            "/api/admin/login",
            {"name": "User", "password": "password123"},
        )
        self.assertEqual(status, 403)
        self.assertIn("管理员权限", error["error"])

    def test_c端_register_and_login_with_username_without_email(self):
        payload = self.register_user("User")
        self.assertEqual(payload["user"]["email"], "")

        status, second_payload = self.request(
            "POST",
            "/api/auth/register",
            {"name": "SecondUser", "password": "password123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(second_payload["user"]["email"], "")

        status, login_payload = self.request(
            "POST",
            "/api/auth/login",
            {"name": "User", "password": "password123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(login_payload["user"]["name"], "User")
        self.assertEqual(login_payload["user"]["email"], "")

        status, error = self.request(
            "POST",
            "/api/auth/register",
            {"name": "User", "password": "password123"},
        )
        self.assertEqual(status, 409)
        self.assertIn("用户名已注册", error["error"])

    def test_username_auth_mode_rejects_email_like_registration(self):
        status, error = self.request(
            "POST",
            "/api/auth/register",
            {"authType": "username", "name": "legacy@example.com", "password": "password123"},
        )
        self.assertEqual(status, 400)
        self.assertIn("请选择邮箱", error["error"])

        with server.connect() as conn:
            user = conn.execute("SELECT id FROM users WHERE name='legacy@example.com'").fetchone()
        self.assertIsNone(user)

    def test_c端_email_auth_mode_uses_email_field_and_prevents_duplicate_email_registration(self):
        status, payload = self.request(
            "POST",
            "/api/auth/register",
            {"authType": "email", "email": "legacy@example.com", "password": "password123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["user"]["email"], "legacy@example.com")
        self.assertEqual(payload["user"]["name"], "legacy")

        status, login_payload = self.request(
            "POST",
            "/api/auth/login",
            {"authType": "email", "email": "legacy@example.com", "password": "password123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(login_payload["user"]["email"], "legacy@example.com")

        status, compatibility_login = self.request(
            "POST",
            "/api/auth/login",
            {"name": "legacy@example.com", "password": "password123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(compatibility_login["user"]["email"], "legacy@example.com")

        status, error = self.request(
            "POST",
            "/api/auth/register",
            {"authType": "email", "email": "legacy@example.com", "password": "password123"},
        )
        self.assertEqual(status, 409)
        self.assertIn("邮箱已注册", error["error"])

    def test_builtin_admin_can_promote_registered_user_to_admin(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()

        status, _ = self.request(
            "PATCH",
            f"/api/admin/users/{user_payload['user']['id']}",
            {"role": "admin"},
            token=admin_token,
        )
        self.assertEqual(status, 200)

        status, users_payload = self.request("GET", "/api/admin/users", token=admin_token)
        self.assertEqual(status, 200)
        listed_user = next(user for user in users_payload["users"] if user["id"] == user_payload["user"]["id"])
        self.assertEqual(listed_user["role"], "admin")

        status, promoted_login = self.request(
            "POST",
            "/api/admin/login",
            {"name": "User", "password": "password123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(promoted_login["admin"]["source"], "user")

        status, me_payload = self.request("GET", "/api/admin/me", token=promoted_login["token"])
        self.assertEqual(status, 200)
        self.assertEqual(me_payload["admin"]["name"], "User")
        self.assertEqual(me_payload["admin"]["email"], "")

    def test_admin_can_save_model_providers_and_tokens_are_masked(self):
        admin_token = self.builtin_admin_token()

        providers = self.save_model_providers(admin_token)

        self.assertEqual([provider["name"] for provider in providers], ["Muskapis", "OpenAI Compatible"])
        self.assertEqual(providers[0]["providerType"], "muskapis_image")
        self.assertEqual(providers[0]["baseUrl"], "https://api.muskapis.com/v1")
        self.assertTrue(providers[0]["apiKeyConfigured"])
        self.assertNotIn("musk-secret-key", json.dumps(providers, ensure_ascii=False))
        self.assertNotIn("apiKey", providers[0])
        self.assertEqual(providers[0]["models"][0]["modelName"], "musk-first")
        self.assertEqual(providers[0]["models"][0]["modelKind"], "image")
        self.assertEqual(providers[0]["models"][0]["priority"], 5)
        self.assertFalse(providers[0]["models"][1]["enabled"])
        self.assertEqual(providers[0]["models"][2]["modelName"], "musk-video")
        self.assertEqual(providers[0]["models"][2]["modelKind"], "video")

    def test_admin_can_save_muskapis_gpt55_text_understanding_model(self):
        admin_token = self.builtin_admin_token()

        status, _ = self.request(
            "PUT",
            "/api/admin/model-config",
            {
                "modelProviders": [
                    {
                        "name": "Muskapis GPT",
                        "providerType": "openai_image",
                        "baseUrl": "https://api.muskapis.com/v1",
                        "apiKey": "text-secret-key",
                        "enabled": True,
                        "models": [
                            {"modelName": "gpt-5.5", "modelKind": "text", "priority": 5, "enabled": True},
                        ],
                    }
                ],
            },
            token=admin_token,
        )
        self.assertEqual(status, 200)
        status, payload = self.request("GET", "/api/admin/model-config", token=admin_token)
        self.assertEqual(status, 200)
        providers = payload["modelConfig"]["modelProviders"]

        self.assertEqual(providers[0]["baseUrl"], "https://api.muskapis.com/v1")
        self.assertEqual(providers[0]["models"][0]["modelName"], "gpt-5.5")
        self.assertEqual(providers[0]["models"][0]["modelKind"], "text")

    def test_admin_can_set_default_provider_model_for_c端_generation(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        providers = self.save_model_providers(admin_token)
        default_model_id = providers[1]["models"][0]["id"]

        status, _ = self.request(
            "PUT",
            "/api/admin/model-config",
            {
                "defaultEndpoint": "https://legacy.example.com/v1/images",
                "defaultModel": "legacy-image-model",
                "usageNote": "provider routing test",
                "defaultImageModelId": default_model_id,
                "modelProviders": providers,
            },
            token=admin_token,
        )
        self.assertEqual(status, 200)
        status, config_payload = self.request("GET", "/api/admin/model-config", token=admin_token)
        self.assertEqual(status, 200)
        self.assertEqual(config_payload["modelConfig"]["defaultImageModelId"], default_model_id)

        upstream_payload = {"data": [{"b64_json": "aW1hZ2U="}]}
        with mock.patch("server.call_upstream_model", return_value=upstream_payload) as call_model:
            status, payload = self.request(
                "POST",
                "/api/generate",
                {"templateId": "amazon-aplus-3c-digital-accessories-brand-story", "count": 1, "size": "1024x1024"},
                token=user_payload["token"],
            )

        self.assertEqual(status, 200)
        endpoint, api_key, request_body = call_model.call_args.args
        self.assertEqual(endpoint, "https://compatible.example.com/v1/images/generations")
        self.assertEqual(api_key, "openai-secret-key")
        self.assertEqual(request_body["model"], "stable-success")
        self.assertEqual(payload["model"], "stable-success")
        self.assertEqual(payload["provider"]["modelId"], default_model_id)

    def test_admin_defaults_are_separated_by_model_kind(self):
        admin_token = self.builtin_admin_token()
        providers = self.save_model_providers(admin_token)
        image_model_id = providers[1]["models"][0]["id"]
        video_model_id = providers[0]["models"][2]["id"]

        status, _ = self.request(
            "PUT",
            "/api/admin/model-config",
            {
                "defaultImageModelId": video_model_id,
                "defaultVideoModelId": video_model_id,
                "modelProviders": providers,
            },
            token=admin_token,
        )
        self.assertEqual(status, 200)
        status, config_payload = self.request("GET", "/api/admin/model-config", token=admin_token)
        self.assertEqual(status, 200)
        self.assertEqual(config_payload["modelConfig"]["defaultImageModelId"], "")
        self.assertEqual(config_payload["modelConfig"]["defaultVideoModelId"], video_model_id)

        status, _ = self.request(
            "PUT",
            "/api/admin/model-config",
            {
                "defaultImageModelId": image_model_id,
                "defaultVideoModelId": image_model_id,
                "modelProviders": providers,
            },
            token=admin_token,
        )
        self.assertEqual(status, 200)
        status, config_payload = self.request("GET", "/api/admin/model-config", token=admin_token)
        self.assertEqual(status, 200)
        self.assertEqual(config_payload["modelConfig"]["defaultImageModelId"], image_model_id)
        self.assertEqual(config_payload["modelConfig"]["defaultVideoModelId"], "")

    def test_admin_can_assign_provider_models_to_user_without_changing_legacy_key(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        providers = self.save_model_providers(admin_token)
        allowed_ids = [providers[0]["models"][0]["id"], providers[1]["models"][0]["id"]]

        status, _ = self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {
                "imageApiKey": "legacy-secret-key",
                "imageEndpoint": "https://legacy.example.com/v1/images",
                "imageModel": "legacy-image-model",
            },
            token=admin_token,
        )
        self.assertEqual(status, 200)
        status, _ = self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {"allowedImageModelIds": allowed_ids},
            token=admin_token,
        )
        self.assertEqual(status, 200)

        status, users_payload = self.request("GET", "/api/admin/users", token=admin_token)
        self.assertEqual(status, 200)
        listed_user = next(user for user in users_payload["users"] if user["id"] == user_id)
        self.assertEqual(
            [model["id"] for model in listed_user["allowedImageModels"]],
            allowed_ids,
        )
        self.assertEqual(listed_user["allowedImageModels"][0]["providerName"], "Muskapis")
        self.assertEqual(listed_user["allowedImageModels"][0]["providerType"], "muskapis_image")
        self.assertEqual(listed_user["allowedImageModels"][0]["modelName"], "musk-first")
        self.assertTrue(listed_user["imageApiKeyConfigured"])
        self.assertEqual(listed_user["imageModel"], "legacy-image-model")
        self.assertNotIn("legacy-secret-key", json.dumps(listed_user, ensure_ascii=False))
        self.assertNotIn("musk-secret-key", json.dumps(listed_user, ensure_ascii=False))

    def test_admin_can_assign_video_models_without_replacing_image_models(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        providers = self.save_model_providers(admin_token)
        image_model_id = providers[0]["models"][0]["id"]
        video_model_id = providers[0]["models"][2]["id"]

        status, _ = self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {"allowedImageModelIds": [image_model_id]},
            token=admin_token,
        )
        self.assertEqual(status, 200)
        status, _ = self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {"allowedVideoModelIds": [video_model_id]},
            token=admin_token,
        )
        self.assertEqual(status, 200)

        status, users_payload = self.request("GET", "/api/admin/users", token=admin_token)
        self.assertEqual(status, 200)
        listed_user = next(user for user in users_payload["users"] if user["id"] == user_id)
        self.assertEqual([model["id"] for model in listed_user["allowedImageModels"]], [image_model_id])
        self.assertEqual([model["id"] for model in listed_user["allowedVideoModels"]], [video_model_id])
        self.assertEqual(listed_user["allowedVideoModels"][0]["modelKind"], "video")

    def test_settings_do_not_report_default_ready_when_assigned_models_are_unusable(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        providers = self.save_model_providers(admin_token)
        default_image_id = providers[1]["models"][0]["id"]
        disabled_image_id = providers[0]["models"][1]["id"]
        status, _ = self.request(
            "PUT",
            "/api/admin/model-config",
            {
                "defaultImageModelId": default_image_id,
                "modelProviders": providers,
            },
            token=admin_token,
        )
        self.assertEqual(status, 200)
        status, _ = self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {"allowedImageModelIds": [disabled_image_id]},
            token=admin_token,
        )
        self.assertEqual(status, 200)

        status, settings_payload = self.request("GET", "/api/settings", token=user_payload["token"])
        self.assertEqual(status, 200)
        settings = settings_payload["settings"]
        self.assertFalse(settings["imageApiKeyConfigured"])
        self.assertFalse(settings["apiKeyConfigured"])
        self.assertEqual([model["id"] for model in settings["availableImageModels"]], [disabled_image_id])

        with mock.patch("server.call_upstream_model") as call_model:
            status, error = self.request(
                "POST",
                "/api/generate",
                {"templateId": "main-white", "count": 1, "size": "1024x1024"},
                token=user_payload["token"],
            )
        self.assertEqual(status, 403)
        self.assertIn("可用图片模型", error["error"])
        call_model.assert_not_called()

    def test_admin_can_configure_image_and_video_keys(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]

        status, _ = self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {
                "imageApiKey": "image-secret-key",
                "imageEndpoint": "https://image.example.com/v1/generate",
                "imageModel": "gemini-3-pro-image",
                "videoApiKey": "video-secret-key",
                "videoModel": "veo-3-fast",
                "videoEndpointPrimary": "https://video.example.com/v1/jobs",
                "videoEndpointSecondary": "https://video.example.com/v1/status",
            },
            token=admin_token,
        )
        self.assertEqual(status, 200)

        status, users_payload = self.request("GET", "/api/admin/users", token=admin_token)
        self.assertEqual(status, 200)
        listed_user = next(user for user in users_payload["users"] if user["id"] == user_id)
        self.assertTrue(listed_user["imageApiKeyConfigured"])
        self.assertTrue(listed_user["videoApiKeyConfigured"])
        self.assertEqual(listed_user["imageEndpoint"], "https://image.example.com/v1/generate")
        self.assertEqual(listed_user["imageModel"], "gemini-3-pro-image")
        self.assertEqual(listed_user["videoModel"], "veo-3-fast")
        self.assertEqual(listed_user["videoEndpointPrimary"], "https://video.example.com/v1/jobs")
        self.assertEqual(listed_user["videoEndpointSecondary"], "https://video.example.com/v1/status")
        self.assertNotIn("secret", listed_user["imageApiKeyMasked"])
        self.assertNotIn("secret", listed_user["videoApiKeyMasked"])

        status, settings_payload = self.request("GET", "/api/settings", token=user_payload["token"])
        self.assertEqual(status, 200)
        self.assertTrue(settings_payload["settings"]["imageApiKeyConfigured"])
        self.assertTrue(settings_payload["settings"]["apiKeyConfigured"])
        self.assertTrue(settings_payload["settings"]["videoApiKeyConfigured"])
        self.assertNotIn("secret", settings_payload["settings"]["imageApiKeyMasked"])
        self.assertNotIn("secret", settings_payload["settings"]["videoApiKeyMasked"])
        self.assertEqual(settings_payload["settings"]["endpoint"], "https://image.example.com/v1/generate")
        self.assertEqual(settings_payload["settings"]["model"], "gemini-3-pro-image")
        self.assertEqual(settings_payload["settings"]["imageEndpoint"], "https://image.example.com/v1/generate")
        self.assertEqual(settings_payload["settings"]["imageModel"], "gemini-3-pro-image")
        self.assertEqual(settings_payload["settings"]["videoModel"], "veo-3-fast")
        self.assertEqual(settings_payload["settings"]["videoEndpointPrimary"], "https://video.example.com/v1/jobs")
        self.assertEqual(settings_payload["settings"]["videoEndpointSecondary"], "https://video.example.com/v1/status")

    def test_c端_settings_hides_single_template_prompt_text(self):
        user_payload = self.register_user()

        status, settings_payload = self.request("GET", "/api/settings", token=user_payload["token"])
        self.assertEqual(status, 200)
        prompt_config = settings_payload["settings"]["promptConfig"]
        self.assertNotIn("custom", [item["id"] for item in prompt_config["single"]["templateCategories"]])
        self.assertNotIn("prompt", prompt_config["single"]["templates"][0])
        self.assertIn("matrix", prompt_config["single"])
        self.assertNotIn("prompt", prompt_config["single"]["matrix"]["platforms"][0]["categories"][0]["scenarios"][0])
        self.assertNotIn("prompt", prompt_config["suite"]["presets"][0]["shots"][0])
        self.assertNotIn("平台合规白底主图", json.dumps(prompt_config, ensure_ascii=False))

        status, error = self.request("GET", "/prompt-config-defaults.json")
        self.assertEqual(status, 404)
        self.assertIn("接口不存在", error["error"])

    def test_generate_with_template_id_resolves_prompt_server_side(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {
                "imageApiKey": "image-secret-key",
                "imageEndpoint": "https://image.example.com/v1/generate",
                "imageModel": "gemini-3-pro-image",
            },
            token=admin_token,
        )

        upstream_payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": "aW1hZ2U=",
                                }
                            }
                        ]
                    }
                }
            ]
        }
        with mock.patch("server.call_upstream_model", return_value=upstream_payload) as call_model:
            status, payload = self.request(
                "POST",
                "/api/generate",
                {"templateId": "main-white", "count": 1, "size": "1024x1024"},
                token=user_payload["token"],
            )

        self.assertEqual(status, 200)
        request_body = call_model.call_args.args[2]
        self.assertIn("平台合规白底主图", json.dumps(request_body, ensure_ascii=False))
        self.assertIn("图片中的所有可见文案", json.dumps(request_body, ensure_ascii=False))
        self.assertEqual(payload["request"]["body"]["templateId"], "main-white")
        self.assertNotIn("prompt", payload["request"]["body"])
        self.assertNotIn("平台合规白底主图", json.dumps(payload, ensure_ascii=False))

    def test_generate_retries_transient_upstream_overload_once(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {
                "imageApiKey": "image-secret-key",
                "imageEndpoint": "https://aokapi.com/v1beta/models/{model}:generateContent/",
                "imageModel": "gemini-3-pro-image-preview",
            },
            token=admin_token,
        )

        upstream_payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": "aW1hZ2U=",
                                }
                            }
                        ]
                    }
                }
            ]
        }
        transient_error = server.UpstreamError(
            500,
            "upstream overloaded, please retry",
            {"error": {"type": "rate_limit_error", "code": "upstream_overloaded"}},
        )
        with mock.patch("server.call_upstream_model", side_effect=[transient_error, upstream_payload]) as call_model:
            status, payload = self.request(
                "POST",
                "/api/generate",
                {"templateId": "main-white", "count": 1, "size": "1024x1024"},
                token=user_payload["token"],
            )

        self.assertEqual(status, 200)
        self.assertEqual(call_model.call_count, 2)
        self.assertEqual(payload["images"][0]["url"], "data:image/png;base64,aW1hZ2U=")

    def test_generate_uses_authorized_models_by_priority_and_falls_back(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        providers = self.save_model_providers(admin_token)
        allowed_ids = [providers[0]["models"][0]["id"], providers[1]["models"][0]["id"]]
        status, _ = self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {"allowedImageModelIds": allowed_ids},
            token=admin_token,
        )
        self.assertEqual(status, 200)

        first_error = server.UpstreamError(500, "provider down", {"error": "down"})
        upstream_payload = {"data": [{"b64_json": "aW1hZ2U="}]}
        with mock.patch("server.call_upstream_model", side_effect=[first_error, upstream_payload]) as call_model:
            status, payload = self.request(
                "POST",
                "/api/generate",
                {"templateId": "main-white", "count": 1, "size": "1024x1024"},
                token=user_payload["token"],
            )

        self.assertEqual(status, 200)
        self.assertEqual(call_model.call_count, 2)
        first_endpoint, first_key, first_body = call_model.call_args_list[0].args
        second_endpoint, second_key, second_body = call_model.call_args_list[1].args
        self.assertEqual(first_endpoint, "https://api.muskapis.com/v1/images/generations")
        self.assertEqual(first_key, "musk-secret-key")
        self.assertEqual(first_body["model"], "musk-first")
        self.assertEqual(first_body["response_format"], "b64_json")
        self.assertEqual(second_endpoint, "https://compatible.example.com/v1/images/generations")
        self.assertEqual(second_key, "openai-secret-key")
        self.assertEqual(second_body["model"], "stable-success")
        self.assertEqual(payload["model"], "stable-success")
        self.assertEqual(payload["images"][0]["url"], "data:image/png;base64,aW1hZ2U=")

        with server.connect() as conn:
            logs = conn.execute(
                "SELECT model, status FROM generation_logs WHERE user_id=? ORDER BY created_at ASC",
                (user_id,),
            ).fetchall()
        self.assertEqual(
            [(row["model"], row["status"]) for row in logs],
            [("musk-first", "failed"), ("stable-success", "completed")],
        )

    def test_generate_uses_explicit_authorized_image_model_for_single_image(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        providers = self.save_model_providers(admin_token)
        first_image_id = providers[0]["models"][0]["id"]
        selected_image_id = providers[1]["models"][0]["id"]
        status, _ = self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {"allowedImageModelIds": [first_image_id, selected_image_id]},
            token=admin_token,
        )
        self.assertEqual(status, 200)

        upstream_payload = {"data": [{"b64_json": "aW1hZ2U="}]}
        with mock.patch("server.call_upstream_model", return_value=upstream_payload) as call_model:
            status, payload = self.request(
                "POST",
                "/api/generate",
                {
                    "templateId": "main-white",
                    "count": 1,
                    "size": "1024x1024",
                    "imageModelId": selected_image_id,
                },
                token=user_payload["token"],
            )

        self.assertEqual(status, 200)
        self.assertEqual(call_model.call_count, 1)
        endpoint, api_key, request_body = call_model.call_args.args
        self.assertEqual(endpoint, "https://compatible.example.com/v1/images/generations")
        self.assertEqual(api_key, "openai-secret-key")
        self.assertEqual(request_body["model"], "stable-success")
        self.assertEqual(request_body["n"], 1)
        self.assertEqual(payload["model"], "stable-success")
        self.assertEqual(payload["provider"]["modelId"], selected_image_id)
        self.assertEqual(payload["images"][0]["url"], "data:image/png;base64,aW1hZ2U=")

    def test_generate_rejects_video_or_unauthorized_explicit_model_id(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        providers = self.save_model_providers(admin_token)
        video_model_id = providers[0]["models"][2]["id"]
        image_model_id = providers[1]["models"][0]["id"]

        with mock.patch("server.call_upstream_model") as call_model:
            status, error = self.request(
                "POST",
                "/api/generate",
                {"templateId": "main-white", "count": 1, "imageModelId": video_model_id},
                token=user_payload["token"],
            )
        self.assertEqual(status, 403)
        self.assertIn("无权使用该图片模型", error["error"])
        call_model.assert_not_called()

        with mock.patch("server.call_upstream_model") as call_model:
            status, error = self.request(
                "POST",
                "/api/generate",
                {"templateId": "main-white", "count": 1, "imageModelId": image_model_id},
                token=user_payload["token"],
            )
        self.assertEqual(status, 403)
        self.assertIn("无权使用该图片模型", error["error"])
        call_model.assert_not_called()

    def test_muskapis_provider_uses_openai_image_payload_and_bearer_auth(self):
        provider = {
            "providerType": "muskapis_image",
            "baseUrl": "https://api.muskapis.com/v1",
        }

        endpoint = server.resolve_provider_image_endpoint(provider, "musk-image")
        body, strategy = server.build_provider_image_request_body(
            prompt="make a product photo",
            count=2,
            size="1024x1024",
            model="musk-image",
            endpoint=endpoint,
            provider_type="muskapis_image",
            references=[],
        )
        images = server.extract_image_results_from_payload(
            {"data": [{"b64_json": "aW1hZ2U="}, {"url": "https://cdn.example.com/out.png"}]}
        )

        self.assertEqual(endpoint, "https://api.muskapis.com/v1/images/generations")
        self.assertEqual(strategy, "OpenAI image b64_json")
        self.assertEqual(
            body,
            {
                "model": "musk-image",
                "prompt": "make a product photo",
                "n": 2,
                "size": "1024x1024",
                "response_format": "b64_json",
            },
        )
        self.assertEqual(server.authorization_header_value("musk-token", endpoint), "Bearer musk-token")
        self.assertEqual(
            [image["url"] for image in images],
            ["data:image/png;base64,aW1hZ2U=", "https://cdn.example.com/out.png"],
        )

    def test_muskapis_provider_uses_edit_payload_when_references_are_present(self):
        provider = {
            "providerType": "muskapis_image",
            "baseUrl": "https://api.muskapis.com/v1",
        }
        references = [{"url": "data:image/png;base64,cmVm"}]

        endpoint = server.resolve_provider_image_endpoint(provider, "musk-image", references=references)
        body, strategy = server.build_provider_image_request_body(
            prompt="make a product photo",
            count=1,
            size="1024x1024",
            model="musk-image",
            endpoint=endpoint,
            provider_type="muskapis_image",
            references=references,
        )

        self.assertEqual(endpoint, "https://api.muskapis.com/v1/images/edits")
        self.assertEqual(strategy, "OpenAI image edit b64_json")
        self.assertEqual(body["image"], "data:image/png;base64,cmVm")
        self.assertNotIn("reference_images", body)

    def test_call_upstream_model_sends_openai_image_edits_as_multipart(self):
        captured = {}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self):
                return json.dumps({"data": [{"b64_json": "aW1hZ2U="}]}).encode("utf-8")

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse()

        with mock.patch("shutil.which", return_value=None):
            with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
                payload = server.call_upstream_model(
                    "https://api.muskapis.com/v1/images/edits",
                    "musk-token",
                    {
                        "model": "musk-image",
                        "prompt": "make a product photo",
                        "n": 1,
                        "size": "1024x1024",
                        "response_format": "b64_json",
                        "image": "data:image/png;base64,cmVm",
                    },
                )

        request = captured["request"]
        self.assertEqual(payload["data"][0]["b64_json"], "aW1hZ2U=")
        self.assertIn("multipart/form-data; boundary=", request.headers["Content-type"])
        self.assertEqual(request.headers["Authorization"], "Bearer musk-token")
        request_body = request.data.decode("latin1")
        self.assertIn('name="model"', request_body)
        self.assertIn('name="image"; filename="reference.png"', request_body)
        self.assertIn("Content-Type: image/png", request_body)

    def test_call_upstream_model_prefers_curl_for_openai_image_edits(self):
        captured = {}

        def fake_run(args, input, stdout, stderr, timeout, check):
            captured["args"] = args
            captured["config"] = input.decode("utf-8")
            return mock.Mock(
                returncode=0,
                stdout=b'{"data":[{"b64_json":"aW1hZ2U="}]}\n__AIDX_HTTP_STATUS__:200',
                stderr=b"",
            )

        with mock.patch("shutil.which", return_value="/usr/bin/curl"):
            with mock.patch("subprocess.run", side_effect=fake_run):
                payload = server.call_upstream_model(
                    "https://api.muskapis.com/v1/images/edits",
                    "musk-token",
                    {
                        "model": "musk-image",
                        "prompt": "make a product photo",
                        "n": 1,
                        "size": "1024x1024",
                        "response_format": "b64_json",
                        "image": "data:image/png;base64,cmVm",
                    },
                )

        self.assertEqual(payload["data"][0]["b64_json"], "aW1hZ2U=")
        self.assertEqual(captured["args"], ["curl", "--config", "-"])
        self.assertIn('header = "Authorization: Bearer musk-token"', captured["config"])
        self.assertIn('form-string = "model=musk-image"', captured["config"])
        self.assertIn('form = "image=@', captured["config"])
        self.assertIn(";type=image/png;filename=reference.png", captured["config"])

    def test_call_upstream_model_wraps_curl_timeout_for_openai_image_edits(self):
        with mock.patch("shutil.which", return_value="/usr/bin/curl"):
            with mock.patch(
                "subprocess.run",
                side_effect=server.subprocess.TimeoutExpired("curl", server.UPSTREAM_TIMEOUT_SECONDS),
            ):
                with self.assertRaises(server.UpstreamError) as caught:
                    server.call_upstream_model(
                        "https://api.muskapis.com/v1/images/edits",
                        "musk-token",
                        {
                            "model": "musk-image",
                            "prompt": "make a product photo",
                            "n": 1,
                            "size": "1024x1024",
                            "response_format": "b64_json",
                            "image": "data:image/png;base64,cmVm",
                        },
                    )

        self.assertEqual(caught.exception.status, 504)
        self.assertIn("超时", caught.exception.message)

    def test_generate_retries_transient_upstream_image_upload_disconnect_once(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {
                "imageApiKey": "image-secret-key",
                "imageEndpoint": "https://aokapi.com/v1beta/models/{model}:generateContent/",
                "imageModel": "gemini-3-pro-image-preview",
            },
            token=admin_token,
        )

        upstream_payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": "aW1hZ2U=",
                                }
                            }
                        ]
                    }
                }
            ]
        }
        transient_error = server.UpstreamError(
            500,
            "upload image failed: 503 upstream connect error or disconnect/reset before headers. "
            "reset reason: connection termination (status=503)",
            {"error": {"type": "server_error", "code": "network_proxy_dns"}},
        )
        with mock.patch("server.call_upstream_model", side_effect=[transient_error, upstream_payload]) as call_model:
            status, payload = self.request(
                "POST",
                "/api/generate",
                {
                    "templateId": "main-white",
                    "count": 1,
                    "size": "1024x1024",
                    "referenceImages": [
                        {
                            "name": "ref",
                            "size": "1600x1600",
                            "url": "data:image/jpeg;base64,aW1hZ2U=",
                        }
                    ],
                },
                token=user_payload["token"],
            )

        self.assertEqual(status, 200)
        self.assertEqual(call_model.call_count, 2)
        self.assertEqual(payload["images"][0]["url"], "data:image/png;base64,aW1hZ2U=")

    def test_generate_persists_recoverable_assets_for_current_user_only(self):
        user_payload = self.register_user("AssetUser")
        other_payload = self.register_user("OtherUser")
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        self.request(
            "PATCH",
            f"/api/admin/users/{user_id}",
            {
                "imageApiKey": "image-secret-key",
                "imageEndpoint": "https://image.example.com/v1/generate",
                "imageModel": "gemini-3-pro-image",
            },
            token=admin_token,
        )

        upstream_payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": "aW1hZ2U=",
                                }
                            }
                        ]
                    }
                }
            ]
        }
        with mock.patch("server.call_upstream_model", return_value=upstream_payload):
            status, payload = self.request(
                "POST",
                "/api/generate",
                {"templateId": "main-white", "count": 1, "size": "1024x1024"},
                token=user_payload["token"],
            )

        self.assertEqual(status, 200)
        remote_asset_id = payload["images"][0]["remoteAssetId"]
        self.assertTrue(remote_asset_id.startswith("asset_"))

        status, asset_payload = self.request("GET", "/api/generated-assets", token=user_payload["token"])
        self.assertEqual(status, 200)
        self.assertEqual(len(asset_payload["assets"]), 1)
        asset = asset_payload["assets"][0]
        self.assertEqual(asset["id"], remote_asset_id)
        self.assertEqual(asset["url"], "data:image/png;base64,aW1hZ2U=")
        self.assertEqual(asset["prompt"], "模板：main-white")
        self.assertNotIn("平台合规白底主图", json.dumps(asset, ensure_ascii=False))

        status, other_assets = self.request("GET", "/api/generated-assets", token=other_payload["token"])
        self.assertEqual(status, 200)
        self.assertEqual(other_assets["assets"], [])

    def test_demoting_admin_user_revokes_admin_sessions(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        self.request("PATCH", f"/api/admin/users/{user_id}", {"role": "admin"}, token=admin_token)
        status, promoted_login = self.request(
            "POST",
            "/api/admin/login",
            {"name": "User", "password": "password123"},
        )
        self.assertEqual(status, 200)

        status, _ = self.request("PATCH", f"/api/admin/users/{user_id}", {"role": "user"}, token=admin_token)
        self.assertEqual(status, 200)

        status, error = self.request("GET", "/api/admin/me", token=promoted_login["token"])
        self.assertEqual(status, 401)
        self.assertIn("登录已失效", error["error"])

        status, error = self.request(
            "POST",
            "/api/admin/login",
            {"name": "User", "password": "password123"},
        )
        self.assertEqual(status, 403)
        self.assertIn("管理员权限", error["error"])


if __name__ == "__main__":
    unittest.main()
