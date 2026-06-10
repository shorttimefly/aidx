#!/usr/bin/env python3
"""Account and admin backend for the AI image editor."""

from __future__ import annotations

from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import base64
import errno
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, quote, unquote, urlparse


ROOT = Path(__file__).resolve().parent
STORAGE_DIR = ROOT / os.environ.get("IMAGE_STUDIO_STORAGE", "storage")
DB_PATH = Path(os.environ.get("IMAGE_STUDIO_DB", str(STORAGE_DIR / "image_studio.sqlite")))
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "14"))
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "change-me")
DEFAULT_ENDPOINT = "https://aokapi.com/v1beta/models/gemini-2.5-flash-image:generateContent/"
DEFAULT_MODEL = "gemini-2.5-flash-image"
UPSTREAM_TIMEOUT_SECONDS = float(os.environ.get("UPSTREAM_TIMEOUT_SECONDS", "120"))


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def make_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(12)}"


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return salt, base64.b64encode(digest).decode("ascii")


def verify_password(password: str, salt: str, stored_hash: str) -> bool:
    _, digest = hash_password(password, salt)
    return hmac.compare_digest(digest, stored_hash)


def connect() -> sqlite3.Connection:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def ensure_sessions_schema(conn: sqlite3.Connection) -> None:
    columns = {row["name"]: row for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}
    user_id = columns.get("user_id")
    needs_rebuild = (
        "token" not in columns
        or "role" not in columns
        or not user_id
        or bool(user_id["notnull"])
    )
    if needs_rebuild:
        # Sessions are ephemeral; rebuild legacy tables that cannot store admin sessions.
        conn.execute("DROP TABLE IF EXISTS sessions")
        conn.execute(
            """
            CREATE TABLE sessions (
              token TEXT PRIMARY KEY,
              user_id TEXT,
              role TEXT NOT NULL DEFAULT 'user',
              created_at TEXT NOT NULL,
              expires_at INTEGER NOT NULL
            )
            """
        )


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              password_salt TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              disabled INTEGER NOT NULL DEFAULT 0,
              source TEXT NOT NULL DEFAULT 'direct',
              referrer TEXT NOT NULL DEFAULT '',
              utm_source TEXT NOT NULL DEFAULT '',
              utm_medium TEXT NOT NULL DEFAULT '',
              utm_campaign TEXT NOT NULL DEFAULT '',
              source_path TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              last_login_at TEXT
            );

            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY,
              user_id TEXT,
              role TEXT NOT NULL DEFAULT 'user',
              created_at TEXT NOT NULL,
              expires_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_settings (
              user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
              api_key TEXT NOT NULL DEFAULT '',
              endpoint TEXT NOT NULL DEFAULT '',
              model TEXT NOT NULL DEFAULT '',
              size TEXT NOT NULL DEFAULT '1024x1024',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS generation_logs (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              endpoint TEXT NOT NULL,
              model TEXT NOT NULL,
              prompt TEXT NOT NULL,
              size TEXT NOT NULL,
              count INTEGER NOT NULL DEFAULT 1,
              image_count INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL,
              error TEXT NOT NULL DEFAULT '',
              request_json TEXT NOT NULL DEFAULT '{}',
              response_json TEXT NOT NULL DEFAULT '{}',
              input_tokens INTEGER NOT NULL DEFAULT 0,
              output_tokens INTEGER NOT NULL DEFAULT 0,
              total_tokens INTEGER NOT NULL DEFAULT 0,
              duration_ms INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS image_feedback (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              feedback_type TEXT NOT NULL DEFAULT 'downvote',
              image_url TEXT NOT NULL,
              image_name TEXT NOT NULL DEFAULT '',
              image_source TEXT NOT NULL DEFAULT '',
              prompt TEXT NOT NULL DEFAULT '',
              model TEXT NOT NULL DEFAULT '',
              size TEXT NOT NULL DEFAULT '',
              request_json TEXT NOT NULL DEFAULT '{}',
              item_json TEXT NOT NULL DEFAULT '{}',
              user_source TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_logs_user_created ON generation_logs(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_logs_created ON generation_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_feedback_created ON image_feedback(created_at);
            CREATE INDEX IF NOT EXISTS idx_feedback_source ON image_feedback(user_source, image_source, created_at);
            """
        )
        ensure_column(conn, "users", "disabled", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "users", "source", "TEXT NOT NULL DEFAULT 'direct'")
        ensure_column(conn, "users", "referrer", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "utm_source", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "utm_medium", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "utm_campaign", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "source_path", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "last_login_at", "TEXT")
        ensure_sessions_schema(conn)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, role)")
        seed_setting(conn, "default_endpoint", DEFAULT_ENDPOINT)
        seed_setting(conn, "default_model", DEFAULT_MODEL)
        seed_setting(conn, "usage_note", "用量为前端根据模型返回 usage 或请求/响应文本估算的次数与 token 数。")


def seed_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
        (key, value, now_iso()),
    )


def app_settings(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
    values = {row["key"]: row["value"] for row in rows}
    return {
        "defaultEndpoint": values.get("default_endpoint", DEFAULT_ENDPOINT),
        "defaultModel": values.get("default_model", DEFAULT_MODEL),
        "usageNote": values.get("usage_note", ""),
    }


def mask_api_key(api_key: str) -> str:
    value = str(api_key or "").strip()
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * 8}{value[-4:]}"


def row_user(
    row: sqlite3.Row,
    usage: dict | None = None,
    api_key_configured: bool = False,
    api_key_masked: str = "",
) -> dict:
    source = row_value(row, "source", "direct") or "direct"
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "disabled": bool(row["disabled"]),
        "source": {
            "source": source,
            "referrer": row_value(row, "referrer", ""),
            "utmSource": row_value(row, "utm_source", ""),
            "utmMedium": row_value(row, "utm_medium", ""),
            "utmCampaign": row_value(row, "utm_campaign", ""),
            "sourcePath": row_value(row, "source_path", ""),
        },
        "createdAt": row["created_at"],
        "lastLoginAt": row["last_login_at"],
        "apiKeyConfigured": api_key_configured,
        "apiKeyMasked": api_key_masked,
        "usage": usage
        or {
            "calls": 0,
            "images": 0,
            "inputTokens": 0,
            "outputTokens": 0,
            "totalTokens": 0,
        },
    }


def row_value(row: sqlite3.Row, key: str, default=""):
    return row[key] if key in row.keys() else default


class AppError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class UpstreamError(Exception):
    def __init__(self, status: int, message: str, payload=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.payload = payload


class Handler(SimpleHTTPRequestHandler):
    server_version = "ImageStudioAccount/1.0"

    def do_GET(self) -> None:
        self.route()

    def do_POST(self) -> None:
        self.route()

    def do_PUT(self) -> None:
        self.route()

    def do_PATCH(self) -> None:
        self.route()

    def route(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        method = self.command
        try:
            if path == "/api/health" and method == "GET":
                return self.json_response({"ok": True, "mode": "account-admin"})
            if path == "/api/auth/register" and method == "POST":
                return self.handle_register()
            if path == "/api/auth/login" and method == "POST":
                return self.handle_login()
            if path == "/api/auth/logout" and method == "POST":
                return self.handle_logout()
            if path == "/api/me" and method == "GET":
                return self.handle_me()
            if path == "/api/settings" and method == "GET":
                return self.handle_get_settings()
            if path == "/api/settings" and method == "PUT":
                return self.handle_put_settings()
            if path == "/api/generate" and method == "POST":
                return self.handle_generate()
            if path == "/api/generation-logs" and method == "POST":
                return self.handle_create_generation_log()
            if path == "/api/image-feedback" and method == "POST":
                return self.handle_create_image_feedback()
            if path == "/api/admin/login" and method == "POST":
                return self.handle_admin_login()
            if path == "/api/admin/me" and method == "GET":
                self.require_admin()
                return self.json_response({"admin": {"email": ADMIN_EMAIL}})
            if path == "/api/admin/summary" and method == "GET":
                return self.handle_admin_summary()
            if path == "/api/admin/users" and method == "GET":
                return self.handle_admin_users()
            if path.startswith("/api/admin/users/") and method == "PATCH":
                user_id = unquote(path.removeprefix("/api/admin/users/"))
                return self.handle_admin_update_user(user_id)
            if path == "/api/admin/logs" and method == "GET":
                return self.handle_admin_logs(parsed.query)
            if path == "/api/admin/feedback" and method == "GET":
                return self.handle_admin_feedback(parsed.query)
            if path == "/api/admin/downvotes" and method == "GET":
                return self.handle_admin_feedback(parsed.query)
            if path == "/api/admin/model-config" and method == "GET":
                return self.handle_admin_model_config()
            if path == "/api/admin/model-config" and method == "PUT":
                return self.handle_admin_put_model_config()
            if path.startswith("/api/"):
                raise AppError(HTTPStatus.NOT_FOUND, "接口不存在")
            return super().do_GET()
        except AppError as error:
            self.json_response({"error": error.message}, error.status)
        except Exception as error:
            self.json_response({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            raise AppError(HTTPStatus.BAD_REQUEST, "JSON 格式错误")

    def json_response(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def bearer_token(self) -> str:
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            return auth.split(" ", 1)[1].strip()
        return ""

    def require_user(self) -> sqlite3.Row:
        token = self.bearer_token()
        if not token:
            raise AppError(HTTPStatus.UNAUTHORIZED, "请先登录")
        now = int(time.time())
        with connect() as conn:
            session = conn.execute(
                "SELECT * FROM sessions WHERE token=? AND role='user' AND expires_at>?",
                (token, now),
            ).fetchone()
            if not session:
                raise AppError(HTTPStatus.UNAUTHORIZED, "登录已失效")
            user = conn.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
            if not user:
                raise AppError(HTTPStatus.UNAUTHORIZED, "用户不存在")
            if user["disabled"]:
                conn.execute("DELETE FROM sessions WHERE user_id=? AND role='user'", (user["id"],))
                conn.commit()
                raise AppError(HTTPStatus.FORBIDDEN, "账号已被禁用")
            return user

    def require_admin(self) -> None:
        token = self.bearer_token()
        if not token:
            raise AppError(HTTPStatus.UNAUTHORIZED, "请先登录 B 端")
        with connect() as conn:
            session = conn.execute(
                "SELECT token FROM sessions WHERE token=? AND role='admin' AND expires_at>?",
                (token, int(time.time())),
            ).fetchone()
        if not session:
            raise AppError(HTTPStatus.UNAUTHORIZED, "B 端登录已失效")

    def create_session(self, user_id: str | None, role: str) -> str:
        token = secrets.token_urlsafe(32)
        expires_at = int(time.time()) + SESSION_DAYS * 86400
        with connect() as conn:
            conn.execute(
                "INSERT INTO sessions (token, user_id, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                (token, user_id, role, now_iso(), expires_at),
            )
        return token

    def handle_register(self) -> None:
        body = self.read_json()
        email = str(body.get("email") or "").strip().lower()
        name = str(body.get("name") or "").strip() or email.split("@")[0]
        password = str(body.get("password") or "")
        if "@" not in email:
            raise AppError(HTTPStatus.BAD_REQUEST, "请输入有效邮箱")
        if len(password) < 8:
            raise AppError(HTTPStatus.BAD_REQUEST, "密码至少 8 位")
        source = normalize_source(body.get("source"))
        salt, password_hash = hash_password(password)
        user_id = make_id("user")
        try:
            with connect() as conn:
                conn.execute(
                    """
                    INSERT INTO users
                      (id, email, name, password_salt, password_hash, disabled, source, referrer,
                       utm_source, utm_medium, utm_campaign, source_path, created_at, last_login_at)
                    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        email,
                        name,
                        salt,
                        password_hash,
                        source["source"],
                        source["referrer"],
                        source["utmSource"],
                        source["utmMedium"],
                        source["utmCampaign"],
                        source["sourcePath"],
                        now_iso(),
                        now_iso(),
                    ),
                )
                settings = app_settings(conn)
                conn.execute(
                    """
                    INSERT INTO user_settings (user_id, endpoint, model, size, updated_at)
                    VALUES (?, ?, ?, '1024x1024', ?)
                    """,
                    (user_id, settings["defaultEndpoint"], settings["defaultModel"], now_iso()),
                )
        except sqlite3.IntegrityError:
            raise AppError(HTTPStatus.CONFLICT, "邮箱已注册")
        token = self.create_session(user_id, "user")
        user = connect().execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        self.json_response({"token": token, "user": row_user(user)})

    def handle_login(self) -> None:
        body = self.read_json()
        email = str(body.get("email") or "").strip().lower()
        password = str(body.get("password") or "")
        with connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
                raise AppError(HTTPStatus.UNAUTHORIZED, "邮箱或密码错误")
            if user["disabled"]:
                raise AppError(HTTPStatus.FORBIDDEN, "账号已被禁用")
            conn.execute("UPDATE users SET last_login_at=? WHERE id=?", (now_iso(), user["id"]))
        token = self.create_session(user["id"], "user")
        user = connect().execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        self.json_response({"token": token, "user": row_user(user)})

    def handle_logout(self) -> None:
        token = self.bearer_token()
        if token:
            with connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token=?", (token,))
        self.json_response({"ok": True})

    def handle_me(self) -> None:
        user = self.require_user()
        self.json_response({"user": row_user(user)})

    def handle_get_settings(self) -> None:
        user = self.require_user()
        with connect() as conn:
            settings = app_settings(conn)
            row = conn.execute("SELECT * FROM user_settings WHERE user_id=?", (user["id"],)).fetchone()
        api_key = row["api_key"] if row else ""
        self.json_response(
            {
                "settings": {
                    "apiKeyConfigured": bool(api_key),
                    "apiKeyMasked": mask_api_key(api_key),
                    "endpoint": settings["defaultEndpoint"],
                    "model": settings["defaultModel"],
                    "size": row["size"] if row else "1024x1024",
                    "defaultEndpoint": settings["defaultEndpoint"],
                    "defaultModel": settings["defaultModel"],
                }
            }
        )

    def handle_put_settings(self) -> None:
        user = self.require_user()
        body = self.read_json()
        size = normalize_image_size(str(body.get("size") or "1024x1024").strip()) or "1024x1024"
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO user_settings (user_id, api_key, endpoint, model, size, updated_at)
                VALUES (?, '', '', '', ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                  size=excluded.size,
                  updated_at=excluded.updated_at
                """,
                (user["id"], size, now_iso()),
            )
        self.json_response({"ok": True})

    def handle_generate(self) -> None:
        user = self.require_user()
        body = self.read_json()
        prompt = trim_text(str(body.get("prompt") or "").strip(), 8000)
        if not prompt:
            raise AppError(HTTPStatus.BAD_REQUEST, "请输入提示词")
        count = clamp_int(body.get("count") or body.get("n") or 1, 1, 8)
        size = normalize_image_size(str(body.get("size") or "1024x1024").strip()) or "1024x1024"
        references = normalize_reference_images(body.get("referenceImages"))
        with connect() as conn:
            settings = app_settings(conn)
            row = conn.execute("SELECT * FROM user_settings WHERE user_id=?", (user["id"],)).fetchone()
        api_key = str(row["api_key"] if row else "").strip()
        if not api_key:
            raise AppError(HTTPStatus.FORBIDDEN, "请联系管理员配置 API Key")
        endpoint = settings["defaultEndpoint"]
        model = settings["defaultModel"]
        resolved_endpoint = resolve_image_endpoint(endpoint, model)
        request_body, strategy = build_image_request_body(
            prompt=prompt,
            count=count,
            size=size,
            model=model,
            endpoint=resolved_endpoint,
            references=references,
        )
        request_snapshot = {
            "model": model,
            "strategy": strategy,
            "body": sanitize_payload(request_body),
        }
        started_at = time.monotonic()
        try:
            payload = call_upstream_model(resolved_endpoint, api_key, request_body)
            images = extract_image_results_from_payload(payload)
            if not images:
                raise UpstreamError(502, "接口未返回可识别的图片地址或 b64_json", payload)
            duration_ms = int((time.monotonic() - started_at) * 1000)
            log_generation(
                user_id=user["id"],
                endpoint=resolved_endpoint,
                model=model,
                prompt=prompt,
                size=size,
                count=count,
                images=images,
                status="completed",
                error="",
                request_body=request_body,
                response_body=payload,
                duration_ms=duration_ms,
            )
            self.json_response(
                {
                    "images": [{**image, "request": request_snapshot} for image in images],
                    "request": request_snapshot,
                    "model": model,
                    "apiKeyConfigured": True,
                }
            )
        except UpstreamError as error:
            duration_ms = int((time.monotonic() - started_at) * 1000)
            log_generation(
                user_id=user["id"],
                endpoint=resolved_endpoint,
                model=model,
                prompt=prompt,
                size=size,
                count=count,
                images=[],
                status="failed",
                error=f"API {error.status}: {error.message}",
                request_body=request_body,
                response_body=error.payload,
                duration_ms=duration_ms,
            )
            raise AppError(HTTPStatus.BAD_GATEWAY, f"远端接口 {error.status}: {error.message}")

    def handle_create_generation_log(self) -> None:
        user = self.require_user()
        body = self.read_json()
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO generation_logs
                  (id, user_id, endpoint, model, prompt, size, count, image_count, status, error,
                   request_json, response_json, input_tokens, output_tokens, total_tokens, duration_ms, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    make_id("log"),
                    user["id"],
                    str(body.get("endpoint") or "")[:800],
                    str(body.get("model") or "")[:160],
                    str(body.get("prompt") or "")[:4000],
                    str(body.get("size") or "")[:80],
                    int(body.get("count") or 1),
                    int(body.get("imageCount") or 0),
                    str(body.get("status") or "completed")[:32],
                    str(body.get("error") or "")[:2000],
                    trim_json(body.get("requestBody")),
                    trim_json(body.get("responseBody")),
                    int(body.get("inputTokens") or 0),
                    int(body.get("outputTokens") or 0),
                    int(body.get("totalTokens") or 0),
                    int(body.get("durationMs") or 0),
                    now_iso(),
                ),
            )
        self.json_response({"ok": True})

    def handle_create_image_feedback(self) -> None:
        user = self.require_user()
        body = self.read_json()
        image_url = str(body.get("imageUrl") or "").strip()
        if not image_url:
            raise AppError(HTTPStatus.BAD_REQUEST, "缺少图片信息")
        feedback_type = str(body.get("feedbackType") or "downvote").strip()[:32] or "downvote"
        if feedback_type not in {"upvote", "downvote"}:
            raise AppError(HTTPStatus.BAD_REQUEST, "反馈类型无效")
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO image_feedback
                  (id, user_id, feedback_type, image_url, image_name, image_source, prompt, model, size,
                   request_json, item_json, user_source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    make_id("fb"),
                    user["id"],
                    feedback_type,
                    trim_text(image_url, 240_000),
                    str(body.get("imageName") or "")[:240],
                    str(body.get("imageSource") or "")[:80],
                    str(body.get("prompt") or "")[:6000],
                    str(body.get("model") or "")[:160],
                    str(body.get("size") or "")[:80],
                    trim_json(body.get("requestBody"), 120_000),
                    trim_json(body.get("item"), 80_000),
                    row_value(user, "source", "direct") or "direct",
                    now_iso(),
                ),
            )
        self.json_response({"ok": True})

    def handle_admin_login(self) -> None:
        body = self.read_json()
        email = str(body.get("email") or "").strip().lower()
        password = str(body.get("password") or "")
        if email != ADMIN_EMAIL or password != ADMIN_PASSWORD:
            raise AppError(HTTPStatus.UNAUTHORIZED, "B 端账号或密码错误")
        token = self.create_session(None, "admin")
        self.json_response({"token": token, "admin": {"email": ADMIN_EMAIL}})

    def handle_admin_summary(self) -> None:
        self.require_admin()
        with connect() as conn:
            summary = conn.execute(
                """
                SELECT
                  (SELECT COUNT(*) FROM users) AS users,
                  (SELECT COUNT(*) FROM users WHERE disabled=1) AS disabled_users,
                  (SELECT COUNT(*) FROM generation_logs) AS calls,
                  (SELECT COALESCE(SUM(image_count), 0) FROM generation_logs) AS images,
                  (SELECT COALESCE(SUM(input_tokens), 0) FROM generation_logs) AS input_tokens,
                  (SELECT COALESCE(SUM(output_tokens), 0) FROM generation_logs) AS output_tokens,
                  (SELECT COALESCE(SUM(total_tokens), 0) FROM generation_logs) AS total_tokens,
                  (SELECT COUNT(*) FROM image_feedback) AS feedbacks,
                  (SELECT COUNT(*) FROM image_feedback WHERE feedback_type='upvote') AS upvotes,
                  (SELECT COUNT(*) FROM image_feedback WHERE feedback_type='downvote') AS downvotes
                """
            ).fetchone()
            settings = app_settings(conn)
        self.json_response({"summary": dict(summary), "modelConfig": settings})

    def handle_admin_users(self) -> None:
        self.require_admin()
        with connect() as conn:
            rows = conn.execute("SELECT * FROM users ORDER BY created_at DESC").fetchall()
            usage_rows = conn.execute(
                """
                SELECT user_id, COUNT(*) AS calls, COALESCE(SUM(image_count), 0) AS images,
                       COALESCE(SUM(input_tokens), 0) AS input_tokens,
                       COALESCE(SUM(output_tokens), 0) AS output_tokens,
                       COALESCE(SUM(total_tokens), 0) AS total_tokens
                FROM generation_logs GROUP BY user_id
                """
            ).fetchall()
            settings_rows = conn.execute("SELECT user_id, api_key FROM user_settings").fetchall()
        usage_by_user = {
            row["user_id"]: {
                "calls": row["calls"],
                "images": row["images"],
                "inputTokens": row["input_tokens"],
                "outputTokens": row["output_tokens"],
                "totalTokens": row["total_tokens"],
            }
            for row in usage_rows
        }
        key_by_user = {row["user_id"]: row["api_key"] for row in settings_rows}
        self.json_response(
            {
                "users": [
                    row_user(
                        row,
                        usage_by_user.get(row["id"]),
                        bool(key_by_user.get(row["id"], "")),
                        mask_api_key(key_by_user.get(row["id"], "")),
                    )
                    for row in rows
                ]
            }
        )

    def handle_admin_update_user(self, user_id: str) -> None:
        self.require_admin()
        body = self.read_json()
        with connect() as conn:
            user = conn.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
            if not user:
                raise AppError(HTTPStatus.NOT_FOUND, "用户不存在")
            if "disabled" in body:
                disabled = 1 if body.get("disabled") else 0
                conn.execute("UPDATE users SET disabled=? WHERE id=?", (disabled, user_id))
                if disabled:
                    conn.execute("DELETE FROM sessions WHERE user_id=? AND role='user'", (user_id,))
            if body.get("clearApiKey"):
                self.upsert_user_api_key(conn, user_id, "")
            elif "apiKey" in body:
                self.upsert_user_api_key(conn, user_id, str(body.get("apiKey") or "").strip())
        self.json_response({"ok": True})

    def upsert_user_api_key(self, conn: sqlite3.Connection, user_id: str, api_key: str) -> None:
        settings = app_settings(conn)
        conn.execute(
            """
            INSERT INTO user_settings (user_id, api_key, endpoint, model, size, updated_at)
            VALUES (?, ?, ?, ?, '1024x1024', ?)
            ON CONFLICT(user_id) DO UPDATE SET
              api_key=excluded.api_key,
              updated_at=excluded.updated_at
            """,
            (user_id, api_key, settings["defaultEndpoint"], settings["defaultModel"], now_iso()),
        )

    def handle_admin_logs(self, query: str) -> None:
        self.require_admin()
        params = parse_qs(query)
        limit = min(max(int(params.get("limit", ["120"])[0] or 120), 1), 500)
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT generation_logs.*, users.email, users.name, users.source
                FROM generation_logs
                JOIN users ON users.id = generation_logs.user_id
                ORDER BY generation_logs.created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        logs = []
        for row in rows:
            logs.append(
                {
                    "id": row["id"],
                    "userId": row["user_id"],
                    "userEmail": row["email"],
                    "userName": row["name"],
                    "userSource": row["source"],
                    "endpoint": row["endpoint"],
                    "model": row["model"],
                    "prompt": row["prompt"],
                    "size": row["size"],
                    "count": row["count"],
                    "imageCount": row["image_count"],
                    "status": row["status"],
                    "error": row["error"],
                    "requestBody": parse_json_field(row["request_json"]),
                    "responseBody": parse_json_field(row["response_json"]),
                    "inputTokens": row["input_tokens"],
                    "outputTokens": row["output_tokens"],
                    "totalTokens": row["total_tokens"],
                    "durationMs": row["duration_ms"],
                    "createdAt": row["created_at"],
                }
            )
        self.json_response({"logs": logs})

    def handle_admin_feedback(self, query: str) -> None:
        self.require_admin()
        params = parse_qs(query)
        limit = min(max(int(params.get("limit", ["120"])[0] or 120), 1), 500)
        feedback_type_filter = str(params.get("feedbackType", [""])[0] or "").strip()
        if feedback_type_filter not in {"upvote", "downvote"}:
            feedback_type_filter = ""
        source_filter = str(params.get("source", [""])[0] or "").strip()
        image_source_filter = str(params.get("imageSource", [""])[0] or "").strip()
        where = ["1=1"]
        values: list[str | int] = []
        if feedback_type_filter:
            where.append("image_feedback.feedback_type=?")
            values.append(feedback_type_filter)
        if source_filter:
            where.append("users.source=?")
            values.append(source_filter)
        if image_source_filter:
            where.append("image_feedback.image_source=?")
            values.append(image_source_filter)
        values.append(limit)
        with connect() as conn:
            rows = conn.execute(
                f"""
                SELECT image_feedback.*, users.email, users.name, users.source, users.referrer,
                       users.utm_source, users.utm_medium, users.utm_campaign, users.source_path
                FROM image_feedback
                JOIN users ON users.id = image_feedback.user_id
                WHERE {" AND ".join(where)}
                ORDER BY image_feedback.created_at DESC
                LIMIT ?
                """,
                values,
            ).fetchall()
            source_rows = conn.execute(
                """
                SELECT COALESCE(NULLIF(users.source, ''), 'direct') AS source, COUNT(*) AS count
                FROM image_feedback
                JOIN users ON users.id = image_feedback.user_id
                WHERE (? = '' OR image_feedback.feedback_type = ?)
                GROUP BY COALESCE(NULLIF(users.source, ''), 'direct')
                ORDER BY count DESC, source ASC
                """,
                (feedback_type_filter, feedback_type_filter),
            ).fetchall()
            image_source_rows = conn.execute(
                """
                SELECT COALESCE(NULLIF(image_source, ''), 'unknown') AS image_source, COUNT(*) AS count
                FROM image_feedback
                WHERE (? = '' OR feedback_type = ?)
                GROUP BY COALESCE(NULLIF(image_source, ''), 'unknown')
                ORDER BY count DESC, image_source ASC
                """,
                (feedback_type_filter, feedback_type_filter),
            ).fetchall()
        feedbacks = []
        for row in rows:
            feedbacks.append(
                {
                    "id": row["id"],
                    "userId": row["user_id"],
                    "userEmail": row["email"],
                    "userName": row["name"],
                    "feedbackType": row["feedback_type"],
                    "userSource": {
                        "source": row["source"] or "direct",
                        "referrer": row["referrer"],
                        "utmSource": row["utm_source"],
                        "utmMedium": row["utm_medium"],
                        "utmCampaign": row["utm_campaign"],
                        "sourcePath": row["source_path"],
                    },
                    "imageUrl": row["image_url"],
                    "imageName": row["image_name"],
                    "imageSource": row["image_source"],
                    "prompt": row["prompt"],
                    "model": row["model"],
                    "size": row["size"],
                    "requestBody": parse_json_field(row["request_json"]),
                    "item": parse_json_field(row["item_json"]),
                    "createdAt": row["created_at"],
                }
            )
        self.json_response(
            {
                "feedbacks": feedbacks,
                "sources": [{"source": row["source"], "count": row["count"]} for row in source_rows],
                "imageSources": [
                    {"imageSource": row["image_source"], "count": row["count"]} for row in image_source_rows
                ],
            }
        )

    def handle_admin_model_config(self) -> None:
        self.require_admin()
        with connect() as conn:
            self.json_response({"modelConfig": app_settings(conn)})

    def handle_admin_put_model_config(self) -> None:
        self.require_admin()
        body = self.read_json()
        endpoint = str(body.get("defaultEndpoint") or DEFAULT_ENDPOINT).strip() or DEFAULT_ENDPOINT
        model = str(body.get("defaultModel") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
        note = str(body.get("usageNote") or "").strip()
        with connect() as conn:
            for key, value in {
                "default_endpoint": endpoint,
                "default_model": model,
                "usage_note": note,
            }.items():
                conn.execute(
                    """
                    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                    """,
                    (key, value, now_iso()),
                )
        self.json_response({"ok": True})


def clamp_int(value, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = minimum
    return max(minimum, min(number, maximum))


def normalize_image_size(value: str) -> str:
    text = str(value or "").strip().lower().replace("×", "x")
    parts = text.split("x")
    if len(parts) != 2:
        return ""
    try:
        width = int(parts[0])
        height = int(parts[1])
    except ValueError:
        return ""
    if width <= 0 or height <= 0 or width > 4096 or height > 4096:
        return ""
    return f"{width}x{height}"


def resolve_image_endpoint(endpoint: str, model: str) -> str:
    selected_model = quote_component(model or DEFAULT_MODEL)
    value = str(endpoint or DEFAULT_ENDPOINT).strip() or DEFAULT_ENDPOINT
    if "{model}" in value:
        return value.replace("{model}", selected_model)
    if is_gemini_image_endpoint(value, model):
        marker = "/v1beta/models/"
        suffix = ":generateContent"
        lower = value.lower()
        marker_index = lower.find(marker)
        suffix_index = lower.find(suffix.lower(), marker_index)
        if marker_index >= 0 and suffix_index >= 0:
            prefix = value[: marker_index + len(marker)]
            tail = value[suffix_index + len(suffix) :]
            return f"{prefix}{selected_model}{suffix}{tail}"
    return value


def quote_component(value: str) -> str:
    return quote(str(value or ""), safe="")


def is_gemini_image_endpoint(endpoint: str, model: str = "") -> bool:
    value = f"{endpoint or ''} {model or ''}".lower()
    return "generatecontent" in value or "gemini-2.5-flash-image" in value or "gemini-3-pro-image" in value


def build_image_request_body(
    *,
    prompt: str,
    count: int,
    size: str,
    model: str,
    endpoint: str,
    references: list[dict],
) -> tuple[dict, str]:
    if is_gemini_image_endpoint(endpoint, model):
        parts = [{"text": prompt}]
        for reference in references:
            inline_data = reference_to_inline_data(reference)
            if inline_data:
                parts.append({"inlineData": inline_data})
        return (
            {
                "contents": [
                    {
                        "role": "user",
                        "parts": parts,
                    }
                ],
                "generationConfig": {
                    "responseModalities": ["TEXT", "IMAGE"],
                    "imageConfig": gemini_image_config_from_size(size),
                },
            },
            "Gemini inlineData" if len(parts) > 1 else "Gemini text",
        )
    body = {
        "model": model,
        "prompt": prompt,
        "n": count,
        "size": size,
    }
    if references:
        body["reference_images"] = [reference["url"] for reference in references]
    return body, "reference_images" if references else "text"


def normalize_reference_images(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    references = []
    seen = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        references.append(
            {
                "name": trim_text(item.get("name") or "参考图", 120),
                "size": normalize_image_size(str(item.get("size") or "")),
                "url": url,
            }
        )
        if len(references) >= 3:
            break
    return references


def reference_to_inline_data(reference: dict) -> dict | None:
    url = str(reference.get("url") or "")
    if not url.startswith("data:image/"):
        return None
    mime_type = "image/png"
    header, _, data = url.partition(",")
    if not data:
        return None
    if ";" in header and ":" in header:
        mime_type = header.split(":", 1)[1].split(";", 1)[0] or mime_type
    return {"data": data, "mimeType": mime_type}


def gemini_image_config_from_size(size: str) -> dict:
    parsed = parse_image_size(size)
    if not parsed:
        return {"aspectRatio": "1:1", "imageSize": "1K"}
    width, height = parsed
    return {
        "aspectRatio": nearest_gemini_aspect_ratio(width, height),
        "imageSize": "2K" if max(width, height) > 1200 else "1K",
    }


def parse_image_size(size: str) -> tuple[int, int] | None:
    normalized = normalize_image_size(size)
    if not normalized:
        return None
    width, height = normalized.split("x", 1)
    return int(width), int(height)


def nearest_gemini_aspect_ratio(width: int, height: int) -> str:
    ratio = width / height
    options = [
        ("1:1", 1),
        ("16:9", 16 / 9),
        ("9:16", 9 / 16),
        ("4:3", 4 / 3),
        ("3:4", 3 / 4),
    ]
    return min(options, key=lambda item: abs(item[1] - ratio))[0]


def call_upstream_model(endpoint: str, api_key: str, body: dict):
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": authorization_header_value(api_key, endpoint),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
            text = response.read().decode("utf-8", errors="replace")
            return parse_upstream_payload(text)
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        payload = parse_upstream_payload(text)
        raise UpstreamError(error.code, upstream_error_message(payload, error.reason), payload)
    except urllib.error.URLError as error:
        raise UpstreamError(502, str(error.reason), {"error": str(error.reason)})
    except (TimeoutError, socket.timeout):
        raise UpstreamError(504, "请求远端模型超时", {"error": "timeout"})


def authorization_header_value(api_key: str, endpoint: str) -> str:
    value = str(api_key or "").strip()
    if value.lower().startswith("bearer "):
        return value
    if is_gemini_image_endpoint(endpoint) or "aokapi.com" in str(endpoint).lower():
        return value
    return f"Bearer {value}"


def parse_upstream_payload(text: str):
    try:
        return json.loads(text or "{}")
    except json.JSONDecodeError:
        return text


def upstream_error_message(payload, fallback: str) -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error.get("message"))
        if error:
            return str(error)
        if payload.get("message"):
            return str(payload.get("message"))
    if isinstance(payload, str) and payload:
        return payload[:500]
    return str(fallback or "接口请求失败")


def extract_image_results_from_payload(payload) -> list[dict]:
    images: list[dict] = []
    data = []
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            data = payload["data"]
        elif isinstance(payload.get("images"), list):
            data = payload["images"]
    for item in data:
        if isinstance(item, str):
            images.append({"url": item})
        elif isinstance(item, dict):
            if item.get("url"):
                images.append({"url": item["url"]})
            elif item.get("b64_json"):
                images.append({"url": f"data:image/png;base64,{item['b64_json']}"})
            elif item.get("image"):
                images.append({"url": item["image"]})
    if isinstance(payload, dict):
        for candidate in payload.get("candidates") or []:
            content = candidate.get("content") if isinstance(candidate, dict) else {}
            for part in (content or {}).get("parts") or []:
                inline = (part.get("inlineData") or part.get("inline_data")) if isinstance(part, dict) else None
                if inline and inline.get("data"):
                    mime_type = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                    images.append({"url": f"data:{mime_type};base64,{inline['data']}"})
        for choice in payload.get("choices") or []:
            if not isinstance(choice, dict):
                continue
            content = choice.get("message", {}).get("content") if isinstance(choice.get("message"), dict) else ""
            text = content or choice.get("text") or ""
            images.extend({"url": url} for url in extract_data_urls_from_text(text))
    return [image for image in images if image.get("url")]


def extract_data_urls_from_text(text: str) -> list[str]:
    value = str(text or "")
    urls = []
    cursor = 0
    marker = "data:image/"
    while True:
        start = value.find(marker, cursor)
        if start < 0:
            break
        end = start
        while end < len(value) and value[end] not in {'"', "'", " ", "\n", "\r", "\t", ")", "]", "}"}:
            end += 1
        urls.append(value[start:end])
        cursor = end
    return urls


def sanitize_payload(value):
    if isinstance(value, list):
        return [sanitize_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_payload(entry) for key, entry in value.items()}
    if not isinstance(value, str):
        return value
    if value.startswith("data:image/"):
        prefix, _, data = value.partition(",")
        return f"{prefix},[base64 图片数据已截断，长度 {len(data)}]"
    if len(value) >= 400 and all(char.isalnum() or char in "+/=" for char in value):
        return f"[base64 图片数据已截断，长度 {len(value)}]"
    return value


def extract_token_usage(request_body, response_body) -> dict:
    response = response_body if isinstance(response_body, dict) else {}
    usage = response.get("usageMetadata") or response.get("usage_metadata") or response.get("usage") or {}
    input_tokens = int(
        usage.get("promptTokenCount")
        or usage.get("prompt_token_count")
        or usage.get("prompt_tokens")
        or estimate_tokens(sanitize_payload(request_body))
    )
    output_tokens = int(
        usage.get("candidatesTokenCount")
        or usage.get("candidates_token_count")
        or usage.get("completion_tokens")
        or estimate_tokens(sanitize_payload(response_body))
    )
    total_tokens = int(
        usage.get("totalTokenCount")
        or usage.get("total_token_count")
        or usage.get("total_tokens")
        or input_tokens + output_tokens
    )
    return {"input": input_tokens, "output": output_tokens, "total": total_tokens}


def estimate_tokens(value) -> int:
    text = value if isinstance(value, str) else json.dumps(value or {}, ensure_ascii=False)
    return max(0, (len(text) + 3) // 4)


def log_generation(
    *,
    user_id: str,
    endpoint: str,
    model: str,
    prompt: str,
    size: str,
    count: int,
    images: list[dict],
    status: str,
    error: str,
    request_body,
    response_body,
    duration_ms: int,
) -> None:
    usage = extract_token_usage(request_body, response_body)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO generation_logs
              (id, user_id, endpoint, model, prompt, size, count, image_count, status, error,
               request_json, response_json, input_tokens, output_tokens, total_tokens, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                make_id("log"),
                user_id,
                endpoint[:800],
                model[:160],
                prompt[:4000],
                size[:80],
                count,
                len(images),
                status[:32],
                error[:2000],
                trim_json(sanitize_payload(request_body)),
                trim_json(sanitize_payload(response_body)),
                usage["input"],
                usage["output"],
                usage["total"],
                duration_ms,
                now_iso(),
            ),
        )


def normalize_source(value) -> dict:
    source = value if isinstance(value, dict) else {}
    utm_source = str(source.get("utmSource") or source.get("utm_source") or source.get("source") or "").strip()
    referrer = str(source.get("referrer") or "").strip()
    normalized_source = str(source.get("source") or utm_source or "").strip()
    if not normalized_source:
        normalized_source = "referrer" if referrer else "direct"
    return {
        "source": trim_text(normalized_source.lower(), 120) or "direct",
        "referrer": trim_text(referrer, 600),
        "utmSource": trim_text(utm_source, 120),
        "utmMedium": trim_text(str(source.get("utmMedium") or source.get("utm_medium") or "").strip(), 120),
        "utmCampaign": trim_text(str(source.get("utmCampaign") or source.get("utm_campaign") or "").strip(), 160),
        "sourcePath": trim_text(str(source.get("sourcePath") or source.get("source_path") or "").strip(), 600),
    }


def trim_text(value, max_len: int) -> str:
    text = str(value or "")
    if len(text) <= max_len:
        return text
    return text[:max_len]


def trim_json(value, max_len: int = 120_000) -> str:
    text = json.dumps(value or {}, ensure_ascii=False)
    if len(text) > max_len:
        return json.dumps({"truncated": True, "preview": text[:max_len]}, ensure_ascii=False)
    return text


def parse_json_field(value: str):
    try:
        return json.loads(value or "{}")
    except json.JSONDecodeError:
        return {"raw": value}


def main() -> None:
    init_db()
    os.chdir(ROOT)
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8787"))
    display_host = "localhost" if host in {"", "0.0.0.0", "::", "127.0.0.1"} else host
    server = bind_server(host, port)
    actual_port = server.server_address[1]
    print(f"AI image editor server running on http://{display_host}:{actual_port}")
    if actual_port != port:
        print(f"Port {port} is busy; switched to http://{display_host}:{actual_port}")
    print(f"Admin login: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def bind_server(host: str, port: int) -> ThreadingHTTPServer:
    if os.environ.get("PORT"):
        return ThreadingHTTPServer((host, port), Handler)
    for candidate in range(port, port + 20):
        try:
            return ThreadingHTTPServer((host, candidate), Handler)
        except OSError as error:
            if error.errno not in {errno.EADDRINUSE, 48}:
                raise
    raise OSError(errno.EADDRINUSE, f"Ports {port}-{port + 19} are already in use")


if __name__ == "__main__":
    main()
