#!/usr/bin/env python3
"""Cloud backend for the AI image editor.

Zero third-party dependencies on purpose: this can run locally with Python's
standard library, but still gives the app real users, SQLite persistence,
quota accounting, cloud assets, generation history, and a deployable HTTP API.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
STORAGE_DIR = Path(os.environ.get("IMAGE_STUDIO_STORAGE", ROOT / "storage")).resolve()
DB_PATH = Path(os.environ.get("IMAGE_STUDIO_DB", STORAGE_DIR / "image_studio.sqlite")).resolve()
MEDIA_ROOT = STORAGE_DIR / "media"

DEFAULT_ENDPOINT = os.environ.get(
    "IMAGE_API_ENDPOINT", "https://aokapi.com/v1beta/models/gemini-2.5-flash-image:generateContent/"
)
DEFAULT_MODEL = os.environ.get("IMAGE_API_MODEL", "gemini-2.5-flash-image")
IMAGE_API_KEY = os.environ.get("IMAGE_API_KEY", "")
ALLOW_CLIENT_IMAGE_CONFIG = os.environ.get("ALLOW_CLIENT_IMAGE_CONFIG", "").lower() in {"1", "true", "yes"}
FREE_QUOTA = int(os.environ.get("FREE_QUOTA_CREDITS", "20"))
CREDITS_PER_IMAGE = int(os.environ.get("CREDITS_PER_IMAGE", "1"))
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "14"))
CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "*")
MOCK_BILLING_AUTOGRANT = os.environ.get("MOCK_BILLING_AUTOGRANT", "1").lower() in {"1", "true", "yes"}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def parse_iso(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              password_salt TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              plan TEXT NOT NULL DEFAULT 'free',
              quota_balance INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL,
              expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS folders (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(user_id, name)
            );

            CREATE TABLE IF NOT EXISTS assets (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              url TEXT NOT NULL,
              storage_path TEXT,
              prompt TEXT,
              source TEXT,
              model TEXT,
              size TEXT,
              metadata_json TEXT,
              created_at TEXT NOT NULL,
              saved_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS generations (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              prompt TEXT NOT NULL,
              model TEXT NOT NULL,
              size TEXT NOT NULL,
              count INTEGER NOT NULL,
              reference_count INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL,
              error TEXT,
              credit_cost INTEGER NOT NULL DEFAULT 0,
              request_json TEXT,
              created_at TEXT NOT NULL,
              completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS generation_images (
              id TEXT PRIMARY KEY,
              generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              url TEXT NOT NULL,
              storage_path TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS quota_ledger (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              delta INTEGER NOT NULL,
              reason TEXT NOT NULL,
              ref_type TEXT,
              ref_id TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS plans (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              price_cents INTEGER NOT NULL,
              credits INTEGER NOT NULL,
              description TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS billing_orders (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              plan_id TEXT NOT NULL REFERENCES plans(id),
              amount_cents INTEGER NOT NULL,
              credits INTEGER NOT NULL,
              status TEXT NOT NULL,
              provider TEXT NOT NULL,
              checkout_url TEXT,
              created_at TEXT NOT NULL,
              paid_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_assets_user_saved ON assets(user_id, saved_at);
            CREATE INDEX IF NOT EXISTS idx_generations_user_created ON generations(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON quota_ledger(user_id, created_at);
            """
        )
        seed_plans(conn)


def seed_plans(conn: sqlite3.Connection) -> None:
    plans = [
        ("starter", "Starter", 2900, 200, "适合个人店铺与轻量测试"),
        ("growth", "Growth", 9900, 900, "适合稳定批量出图团队"),
        ("studio", "Studio", 29900, 3200, "适合多人协作和高频生成"),
    ]
    for plan in plans:
        conn.execute(
            """
            INSERT INTO plans (id, name, price_cents, credits, description)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name=excluded.name,
              price_cents=excluded.price_cents,
              credits=excluded.credits,
              description=excluded.description
            """,
            plan,
        )


def password_digest(password: str, salt: str) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 200_000)
    return digest.hex()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def clean_email(value: str) -> str:
    return value.strip().lower()


def public_media_url(storage_path: str) -> str:
    return "/" + storage_path.replace(os.sep, "/")


def safe_name(value: str, fallback: str = "image") -> str:
    text = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "-", str(value or "")).strip()
    return text[:96] or fallback


def json_compact(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def parse_json_bytes(raw: bytes) -> object:
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def row_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "plan": row["plan"],
        "quotaBalance": row["quota_balance"],
        "createdAt": row["created_at"],
    }


def row_folder(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"], "createdAt": row["created_at"]}


def row_asset(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "folderId": row["folder_id"],
        "folderName": row["folder_name"] if "folder_name" in row.keys() else "",
        "name": row["name"],
        "url": row["url"],
        "prompt": row["prompt"] or "",
        "source": row["source"] or "",
        "model": row["model"] or "",
        "size": row["size"] or "",
        "metadata": json.loads(row["metadata_json"] or "{}"),
        "createdAt": row["created_at"],
        "savedAt": row["saved_at"],
    }


def row_plan(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "priceCents": row["price_cents"],
        "credits": row["credits"],
        "description": row["description"],
    }


def row_generation(row: sqlite3.Row, images: list[dict] | None = None) -> dict:
    return {
        "id": row["id"],
        "prompt": row["prompt"],
        "model": row["model"],
        "size": row["size"],
        "count": row["count"],
        "referenceCount": row["reference_count"],
        "status": row["status"],
        "error": row["error"] or "",
        "creditCost": row["credit_cost"],
        "createdAt": row["created_at"],
        "completedAt": row["completed_at"] or "",
        "images": images or [],
    }


def get_default_folder(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM folders WHERE user_id=? ORDER BY created_at LIMIT 1", (user_id,)
    ).fetchone()
    if row:
        return row
    folder_id = make_id("folder")
    conn.execute(
        "INSERT INTO folders (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
        (folder_id, user_id, "未分类素材", now_iso()),
    )
    return conn.execute("SELECT * FROM folders WHERE id=?", (folder_id,)).fetchone()


def get_or_create_folder(conn: sqlite3.Connection, user_id: str, folder_id: str | None, new_name: str | None) -> sqlite3.Row:
    if new_name:
        existing = conn.execute(
            "SELECT * FROM folders WHERE user_id=? AND name=?", (user_id, new_name)
        ).fetchone()
        if existing:
            return existing
        new_id = make_id("folder")
        conn.execute(
            "INSERT INTO folders (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
            (new_id, user_id, safe_name(new_name, "新文件夹"), now_iso()),
        )
        return conn.execute("SELECT * FROM folders WHERE id=?", (new_id,)).fetchone()

    if folder_id:
        folder = conn.execute(
            "SELECT * FROM folders WHERE id=? AND user_id=?", (folder_id, user_id)
        ).fetchone()
        if folder:
            return folder
    return get_default_folder(conn, user_id)


def parse_data_url(value: str) -> tuple[str, bytes] | None:
    match = re.match(r"^data:([^;,]+)?(?:;base64)?,(.*)$", value, re.S)
    if not match:
        return None
    mime = match.group(1) or "application/octet-stream"
    payload = match.group(2)
    if ";base64," in value[:100]:
        return mime, base64.b64decode(payload)
    return mime, urllib.parse.unquote_to_bytes(payload)


def extension_for_mime(mime: str) -> str:
    if mime == "image/svg+xml":
        return ".svg"
    return mimetypes.guess_extension(mime) or ".png"


def persist_image(user_id: str, image_url: str, namespace: str) -> tuple[str, str | None]:
    if not image_url:
        raise ValueError("图片地址不能为空")

    data = parse_data_url(image_url)
    if not data:
        return image_url, None

    mime, bytes_value = data
    ext = extension_for_mime(mime)
    media_dir = MEDIA_ROOT / user_id / namespace
    media_dir.mkdir(parents=True, exist_ok=True)
    file_name = f"{uuid.uuid4().hex}{ext}"
    path = media_dir / file_name
    path.write_bytes(bytes_value)
    storage_path = str(path.relative_to(STORAGE_DIR))
    return public_media_url(storage_path), storage_path


def sanitize_request_payload(value: object) -> object:
    if isinstance(value, list):
        return [sanitize_request_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_request_payload(entry) for key, entry in value.items()}
    if isinstance(value, str):
        if value.startswith("data:image/"):
            prefix, _, data = value.partition(",")
            return f"{prefix},[base64 image truncated, length {len(data)}]"
        if re.fullmatch(r"[A-Za-z0-9+/=]{400,}", value):
            return f"[base64 image truncated, length {len(value)}]"
    return value


def normalize_references(references: object) -> list[dict]:
    if not isinstance(references, list):
        return []
    seen = set()
    normalized = []
    for item in references:
        if not isinstance(item, dict) or not item.get("url"):
            continue
        url = str(item["url"])
        if url in seen:
            continue
        seen.add(url)
        normalized.append(
            {
                "name": str(item.get("name") or "参考图"),
                "size": str(item.get("size") or ""),
                "url": url,
            }
        )
        if len(normalized) >= 3:
            break
    return normalized


def reference_payload_strategies(references: list[dict]) -> list[tuple[str, dict]]:
    urls = [item["url"] for item in references]
    base64_images = [strip_data_url_prefix(item["url"]) for item in references]
    objects = [{"type": "input_image", "image_url": item["url"]} for item in references]
    return [
        ("reference_images", {"reference_images": urls}),
        ("images", {"images": urls}),
        ("image_urls", {"image_urls": urls}),
        ("input_images", {"input_images": objects}),
        ("image", {"image": urls[0]}),
        ("reference_images_base64", {"reference_images": base64_images}),
        ("images_base64", {"images": base64_images}),
        ("image_base64", {"image": base64_images[0]}),
    ]


def strip_data_url_prefix(value: str) -> str:
    return re.sub(r"^data:[^,]+,", "", value)


def mock_image(prompt: str, index: int, size: str) -> str:
    width, height = 1024, 1024
    match = re.match(r"^(\d+)x(\d+)$", size or "")
    if match:
        width, height = int(match.group(1)), int(match.group(2))
    title = "AI Image Studio"
    prompt_line = re.sub(r"\s+", " ", prompt).strip()[:130]
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#eef8ff"/>
      <stop offset=".55" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e8fff7"/>
    </linearGradient>
    <pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0v40" fill="none" stroke="#8ecae6" stroke-opacity=".25"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#p)"/>
  <rect x="{width * 0.12}" y="{height * 0.14}" width="{width * 0.76}" height="{height * 0.58}" rx="12" fill="#fff" stroke="#9fc5d8"/>
  <circle cx="{width * 0.5}" cy="{height * 0.38}" r="{min(width, height) * 0.16}" fill="#dff8ed" stroke="#12b886"/>
  <text x="{width * 0.5}" y="{height * 0.78}" text-anchor="middle" font-family="Avenir, sans-serif" font-size="{max(24, width // 34)}" fill="#1264e8" font-weight="800">{title} #{index}</text>
  <text x="{width * 0.5}" y="{height * 0.84}" text-anchor="middle" font-family="Avenir, sans-serif" font-size="{max(16, width // 56)}" fill="#5b6c7d">{escape_xml(prompt_line)}</text>
</svg>"""
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")


def escape_xml(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


class UpstreamError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


def should_retry_reference(error: UpstreamError) -> bool:
    if error.status not in {400, 404, 415, 422}:
        return False
    message = error.message.lower()
    return any(
        keyword in message
        for keyword in ["unknown", "unsupported", "invalid", "unrecognized", "unexpected", "reference", "image", "param", "field", "format"]
    )


def resolve_image_endpoint(endpoint: str, model: str) -> str:
    value = (endpoint or DEFAULT_ENDPOINT).strip() or DEFAULT_ENDPOINT
    selected_model = urllib.parse.quote(model or DEFAULT_MODEL, safe="")
    if "{model}" in value:
        return value.replace("{model}", selected_model)
    if is_gemini_image_endpoint(value, model):
        return re.sub(
            r"/v1beta/models/[^/:]+:generateContent/?$",
            f"/v1beta/models/{selected_model}:generateContent/",
            value,
        )
    return value


def is_gemini_image_endpoint(endpoint: str, model: str = "") -> bool:
    value = f"{endpoint or ''} {model or ''}".lower()
    return (
        "generatecontent" in value
        or "gemini-2.5-flash-image" in value
        or "gemini-3-pro-image" in value
    )


def authorization_header_value(api_key: str, endpoint: str) -> str:
    value = (api_key or "").strip()
    if value.lower().startswith("bearer "):
        return value
    if is_gemini_image_endpoint(endpoint) or "aokapi.com" in endpoint.lower():
        return value
    return f"Bearer {value}"


def build_gemini_image_body(prompt: str, size: str, references: list[dict]) -> dict:
    parts: list[dict] = [{"text": prompt}]
    for reference in references:
        inline = reference_to_inline_data(reference)
        if inline:
            parts.append({"inlineData": inline})
    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": gemini_image_config_from_size(size),
        },
    }


def reference_to_inline_data(reference: dict) -> dict | None:
    url = str(reference.get("url") or "")
    if not url:
        return None
    data_url = parse_data_url(url)
    if data_url:
        mime, bytes_value = data_url
        return {"data": base64.b64encode(bytes_value).decode("ascii"), "mimeType": mime or "image/png"}

    bytes_value, mime = read_reference_bytes(url)
    if not bytes_value:
        return None
    return {"data": base64.b64encode(bytes_value).decode("ascii"), "mimeType": mime or "image/png"}


def read_reference_bytes(url: str) -> tuple[bytes | None, str]:
    if url.startswith("/media/") or url.startswith("media/"):
        path = (STORAGE_DIR / url.lstrip("/")).resolve()
        if str(path).startswith(str(STORAGE_DIR.resolve())) and path.exists():
            return path.read_bytes(), mimetypes.guess_type(str(path))[0] or "image/png"
        return None, "image/png"

    if url.startswith("http://") or url.startswith("https://"):
        request = urllib.request.Request(url, headers={"User-Agent": "ImageStudioCloud/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            mime = response.headers.get_content_type() or "image/png"
            return response.read(), mime

    return None, "image/png"


def gemini_image_config_from_size(size: str) -> dict:
    match = re.match(r"^(\d+)x(\d+)$", str(size or "").strip())
    if not match:
        return {"aspectRatio": "1:1", "imageSize": "1K"}
    width = int(match.group(1))
    height = int(match.group(2))
    return {
        "aspectRatio": nearest_gemini_aspect_ratio(width, height),
        "imageSize": "2K" if max(width, height) > 1200 else "1K",
    }


def nearest_gemini_aspect_ratio(width: int, height: int) -> str:
    ratio = width / height
    options = {
        "1:1": 1,
        "16:9": 16 / 9,
        "9:16": 9 / 16,
        "4:3": 4 / 3,
        "3:4": 3 / 4,
    }
    return min(options.items(), key=lambda item: abs(item[1] - ratio))[0]


def extract_image_urls_from_payload(payload: object) -> list[dict]:
    images: list[dict] = []
    if isinstance(payload, dict):
        data = payload.get("data") if isinstance(payload.get("data"), list) else payload.get("images")
        if isinstance(data, list):
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

        for candidate in payload.get("candidates") or []:
            for part in candidate.get("content", {}).get("parts") or []:
                inline = part.get("inlineData") or part.get("inline_data")
                if isinstance(inline, dict) and inline.get("data"):
                    mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                    images.append({"url": f"data:{mime};base64,{inline['data']}"})

        for choice in payload.get("choices") or []:
            content = choice.get("message", {}).get("content") or choice.get("text") or ""
            for match in re.findall(r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+", content):
                images.append({"url": match})
    return [image for image in images if image.get("url")]


def call_upstream(endpoint: str, api_key: str, body: dict) -> list[dict]:
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
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
            message = payload.get("error", {}).get("message") or payload.get("message") or error.reason
        except Exception:
            message = raw or error.reason
        raise UpstreamError(error.code, message)
    except urllib.error.URLError as error:
        raise UpstreamError(502, str(error.reason))

    images = extract_image_urls_from_payload(payload)
    if not images:
        raise UpstreamError(502, "模型接口未返回可识别的图片")
    return images


def generate_images(body: dict) -> tuple[list[dict], dict]:
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt 不能为空")
    count = max(1, min(int(body.get("count") or body.get("n") or 1), 8))
    size = str(body.get("size") or "1024x1024")
    model = str(body.get("model") or os.environ.get("IMAGE_API_MODEL") or DEFAULT_MODEL)
    endpoint = str(body.get("endpoint") or DEFAULT_ENDPOINT)
    endpoint = resolve_image_endpoint(endpoint, model)
    api_key = IMAGE_API_KEY

    if ALLOW_CLIENT_IMAGE_CONFIG:
        endpoint = resolve_image_endpoint(str(body.get("endpoint") or endpoint), model)
        api_key = str(body.get("apiKey") or api_key)

    base_payload = {"model": model, "prompt": prompt, "n": count, "size": size}
    references = normalize_references(body.get("referenceImages"))
    if not api_key:
        images = [{"url": mock_image(prompt, index + 1, size)} for index in range(count)]
        return images, {"endpoint": "mock://image-generator", "body": sanitize_request_payload(base_payload)}

    if is_gemini_image_endpoint(endpoint, model):
        images: list[dict] = []
        request_meta: dict | None = None
        calls = 0
        while len(images) < count:
            calls += 1
            call_prompt = prompt
            if calls > 1:
                call_prompt = (
                    prompt
                    + f"\n\n请生成第 {calls} 张变体，保持同一商品和同一设计方向，但构图、角度或背景细节与前面图片有区别。"
                )
            gemini_body = build_gemini_image_body(call_prompt, size, references)
            if request_meta is None:
                request_meta = {
                    "endpoint": endpoint,
                    "referenceStrategy": "Gemini inlineData" if references else "Gemini text",
                    "body": sanitize_request_payload(gemini_body),
                }
            images.extend(call_upstream(endpoint, api_key, gemini_body))
        request_meta = request_meta or {"endpoint": endpoint, "body": {}}
        request_meta["calls"] = calls
        return images[:count], request_meta

    if not references:
        return call_upstream(endpoint, api_key, base_payload), {
            "endpoint": endpoint,
            "body": sanitize_request_payload(base_payload),
        }

    last_error: UpstreamError | None = None
    for strategy_name, strategy_payload in reference_payload_strategies(references):
        payload = {**base_payload, **strategy_payload}
        try:
            return call_upstream(endpoint, api_key, payload), {
                "endpoint": endpoint,
                "referenceStrategy": strategy_name,
                "body": sanitize_request_payload(payload),
            }
        except UpstreamError as error:
            if not should_retry_reference(error):
                raise
            last_error = error

    if last_error:
        payload = {
            **base_payload,
            "prompt": (
                prompt
                + "\n\n注意：当前上游接口未接受图片字段，本次降级为提示词锁定；请检查模型的参考图入参格式。"
            ),
        }
        return call_upstream(endpoint, api_key, payload), {
            "endpoint": endpoint,
            "referenceStrategy": "prompt_fallback",
            "body": sanitize_request_payload(payload),
            "fallbackError": last_error.message,
        }
    raise UpstreamError(502, "参考图生成失败")


class Handler(BaseHTTPRequestHandler):
    server_version = "ImageStudioCloud/1.0"

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.add_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        try:
            self.route("GET")
        except Exception as error:
            self.fail(error)

    def do_POST(self) -> None:
        try:
            self.route("POST")
        except Exception as error:
            self.fail(error)

    def do_PATCH(self) -> None:
        try:
            self.route("PATCH")
        except Exception as error:
            self.fail(error)

    def do_DELETE(self) -> None:
        try:
            self.route("DELETE")
        except Exception as error:
            self.fail(error)

    def route(self, method: str) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/health" and method == "GET":
            return self.json_response({"ok": True, "time": now_iso(), "db": str(DB_PATH)})
        if path == "/api/auth/register" and method == "POST":
            return self.handle_register()
        if path == "/api/auth/login" and method == "POST":
            return self.handle_login()
        if path == "/api/auth/logout" and method == "POST":
            return self.handle_logout()
        if path == "/api/me" and method == "GET":
            return self.handle_me()
        if path == "/api/folders":
            if method == "GET":
                return self.handle_list_folders()
            if method == "POST":
                return self.handle_create_folder()
        if path == "/api/assets":
            if method == "GET":
                return self.handle_list_assets(query)
            if method == "POST":
                return self.handle_create_asset()
        if path.startswith("/api/assets/"):
            asset_id = path.rsplit("/", 1)[-1]
            if method == "PATCH":
                return self.handle_update_asset(asset_id)
            if method == "DELETE":
                return self.handle_delete_asset(asset_id)
        if path == "/api/generations" and method == "GET":
            return self.handle_list_generations()
        if path == "/api/generate" and method == "POST":
            return self.handle_generate()
        if path == "/api/billing/plans" and method == "GET":
            return self.handle_list_plans()
        if path == "/api/billing/checkout" and method == "POST":
            return self.handle_checkout()
        if path.startswith("/api/billing/mock-pay/") and method == "POST":
            order_id = path.rsplit("/", 1)[-1]
            return self.handle_mock_pay(order_id)

        if method == "GET":
            return self.serve_static(path)
        self.json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        value = parse_json_bytes(raw)
        if not isinstance(value, dict):
            raise ValueError("请求体必须是 JSON 对象")
        return value

    def json_response(self, payload: object, status: int = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.add_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def add_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type")

    def fail(self, error: Exception) -> None:
        if isinstance(error, PermissionError):
            self.json_response({"error": str(error)}, HTTPStatus.UNAUTHORIZED)
            return
        if isinstance(error, ValueError):
            self.json_response({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return
        if isinstance(error, UpstreamError):
            self.json_response({"error": error.message}, error.status)
            return
        self.json_response({"error": f"服务器错误：{error}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def auth_user(self, conn: sqlite3.Connection) -> sqlite3.Row:
        header = self.headers.get("Authorization", "")
        match = re.match(r"Bearer\s+(.+)", header)
        if not match:
            raise PermissionError("请先登录")
        token_hash = hash_token(match.group(1).strip())
        session = conn.execute(
            """
            SELECT users.*, sessions.expires_at AS session_expires_at
            FROM sessions
            JOIN users ON users.id=sessions.user_id
            WHERE sessions.token_hash=?
            """,
            (token_hash,),
        ).fetchone()
        if not session:
            raise PermissionError("登录已失效")
        if parse_iso(session["session_expires_at"]) < dt.datetime.now(dt.timezone.utc):
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
            raise PermissionError("登录已过期")
        return session

    def create_session(self, conn: sqlite3.Connection, user_id: str) -> str:
        token = secrets.token_urlsafe(36)
        expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=SESSION_DAYS)
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (hash_token(token), user_id, now_iso(), expires.isoformat(timespec="seconds")),
        )
        return token

    def handle_register(self) -> None:
        body = self.read_json()
        email = clean_email(str(body.get("email") or ""))
        password = str(body.get("password") or "")
        name = safe_name(body.get("name") or email.split("@")[0] or "用户", "用户")
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("请输入有效邮箱")
        if len(password) < 8:
            raise ValueError("密码至少 8 位")
        salt = secrets.token_hex(16)
        user_id = make_id("user")
        with connect() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO users (id, email, name, password_salt, password_hash, plan, quota_balance, created_at)
                    VALUES (?, ?, ?, ?, ?, 'free', ?, ?)
                    """,
                    (user_id, email, name, salt, password_digest(password, salt), FREE_QUOTA, now_iso()),
                )
            except sqlite3.IntegrityError:
                raise ValueError("该邮箱已注册")
            conn.execute(
                "INSERT INTO quota_ledger (id, user_id, delta, reason, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (make_id("quota"), user_id, FREE_QUOTA, "new_user_free_quota", "user", user_id, now_iso()),
            )
            get_default_folder(conn, user_id)
            token = self.create_session(conn, user_id)
            user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        self.json_response({"token": token, "user": row_user(user)})

    def handle_login(self) -> None:
        body = self.read_json()
        email = clean_email(str(body.get("email") or ""))
        password = str(body.get("password") or "")
        with connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            if not user:
                raise PermissionError("邮箱或密码不正确")
            candidate = password_digest(password, user["password_salt"])
            if not hmac.compare_digest(candidate, user["password_hash"]):
                raise PermissionError("邮箱或密码不正确")
            token = self.create_session(conn, user["id"])
        self.json_response({"token": token, "user": row_user(user)})

    def handle_logout(self) -> None:
        header = self.headers.get("Authorization", "")
        match = re.match(r"Bearer\s+(.+)", header)
        if match:
            with connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash=?", (hash_token(match.group(1).strip()),))
        self.json_response({"ok": True})

    def handle_me(self) -> None:
        with connect() as conn:
            user = self.auth_user(conn)
            counts = conn.execute(
                """
                SELECT
                  (SELECT COUNT(*) FROM folders WHERE user_id=?) AS folders,
                  (SELECT COUNT(*) FROM assets WHERE user_id=?) AS assets,
                  (SELECT COUNT(*) FROM generations WHERE user_id=?) AS generations
                """,
                (user["id"], user["id"], user["id"]),
            ).fetchone()
        self.json_response({"user": row_user(user), "counts": dict(counts)})

    def handle_list_folders(self) -> None:
        with connect() as conn:
            user = self.auth_user(conn)
            get_default_folder(conn, user["id"])
            rows = conn.execute(
                "SELECT * FROM folders WHERE user_id=? ORDER BY created_at ASC", (user["id"],)
            ).fetchall()
        self.json_response({"folders": [row_folder(row) for row in rows]})

    def handle_create_folder(self) -> None:
        body = self.read_json()
        name = safe_name(body.get("name"), "新文件夹")
        with connect() as conn:
            user = self.auth_user(conn)
            folder = get_or_create_folder(conn, user["id"], None, name)
        self.json_response({"folder": row_folder(folder)}, HTTPStatus.CREATED)

    def handle_list_assets(self, query: dict) -> None:
        search = (query.get("search") or [""])[0].strip().lower()
        folder_id = (query.get("folderId") or [""])[0]
        with connect() as conn:
            user = self.auth_user(conn)
            params: list[object] = [user["id"]]
            clauses = ["assets.user_id=?"]
            if folder_id and folder_id != "all":
                clauses.append("assets.folder_id=?")
                params.append(folder_id)
            if search:
                clauses.append(
                    "(lower(assets.name) LIKE ? OR lower(assets.prompt) LIKE ? OR lower(folders.name) LIKE ?)"
                )
                params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
            rows = conn.execute(
                f"""
                SELECT assets.*, folders.name AS folder_name
                FROM assets
                JOIN folders ON folders.id=assets.folder_id
                WHERE {' AND '.join(clauses)}
                ORDER BY assets.saved_at DESC
                """,
                params,
            ).fetchall()
        self.json_response({"assets": [row_asset(row) for row in rows]})

    def handle_create_asset(self) -> None:
        body = self.read_json()
        url = str(body.get("url") or "")
        name = safe_name(body.get("name"), "未命名图片")
        with connect() as conn:
            user = self.auth_user(conn)
            folder = get_or_create_folder(
                conn,
                user["id"],
                str(body.get("folderId") or "") or None,
                str(body.get("newFolderName") or "").strip() or None,
            )
            public_url, storage_path = persist_image(user["id"], url, "assets")
            asset_id = make_id("asset")
            created_at = str(body.get("createdAt") or now_iso())
            saved_at = now_iso()
            conn.execute(
                """
                INSERT INTO assets
                  (id, user_id, folder_id, name, url, storage_path, prompt, source, model, size, metadata_json, created_at, saved_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    asset_id,
                    user["id"],
                    folder["id"],
                    name,
                    public_url,
                    storage_path,
                    str(body.get("prompt") or ""),
                    str(body.get("source") or ""),
                    str(body.get("model") or ""),
                    str(body.get("size") or ""),
                    json_compact(body.get("metadata") or {}),
                    created_at,
                    saved_at,
                ),
            )
            row = conn.execute(
                """
                SELECT assets.*, folders.name AS folder_name
                FROM assets JOIN folders ON folders.id=assets.folder_id
                WHERE assets.id=?
                """,
                (asset_id,),
            ).fetchone()
        self.json_response({"asset": row_asset(row)}, HTTPStatus.CREATED)

    def handle_update_asset(self, asset_id: str) -> None:
        body = self.read_json()
        with connect() as conn:
            user = self.auth_user(conn)
            asset = conn.execute("SELECT * FROM assets WHERE id=? AND user_id=?", (asset_id, user["id"])).fetchone()
            if not asset:
                self.json_response({"error": "素材不存在"}, HTTPStatus.NOT_FOUND)
                return
            name = safe_name(body.get("name") or asset["name"], asset["name"])
            folder_id = str(body.get("folderId") or asset["folder_id"])
            folder = get_or_create_folder(conn, user["id"], folder_id, None)
            conn.execute(
                "UPDATE assets SET name=?, folder_id=? WHERE id=? AND user_id=?",
                (name, folder["id"], asset_id, user["id"]),
            )
            row = conn.execute(
                """
                SELECT assets.*, folders.name AS folder_name
                FROM assets JOIN folders ON folders.id=assets.folder_id
                WHERE assets.id=?
                """,
                (asset_id,),
            ).fetchone()
        self.json_response({"asset": row_asset(row)})

    def handle_delete_asset(self, asset_id: str) -> None:
        with connect() as conn:
            user = self.auth_user(conn)
            asset = conn.execute("SELECT * FROM assets WHERE id=? AND user_id=?", (asset_id, user["id"])).fetchone()
            if not asset:
                self.json_response({"ok": True})
                return
            conn.execute("DELETE FROM assets WHERE id=? AND user_id=?", (asset_id, user["id"]))
        self.json_response({"ok": True})

    def handle_list_generations(self) -> None:
        with connect() as conn:
            user = self.auth_user(conn)
            rows = conn.execute(
                "SELECT * FROM generations WHERE user_id=? ORDER BY created_at DESC LIMIT 80", (user["id"],)
            ).fetchall()
            generation_ids = [row["id"] for row in rows]
            images_by_generation: dict[str, list[dict]] = {generation_id: [] for generation_id in generation_ids}
            if generation_ids:
                placeholders = ",".join("?" for _ in generation_ids)
                image_rows = conn.execute(
                    f"SELECT * FROM generation_images WHERE generation_id IN ({placeholders}) ORDER BY created_at ASC",
                    generation_ids,
                ).fetchall()
                for image in image_rows:
                    images_by_generation[image["generation_id"]].append(
                        {"id": image["id"], "name": image["name"], "url": image["url"], "createdAt": image["created_at"]}
                    )
        self.json_response({"generations": [row_generation(row, images_by_generation[row["id"]]) for row in rows]})

    def handle_generate(self) -> None:
        body = self.read_json()
        count = max(1, min(int(body.get("count") or body.get("n") or 1), 8))
        cost = count * CREDITS_PER_IMAGE
        references = normalize_references(body.get("referenceImages"))
        prompt = str(body.get("prompt") or "").strip()
        size = str(body.get("size") or "1024x1024")
        model = str(body.get("model") or DEFAULT_MODEL)
        if not prompt:
            raise ValueError("prompt 不能为空")

        with connect() as conn:
            user = self.auth_user(conn)
            fresh_user = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
            if fresh_user["quota_balance"] < cost:
                self.json_response(
                    {"error": f"配额不足，本次需要 {cost} 点，当前剩余 {fresh_user['quota_balance']} 点"},
                    HTTPStatus.PAYMENT_REQUIRED,
                )
                return
            generation_id = make_id("gen")
            conn.execute(
                """
                INSERT INTO generations
                  (id, user_id, prompt, model, size, count, reference_count, status, credit_cost, request_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
                """,
                (
                    generation_id,
                    user["id"],
                    prompt,
                    model,
                    size,
                    count,
                    len(references),
                    cost,
                    json_compact(sanitize_request_payload(body)),
                    now_iso(),
                ),
            )

        try:
            images, request_meta = generate_images({**body, "count": count, "size": size, "model": model})
        except Exception as error:
            with connect() as conn:
                conn.execute(
                    "UPDATE generations SET status='failed', error=?, completed_at=? WHERE id=?",
                    (str(error), now_iso(), generation_id),
                )
            raise

        saved_images = []
        with connect() as conn:
            user = self.auth_user(conn)
            for index, image in enumerate(images[:count], start=1):
                public_url, storage_path = persist_image(user["id"], image["url"], "generated")
                image_id = make_id("img")
                image_name = f"生成图片-{index}"
                conn.execute(
                    """
                    INSERT INTO generation_images (id, generation_id, user_id, name, url, storage_path, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (image_id, generation_id, user["id"], image_name, public_url, storage_path, now_iso()),
                )
                saved_images.append({"id": image_id, "name": image_name, "url": public_url, "createdAt": now_iso()})

            conn.execute(
                "UPDATE users SET quota_balance=quota_balance-? WHERE id=?",
                (cost, user["id"]),
            )
            conn.execute(
                """
                INSERT INTO quota_ledger (id, user_id, delta, reason, ref_type, ref_id, created_at)
                VALUES (?, ?, ?, 'image_generation', 'generation', ?, ?)
                """,
                (make_id("quota"), user["id"], -cost, generation_id, now_iso()),
            )
            conn.execute(
                "UPDATE generations SET status='completed', completed_at=?, request_json=? WHERE id=?",
                (now_iso(), json_compact(request_meta), generation_id),
            )
            updated_user = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
            generation = conn.execute("SELECT * FROM generations WHERE id=?", (generation_id,)).fetchone()

        self.json_response(
            {
                "images": [{"url": image["url"]} for image in saved_images],
                "generation": row_generation(generation, saved_images),
                "quota": {"balance": updated_user["quota_balance"], "cost": cost},
                "request": request_meta,
            }
        )

    def handle_list_plans(self) -> None:
        with connect() as conn:
            rows = conn.execute("SELECT * FROM plans ORDER BY price_cents ASC").fetchall()
        self.json_response({"plans": [row_plan(row) for row in rows]})

    def handle_checkout(self) -> None:
        body = self.read_json()
        plan_id = str(body.get("planId") or "")
        with connect() as conn:
            user = self.auth_user(conn)
            plan = conn.execute("SELECT * FROM plans WHERE id=?", (plan_id,)).fetchone()
            if not plan:
                raise ValueError("套餐不存在")
            order_id = make_id("order")
            status = "paid" if MOCK_BILLING_AUTOGRANT else "pending"
            paid_at = now_iso() if status == "paid" else None
            checkout_url = f"/api/billing/mock-pay/{order_id}"
            conn.execute(
                """
                INSERT INTO billing_orders
                  (id, user_id, plan_id, amount_cents, credits, status, provider, checkout_url, created_at, paid_at)
                VALUES (?, ?, ?, ?, ?, ?, 'mock', ?, ?, ?)
                """,
                (
                    order_id,
                    user["id"],
                    plan["id"],
                    plan["price_cents"],
                    plan["credits"],
                    status,
                    checkout_url,
                    now_iso(),
                    paid_at,
                ),
            )
            if status == "paid":
                self.grant_order_credits(conn, user["id"], order_id, plan["credits"])
            updated_user = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        self.json_response(
            {
                "order": {
                    "id": order_id,
                    "status": status,
                    "provider": "mock",
                    "checkoutUrl": checkout_url,
                    "credits": plan["credits"],
                    "amountCents": plan["price_cents"],
                },
                "user": row_user(updated_user),
            },
            HTTPStatus.CREATED,
        )

    def handle_mock_pay(self, order_id: str) -> None:
        with connect() as conn:
            user = self.auth_user(conn)
            order = conn.execute(
                "SELECT * FROM billing_orders WHERE id=? AND user_id=?", (order_id, user["id"])
            ).fetchone()
            if not order:
                self.json_response({"error": "订单不存在"}, HTTPStatus.NOT_FOUND)
                return
            if order["status"] != "paid":
                conn.execute(
                    "UPDATE billing_orders SET status='paid', paid_at=? WHERE id=?",
                    (now_iso(), order_id),
                )
                self.grant_order_credits(conn, user["id"], order_id, order["credits"])
            updated_user = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        self.json_response({"ok": True, "user": row_user(updated_user)})

    def grant_order_credits(self, conn: sqlite3.Connection, user_id: str, order_id: str, credits: int) -> None:
        conn.execute("UPDATE users SET quota_balance=quota_balance+? WHERE id=?", (credits, user_id))
        conn.execute(
            """
            INSERT INTO quota_ledger (id, user_id, delta, reason, ref_type, ref_id, created_at)
            VALUES (?, ?, ?, 'billing_topup', 'order', ?, ?)
            """,
            (make_id("quota"), user_id, credits, order_id, now_iso()),
        )

    def serve_static(self, path: str) -> None:
        if path in {"", "/"}:
            target = ROOT / "index.html"
        elif path.startswith("/media/"):
            target = STORAGE_DIR / path.lstrip("/")
        else:
            target = ROOT / path.lstrip("/")

        target = target.resolve()
        allowed_roots = [ROOT.resolve(), STORAGE_DIR.resolve()]
        if not any(str(target).startswith(str(root)) for root in allowed_roots):
            self.json_response({"error": "Forbidden"}, HTTPStatus.FORBIDDEN)
            return
        if not target.exists() or not target.is_file():
            self.json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return

        data = target.read_bytes()
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.add_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))


def main() -> None:
    init_db()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8787"))
    server = ThreadingHTTPServer((host, port), Handler)
    display_host = "localhost" if host in {"127.0.0.1", "0.0.0.0"} else host
    print(f"AI image editor cloud server running on http://{display_host}:{port}")
    print(f"SQLite database: {DB_PATH}")
    if not IMAGE_API_KEY:
        print("IMAGE_API_KEY is not set; /api/generate will return mock images for local testing.")
    server.serve_forever()


if __name__ == "__main__":
    main()
