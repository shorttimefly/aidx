import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import server


class UsernameAuthSchemaTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
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


class AdminRoleTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
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
        self.assertEqual(settings_payload["settings"]["endpoint"], "https://image.example.com/v1/generate")
        self.assertEqual(settings_payload["settings"]["model"], "gemini-3-pro-image")

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
