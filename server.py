#!/usr/bin/env python3
"""Account and admin backend for the AI image editor."""

from __future__ import annotations

from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import base64
import copy
import errno
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import traceback
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
OLD_DEFAULT_ENDPOINT = "https://aokapi.com/v1beta/models/gemini-2.5-flash-image:generateContent/"
OLD_GEMINI3_PREVIEW_MODEL = "gemini-3-pro-image-preview"
GEMINI3_IMAGE_MODEL = "gemini-3-pro-image"
OLD_GEMINI3_PREVIEW_ENDPOINT = f"https://aokapi.com/v1beta/models/{OLD_GEMINI3_PREVIEW_MODEL}:generateContent/"
DEFAULT_ENDPOINT = "https://aokapi.com/v1beta/models/{model}:generateContent/"
DEFAULT_MODEL = "gemini-2.5-flash-image"
PROVIDER_TYPE_AOKAPI_GEMINI = "aokapi_gemini"
PROVIDER_TYPE_MUSKAPIS_IMAGE = "muskapis_image"
PROVIDER_TYPE_OPENAI_IMAGE = "openai_image"
VALID_IMAGE_PROVIDER_TYPES = {
    PROVIDER_TYPE_AOKAPI_GEMINI,
    PROVIDER_TYPE_MUSKAPIS_IMAGE,
    PROVIDER_TYPE_OPENAI_IMAGE,
}
DEFAULT_PROVIDER_BASE_URLS = {
    PROVIDER_TYPE_AOKAPI_GEMINI: DEFAULT_ENDPOINT,
    PROVIDER_TYPE_MUSKAPIS_IMAGE: "https://api.muskapis.com/v1",
    PROVIDER_TYPE_OPENAI_IMAGE: "https://api.openai.com/v1",
}
UPSTREAM_TIMEOUT_SECONDS = float(os.environ.get("UPSTREAM_TIMEOUT_SECONDS", "120"))
UPSTREAM_MAX_ATTEMPTS = max(1, int(os.environ.get("UPSTREAM_MAX_ATTEMPTS", "2")))
UPSTREAM_RETRY_DELAY_SECONDS = max(0.0, float(os.environ.get("UPSTREAM_RETRY_DELAY_SECONDS", "1")))
PROMPT_CONFIG_KEY = "prompt_config_json"
PROMPT_CONFIG_PATH = ROOT / "prompt-config-defaults.json"
PROMPT_TEXT_LIMIT = 20_000
LOCKED_PROMPT_CONFIG_KEYS = {"id", "url"}
USER_ROLE = "user"
ADMIN_ROLE = "admin"
VALID_USER_ROLES = {USER_ROLE, ADMIN_ROLE}


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


def ensure_users_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").fetchone()
    schema = " ".join(str(row_value(row, "sql", "") or "").upper().split())
    if "EMAIL TEXT NOT NULL UNIQUE" not in schema:
        return

    # The C端 account flow no longer uses email. Rebuild only this table to
    # remove the historical unique email constraint while preserving user data.
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("PRAGMA legacy_alter_table = ON")
    conn.execute("ALTER TABLE users RENAME TO users_legacy")
    conn.execute(
        """
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          disabled INTEGER NOT NULL DEFAULT 0,
          role TEXT NOT NULL DEFAULT 'user',
          source TEXT NOT NULL DEFAULT 'direct',
          referrer TEXT NOT NULL DEFAULT '',
          utm_source TEXT NOT NULL DEFAULT '',
          utm_medium TEXT NOT NULL DEFAULT '',
          utm_campaign TEXT NOT NULL DEFAULT '',
          source_path TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          last_login_at TEXT
        )
        """
    )
    columns = [
        "id",
        "email",
        "name",
        "password_salt",
        "password_hash",
        "disabled",
        "role",
        "source",
        "referrer",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "source_path",
        "created_at",
        "last_login_at",
    ]
    column_sql = ", ".join(columns)
    conn.execute(f"INSERT INTO users ({column_sql}) SELECT {column_sql} FROM users_legacy")
    conn.execute("DROP TABLE users_legacy")
    conn.commit()
    conn.execute("PRAGMA legacy_alter_table = OFF")
    conn.execute("PRAGMA foreign_keys = ON")


def migrate_default_endpoint(conn: sqlite3.Connection) -> None:
    timestamp = now_iso()
    conn.execute(
        "UPDATE app_settings SET value=?, updated_at=? WHERE key='default_endpoint' AND value=?",
        (DEFAULT_ENDPOINT, timestamp, OLD_DEFAULT_ENDPOINT),
    )
    conn.execute(
        "UPDATE user_settings SET endpoint=?, updated_at=? WHERE endpoint=?",
        (DEFAULT_ENDPOINT, timestamp, OLD_DEFAULT_ENDPOINT),
    )
    conn.execute(
        "UPDATE app_settings SET value=?, updated_at=? WHERE key='default_endpoint' AND value=?",
        (DEFAULT_ENDPOINT, timestamp, OLD_GEMINI3_PREVIEW_ENDPOINT),
    )
    conn.execute(
        "UPDATE user_settings SET endpoint=?, updated_at=? WHERE endpoint=?",
        (DEFAULT_ENDPOINT, timestamp, OLD_GEMINI3_PREVIEW_ENDPOINT),
    )
    conn.execute(
        "UPDATE app_settings SET value=?, updated_at=? WHERE key='default_model' AND value=?",
        (GEMINI3_IMAGE_MODEL, timestamp, OLD_GEMINI3_PREVIEW_MODEL),
    )
    conn.execute(
        "UPDATE user_settings SET model=?, updated_at=? WHERE model=?",
        (GEMINI3_IMAGE_MODEL, timestamp, OLD_GEMINI3_PREVIEW_MODEL),
    )


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL DEFAULT '',
              name TEXT NOT NULL,
              password_salt TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              disabled INTEGER NOT NULL DEFAULT 0,
              role TEXT NOT NULL DEFAULT 'user',
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
              video_api_key TEXT NOT NULL DEFAULT '',
              video_model TEXT NOT NULL DEFAULT '',
              video_endpoint_primary TEXT NOT NULL DEFAULT '',
              video_endpoint_secondary TEXT NOT NULL DEFAULT '',
              size TEXT NOT NULL DEFAULT '1024x1024',
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS model_providers (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              provider_type TEXT NOT NULL,
              base_url TEXT NOT NULL,
              api_key TEXT NOT NULL DEFAULT '',
              enabled INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS provider_models (
              id TEXT PRIMARY KEY,
              provider_id TEXT NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
              model_name TEXT NOT NULL,
              priority INTEGER NOT NULL DEFAULT 100,
              enabled INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_model_access (
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              provider_model_id TEXT NOT NULL REFERENCES provider_models(id) ON DELETE CASCADE,
              enabled INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              PRIMARY KEY (user_id, provider_model_id)
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

            CREATE TABLE IF NOT EXISTS generated_assets (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              log_id TEXT NOT NULL DEFAULT '',
              image_url TEXT NOT NULL,
              name TEXT NOT NULL DEFAULT '',
              endpoint TEXT NOT NULL DEFAULT '',
              model TEXT NOT NULL DEFAULT '',
              prompt TEXT NOT NULL DEFAULT '',
              size TEXT NOT NULL DEFAULT '',
              source TEXT NOT NULL DEFAULT 'generation',
              request_json TEXT NOT NULL DEFAULT '{}',
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
            CREATE INDEX IF NOT EXISTS idx_generated_assets_user_created ON generated_assets(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_feedback_created ON image_feedback(created_at);
            CREATE INDEX IF NOT EXISTS idx_feedback_source ON image_feedback(user_source, image_source, created_at);
            CREATE INDEX IF NOT EXISTS idx_provider_models_provider_priority ON provider_models(provider_id, priority);
            CREATE INDEX IF NOT EXISTS idx_user_model_access_user ON user_model_access(user_id, enabled);
            """
        )
        ensure_column(conn, "users", "disabled", "INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "users", "role", "TEXT NOT NULL DEFAULT 'user'")
        ensure_column(conn, "users", "source", "TEXT NOT NULL DEFAULT 'direct'")
        ensure_column(conn, "users", "referrer", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "utm_source", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "utm_medium", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "utm_campaign", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "source_path", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "last_login_at", "TEXT")
        ensure_users_schema(conn)
        ensure_column(conn, "user_settings", "video_api_key", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "user_settings", "video_model", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "user_settings", "video_endpoint_primary", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "user_settings", "video_endpoint_secondary", "TEXT NOT NULL DEFAULT ''")
        migrate_default_endpoint(conn)
        ensure_sessions_schema(conn)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, role)")
        seed_setting(conn, "default_endpoint", DEFAULT_ENDPOINT)
        seed_setting(conn, "default_model", DEFAULT_MODEL)
        seed_setting(conn, "usage_note", "用量为前端根据模型返回 usage 或请求/响应文本估算的次数与 token 数。")
        seed_setting(conn, PROMPT_CONFIG_KEY, prompt_config_json(default_prompt_config()))


def seed_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
        (key, value, now_iso()),
    )


def default_prompt_config() -> dict:
    try:
        return json.loads(PROMPT_CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {
            "version": 1,
            "single": {
                "defaultTemplateCategory": "aplus",
                "defaultTemplateId": "aplus-brand-story",
                "templateCategories": [],
                "templates": [],
                "supplementalVariantPrompt": "",
            },
            "refinement": {
                "quickEdits": [],
                "compose": {},
                "imageReferenceText": {"local": "", "remote": ""},
            },
            "suite": {
                "visualStyles": [],
                "contextFallbacks": {"productLabel": "", "category": "", "sellingPoints": "", "styleText": ""},
                "compose": {},
                "presets": [],
            },
            "reference": {
                "strictRule": "",
                "strictRuleDedupeNeedles": [],
                "context": {},
                "defaultName": "参考图",
                "defaultAssetPromptLabels": {"suiteReference": "", "uploaded": ""},
            },
            "referenceProbe": {
                "fallbackReference": {"name": "参考图探测", "size": "1x1", "url": ""},
                "withReferencePrompt": "",
                "controlPrompt": "",
                "size": "1024x1024",
            },
        }


def normalize_prompt_config(value) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = {}
    if not isinstance(value, dict):
        value = {}
    config = merge_prompt_config(default_prompt_config(), value)
    validate_prompt_config_sizes(config)
    return config


def validate_prompt_config_sizes(config: dict) -> None:
    for preset in config.get("suite", {}).get("presets", []):
        for shot in preset.get("shots", []):
            size = normalize_image_size(str(shot.get("size") or ""))
            if not size:
                raise AppError(HTTPStatus.BAD_REQUEST, f"无效套图尺寸：{shot.get('name') or shot.get('id')}")
            shot["size"] = size
    probe = config.get("referenceProbe", {})
    size = normalize_image_size(str(probe.get("size") or ""))
    if not size:
        raise AppError(HTTPStatus.BAD_REQUEST, "无效探测生成尺寸")
    probe["size"] = size


def merge_prompt_config(default, override):
    if isinstance(default, dict):
        source = override if isinstance(override, dict) else {}
        merged = {}
        for key, default_value in default.items():
            if key in LOCKED_PROMPT_CONFIG_KEYS or (key == "category" and "id" in default):
                merged[key] = default_value
            else:
                merged[key] = merge_prompt_config(default_value, source.get(key))
        return merged
    if isinstance(default, list):
        if all(isinstance(item, dict) and "id" in item for item in default):
            override_by_id = {
                item.get("id"): item for item in override if isinstance(item, dict)
            } if isinstance(override, list) else {}
            return [
                merge_prompt_config(
                    item,
                    override_by_id.get(item["id"])
                    or (override[index] if isinstance(override, list) and index < len(override) else None),
                )
                for index, item in enumerate(default)
            ]
        return override if isinstance(override, list) and len(override) == len(default) else default
    if isinstance(default, str):
        return trim_text(override, PROMPT_TEXT_LIMIT) if isinstance(override, str) else default
    if isinstance(default, int):
        return override if isinstance(override, int) else default
    if isinstance(default, bool):
        return override if isinstance(override, bool) else default
    return override if override is not None else default


def prompt_config_json(value) -> str:
    return json.dumps(normalize_prompt_config(value), ensure_ascii=False)


def app_settings(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
    values = {row["key"]: row["value"] for row in rows}
    return {
        "defaultEndpoint": values.get("default_endpoint", DEFAULT_ENDPOINT),
        "defaultModel": values.get("default_model", DEFAULT_MODEL),
        "usageNote": values.get("usage_note", ""),
    }


def model_config_settings(conn: sqlite3.Connection) -> dict:
    config = app_settings(conn)
    config["modelProviders"] = model_providers_config(conn)
    return config


def normalize_provider_type(value) -> str:
    provider_type = str(value or "").strip().lower()
    if provider_type in VALID_IMAGE_PROVIDER_TYPES:
        return provider_type
    if provider_type in {"muskapis", "muskapi"}:
        return PROVIDER_TYPE_MUSKAPIS_IMAGE
    if provider_type in {"aokapi", "gemini"}:
        return PROVIDER_TYPE_AOKAPI_GEMINI
    if provider_type in {"openai", "openai_compatible", "compatible"}:
        return PROVIDER_TYPE_OPENAI_IMAGE
    return PROVIDER_TYPE_OPENAI_IMAGE


def provider_type_label(provider_type: str) -> str:
    return {
        PROVIDER_TYPE_AOKAPI_GEMINI: "AOKAPI / Gemini",
        PROVIDER_TYPE_MUSKAPIS_IMAGE: "Muskapis Image",
        PROVIDER_TYPE_OPENAI_IMAGE: "OpenAI Image Compatible",
    }.get(provider_type, "OpenAI Image Compatible")


def normalize_provider_base_url(base_url: str, provider_type: str) -> str:
    value = str(base_url or "").strip()
    if not value:
        value = DEFAULT_PROVIDER_BASE_URLS.get(provider_type, DEFAULT_PROVIDER_BASE_URLS[PROVIDER_TYPE_OPENAI_IMAGE])
    return trim_text(value.rstrip("/"), 800)


def normalize_provider_model_name(value: str, provider_type: str) -> str:
    model_name = trim_text(str(value or "").strip(), 160)
    if model_name:
        return model_name
    if provider_type == PROVIDER_TYPE_MUSKAPIS_IMAGE:
        return "gpt-image-2"
    return DEFAULT_MODEL


def row_provider_model(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "providerId": row["provider_id"],
        "modelName": row["model_name"],
        "priority": int(row["priority"] or 100),
        "enabled": bool(row["enabled"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def row_model_provider(provider: sqlite3.Row, models: list[dict] | None = None) -> dict:
    api_key = row_value(provider, "api_key", "")
    provider_type = normalize_provider_type(row_value(provider, "provider_type", ""))
    return {
        "id": provider["id"],
        "name": provider["name"],
        "providerType": provider_type,
        "providerTypeLabel": provider_type_label(provider_type),
        "baseUrl": provider["base_url"],
        "enabled": bool(provider["enabled"]),
        "apiKeyConfigured": bool(str(api_key or "").strip()),
        "apiKeyMasked": mask_api_key(api_key),
        "createdAt": provider["created_at"],
        "updatedAt": provider["updated_at"],
        "models": models or [],
    }


def model_providers_config(conn: sqlite3.Connection) -> list[dict]:
    providers = conn.execute("SELECT * FROM model_providers ORDER BY created_at ASC, name ASC").fetchall()
    model_rows = conn.execute("SELECT * FROM provider_models ORDER BY priority ASC, created_at ASC").fetchall()
    models_by_provider: dict[str, list[dict]] = {}
    for row in model_rows:
        models_by_provider.setdefault(row["provider_id"], []).append(row_provider_model(row))
    return [row_model_provider(provider, models_by_provider.get(provider["id"], [])) for provider in providers]


def user_allowed_image_models(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
          user_model_access.enabled AS access_enabled,
          provider_models.id AS model_id,
          provider_models.provider_id,
          provider_models.model_name,
          provider_models.priority,
          provider_models.enabled AS model_enabled,
          model_providers.name AS provider_name,
          model_providers.provider_type,
          model_providers.base_url,
          model_providers.enabled AS provider_enabled
        FROM user_model_access
        JOIN provider_models ON provider_models.id = user_model_access.provider_model_id
        JOIN model_providers ON model_providers.id = provider_models.provider_id
        WHERE user_model_access.user_id=? AND user_model_access.enabled=1
        ORDER BY provider_models.priority ASC, model_providers.name ASC, provider_models.model_name ASC
        """,
        (user_id,),
    ).fetchall()
    return [
        {
            "id": row["model_id"],
            "providerId": row["provider_id"],
            "providerName": row["provider_name"],
            "providerType": normalize_provider_type(row["provider_type"]),
            "baseUrl": row["base_url"],
            "modelName": row["model_name"],
            "priority": int(row["priority"] or 100),
            "enabled": bool(row["access_enabled"]) and bool(row["model_enabled"]) and bool(row["provider_enabled"]),
            "modelEnabled": bool(row["model_enabled"]),
            "providerEnabled": bool(row["provider_enabled"]),
        }
        for row in rows
    ]


def authorized_image_model_options(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
          model_providers.id AS provider_id,
          model_providers.name AS provider_name,
          model_providers.provider_type,
          model_providers.base_url,
          model_providers.api_key,
          provider_models.id AS provider_model_id,
          provider_models.model_name,
          provider_models.priority
        FROM user_model_access
        JOIN provider_models ON provider_models.id = user_model_access.provider_model_id
        JOIN model_providers ON model_providers.id = provider_models.provider_id
        WHERE user_model_access.user_id=?
          AND user_model_access.enabled=1
          AND provider_models.enabled=1
          AND model_providers.enabled=1
          AND TRIM(model_providers.api_key)<>''
        ORDER BY provider_models.priority ASC, model_providers.name ASC, provider_models.model_name ASC
        """,
        (user_id,),
    ).fetchall()
    return [
        {
            "providerId": row["provider_id"],
            "providerName": row["provider_name"],
            "providerType": normalize_provider_type(row["provider_type"]),
            "baseUrl": row["base_url"],
            "apiKey": row["api_key"],
            "providerModelId": row["provider_model_id"],
            "modelName": row["model_name"],
            "priority": int(row["priority"] or 100),
        }
        for row in rows
    ]


def set_user_model_access(conn: sqlite3.Connection, user_id: str, model_ids) -> None:
    if not isinstance(model_ids, list):
        raise AppError(HTTPStatus.BAD_REQUEST, "可用图片模型格式错误")
    unique_ids = []
    seen = set()
    for value in model_ids:
        model_id = trim_text(str(value or "").strip(), 120)
        if model_id and model_id not in seen:
            unique_ids.append(model_id)
            seen.add(model_id)
    if unique_ids:
        placeholders = ",".join("?" for _ in unique_ids)
        existing = {
            row["id"]
            for row in conn.execute(
                f"SELECT id FROM provider_models WHERE id IN ({placeholders})",
                unique_ids,
            ).fetchall()
        }
        missing = [model_id for model_id in unique_ids if model_id not in existing]
        if missing:
            raise AppError(HTTPStatus.BAD_REQUEST, "可用图片模型不存在")
    timestamp = now_iso()
    conn.execute("DELETE FROM user_model_access WHERE user_id=?", (user_id,))
    conn.executemany(
        """
        INSERT INTO user_model_access (user_id, provider_model_id, enabled, created_at)
        VALUES (?, ?, 1, ?)
        """,
        [(user_id, model_id, timestamp) for model_id in unique_ids],
    )


def save_model_providers(conn: sqlite3.Connection, providers) -> None:
    if providers is None:
        return
    if not isinstance(providers, list):
        raise AppError(HTTPStatus.BAD_REQUEST, "模型供应商配置格式错误")
    existing_providers = {
        row["id"]: row for row in conn.execute("SELECT * FROM model_providers").fetchall()
    }
    keep_provider_ids = []
    keep_model_ids = []
    timestamp = now_iso()
    for index, item in enumerate(providers, start=1):
        if not isinstance(item, dict):
            continue
        provider_id = trim_text(str(item.get("id") or "").strip(), 120)
        if not provider_id or provider_id not in existing_providers:
            provider_id = make_id("provider")
        provider_type = normalize_provider_type(item.get("providerType") or item.get("provider_type"))
        name = trim_text(str(item.get("name") or provider_type_label(provider_type)).strip(), 160)
        base_url = normalize_provider_base_url(item.get("baseUrl") or item.get("base_url"), provider_type)
        existing_api_key = row_value(existing_providers.get(provider_id), "api_key", "")
        if item.get("clearApiKey"):
            api_key = ""
        elif "apiKey" in item:
            incoming_key = str(item.get("apiKey") or "").strip()
            api_key = incoming_key or existing_api_key
        elif "api_key" in item:
            incoming_key = str(item.get("api_key") or "").strip()
            api_key = incoming_key or existing_api_key
        else:
            api_key = existing_api_key
        enabled = 1 if item.get("enabled", True) else 0
        created_at = row_value(existing_providers.get(provider_id), "created_at", timestamp) or timestamp
        conn.execute(
            """
            INSERT INTO model_providers
              (id, name, provider_type, base_url, api_key, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name=excluded.name,
              provider_type=excluded.provider_type,
              base_url=excluded.base_url,
              api_key=excluded.api_key,
              enabled=excluded.enabled,
              updated_at=excluded.updated_at
            """,
            (provider_id, name, provider_type, base_url, api_key, enabled, created_at, timestamp),
        )
        keep_provider_ids.append(provider_id)
        existing_models = {
            row["id"]: row
            for row in conn.execute(
                "SELECT * FROM provider_models WHERE provider_id=?",
                (provider_id,),
            ).fetchall()
        }
        model_items = item.get("models") if isinstance(item.get("models"), list) else []
        for model_index, model_item in enumerate(model_items, start=1):
            if not isinstance(model_item, dict):
                continue
            model_id = trim_text(str(model_item.get("id") or "").strip(), 120)
            if not model_id or model_id not in existing_models:
                model_id = make_id("pmodel")
            model_name = normalize_provider_model_name(
                model_item.get("modelName") or model_item.get("model_name"),
                provider_type,
            )
            priority = clamp_int(model_item.get("priority"), 1, 1_000_000)
            if priority == 1 and model_item.get("priority") in (None, ""):
                priority = index * 100 + model_index
            model_enabled = 1 if model_item.get("enabled", True) else 0
            model_created_at = row_value(existing_models.get(model_id), "created_at", timestamp) or timestamp
            conn.execute(
                """
                INSERT INTO provider_models
                  (id, provider_id, model_name, priority, enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  provider_id=excluded.provider_id,
                  model_name=excluded.model_name,
                  priority=excluded.priority,
                  enabled=excluded.enabled,
                  updated_at=excluded.updated_at
                """,
                (model_id, provider_id, model_name, priority, model_enabled, model_created_at, timestamp),
            )
            keep_model_ids.append(model_id)
    if keep_model_ids:
        placeholders = ",".join("?" for _ in keep_model_ids)
        conn.execute(f"DELETE FROM provider_models WHERE id NOT IN ({placeholders})", keep_model_ids)
    else:
        conn.execute("DELETE FROM provider_models")
    if keep_provider_ids:
        placeholders = ",".join("?" for _ in keep_provider_ids)
        conn.execute(f"DELETE FROM model_providers WHERE id NOT IN ({placeholders})", keep_provider_ids)
    else:
        conn.execute("DELETE FROM model_providers")


def prompt_config_settings(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT value FROM app_settings WHERE key=?", (PROMPT_CONFIG_KEY,)).fetchone()
    return normalize_prompt_config(row["value"] if row else "")


def client_prompt_config(config: dict) -> dict:
    safe_config = copy.deepcopy(normalize_prompt_config(config))
    safe_config.get("single", {})["templateCategories"] = [
        category for category in safe_config.get("single", {}).get("templateCategories", []) if category.get("id") != "custom"
    ]
    safe_config.get("single", {}).pop("supplementalVariantPrompt", None)
    for template in safe_config.get("single", {}).get("templates", []):
        template.pop("prompt", None)
    for preset in safe_config.get("suite", {}).get("presets", []):
        for shot in preset.get("shots", []):
            shot.pop("prompt", None)
    safe_config.get("suite", {})["compose"] = {}
    return safe_config


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
    image_endpoint: str = "",
    image_model: str = "",
    video_api_key_configured: bool = False,
    video_api_key_masked: str = "",
    video_model: str = "",
    video_endpoint_primary: str = "",
    video_endpoint_secondary: str = "",
    allowed_image_models: list[dict] | None = None,
) -> dict:
    source = row_value(row, "source", "direct") or "direct"
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "disabled": bool(row["disabled"]),
        "role": normalize_user_role(row_value(row, "role", USER_ROLE)),
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
        "imageApiKeyConfigured": api_key_configured,
        "imageApiKeyMasked": api_key_masked,
        "imageEndpoint": image_endpoint,
        "imageModel": image_model,
        "videoApiKeyConfigured": video_api_key_configured,
        "videoApiKeyMasked": video_api_key_masked,
        "videoModel": video_model,
        "videoEndpointPrimary": video_endpoint_primary,
        "videoEndpointSecondary": video_endpoint_secondary,
        "allowedImageModels": allowed_image_models or [],
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
    if row is None:
        return default
    return row[key] if key in row.keys() else default


def normalize_user_role(value) -> str:
    role = str(value or USER_ROLE).strip().lower()
    return role if role in VALID_USER_ROLES else USER_ROLE


def auth_type(body: dict) -> str:
    value = str(body.get("authType") or body.get("auth_type") or "").strip().lower()
    if value in {"email", "username"}:
        return value
    identifier = str(body.get("email") or body.get("username") or body.get("name") or "").strip()
    return "email" if "@" in identifier else "username"


def auth_identifier(body: dict) -> str:
    value = body.get("username") or body.get("name") or body.get("email") or ""
    return trim_text(str(value).strip(), 120)


def auth_email(body: dict) -> str:
    return trim_text(str(body.get("email") or body.get("name") or body.get("username") or "").strip().lower(), 120)


def find_user_by_name(conn: sqlite3.Connection, name: str):
    if not name:
        return None
    return conn.execute("SELECT * FROM users WHERE lower(name)=lower(?) LIMIT 1", (name,)).fetchone()


def find_user_by_email(conn: sqlite3.Connection, email: str):
    if not email:
        return None
    return conn.execute("SELECT * FROM users WHERE email<>'' AND lower(email)=lower(?) LIMIT 1", (email,)).fetchone()


def find_user_by_auth_identifier(conn: sqlite3.Connection, identifier: str):
    if not identifier:
        return None
    return conn.execute(
        """
        SELECT * FROM users
        WHERE lower(name)=lower(?)
           OR (email<>'' AND lower(email)=lower(?))
        ORDER BY CASE WHEN lower(name)=lower(?) THEN 0 ELSE 1 END
        LIMIT 1
        """,
        (identifier, identifier, identifier),
    ).fetchone()


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
            if path == "/api/generated-assets" and method == "GET":
                return self.handle_generated_assets(parsed.query)
            if path == "/api/generation-logs" and method == "POST":
                return self.handle_create_generation_log()
            if path == "/api/image-feedback" and method == "POST":
                return self.handle_create_image_feedback()
            if path == "/api/admin/login" and method == "POST":
                return self.handle_admin_login()
            if path == "/api/admin/me" and method == "GET":
                admin = self.require_admin()
                return self.json_response({"admin": admin})
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
            if path == "/api/admin/prompt-config" and method == "GET":
                return self.handle_admin_prompt_config()
            if path == "/api/admin/prompt-config" and method == "PUT":
                return self.handle_admin_put_prompt_config()
            if path == "/prompt-config-defaults.json":
                raise AppError(HTTPStatus.NOT_FOUND, "接口不存在")
            if path.startswith("/api/"):
                raise AppError(HTTPStatus.NOT_FOUND, "接口不存在")
            return super().do_GET()
        except AppError as error:
            self.json_response({"error": error.message}, error.status)
        except Exception as error:
            traceback.print_exc()
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

    def require_admin(self) -> dict:
        token = self.bearer_token()
        if not token:
            raise AppError(HTTPStatus.UNAUTHORIZED, "请先登录 B 端")
        with connect() as conn:
            session = conn.execute(
                "SELECT * FROM sessions WHERE token=? AND role=? AND expires_at>?",
                (token, ADMIN_ROLE, int(time.time())),
            ).fetchone()
            if not session:
                raise AppError(HTTPStatus.UNAUTHORIZED, "B 端登录已失效")
            user_id = row_value(session, "user_id", "")
            if not user_id:
                return {"email": ADMIN_EMAIL, "role": ADMIN_ROLE, "source": "builtin"}
            user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            if not user:
                conn.execute("DELETE FROM sessions WHERE token=?", (token,))
                conn.commit()
                raise AppError(HTTPStatus.UNAUTHORIZED, "管理员用户不存在")
            if user["disabled"]:
                conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
                conn.commit()
                raise AppError(HTTPStatus.FORBIDDEN, "管理员账号已被禁用")
            if normalize_user_role(row_value(user, "role", USER_ROLE)) != ADMIN_ROLE:
                conn.execute("DELETE FROM sessions WHERE user_id=? AND role=?", (user_id, ADMIN_ROLE))
                conn.commit()
                raise AppError(HTTPStatus.FORBIDDEN, "管理员权限已撤销")
            return {
                "id": user["id"],
                "email": user["email"],
                "name": user["name"],
                "role": ADMIN_ROLE,
                "source": "user",
            }

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
        selected_auth_type = auth_type(body)
        email = auth_email(body) if selected_auth_type == "email" else ""
        name = email.split("@", 1)[0] if selected_auth_type == "email" else auth_identifier(body)
        password = str(body.get("password") or "")
        if selected_auth_type == "email":
            if "@" not in email:
                raise AppError(HTTPStatus.BAD_REQUEST, "请输入有效邮箱")
        elif not name:
            raise AppError(HTTPStatus.BAD_REQUEST, "请输入用户名")
        elif "@" in name:
            raise AppError(HTTPStatus.BAD_REQUEST, "这是邮箱格式，请选择邮箱登录/注册")
        if len(password) < 8:
            raise AppError(HTTPStatus.BAD_REQUEST, "密码至少 8 位")
        source = normalize_source(body.get("source"))
        salt, password_hash = hash_password(password)
        user_id = make_id("user")
        try:
            with connect() as conn:
                if selected_auth_type == "email" and find_user_by_email(conn, email):
                    raise AppError(HTTPStatus.CONFLICT, "邮箱已注册")
                if selected_auth_type == "username" and find_user_by_name(conn, name):
                    raise AppError(HTTPStatus.CONFLICT, "用户名已注册")
                conn.execute(
                    """
                    INSERT INTO users
                      (id, email, name, password_salt, password_hash, disabled, role, source, referrer,
                       utm_source, utm_medium, utm_campaign, source_path, created_at, last_login_at)
                    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        email,
                        name,
                        salt,
                        password_hash,
                        USER_ROLE,
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
            raise AppError(HTTPStatus.CONFLICT, "邮箱已注册" if selected_auth_type == "email" else "用户名已注册")
        token = self.create_session(user_id, "user")
        user = connect().execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        self.json_response({"token": token, "user": row_user(user)})

    def handle_login(self) -> None:
        body = self.read_json()
        selected_auth_type = auth_type(body)
        identifier = auth_email(body) if selected_auth_type == "email" else auth_identifier(body)
        password = str(body.get("password") or "")
        with connect() as conn:
            user = find_user_by_email(conn, identifier) if selected_auth_type == "email" else find_user_by_name(conn, identifier)
            if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
                raise AppError(HTTPStatus.UNAUTHORIZED, "邮箱或密码错误" if selected_auth_type == "email" else "用户名或密码错误")
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
            prompt_config = prompt_config_settings(conn)
            row = conn.execute("SELECT * FROM user_settings WHERE user_id=?", (user["id"],)).fetchone()
        api_key = row["api_key"] if row else ""
        endpoint = row_value(row, "endpoint", "") or settings["defaultEndpoint"]
        model = row_value(row, "model", "") or settings["defaultModel"]
        video_api_key = row_value(row, "video_api_key", "")
        video_model = row_value(row, "video_model", "")
        video_endpoint_primary = row_value(row, "video_endpoint_primary", "")
        video_endpoint_secondary = row_value(row, "video_endpoint_secondary", "")
        self.json_response(
            {
                "settings": {
                    "apiKeyConfigured": bool(api_key),
                    "apiKeyMasked": mask_api_key(api_key),
                    "imageApiKeyConfigured": bool(api_key),
                    "imageApiKeyMasked": mask_api_key(api_key),
                    "imageEndpoint": endpoint,
                    "imageModel": model,
                    "endpoint": endpoint,
                    "model": model,
                    "videoApiKeyConfigured": bool(video_api_key),
                    "videoApiKeyMasked": mask_api_key(video_api_key),
                    "videoModel": video_model,
                    "videoEndpointPrimary": video_endpoint_primary,
                    "videoEndpointSecondary": video_endpoint_secondary,
                    "size": row["size"] if row else "1024x1024",
                    "defaultEndpoint": settings["defaultEndpoint"],
                    "defaultModel": settings["defaultModel"],
                    "promptConfig": client_prompt_config(prompt_config),
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
        count = clamp_int(body.get("count") or body.get("n") or 1, 1, 8)
        size = normalize_image_size(str(body.get("size") or "1024x1024").strip()) or "1024x1024"
        references = normalize_reference_images(body.get("referenceImages"))
        with connect() as conn:
            settings = app_settings(conn)
            prompt_config = prompt_config_settings(conn)
            row = conn.execute("SELECT * FROM user_settings WHERE user_id=?", (user["id"],)).fetchone()
            assigned_models = user_allowed_image_models(conn, user["id"])
            authorized_models = authorized_image_model_options(conn, user["id"]) if assigned_models else []
        prompt, prompt_source = resolve_generation_prompt(body, prompt_config, references)
        if assigned_models:
            if not authorized_models:
                raise AppError(HTTPStatus.FORBIDDEN, "请联系管理员配置可用图片模型")
            last_error = None
            for attempt_index, option in enumerate(authorized_models, start=1):
                model = option["modelName"]
                provider_type = option["providerType"]
                resolved_endpoint = resolve_provider_image_endpoint(option, model)
                request_body, strategy = build_provider_image_request_body(
                    prompt=prompt,
                    count=count,
                    size=size,
                    model=model,
                    endpoint=resolved_endpoint,
                    provider_type=provider_type,
                    references=references,
                )
                request_snapshot = {
                    "model": model,
                    "providerId": option["providerId"],
                    "providerName": option["providerName"],
                    "providerType": provider_type,
                    "providerModelId": option["providerModelId"],
                    "strategy": strategy,
                    "body": public_request_snapshot_body(
                        request_body,
                        prompt_source=prompt_source,
                        template_id=body.get("templateId"),
                        count=count,
                        size=size,
                        reference_count=len(references),
                    ),
                }
                started_at = time.monotonic()
                try:
                    payload = call_upstream_model_with_retry(resolved_endpoint, option["apiKey"], request_body)
                    images = extract_image_results_from_payload(payload)
                    if not images:
                        raise UpstreamError(502, "接口未返回可识别的图片地址或 b64_json", payload)
                    duration_ms = int((time.monotonic() - started_at) * 1000)
                    log_id = log_generation(
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
                    generated_assets = save_generated_assets(
                        user_id=user["id"],
                        log_id=log_id,
                        endpoint=resolved_endpoint,
                        model=model,
                        prompt=prompt,
                        size=size,
                        images=images,
                        request_snapshot=request_snapshot,
                    )
                    self.json_response(
                        {
                            "images": [
                                {
                                    **image,
                                    "request": request_snapshot,
                                    "remoteAssetId": generated_assets[index]["id"] if index < len(generated_assets) else "",
                                    "generatedAssetId": generated_assets[index]["id"] if index < len(generated_assets) else "",
                                }
                                for index, image in enumerate(images)
                            ],
                            "request": request_snapshot,
                            "model": model,
                            "provider": {
                                "id": option["providerId"],
                                "name": option["providerName"],
                                "type": provider_type,
                                "modelId": option["providerModelId"],
                            },
                            "attemptCount": attempt_index,
                            "apiKeyConfigured": True,
                        }
                    )
                    return
                except UpstreamError as error:
                    last_error = error
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
                    if attempt_index >= len(authorized_models) or not is_failoverable_upstream_error(error):
                        raise AppError(HTTPStatus.BAD_GATEWAY, f"远端接口 {error.status}: {error.message}")
            if last_error:
                raise AppError(HTTPStatus.BAD_GATEWAY, f"远端接口 {last_error.status}: {last_error.message}")

        api_key = str(row["api_key"] if row else "").strip()
        if not api_key:
            raise AppError(HTTPStatus.FORBIDDEN, "请联系管理员配置 API Key")
        endpoint = row_value(row, "endpoint", "") or settings["defaultEndpoint"]
        model = row_value(row, "model", "") or settings["defaultModel"]
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
            "body": public_request_snapshot_body(
                request_body,
                prompt_source=prompt_source,
                template_id=body.get("templateId"),
                count=count,
                size=size,
                reference_count=len(references),
            ),
        }
        started_at = time.monotonic()
        try:
            payload = call_upstream_model_with_retry(resolved_endpoint, api_key, request_body)
            images = extract_image_results_from_payload(payload)
            if not images:
                raise UpstreamError(502, "接口未返回可识别的图片地址或 b64_json", payload)
            duration_ms = int((time.monotonic() - started_at) * 1000)
            log_id = log_generation(
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
            generated_assets = save_generated_assets(
                user_id=user["id"],
                log_id=log_id,
                endpoint=resolved_endpoint,
                model=model,
                prompt=prompt,
                size=size,
                images=images,
                request_snapshot=request_snapshot,
            )
            self.json_response(
                {
                    "images": [
                        {
                            **image,
                            "request": request_snapshot,
                            "remoteAssetId": generated_assets[index]["id"] if index < len(generated_assets) else "",
                            "generatedAssetId": generated_assets[index]["id"] if index < len(generated_assets) else "",
                        }
                        for index, image in enumerate(images)
                    ],
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

    def handle_generated_assets(self, query: str) -> None:
        user = self.require_user()
        params = parse_qs(query)
        limit = clamp_int(params.get("limit", ["30"])[0], 1, 100)
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT id, log_id, image_url, name, endpoint, model, prompt, size, source, request_json, created_at
                FROM generated_assets
                WHERE user_id=?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (user["id"], limit),
            ).fetchall()
        self.json_response({"assets": [row_generated_asset(row) for row in rows]})

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
        selected_auth_type = auth_type(body)
        identifier = (auth_email(body) if selected_auth_type == "email" else auth_identifier(body)).lower()
        password = str(body.get("password") or "")
        if (selected_auth_type == "email" or "@" in identifier) and identifier == ADMIN_EMAIL and password == ADMIN_PASSWORD:
            token = self.create_session(None, ADMIN_ROLE)
            self.json_response({"token": token, "admin": {"email": ADMIN_EMAIL, "role": ADMIN_ROLE, "source": "builtin"}})
            return

        with connect() as conn:
            user = find_user_by_email(conn, identifier) if selected_auth_type == "email" else find_user_by_name(conn, identifier)
            if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
                raise AppError(HTTPStatus.UNAUTHORIZED, "B 端账号或密码错误")
            if user["disabled"]:
                raise AppError(HTTPStatus.FORBIDDEN, "管理员账号已被禁用")
            if normalize_user_role(row_value(user, "role", USER_ROLE)) != ADMIN_ROLE:
                raise AppError(HTTPStatus.FORBIDDEN, "该账号没有 B 端管理员权限")
            conn.execute("UPDATE users SET last_login_at=? WHERE id=?", (now_iso(), user["id"]))
        token = self.create_session(user["id"], ADMIN_ROLE)
        self.json_response(
            {
                "token": token,
                "admin": {"id": user["id"], "email": user["email"], "name": user["name"], "role": ADMIN_ROLE, "source": "user"},
            }
        )

    def handle_admin_summary(self) -> None:
        self.require_admin()
        with connect() as conn:
            summary = conn.execute(
                """
                SELECT
                  (SELECT COUNT(*) FROM users) AS users,
                  (SELECT COUNT(*) FROM users WHERE role='admin') AS admin_users,
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
            settings = model_config_settings(conn)
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
            settings_rows = conn.execute(
                """
                SELECT user_id, api_key, endpoint, model, video_api_key, video_model,
                       video_endpoint_primary, video_endpoint_secondary
                FROM user_settings
                """
            ).fetchall()
            access_rows = conn.execute(
                """
                SELECT
                  user_model_access.user_id,
                  user_model_access.enabled AS access_enabled,
                  provider_models.id AS model_id,
                  provider_models.provider_id,
                  provider_models.model_name,
                  provider_models.priority,
                  provider_models.enabled AS model_enabled,
                  model_providers.name AS provider_name,
                  model_providers.provider_type,
                  model_providers.base_url,
                  model_providers.enabled AS provider_enabled
                FROM user_model_access
                JOIN provider_models ON provider_models.id = user_model_access.provider_model_id
                JOIN model_providers ON model_providers.id = provider_models.provider_id
                WHERE user_model_access.enabled=1
                ORDER BY provider_models.priority ASC, model_providers.name ASC, provider_models.model_name ASC
                """
            ).fetchall()
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
        settings_by_user = {row["user_id"]: row for row in settings_rows}
        access_by_user: dict[str, list[dict]] = {}
        for row in access_rows:
            access_by_user.setdefault(row["user_id"], []).append(
                {
                    "id": row["model_id"],
                    "providerId": row["provider_id"],
                    "providerName": row["provider_name"],
                    "providerType": normalize_provider_type(row["provider_type"]),
                    "baseUrl": row["base_url"],
                    "modelName": row["model_name"],
                    "priority": int(row["priority"] or 100),
                    "enabled": bool(row["access_enabled"]) and bool(row["model_enabled"]) and bool(row["provider_enabled"]),
                    "modelEnabled": bool(row["model_enabled"]),
                    "providerEnabled": bool(row["provider_enabled"]),
                }
            )
        self.json_response(
            {
                "users": [
                    row_user(
                        row,
                        usage_by_user.get(row["id"]),
                        bool(row_value(settings_by_user.get(row["id"]), "api_key", "")),
                        mask_api_key(row_value(settings_by_user.get(row["id"]), "api_key", "")),
                        row_value(settings_by_user.get(row["id"]), "endpoint", ""),
                        row_value(settings_by_user.get(row["id"]), "model", ""),
                        bool(row_value(settings_by_user.get(row["id"]), "video_api_key", "")),
                        mask_api_key(row_value(settings_by_user.get(row["id"]), "video_api_key", "")),
                        row_value(settings_by_user.get(row["id"]), "video_model", ""),
                        row_value(settings_by_user.get(row["id"]), "video_endpoint_primary", ""),
                        row_value(settings_by_user.get(row["id"]), "video_endpoint_secondary", ""),
                        access_by_user.get(row["id"], []),
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
                    conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            if "role" in body:
                role = normalize_user_role(body.get("role"))
                if str(body.get("role") or "").strip().lower() not in VALID_USER_ROLES:
                    raise AppError(HTTPStatus.BAD_REQUEST, "用户角色无效")
                conn.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
                if role != ADMIN_ROLE:
                    conn.execute("DELETE FROM sessions WHERE user_id=? AND role=?", (user_id, ADMIN_ROLE))
            if body.get("clearApiKey") or body.get("clearImageApiKey"):
                self.upsert_user_image_config(
                    conn,
                    user_id,
                    api_key="",
                    endpoint=body.get("imageEndpoint") if "imageEndpoint" in body else body.get("endpoint"),
                    model=body.get("imageModel") if "imageModel" in body else body.get("model"),
                )
            elif (
                "apiKey" in body
                or "imageApiKey" in body
                or "imageEndpoint" in body
                or "endpoint" in body
                or "imageModel" in body
                or "model" in body
            ):
                self.upsert_user_image_config(
                    conn,
                    user_id,
                    api_key=str(body.get("imageApiKey", body.get("apiKey")) or "").strip()
                    if "imageApiKey" in body or "apiKey" in body
                    else None,
                    endpoint=body.get("imageEndpoint") if "imageEndpoint" in body else body.get("endpoint"),
                    model=body.get("imageModel") if "imageModel" in body else body.get("model"),
                )
            if body.get("clearVideoApiKey"):
                self.upsert_user_video_config(
                    conn,
                    user_id,
                    api_key="",
                    model=body.get("videoModel"),
                    endpoint_primary=body.get("videoEndpointPrimary"),
                    endpoint_secondary=body.get("videoEndpointSecondary"),
                )
            elif (
                "videoApiKey" in body
                or "videoModel" in body
                or "videoEndpointPrimary" in body
                or "videoEndpointSecondary" in body
            ):
                self.upsert_user_video_config(
                    conn,
                    user_id,
                    api_key=str(body.get("videoApiKey") or "").strip() if "videoApiKey" in body else None,
                    model=body.get("videoModel"),
                    endpoint_primary=body.get("videoEndpointPrimary"),
                    endpoint_secondary=body.get("videoEndpointSecondary"),
                )
            if "allowedImageModelIds" in body:
                set_user_model_access(conn, user_id, body.get("allowedImageModelIds"))
        self.json_response({"ok": True})

    def upsert_user_image_config(
        self,
        conn: sqlite3.Connection,
        user_id: str,
        api_key: str | None = None,
        endpoint: str | None = None,
        model: str | None = None,
    ) -> None:
        settings = app_settings(conn)
        row = conn.execute("SELECT * FROM user_settings WHERE user_id=?", (user_id,)).fetchone()
        next_api_key = row_value(row, "api_key", "") if api_key is None else api_key
        next_endpoint = row_value(row, "endpoint", settings["defaultEndpoint"]) if endpoint is None else str(endpoint or "").strip()
        next_endpoint = trim_text(next_endpoint or settings["defaultEndpoint"], 800)
        next_model = row_value(row, "model", settings["defaultModel"]) if model is None else str(model or "").strip()
        next_model = trim_text(next_model or settings["defaultModel"], 160)
        conn.execute(
            """
            INSERT INTO user_settings (user_id, api_key, endpoint, model, size, updated_at)
            VALUES (?, ?, ?, ?, '1024x1024', ?)
            ON CONFLICT(user_id) DO UPDATE SET
              api_key=excluded.api_key,
              endpoint=excluded.endpoint,
              model=excluded.model,
              updated_at=excluded.updated_at
            """,
            (user_id, next_api_key, next_endpoint, next_model, now_iso()),
        )

    def upsert_user_video_config(
        self,
        conn: sqlite3.Connection,
        user_id: str,
        api_key: str | None = None,
        model: str | None = None,
        endpoint_primary: str | None = None,
        endpoint_secondary: str | None = None,
    ) -> None:
        settings = app_settings(conn)
        row = conn.execute("SELECT * FROM user_settings WHERE user_id=?", (user_id,)).fetchone()
        next_api_key = row_value(row, "video_api_key", "") if api_key is None else api_key
        next_model = row_value(row, "video_model", "") if model is None else trim_text(str(model or "").strip(), 160)
        next_primary = (
            row_value(row, "video_endpoint_primary", "")
            if endpoint_primary is None
            else trim_text(str(endpoint_primary or "").strip(), 800)
        )
        next_secondary = (
            row_value(row, "video_endpoint_secondary", "")
            if endpoint_secondary is None
            else trim_text(str(endpoint_secondary or "").strip(), 800)
        )
        conn.execute(
            """
            INSERT INTO user_settings
              (user_id, api_key, endpoint, model, video_api_key, video_model,
               video_endpoint_primary, video_endpoint_secondary, size, updated_at)
            VALUES (?, '', ?, ?, ?, ?, ?, ?, '1024x1024', ?)
            ON CONFLICT(user_id) DO UPDATE SET
              video_api_key=excluded.video_api_key,
              video_model=excluded.video_model,
              video_endpoint_primary=excluded.video_endpoint_primary,
              video_endpoint_secondary=excluded.video_endpoint_secondary,
              updated_at=excluded.updated_at
            """,
            (
                user_id,
                settings["defaultEndpoint"],
                settings["defaultModel"],
                next_api_key,
                next_model,
                next_primary,
                next_secondary,
                now_iso(),
            ),
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
            self.json_response({"modelConfig": model_config_settings(conn)})

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
            save_model_providers(conn, body.get("modelProviders"))
        self.json_response({"ok": True})

    def handle_admin_prompt_config(self) -> None:
        self.require_admin()
        with connect() as conn:
            self.json_response({"promptConfig": prompt_config_settings(conn)})

    def handle_admin_put_prompt_config(self) -> None:
        self.require_admin()
        body = self.read_json()
        prompt_config = normalize_prompt_config(body.get("promptConfig"))
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                """,
                (PROMPT_CONFIG_KEY, prompt_config_json(prompt_config), now_iso()),
            )
        self.json_response({"ok": True, "promptConfig": prompt_config})


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


def provider_value(provider: dict | sqlite3.Row, camel_key: str, snake_key: str = ""):
    if isinstance(provider, sqlite3.Row):
        key = snake_key or camel_key
        return row_value(provider, key, "")
    if isinstance(provider, dict):
        return provider.get(camel_key) if camel_key in provider else provider.get(snake_key or camel_key)
    return ""


def resolve_provider_image_endpoint(provider: dict | sqlite3.Row, model: str) -> str:
    provider_type = normalize_provider_type(provider_value(provider, "providerType", "provider_type"))
    base_url = normalize_provider_base_url(provider_value(provider, "baseUrl", "base_url"), provider_type)
    if provider_type == PROVIDER_TYPE_AOKAPI_GEMINI:
        return resolve_image_endpoint(base_url, model)
    value = base_url.rstrip("/")
    if value.lower().endswith("/images/generations"):
        return value
    return f"{value}/images/generations"


def build_provider_image_request_body(
    *,
    prompt: str,
    count: int,
    size: str,
    model: str,
    endpoint: str,
    provider_type: str,
    references: list[dict],
) -> tuple[dict, str]:
    normalized_type = normalize_provider_type(provider_type)
    if normalized_type == PROVIDER_TYPE_AOKAPI_GEMINI:
        return build_image_request_body(
            prompt=prompt,
            count=count,
            size=size,
            model=model,
            endpoint=endpoint,
            references=references,
        )
    return (
        {
            "model": model,
            "prompt": prompt,
            "n": count,
            "size": size,
            "response_format": "b64_json",
        },
        "OpenAI image b64_json",
    )


def resolve_generation_prompt(body: dict, prompt_config: dict, references: list[dict]) -> tuple[str, str]:
    template_id = trim_text(str(body.get("templateId") or body.get("template_id") or "").strip(), 120)
    if template_id:
        prompt = single_template_prompt(prompt_config, template_id)
        if not prompt:
            raise AppError(HTTPStatus.BAD_REQUEST, "模板不存在或已停用")
        variant_index = clamp_int(body.get("variantIndex") or body.get("variant_index") or 0, 0, 999)
        if variant_index > 1:
            supplemental = prompt_text(
                prompt_config.get("single", {}).get("supplementalVariantPrompt", ""),
                {"index": variant_index},
            )
            prompt = "\n".join(part for part in (prompt, supplemental) if part)
        return with_strict_product_reference(
            with_reference_context(prompt, references, prompt_config),
            prompt_config,
        ), "template"

    prompt = trim_text(str(body.get("prompt") or "").strip(), 8000)
    if not prompt:
        raise AppError(HTTPStatus.BAD_REQUEST, "请选择模板")
    return prompt, "prompt"


def single_template_prompt(prompt_config: dict, template_id: str) -> str:
    for template in prompt_config.get("single", {}).get("templates", []):
        if str(template.get("id") or "") == template_id:
            return trim_text(str(template.get("prompt") or "").strip(), 8000)
    return ""


def prompt_text(template: str, values: dict) -> str:
    text = str(template or "")
    for key, value in values.items():
        text = text.replace("{" + str(key) + "}", str(value))
    return text


def with_reference_context(prompt: str, references: list[dict], prompt_config: dict) -> str:
    if not references:
        return prompt
    context = prompt_config.get("reference", {}).get("context", {})
    primary = references[0]
    size_text = prompt_text(context.get("sizeText", "，尺寸 {size}"), {"size": primary.get("size")}) if primary.get("size") else ""
    lines = [
        prompt_text(
            context.get("primaryLine", "参考图已随请求发送。首要参考图：「{name}」{sizeText}。"),
            {
                "name": primary.get("name") or context.get("defaultName", "参考图 1"),
                "sizeText": size_text,
            },
        ),
        prompt_text(context.get("extraLine", ""), {"count": len(references) - 1}) if len(references) > 1 else "",
        context.get("consistencyLine", ""),
        prompt,
    ]
    return "\n".join(line for line in lines if line)


def with_strict_product_reference(prompt: str, prompt_config: dict) -> str:
    text = str(prompt or "").strip()
    reference_config = prompt_config.get("reference", {})
    for needle in reference_config.get("strictRuleDedupeNeedles", []):
        if needle and needle in text:
            return text
    strict_rule = reference_config.get("strictRule") or ""
    return "\n\n".join(part for part in (strict_rule, text) if part)


def public_request_snapshot_body(
    request_body: dict,
    *,
    prompt_source: str,
    template_id,
    count: int,
    size: str,
    reference_count: int,
):
    if prompt_source == "template":
        return {
            "templateId": str(template_id or ""),
            "count": count,
            "size": size,
            "referenceImageCount": reference_count,
        }
    return sanitize_payload(request_body)


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
    if should_use_curl_transport(endpoint):
        try:
            return call_upstream_model_curl(endpoint, api_key, body)
        except FileNotFoundError:
            pass
        except subprocess.TimeoutExpired:
            raise UpstreamError(504, "请求远端模型超时", {"error": "curl timeout"})
        except UpstreamError:
            raise
        except Exception as error:
            raise UpstreamError(502, str(error), {"error": str(error)})
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": authorization_header_value(api_key, endpoint),
            "Connection": "close",
            "User-Agent": "image-editor-tool/1.0",
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
    except Exception as error:
        raise UpstreamError(502, str(error), {"error": str(error)})


def call_upstream_model_with_retry(endpoint: str, api_key: str, body: dict):
    last_error = None
    for attempt in range(1, UPSTREAM_MAX_ATTEMPTS + 1):
        try:
            return call_upstream_model(endpoint, api_key, body)
        except UpstreamError as error:
            last_error = error
            if attempt >= UPSTREAM_MAX_ATTEMPTS or not is_retryable_upstream_error(error):
                raise
            if UPSTREAM_RETRY_DELAY_SECONDS:
                time.sleep(UPSTREAM_RETRY_DELAY_SECONDS)
    raise last_error or UpstreamError(502, "接口请求失败", {"error": "retry exhausted"})


def is_retryable_upstream_error(error: UpstreamError) -> bool:
    message = str(error.message or "").lower()
    payload = error.payload if isinstance(error.payload, dict) else {}
    payload_error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(payload_error, dict):
        code = str(payload_error.get("code") or "").lower()
        error_type = str(payload_error.get("type") or "").lower()
        if code == "upstream_overloaded" or error_type == "rate_limit_error":
            return True
        if code == "network_proxy_dns" and error_type == "server_error":
            return True
    if error.status in {429, 500, 502, 503, 504} and (
        "overloaded" in message
        or "please retry" in message
        or "rate limit" in message
        or "upload image failed" in message
        or "upstream connect error" in message
        or "disconnect/reset" in message
        or "connection termination" in message
        ):
        return True
    return False


def is_failoverable_upstream_error(error: UpstreamError) -> bool:
    if error.status in {429, 500, 502, 503, 504}:
        return True
    message = str(error.message or "").lower()
    return "timeout" in message or "timed out" in message or "connection" in message or "未返回可识别" in message


def should_use_curl_transport(endpoint: str) -> bool:
    return "aokapi.com" in str(endpoint or "").lower() and bool(shutil.which("curl"))


def call_upstream_model_curl(endpoint: str, api_key: str, body: dict):
    marker = "\n__AIDX_HTTP_STATUS__:"
    body_path = ""
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as body_file:
            json.dump(body, body_file, ensure_ascii=False)
            body_path = body_file.name
        config = "\n".join(
            [
                "silent",
                "show-error",
                f"max-time = {curl_config_quote(str(UPSTREAM_TIMEOUT_SECONDS))}",
                'request = "POST"',
                f"url = {curl_config_quote(endpoint)}",
                f"header = {curl_config_quote('Content-Type: application/json')}",
                f"header = {curl_config_quote('Authorization: ' + authorization_header_value(api_key, endpoint))}",
                f"data-binary = {curl_config_quote('@' + body_path)}",
                f"write-out = {curl_config_quote(marker + '%{http_code}')}",
            ]
        )
        completed = subprocess.run(
            ["curl", "--config", "-"],
            input=config.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=UPSTREAM_TIMEOUT_SECONDS + 10,
            check=False,
        )
    finally:
        if body_path:
            try:
                os.unlink(body_path)
            except FileNotFoundError:
                pass
    stdout = completed.stdout.decode("utf-8", errors="replace")
    stderr = completed.stderr.decode("utf-8", errors="replace").strip()
    if completed.returncode != 0:
        raise UpstreamError(502, stderr or stdout or f"curl exited with {completed.returncode}", {"error": stderr or stdout})
    body_text, _, status_text = stdout.rpartition(marker)
    try:
        status = int(status_text.strip() or "0")
    except ValueError:
        raise UpstreamError(502, stdout or "curl response missing HTTP status", {"error": stdout})
    payload = parse_upstream_payload(body_text)
    if status < 200 or status >= 300:
        raise UpstreamError(status or 502, upstream_error_message(payload, f"HTTP {status}"), payload)
    return payload


def curl_config_quote(value: str) -> str:
    return '"' + str(value or "").replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


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
) -> str:
    usage = extract_token_usage(request_body, response_body)
    log_id = make_id("log")
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO generation_logs
              (id, user_id, endpoint, model, prompt, size, count, image_count, status, error,
               request_json, response_json, input_tokens, output_tokens, total_tokens, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                log_id,
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
    return log_id


def save_generated_assets(
    *,
    user_id: str,
    log_id: str,
    endpoint: str,
    model: str,
    prompt: str,
    size: str,
    images: list[dict],
    request_snapshot: dict,
) -> list[dict]:
    created_at = now_iso()
    name_stamp = created_at.replace("-", "").replace(":", "").replace("T", "-").replace("Z", "")
    records = []
    for index, image in enumerate(images, start=1):
        url = str(image.get("url") or "").strip()
        if not url:
            continue
        records.append(
            {
                "id": make_id("asset"),
                "user_id": user_id,
                "log_id": log_id,
                "image_url": url,
                "name": trim_text(str(image.get("name") or f"生成图 {name_stamp}-{index}"), 160),
                "endpoint": trim_text(endpoint, 800),
                "model": trim_text(model, 160),
                "prompt": trim_text(prompt, 4000),
                "size": trim_text(size, 80),
                "source": trim_text(str(image.get("source") or "generation"), 80),
                "request_json": trim_json(request_snapshot),
                "created_at": created_at,
            }
        )
    if not records:
        return []
    with connect() as conn:
        conn.executemany(
            """
            INSERT INTO generated_assets
              (id, user_id, log_id, image_url, name, endpoint, model, prompt, size, source, request_json, created_at)
            VALUES
              (:id, :user_id, :log_id, :image_url, :name, :endpoint, :model, :prompt, :size, :source, :request_json, :created_at)
            """,
            records,
        )
    return [{"id": record["id"], "createdAt": record["created_at"]} for record in records]


def row_generated_asset(row: sqlite3.Row) -> dict:
    request = parse_json_field(row["request_json"])
    request_body = request.get("body") if isinstance(request, dict) and isinstance(request.get("body"), dict) else {}
    template_id = str(request_body.get("templateId") or "").strip()
    prompt = f"模板：{template_id}" if template_id else row["prompt"]
    return {
        "id": row["id"],
        "logId": row["log_id"],
        "url": row["image_url"],
        "name": row["name"],
        "endpoint": row["endpoint"],
        "model": row["model"],
        "prompt": prompt,
        "size": row["size"],
        "source": row["source"],
        "request": request,
        "createdAt": row["created_at"],
    }


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
