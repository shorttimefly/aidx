import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import server


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

    def register_user(self, email="user@example.com"):
        status, payload = self.request(
            "POST",
            "/api/auth/register",
            {"email": email, "name": "User", "password": "password123"},
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
            {"email": "user@example.com", "password": "password123"},
        )
        self.assertEqual(status, 403)
        self.assertIn("管理员权限", error["error"])

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
            {"email": "user@example.com", "password": "password123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(promoted_login["admin"]["source"], "user")

        status, me_payload = self.request("GET", "/api/admin/me", token=promoted_login["token"])
        self.assertEqual(status, 200)
        self.assertEqual(me_payload["admin"]["email"], "user@example.com")

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
                "videoApiKey": "video-secret-key",
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
        self.assertEqual(listed_user["videoEndpointPrimary"], "https://video.example.com/v1/jobs")
        self.assertEqual(listed_user["videoEndpointSecondary"], "https://video.example.com/v1/status")
        self.assertNotIn("secret", listed_user["imageApiKeyMasked"])
        self.assertNotIn("secret", listed_user["videoApiKeyMasked"])

        status, settings_payload = self.request("GET", "/api/settings", token=user_payload["token"])
        self.assertEqual(status, 200)
        self.assertEqual(settings_payload["settings"]["endpoint"], "https://image.example.com/v1/generate")

    def test_demoting_admin_user_revokes_admin_sessions(self):
        user_payload = self.register_user()
        admin_token = self.builtin_admin_token()
        user_id = user_payload["user"]["id"]
        self.request("PATCH", f"/api/admin/users/{user_id}", {"role": "admin"}, token=admin_token)
        status, promoted_login = self.request(
            "POST",
            "/api/admin/login",
            {"email": "user@example.com", "password": "password123"},
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
            {"email": "user@example.com", "password": "password123"},
        )
        self.assertEqual(status, 403)
        self.assertIn("管理员权限", error["error"])


if __name__ == "__main__":
    unittest.main()
