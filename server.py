#!/usr/bin/env python3
"""Account and admin backend for the AI image editor."""

from __future__ import annotations

from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import base64
import binascii
import calendar
import copy
import errno
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
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
DEFAULT_CREDITS = max(0, int(os.environ.get("DEFAULT_CREDITS", "0")))
REDEEM_PEPPER = os.environ.get("REDEEM_PEPPER", "")
GENERATION_COST_PER_IMAGE = 1
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
MODEL_KIND_IMAGE = "image"
MODEL_KIND_VIDEO = "video"
MODEL_KIND_TEXT = "text"
VALID_MODEL_KINDS = {MODEL_KIND_IMAGE, MODEL_KIND_VIDEO, MODEL_KIND_TEXT}
UPSTREAM_TIMEOUT_SECONDS = float(os.environ.get("UPSTREAM_TIMEOUT_SECONDS", "300"))
UPSTREAM_MAX_ATTEMPTS = max(1, int(os.environ.get("UPSTREAM_MAX_ATTEMPTS", "2")))
UPSTREAM_RETRY_DELAY_SECONDS = max(0.0, float(os.environ.get("UPSTREAM_RETRY_DELAY_SECONDS", "1")))
PROMPT_CONFIG_KEY = "prompt_config_json"
DEFAULT_IMAGE_MODEL_KEY = "default_image_model_id"
DEFAULT_VIDEO_MODEL_KEY = "default_video_model_id"
PROMPT_CONFIG_PATH = ROOT / "prompt-config-defaults.json"
PROMPT_TEXT_LIMIT = 20_000
PROMPT_ASSET_STATUS_DRAFT = "draft"
PROMPT_ASSET_STATUS_GENERATING = "generating"
PROMPT_ASSET_STATUS_GENERATED = "generated"
PROMPT_ASSET_STATUS_PUBLISHED = "published"
PROMPT_ASSET_STATUS_FAILED = "failed"
VALID_PROMPT_ASSET_STATUSES = {
    PROMPT_ASSET_STATUS_DRAFT,
    PROMPT_ASSET_STATUS_GENERATING,
    PROMPT_ASSET_STATUS_GENERATED,
    PROMPT_ASSET_STATUS_PUBLISHED,
    PROMPT_ASSET_STATUS_FAILED,
}
VALID_PROMPT_ASSET_PUBLISH_MODES = {"append", "overwrite"}
PROMPT_ASSET_KIND_SINGLE = "single"
PROMPT_ASSET_KIND_SUITE = "suite"
VALID_PROMPT_ASSET_KINDS = {PROMPT_ASSET_KIND_SINGLE, PROMPT_ASSET_KIND_SUITE}
PROMPT_ASSET_TEXT_LIMIT = 20_000
PROMPT_ASSET_JSON_LIMIT = 180_000
PROMPT_ASSET_IMAGE_URL_LIMIT = 2_400_000
IN_IMAGE_COPY_LANGUAGE_RULE_ZH = "图片中的所有可见文案必须使用英文，不要生成中文或其他语言文字；如果参考图里有中文文案，请翻译为简短、自然、适合电商图片的英文。"
IN_IMAGE_COPY_LANGUAGE_RULE_EN = "All visible in-image copy must be in English. Do not render Chinese or any other language; translate any Chinese reference copy into short, natural ecommerce English."
IN_IMAGE_COPY_LANGUAGE_NEEDLES = (
    "图片中的所有可见文案",
    "All visible in-image copy",
    "Use concise English text inside generated images",
)
LOCKED_PROMPT_CONFIG_KEYS = {"id", "url"}
USER_ROLE = "user"
ADMIN_ROLE = "admin"
VALID_USER_ROLES = {USER_ROLE, ADMIN_ROLE}
LEGACY_SINGLE_SCENE_MAP = {
    "aplus-brand-story": ("amazon-aplus", "brand-story"),
    "aplus-lifestyle": ("amazon-aplus", "lifestyle-module"),
    "aplus-hotspot-detail": ("amazon-aplus", "hotspot-detail"),
    "aplus-benefit-grid": ("amazon-aplus", "benefit-grid"),
    "content-banner": ("shopify-dtc", "hero-visual"),
    "content-comparison": ("shopify-dtc", "conversion-module"),
    "scene-use": ("tiktok-shop", "use-moment"),
    "scene-home": ("shopify-dtc", "lifestyle-story"),
    "info-feature": ("shopee-lazada", "clear-selling-point"),
    "info-size": ("temu-aliexpress", "spec-density"),
    "season-promo": ("shopee-lazada", "promo-visual"),
    "season-gift": ("shein", "value-look"),
}
SINGLE_CATEGORY_LABELS = {
    "3c-digital-accessories": "3C数码配件",
    "home-kitchen": "家居厨房",
    "beauty-personal-care": "美妆个护",
    "health-home-care": "健康护理",
    "tools-automotive": "汽摩工具",
    "fashion-accessories": "服饰鞋包配饰",
    "pet-supplies": "宠物用品",
    "food-beverages": "食品饮品",
    "party-decor": "节日礼品/派对装饰",
}
SINGLE_PLATFORM_DEFS = [
    {
        "id": "amazon-aplus",
        "label": "Amazon A+",
        "categories": [
            "3c-digital-accessories",
            "home-kitchen",
            "beauty-personal-care",
            "health-home-care",
            "tools-automotive",
        ],
    },
    {
        "id": "tiktok-shop",
        "label": "TikTok Shop",
        "categories": [
            "beauty-personal-care",
            "fashion-accessories",
            "home-kitchen",
            "pet-supplies",
            "food-beverages",
        ],
    },
    {
        "id": "shopify-dtc",
        "label": "Shopify / DTC 独立站",
        "categories": [
            "beauty-personal-care",
            "fashion-accessories",
            "home-kitchen",
            "health-home-care",
            "pet-supplies",
        ],
    },
    {
        "id": "shopee-lazada",
        "label": "Shopee / Lazada",
        "categories": [
            "3c-digital-accessories",
            "home-kitchen",
            "beauty-personal-care",
            "fashion-accessories",
            "party-decor",
        ],
    },
    {
        "id": "temu-aliexpress",
        "label": "Temu / AliExpress",
        "categories": [
            "3c-digital-accessories",
            "home-kitchen",
            "tools-automotive",
            "pet-supplies",
            "party-decor",
        ],
    },
    {
        "id": "shein",
        "label": "SHEIN",
        "categories": [
            "fashion-accessories",
            "beauty-personal-care",
            "home-kitchen",
            "pet-supplies",
            "party-decor",
        ],
    },
]
SINGLE_PLATFORM_SCENES = {
    "amazon-aplus": [
        {
            "id": "brand-story",
            "title": "品牌故事横幅",
            "prompt": "生成 Amazon A+ 品牌故事横幅：以当前参考商品为视觉主角，围绕{category}的真实使用价值、品牌气质与购买场景构图，保留清晰标题与品牌文案安全区，画面可信、克制、适合后期排版，不生成平台标识、认证、排名或夸张承诺。",
        },
        {
            "id": "lifestyle-module",
            "title": "场景模块",
            "prompt": "生成 Amazon A+ 场景模块图：围绕{category}商品构建真实生活方式场景，强调用户使用瞬间和场景价值，商品细节清晰可辨，环境服务于商品表达，预留短文案安全区，不生成虚假前后对比或不可验证效果。",
        },
        {
            "id": "hotspot-detail",
            "title": "热点细节",
            "prompt": "生成 Amazon A+ 热点细节图：近景展示{category}商品的关键结构、材质、纹理、接口或配件细节，周围保留热点标注安全区，背景干净，细节真实，不添加未经验证的参数、认证或图标。",
        },
        {
            "id": "benefit-grid",
            "title": "图文模块",
            "prompt": "生成 Amazon A+ 图文模块图：为{category}商品构建三栏或四栏的模块化视觉，每个区域对应卖点、材质、功能或适用场景，版式清楚、留白稳定，适合后期叠加文案，不生成真实可读文字。",
        },
    ],
    "tiktok-shop": [
        {
            "id": "strong-scene",
            "title": "强场景",
            "prompt": "生成 TikTok Shop 强场景主视觉：围绕{category}商品构建抓眼的真实场景，强调第一眼停留和情绪代入，商品保持清晰可信，画面有短视频封面感，但不夸大效果、不生成平台 UI。",
        },
        {
            "id": "use-moment",
            "title": "使用瞬间",
            "prompt": "生成 TikTok Shop 使用瞬间图：捕捉{category}商品被自然使用的关键瞬间，动作明确、商品靠近视觉中心、细节清楚，强调真实使用价值和即时感受，适合短视频或商品卡封面延展。",
        },
        {
            "id": "trend-seeding",
            "title": "种草感",
            "prompt": "生成 TikTok Shop 种草感素材：为{category}商品构建有潮流感、分享感和讨论度的视觉氛围，商品仍然真实可信，画面要有社媒传播感和购买冲动，但避免虚假功效和违规承诺。",
        },
        {
            "id": "quick-sell-point",
            "title": "快节奏卖点",
            "prompt": "生成 TikTok Shop 快节奏卖点图：围绕{category}商品突出一到两个最能打动用户的核心卖点，构图简洁直接，适合移动端快速浏览和转化，不生成真实文字，保留信息叠加空间。",
        },
    ],
    "shopify-dtc": [
        {
            "id": "hero-visual",
            "title": "首屏视觉",
            "prompt": "生成 Shopify / DTC 独立站首屏视觉：以{category}商品为主角，构建品牌感强、排版空间稳定的横版主视觉，适合承接标题、价值主张和按钮区域，画面高级克制、不过度营销。",
        },
        {
            "id": "lifestyle-story",
            "title": "生活方式",
            "prompt": "生成 Shopify / DTC 生活方式场景图：通过真实环境和自然人物关系表达{category}商品的使用语境、品牌态度和日常价值，商品保持清晰真实，画面适合详情页连续叙事。",
        },
        {
            "id": "benefit-section",
            "title": "卖点模块",
            "prompt": "生成 Shopify / DTC 卖点模块图：围绕{category}商品构建适合网站转化页的分区式视觉，突出材质、功能、体验或成分优势，保留模块化留白，不生成真实可读文字。",
        },
        {
            "id": "conversion-module",
            "title": "转化页素材",
            "prompt": "生成 Shopify / DTC 转化页素材：围绕{category}商品构建可信的购买理由场景，可用于对比、信任、FAQ 或组合销售模块，信息结构清楚，画面服务于转化，不生成夸张效果承诺。",
        },
    ],
    "shopee-lazada": [
        {
            "id": "clear-selling-point",
            "title": "清晰卖点",
            "prompt": "生成 Shopee / Lazada 清晰卖点图：围绕{category}商品突出核心功能、材质或使用价值，画面信息清晰、移动端易扫读，保留价格和短文案排版空间，不生成真实可读文字。",
        },
        {
            "id": "promo-visual",
            "title": "促销感",
            "prompt": "生成 Shopee / Lazada 促销主视觉：让{category}商品保持清晰居中，背景有活动氛围但不过度装饰，预留价格、优惠与活动信息区域，适配大促、秒杀与站内推荐位。",
        },
        {
            "id": "mobile-spec",
            "title": "移动端规格图",
            "prompt": "生成 Shopee / Lazada 移动端规格图：以{category}商品为中心，版式紧凑清楚，适合尺寸、规格、套装或包装信息叠加，保证小屏浏览时也能快速理解商品差异点。",
        },
        {
            "id": "activity-blank",
            "title": "活动留白图",
            "prompt": "生成 Shopee / Lazada 活动留白图：为{category}商品构建简洁醒目的视觉底图，商品主体清晰，保留较大留白区域承接活动标题、价格或利益点，适合高频促销运营。",
        },
    ],
    "temu-aliexpress": [
        {
            "id": "spec-density",
            "title": "高信息密度",
            "prompt": "生成 Temu / AliExpress 高信息密度商品图：围绕{category}商品展示规格、尺寸、套装或结构重点，版式清楚、信息承载力强，适合后期叠加多项说明，但不生成真实可读文字。",
        },
        {
            "id": "function-detail",
            "title": "功能细节",
            "prompt": "生成 Temu / AliExpress 功能细节图：用近景或拆解式视角展示{category}商品的关键结构、功能部位、材质或安装点，商品要真实可信，适合快速决策型电商浏览。",
        },
        {
            "id": "bundle-price",
            "title": "套装/价格感",
            "prompt": "生成 Temu / AliExpress 套装与价格感视觉：为{category}商品构建适合表达组合装、规格差异和高性价比感受的商品图，画面直给、清楚，保留利益点信息区，不出现具体价格数字。",
        },
        {
            "id": "quick-decision",
            "title": "快速决策",
            "prompt": "生成 Temu / AliExpress 快速决策图：围绕{category}商品突出一眼能理解的购买理由、适用场景和差异点，适合移动端高速浏览，构图直接，不加入无法验证的认证或承诺。",
        },
    ],
    "shein": [
        {
            "id": "trend-look",
            "title": "潮流造型",
            "prompt": "生成 SHEIN 潮流造型图：围绕{category}商品构建年轻、时尚、有搭配感的视觉，突出当下流行气质和可复制穿搭/使用氛围，商品细节真实，画面适合社媒和站内种草。",
        },
        {
            "id": "value-look",
            "title": "性价比表达",
            "prompt": "生成 SHEIN 性价比表达图：围绕{category}商品展现高完成度、易入手、好搭配或好使用的视觉印象，画面有吸引力但不过度昂贵化，适合年轻消费决策场景。",
        },
        {
            "id": "styling-scene",
            "title": "调性场景",
            "prompt": "生成 SHEIN 调性场景图：为{category}商品构建有风格、有生活方式感的使用或搭配环境，强调氛围、层次和调性统一，商品仍需清晰可信，适合品牌化陈列。",
        },
        {
            "id": "vibe-detail",
            "title": "氛围细节",
            "prompt": "生成 SHEIN 氛围细节图：近景展示{category}商品的面料、纹理、配色、装饰或局部亮点，画面精致、适合年轻时尚审美，避免过度修饰和虚假材质表现。",
        },
    ],
}


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def parse_iso_seconds(value: str) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        return int(calendar.timegm(time.strptime(text, "%Y-%m-%dT%H:%M:%SZ")))
    except ValueError:
        return 0


def make_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(12)}"


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return salt, base64.b64encode(digest).decode("ascii")


def verify_password(password: str, salt: str, stored_hash: str) -> bool:
    _, digest = hash_password(password, salt)
    return hmac.compare_digest(digest, stored_hash)


# ── Redeem code utilities ──────────────────────────────────────────────────

REDEEM_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford Base32, no I/L/O/U
REDEEM_CODE_LENGTH = 16


def _read_pepper() -> str:
    if not REDEEM_PEPPER:
        return ""
    return REDEEM_PEPPER


def _redeem_enabled() -> bool:
    return bool(REDEEM_PEPPER)


def generate_redeem_code() -> str:
    """16-char Crockford Base32, formatted XXXX-XXXX-XXXX-XXXX"""
    raw_bytes = secrets.token_bytes(REDEEM_CODE_LENGTH)
    chars = [REDEEM_ALPHABET[b % len(REDEEM_ALPHABET)] for b in raw_bytes]
    raw = "".join(chars)
    return f"{raw[0:4]}-{raw[4:8]}-{raw[8:12]}-{raw[12:16]}"


def normalize_redeem_code(code: str) -> str:
    """Strip dashes, spaces and uppercase"""
    return re.sub(r"[\s-]", "", code).upper()


def code_prefix(code: str) -> str:
    """First 4 chars of normalized code for admin display"""
    return normalize_redeem_code(code)[:4]


def hash_redeem_code(code: str) -> str:
    """SHA-256(normalize(code) + pepper) -> hex digest"""
    pepper = _read_pepper()
    raw = normalize_redeem_code(code) + pepper
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class RedeemRateLimiter:
    """In-process sliding-window rate limiter for redeem attempts."""

    def __init__(self):
        self._accounts: dict[str, list[float]] = {}
        self._ips: dict[str, list[float]] = {}
        self._window = 60.0       # 1 minute
        self._max_account = 10    # 10 account failures/min
        self._max_ip = 30         # 30 IP failures/min

    def _prune(self, bucket: list[float], cutoff: float) -> list[float]:
        while bucket and bucket[0] < cutoff:
            bucket.pop(0)
        return bucket

    def check_and_record(self, account_key: str, ip: str) -> bool:
        """Return True if rate-limited (should reject)."""
        now = time.time()
        cutoff = now - self._window
        ab = self._accounts.get(account_key, [])
        ab = self._prune(ab, cutoff)
        if len(ab) >= self._max_account:
            self._accounts[account_key] = ab
            return True
        ib = self._ips.get(ip, [])
        ib = self._prune(ib, cutoff)
        if len(ib) >= self._max_ip:
            self._ips[ip] = ib
            return True
        ab.append(now)
        ib.append(now)
        self._accounts[account_key] = ab
        self._ips[ip] = ib
        return False

    def cleanup(self) -> None:
        """Remove stale buckets (called periodically)."""
        cutoff = time.time() - self._window
        for key in list(self._accounts):
            self._accounts[key] = self._prune(self._accounts[key], cutoff)
            if not self._accounts[key]:
                del self._accounts[key]
        for key in list(self._ips):
            self._ips[key] = self._prune(self._ips[key], cutoff)
            if not self._ips[key]:
                del self._ips[key]


_redeem_limiter = RedeemRateLimiter()

# ── Credit helpers ──────────────────────────────────────────────────────────


def consume_credits(conn: sqlite3.Connection, user_id: str, amount: int = 1) -> dict:
    """Atomically consume credits. Returns {ok, remaining} or {ok:false, remaining}"""
    cost = max(0.5, float(amount))
    user = conn.execute("SELECT credits, credits_used FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return {"ok": False, "remaining": 0}
    remaining = max(0.0, float(user["credits"]) - float(user["credits_used"]))
    if remaining < cost:
        return {"ok": False, "remaining": int(remaining)}
    conn.execute(
        "UPDATE users SET credits_used = credits_used + ? WHERE id=?",
        (cost, user_id),
    )
    new_remaining = max(0.0, float(user["credits"]) - (float(user["credits_used"]) + cost))
    return {"ok": True, "remaining": int(new_remaining)}


def refund_credits(conn: sqlite3.Connection, user_id: str, amount: float) -> float:
    """Refund credits (min of used and amount). Returns refunded amount."""
    refund = max(0.0, float(amount))
    user = conn.execute("SELECT credits_used FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return 0.0
    actual = min(refund, max(0.0, float(user["credits_used"])))
    if actual <= 0:
        return 0.0
    conn.execute(
        "UPDATE users SET credits_used = MAX(0, credits_used - ?) WHERE id=?",
        (actual, user_id),
    )
    return actual


def add_credits(conn: sqlite3.Connection, user_id: str, amount: int) -> dict | None:
    """Add credits to user account. Returns {credits, creditsUsed, creditsRemaining} or None."""
    add = max(1, int(amount))
    user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        return None
    conn.execute("UPDATE users SET credits = credits + ? WHERE id=?", (add, user_id))
    updated = conn.execute("SELECT credits, credits_used FROM users WHERE id=?", (user_id,)).fetchone()
    return {
        "credits": int(updated["credits"]),
        "creditsUsed": float(updated["credits_used"]),
        "creditsRemaining": int(updated["credits"]) - float(updated["credits_used"]),
    }


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
              model_kind TEXT NOT NULL DEFAULT 'image',
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

            CREATE TABLE IF NOT EXISTS prompt_assets (
              id TEXT PRIMARY KEY,
              asset_kind TEXT NOT NULL DEFAULT 'single',
              title TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'draft',
              provider_model_id TEXT NOT NULL DEFAULT '',
              reference_images_json TEXT NOT NULL DEFAULT '[]',
              product_image_json TEXT NOT NULL DEFAULT '{}',
              suite_shots_json TEXT NOT NULL DEFAULT '[]',
              reference_analysis TEXT NOT NULL DEFAULT '',
              chinese_prompt TEXT NOT NULL DEFAULT '',
              english_prompt TEXT NOT NULL DEFAULT '',
              image_a_url TEXT NOT NULL DEFAULT '',
              image_b_url TEXT NOT NULL DEFAULT '',
              comparison TEXT NOT NULL DEFAULT '',
              target_platform_id TEXT NOT NULL DEFAULT '',
              target_category_id TEXT NOT NULL DEFAULT '',
              target_scenario_id TEXT NOT NULL DEFAULT '',
              publish_mode TEXT NOT NULL DEFAULT 'append',
              published_template_id TEXT NOT NULL DEFAULT '',
              error TEXT NOT NULL DEFAULT '',
              request_json TEXT NOT NULL DEFAULT '{}',
              response_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              published_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_logs_user_created ON generation_logs(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_logs_created ON generation_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_generated_assets_user_created ON generated_assets(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_feedback_created ON image_feedback(created_at);
            CREATE INDEX IF NOT EXISTS idx_feedback_source ON image_feedback(user_source, image_source, created_at);
            CREATE INDEX IF NOT EXISTS idx_prompt_assets_status_updated ON prompt_assets(status, updated_at);
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
        ensure_column(conn, "users", "credits", "INTEGER NOT NULL DEFAULT 10")
        ensure_column(conn, "users", "credits_used", "REAL NOT NULL DEFAULT 0")
        ensure_users_schema(conn)
        ensure_column(conn, "user_settings", "video_api_key", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "user_settings", "video_model", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "user_settings", "video_endpoint_primary", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "user_settings", "video_endpoint_secondary", "TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "provider_models", "model_kind", "TEXT NOT NULL DEFAULT 'image'")
        ensure_column(conn, "prompt_assets", "asset_kind", "TEXT NOT NULL DEFAULT 'single'")
        ensure_column(conn, "prompt_assets", "suite_shots_json", "TEXT NOT NULL DEFAULT '[]'")
        migrate_default_endpoint(conn)
        ensure_sessions_schema(conn)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, role)")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS redeem_codes (
              id TEXT PRIMARY KEY,
              code_hash TEXT NOT NULL UNIQUE,
              code_prefix TEXT NOT NULL,
              batch_id TEXT NOT NULL,
              credits INTEGER NOT NULL,
              status TEXT NOT NULL DEFAULT 'active',
              expires_at TEXT,
              redeemed_by TEXT,
              redeemed_at TEXT,
              created_by TEXT NOT NULL,
              note TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_redeem_codes_batch ON redeem_codes(batch_id);
            CREATE INDEX IF NOT EXISTS idx_redeem_codes_status ON redeem_codes(status);
        """)
        seed_setting(conn, "default_endpoint", DEFAULT_ENDPOINT)
        seed_setting(conn, "default_model", DEFAULT_MODEL)
        seed_setting(conn, "usage_note", "用量为前端根据模型返回 usage 或请求/响应文本估算的次数与 token 数。")
        seed_setting(conn, PROMPT_CONFIG_KEY, prompt_config_json(default_prompt_config()))


def seed_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
        (key, value, now_iso()),
    )


def bundled_prompt_config() -> dict:
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


def build_single_template_categories(single_matrix: dict) -> list[dict]:
    categories = [{"id": "all", "label": "全部模板"}]
    seen: set[str] = set()
    for platform in single_matrix.get("platforms", []):
        for category in platform.get("categories", []):
            category_id = str(category.get("id") or "").strip()
            if not category_id or category_id in seen:
                continue
            seen.add(category_id)
            categories.append(
                {"id": category_id, "label": trim_text(str(category.get("label") or ""), 120) or category_id}
            )
    return categories


def legacy_single_template_defaults() -> list[dict]:
    return []


def build_single_templates_from_matrix(single_matrix: dict, legacy_templates: list[dict] | None = None) -> list[dict]:
    templates = []
    for platform in single_matrix.get("platforms", []):
        platform_id = str(platform.get("id") or "").strip()
        for category in platform.get("categories", []):
            category_id = str(category.get("id") or "").strip()
            category_label = trim_text(str(category.get("label") or ""), 120) or category_id
            for scenario in category.get("scenarios", []):
                template_id = trim_text(str(scenario.get("templateId") or ""), 160)
                if not template_id:
                    continue
                templates.append(
                    {
                        "id": template_id,
                        "category": category_id,
                        "platform": platform_id,
                        "scenario": str(scenario.get("id") or "").strip(),
                        "title": trim_text(str(scenario.get("title") or ""), 200) or template_id,
                        "prompt": trim_text(str(scenario.get("prompt") or ""), PROMPT_TEXT_LIMIT),
                        "categoryLabel": category_label,
                    }
                )
    if isinstance(legacy_templates, list):
        for template in legacy_templates:
            if not isinstance(template, dict):
                continue
            template_id = trim_text(str(template.get("id") or ""), 160)
            if not template_id or any(item["id"] == template_id for item in templates):
                continue
            templates.append(
                {
                    "id": template_id,
                    "category": trim_text(str(template.get("category") or ""), 120),
                    "platform": "",
                    "scenario": "",
                    "title": trim_text(str(template.get("title") or ""), 200) or template_id,
                    "prompt": trim_text(str(template.get("prompt") or ""), PROMPT_TEXT_LIMIT),
                    "categoryLabel": "",
                }
            )
    return templates


def build_default_single_prompt_config() -> dict:
    platforms = []
    for platform in SINGLE_PLATFORM_DEFS:
        categories = []
        for category_id in platform["categories"]:
            category_label = SINGLE_CATEGORY_LABELS[category_id]
            categories.append({"id": category_id, "label": category_label, "scenarios": []})
        platforms.append({"id": platform["id"], "label": platform["label"], "categories": categories})

    defaults = {"platformId": platforms[0]["id"], "categoryId": platforms[0]["categories"][0]["id"], "scenarioId": ""}
    matrix = {"defaults": defaults, "platforms": platforms}
    templates = build_single_templates_from_matrix(matrix, legacy_single_template_defaults())
    return {
        "defaults": defaults,
        "matrix": matrix,
        "templateCategories": build_single_template_categories(matrix),
        "templates": templates,
        "defaultTemplateCategory": defaults["categoryId"],
        "defaultTemplateId": templates[0]["id"] if templates else "",
        "supplementalVariantPrompt": "",
    }


def apply_legacy_single_template_overrides(single_matrix: dict, legacy_templates: list[dict]) -> None:
    if not isinstance(legacy_templates, list):
        return
    overrides = {
        trim_text(str(template.get("id") or ""), 160): template
        for template in legacy_templates
        if isinstance(template, dict) and template.get("id")
    }
    for legacy_id, (platform_id, scenario_id) in LEGACY_SINGLE_SCENE_MAP.items():
        override = overrides.get(legacy_id)
        if not isinstance(override, dict):
            continue
        title = trim_text(str(override.get("title") or ""), 200)
        prompt_value = trim_text(str(override.get("prompt") or ""), PROMPT_TEXT_LIMIT)
        for platform in single_matrix.get("platforms", []):
            if str(platform.get("id") or "") != platform_id:
                continue
            for category in platform.get("categories", []):
                for scenario in category.get("scenarios", []):
                    if str(scenario.get("id") or "") != scenario_id:
                        continue
                    if title:
                        scenario["title"] = title
                    if prompt_value:
                        scenario["prompt"] = prompt_value


def normalize_single_defaults(single_config: dict) -> dict:
    matrix = single_config.get("matrix", {})
    platforms = matrix.get("platforms", [])
    first_platform = platforms[0] if platforms else {}
    first_category = (first_platform.get("categories") or [{}])[0]
    first_scenario = (first_category.get("scenarios") or [{}])[0]
    defaults = single_config.get("defaults", {}) if isinstance(single_config.get("defaults"), dict) else {}
    platform_id = trim_text(str(defaults.get("platformId") or ""), 120)
    platform = next((item for item in platforms if str(item.get("id") or "") == platform_id), None) or first_platform
    categories = platform.get("categories", []) if isinstance(platform, dict) else []
    category_id = trim_text(str(defaults.get("categoryId") or ""), 120)
    category = next((item for item in categories if str(item.get("id") or "") == category_id), None) or (categories[0] if categories else first_category)
    scenarios = category.get("scenarios", []) if isinstance(category, dict) else []
    scenario_id = trim_text(str(defaults.get("scenarioId") or ""), 120)
    scenario = next((item for item in scenarios if str(item.get("id") or "") == scenario_id), None) or (scenarios[0] if scenarios else first_scenario)
    return {
        "platformId": trim_text(str(platform.get("id") or ""), 120),
        "categoryId": trim_text(str(category.get("id") or ""), 120),
        "scenarioId": trim_text(str(scenario.get("id") or ""), 120),
    }


def default_prompt_config() -> dict:
    config = bundled_prompt_config()
    config["version"] = max(2, int(config.get("version") or 0))
    config["single"] = build_default_single_prompt_config()
    return config


def merge_single_matrix_custom_scenarios(single: dict, source_single: dict | None) -> None:
    source_matrix = source_single.get("matrix") if isinstance(source_single, dict) else None
    if not isinstance(source_matrix, dict):
        return
    target_platforms = single.get("matrix", {}).get("platforms", [])
    for source_platform in source_matrix.get("platforms", []):
        platform_id = str(source_platform.get("id") or "")
        target_platform = next((item for item in target_platforms if str(item.get("id") or "") == platform_id), None)
        if not target_platform:
            continue
        target_categories = target_platform.get("categories", [])
        for source_category in source_platform.get("categories", []):
            category_id = str(source_category.get("id") or "")
            target_category = next((item for item in target_categories if str(item.get("id") or "") == category_id), None)
            if not target_category:
                continue
            target_scenarios = target_category.setdefault("scenarios", [])
            target_ids = {str(item.get("id") or "") for item in target_scenarios}
            for source_scenario in source_category.get("scenarios", []):
                scenario_id = trim_text(str(source_scenario.get("id") or ""), 120)
                template_id = trim_text(str(source_scenario.get("templateId") or ""), 160)
                if not scenario_id or not template_id or scenario_id in target_ids:
                    continue
                target_scenarios.append(
                    {
                        "id": scenario_id,
                        "title": trim_text(str(source_scenario.get("title") or scenario_id), 200),
                        "prompt": trim_text(str(source_scenario.get("prompt") or ""), PROMPT_TEXT_LIMIT),
                        "templateId": template_id,
                    }
                )
                target_ids.add(scenario_id)


def normalize_single_matrix_from_source(source_matrix: dict) -> dict:
    defaults = source_matrix.get("defaults") if isinstance(source_matrix.get("defaults"), dict) else {}
    platforms = []
    seen_platforms: set[str] = set()
    for source_platform in source_matrix.get("platforms", []):
        if not isinstance(source_platform, dict):
            continue
        platform_id = trim_text(str(source_platform.get("id") or ""), 120)
        if not platform_id or platform_id in seen_platforms:
            continue
        seen_platforms.add(platform_id)
        categories = []
        seen_categories: set[str] = set()
        for source_category in source_platform.get("categories", []):
            if not isinstance(source_category, dict):
                continue
            category_id = trim_text(str(source_category.get("id") or ""), 120)
            if not category_id or category_id in seen_categories:
                continue
            seen_categories.add(category_id)
            scenarios = []
            seen_scenarios: set[str] = set()
            for source_scenario in source_category.get("scenarios", []):
                if not isinstance(source_scenario, dict):
                    continue
                scenario_id = trim_text(str(source_scenario.get("id") or ""), 120)
                template_id = trim_text(str(source_scenario.get("templateId") or ""), 160)
                if not scenario_id or not template_id or scenario_id in seen_scenarios:
                    continue
                seen_scenarios.add(scenario_id)
                scenarios.append(
                    {
                        "id": scenario_id,
                        "title": trim_text(str(source_scenario.get("title") or scenario_id), 200),
                        "prompt": trim_text(str(source_scenario.get("prompt") or ""), PROMPT_TEXT_LIMIT),
                        "templateId": template_id,
                    }
                )
            categories.append(
                {
                    "id": category_id,
                    "label": trim_text(str(source_category.get("label") or category_id), 120),
                    "scenarios": scenarios,
                }
            )
        platforms.append(
            {
                "id": platform_id,
                "label": trim_text(str(source_platform.get("label") or platform_id), 120),
                "categories": categories,
            }
        )
    return {"defaults": defaults, "platforms": platforms}


def normalize_single_prompt_config(source_single, default_single: dict) -> dict:
    source_matrix = source_single.get("matrix") if isinstance(source_single, dict) else None
    single = merge_prompt_config(copy.deepcopy(default_single), source_single if isinstance(source_single, dict) else {})
    if isinstance(source_matrix, dict) and isinstance(source_matrix.get("platforms"), list):
        single["matrix"] = normalize_single_matrix_from_source(source_matrix)
    elif isinstance(source_single, dict):
        apply_legacy_single_template_overrides(single.get("matrix", {}), source_single.get("templates", []))
    merge_single_matrix_custom_scenarios(single, source_single if isinstance(source_single, dict) else None)
    defaults = normalize_single_defaults(single)
    single["defaults"] = defaults
    single["matrix"]["defaults"] = defaults
    legacy_templates = None
    if isinstance(source_single, dict) and isinstance(source_single.get("templates"), list):
        legacy_ids = {item.get("id") for item in legacy_single_template_defaults() if isinstance(item, dict)}
        legacy_templates = [item for item in source_single.get("templates", []) if isinstance(item, dict) and item.get("id") in legacy_ids]
    single["templates"] = build_single_templates_from_matrix(
        single.get("matrix", {}),
        legacy_templates if legacy_templates is not None else legacy_single_template_defaults(),
    )
    single["templateCategories"] = build_single_template_categories(single.get("matrix", {}))
    default_template = next(
        (
            template
            for template in single["templates"]
            if template.get("platform") == defaults["platformId"]
            and template.get("category") == defaults["categoryId"]
            and template.get("scenario") == defaults["scenarioId"]
        ),
        single["templates"][0] if single["templates"] else {"id": "", "category": defaults["categoryId"]},
    )
    single["defaultTemplateId"] = default_template.get("id", "")
    single["defaultTemplateCategory"] = default_template.get("category", defaults["categoryId"])
    return single


def normalize_prompt_config(value) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = {}
    if not isinstance(value, dict):
        value = {}
    defaults = default_prompt_config()
    config = merge_prompt_config(defaults, value)
    config["version"] = max(2, int(config.get("version") or 0))
    config["single"] = normalize_single_prompt_config(value.get("single"), defaults["single"])
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
            if key in LOCKED_PROMPT_CONFIG_KEYS or key == "templateId" or (key == "category" and "id" in default):
                merged[key] = default_value
            else:
                merged[key] = merge_prompt_config(default_value, source.get(key))
        return merged
    if isinstance(default, list):
        if all(isinstance(item, dict) and "id" in item for item in default):
            override_by_id = {
                item.get("id"): item for item in override if isinstance(item, dict)
            } if isinstance(override, list) else {}
            merged = [
                merge_prompt_config(
                    item,
                    override_by_id.get(item["id"])
                    or (override[index] if isinstance(override, list) and index < len(override) else None),
                )
                for index, item in enumerate(default)
            ]
            default_ids = {item.get("id") for item in default}
            if isinstance(override, list):
                for item in override:
                    if isinstance(item, dict) and item.get("id") and item.get("id") not in default_ids:
                        merged.append(sanitize_payload(item))
            return merged
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
    image_row = conn.execute("SELECT value FROM app_settings WHERE key=?", (DEFAULT_IMAGE_MODEL_KEY,)).fetchone()
    video_row = conn.execute("SELECT value FROM app_settings WHERE key=?", (DEFAULT_VIDEO_MODEL_KEY,)).fetchone()
    config["defaultImageModelId"] = image_row["value"] if image_row else ""
    config["defaultVideoModelId"] = video_row["value"] if video_row else ""
    config["modelProviders"] = model_providers_config(conn)
    return config


def normalize_model_kind(value) -> str:
    kind = str(value or "").strip().lower()
    if kind in VALID_MODEL_KINDS:
        return kind
    if kind in {"img", "picture", "photo"}:
        return MODEL_KIND_IMAGE
    if kind in {"vid", "movie"}:
        return MODEL_KIND_VIDEO
    if kind in {"llm", "chat", "vision", "text_understanding"}:
        return MODEL_KIND_TEXT
    return MODEL_KIND_IMAGE


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
        PROVIDER_TYPE_OPENAI_IMAGE: "OpenAI Compatible",
    }.get(provider_type, "OpenAI Compatible")


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
        "modelKind": normalize_model_kind(row_value(row, "model_kind", MODEL_KIND_IMAGE)),
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


def user_allowed_models(conn: sqlite3.Connection, user_id: str, model_kind: str = MODEL_KIND_IMAGE) -> list[dict]:
    kind = normalize_model_kind(model_kind)
    rows = conn.execute(
        """
        SELECT
          user_model_access.enabled AS access_enabled,
          provider_models.id AS model_id,
          provider_models.provider_id,
          provider_models.model_name,
          provider_models.model_kind,
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
          AND provider_models.model_kind=?
        ORDER BY provider_models.priority ASC, model_providers.name ASC, provider_models.model_name ASC
        """,
        (user_id, kind),
    ).fetchall()
    return [
        {
            "id": row["model_id"],
            "providerId": row["provider_id"],
            "providerName": row["provider_name"],
            "providerType": normalize_provider_type(row["provider_type"]),
            "baseUrl": row["base_url"],
            "modelName": row["model_name"],
            "modelKind": normalize_model_kind(row["model_kind"]),
            "priority": int(row["priority"] or 100),
            "enabled": bool(row["access_enabled"]) and bool(row["model_enabled"]) and bool(row["provider_enabled"]),
            "modelEnabled": bool(row["model_enabled"]),
            "providerEnabled": bool(row["provider_enabled"]),
        }
        for row in rows
    ]


def user_allowed_image_models(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    return user_allowed_models(conn, user_id, MODEL_KIND_IMAGE)


def user_allowed_video_models(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    return user_allowed_models(conn, user_id, MODEL_KIND_VIDEO)


def authorized_model_options(conn: sqlite3.Connection, user_id: str, model_kind: str = MODEL_KIND_IMAGE) -> list[dict]:
    kind = normalize_model_kind(model_kind)
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
          provider_models.model_kind,
          provider_models.priority
        FROM user_model_access
        JOIN provider_models ON provider_models.id = user_model_access.provider_model_id
        JOIN model_providers ON model_providers.id = provider_models.provider_id
        WHERE user_model_access.user_id=?
          AND user_model_access.enabled=1
          AND provider_models.enabled=1
          AND provider_models.model_kind=?
          AND model_providers.enabled=1
          AND TRIM(model_providers.api_key)<>''
        ORDER BY provider_models.priority ASC, model_providers.name ASC, provider_models.model_name ASC
        """,
        (user_id, kind),
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
            "modelKind": normalize_model_kind(row["model_kind"]),
            "priority": int(row["priority"] or 100),
        }
        for row in rows
    ]


def authorized_image_model_options(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    return authorized_model_options(conn, user_id, MODEL_KIND_IMAGE)


def authorized_video_model_options(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    return authorized_model_options(conn, user_id, MODEL_KIND_VIDEO)


def configured_model_options(conn: sqlite3.Connection, model_kind: str = MODEL_KIND_IMAGE) -> list[dict]:
    kind = normalize_model_kind(model_kind)
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
          provider_models.model_kind,
          provider_models.priority
        FROM provider_models
        JOIN model_providers ON model_providers.id = provider_models.provider_id
        WHERE provider_models.enabled=1
          AND provider_models.model_kind=?
          AND model_providers.enabled=1
          AND TRIM(model_providers.api_key)<>''
        ORDER BY provider_models.priority ASC, model_providers.name ASC, provider_models.model_name ASC
        """,
        (kind,),
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
            "modelKind": normalize_model_kind(row["model_kind"]),
            "priority": int(row["priority"] or 100),
        }
        for row in rows
    ]


def prompt_factory_model_options(conn: sqlite3.Connection) -> list[dict]:
    return [
        option
        for option in [
            *configured_model_options(conn, MODEL_KIND_TEXT),
            *configured_model_options(conn, MODEL_KIND_IMAGE),
        ]
        if is_prompt_factory_model_option(option)
    ]


def is_prompt_factory_model_option(option: dict) -> bool:
    model_kind = normalize_model_kind(option.get("modelKind"))
    if model_kind == MODEL_KIND_TEXT:
        return bool(str(option.get("modelName") or "").strip())
    if normalize_provider_type(option.get("providerType")) != PROVIDER_TYPE_AOKAPI_GEMINI:
        return False
    endpoint = resolve_provider_image_endpoint(option, option.get("modelName") or "")
    return is_gemini_image_endpoint(endpoint, option.get("modelName") or "")


def selected_prompt_factory_image_model(conn: sqlite3.Connection) -> dict:
    options = configured_model_options(conn, MODEL_KIND_IMAGE)
    compatible = [option for option in options if normalize_provider_type(option.get("providerType")) != PROVIDER_TYPE_AOKAPI_GEMINI or is_prompt_factory_model_option(option)]
    if not compatible:
        raise AppError(HTTPStatus.BAD_REQUEST, "请先配置可用的图片验证模型")
    return compatible[0]


def selected_prompt_factory_model(conn: sqlite3.Connection, provider_model_id: str = "") -> dict:
    options = prompt_factory_model_options(conn)
    if provider_model_id:
        selected = next((option for option in options if option["providerModelId"] == provider_model_id), None)
        if selected:
            return selected
        raise AppError(HTTPStatus.BAD_REQUEST, "选择的提示词生成模型不可用")
    if not options:
        raise AppError(HTTPStatus.BAD_REQUEST, "请先配置可用的文本理解模型，例如 Muskapis gpt-5.5")
    return options[0]


def provider_model_option(conn: sqlite3.Connection, provider_model_id: str, model_kind: str = "") -> dict | None:
    model_id = str(provider_model_id or "").strip()
    if not model_id:
        return None
    kind = normalize_model_kind(model_kind) if model_kind else ""
    row = conn.execute(
        """
        SELECT
          model_providers.id AS provider_id,
          model_providers.name AS provider_name,
          model_providers.provider_type,
          model_providers.base_url,
          model_providers.api_key,
          model_providers.enabled AS provider_enabled,
          provider_models.id AS provider_model_id,
          provider_models.model_name,
          provider_models.model_kind,
          provider_models.priority,
          provider_models.enabled AS model_enabled
        FROM provider_models
        JOIN model_providers ON model_providers.id = provider_models.provider_id
        WHERE provider_models.id=?
        LIMIT 1
        """,
        (model_id,),
    ).fetchone()
    if not row or not row["provider_enabled"] or not row["model_enabled"]:
        return None
    row_kind = normalize_model_kind(row["model_kind"])
    if kind and row_kind != kind:
        return None
    return {
        "providerId": row["provider_id"],
        "providerName": row["provider_name"],
        "providerType": normalize_provider_type(row["provider_type"]),
        "baseUrl": row["base_url"],
        "apiKey": row["api_key"],
        "providerModelId": row["provider_model_id"],
        "modelName": row["model_name"],
        "modelKind": row_kind,
        "priority": int(row["priority"] or 100),
        "isDefault": True,
    }


def public_provider_model_option(option: dict | None) -> dict:
    if not option:
        return {}
    return {
        "id": option.get("providerModelId") or option.get("id") or "",
        "providerId": option.get("providerId") or "",
        "providerName": option.get("providerName") or "",
        "providerType": option.get("providerType") or "",
        "baseUrl": option.get("baseUrl") or "",
        "modelName": option.get("modelName") or "",
        "modelKind": normalize_model_kind(option.get("modelKind")),
        "priority": int(option.get("priority") or 100),
        "enabled": True,
        "isDefault": bool(option.get("isDefault")),
    }


def set_user_model_access(conn: sqlite3.Connection, user_id: str, model_ids, model_kind: str = MODEL_KIND_IMAGE) -> None:
    kind = normalize_model_kind(model_kind)
    if not isinstance(model_ids, list):
        raise AppError(HTTPStatus.BAD_REQUEST, "可用模型格式错误")
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
                f"SELECT id FROM provider_models WHERE id IN ({placeholders}) AND model_kind=?",
                [*unique_ids, kind],
            ).fetchall()
        }
        missing = [model_id for model_id in unique_ids if model_id not in existing]
        if missing:
            raise AppError(HTTPStatus.BAD_REQUEST, "可用模型不存在")
    timestamp = now_iso()
    conn.execute(
        """
        DELETE FROM user_model_access
        WHERE user_id=?
          AND provider_model_id IN (SELECT id FROM provider_models WHERE model_kind=?)
        """,
        (user_id, kind),
    )
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
            model_kind = normalize_model_kind(model_item.get("modelKind") or model_item.get("model_kind"))
            priority = clamp_int(model_item.get("priority"), 1, 1_000_000)
            if priority == 1 and model_item.get("priority") in (None, ""):
                priority = index * 100 + model_index
            model_enabled = 1 if model_item.get("enabled", True) else 0
            model_created_at = row_value(existing_models.get(model_id), "created_at", timestamp) or timestamp
            conn.execute(
                """
                INSERT INTO provider_models
                  (id, provider_id, model_name, model_kind, priority, enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  provider_id=excluded.provider_id,
                  model_name=excluded.model_name,
                  model_kind=excluded.model_kind,
                  priority=excluded.priority,
                  enabled=excluded.enabled,
                  updated_at=excluded.updated_at
                """,
                (model_id, provider_id, model_name, model_kind, priority, model_enabled, model_created_at, timestamp),
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


def normalize_prompt_asset_status(value) -> str:
    status = str(value or PROMPT_ASSET_STATUS_DRAFT).strip().lower()
    return status if status in VALID_PROMPT_ASSET_STATUSES else PROMPT_ASSET_STATUS_DRAFT


def normalize_prompt_asset_publish_mode(value) -> str:
    mode = str(value or "append").strip().lower()
    return mode if mode in VALID_PROMPT_ASSET_PUBLISH_MODES else "append"


def normalize_prompt_asset_kind(value) -> str:
    kind = str(value or PROMPT_ASSET_KIND_SINGLE).strip().lower()
    return kind if kind in VALID_PROMPT_ASSET_KINDS else PROMPT_ASSET_KIND_SINGLE


def normalize_prompt_asset_image_url(value) -> str:
    return str(value or "").strip()


def normalize_prompt_asset_image(value) -> dict:
    if not isinstance(value, dict):
        return {}
    url = normalize_prompt_asset_image_url(value.get("url"))
    if not url:
        return {}
    return {
        "name": trim_text(value.get("name") or "参考图", 120),
        "size": normalize_image_size(str(value.get("size") or "")),
        "url": url,
    }


def normalize_prompt_asset_images(value, limit: int = 20) -> list[dict]:
    if not isinstance(value, list):
        return []
    images = []
    seen = set()
    for item in value:
        image = normalize_prompt_asset_image(item)
        url = image.get("url")
        if not url or url in seen:
            continue
        seen.add(url)
        images.append(image)
        if len(images) >= limit:
            break
    return images


def normalize_suite_prompt_shots(value, references: list[dict] | None = None) -> list[dict]:
    source = value if isinstance(value, list) else []
    fallback_references = references if isinstance(references, list) else []
    shot_limit = min(20, len(fallback_references)) if fallback_references else 20
    shots = []
    for index, item in enumerate(source, start=1):
        if not isinstance(item, dict):
            continue
        raw_name = trim_text(str(item.get("name") or item.get("title") or ""), 120)
        size = normalize_image_size(str(item.get("size") or item.get("outputSize") or "1024x1024")) or "1024x1024"
        chinese_prompt = trim_text(
            str(item.get("chinesePrompt") or item.get("prompt") or item.get("promptZh") or ""),
            PROMPT_ASSET_TEXT_LIMIT,
        )
        english_prompt = trim_text(str(item.get("englishPrompt") or item.get("promptEn") or ""), PROMPT_ASSET_TEXT_LIMIT)
        description = trim_text(str(item.get("description") or item.get("summary") or ""), 300)
        name = suite_shot_chinese_name(raw_name, chinese_prompt, description, index)
        shot_id = prompt_asset_slug(str(item.get("id") or name or f"shot-{index}"))
        shots.append(
            {
                "id": shot_id,
                "name": name,
                "size": size,
                "description": description,
                "chinesePrompt": chinese_prompt,
                "englishPrompt": english_prompt,
                "promptOnlyImageUrl": normalize_prompt_asset_image_url(
                    item.get("promptOnlyImageUrl") or item.get("prompt_only_image_url")
                ),
                "referenceImageUrl": normalize_prompt_asset_image_url(
                    item.get("referenceImageUrl") or item.get("reference_image_url")
                ),
                "imageError": trim_text(str(item.get("imageError") or item.get("image_error") or ""), 1000),
            }
        )
    if shots:
        return shots[:shot_limit]

    for index, reference in enumerate(fallback_references[:20], start=1):
        base_name = trim_text(str(reference.get("name") or f"参考图 {index}"), 120)
        size = normalize_image_size(str(reference.get("size") or "")) or "1024x1024"
        shots.append(
            {
                "id": prompt_asset_slug(f"shot-{index}-{base_name}"),
                "name": f"{index:02d} {base_name}",
                "size": size,
                "description": "根据对应参考图生成的套图图位",
                "chinesePrompt": "",
                "englishPrompt": "",
                "promptOnlyImageUrl": "",
                "referenceImageUrl": "",
                "imageError": "",
            }
        )
    return shots


GENERIC_SUITE_SHOT_NAMES = {
    "首屏品牌横幅",
    "卖点信息图",
    "细节特写图",
    "生活场景图",
    "使用步骤图",
    "尺寸包装图",
    "对比说明图",
    "配件展示图",
    "促销广告图",
    "问答信任图",
    "套图图位",
}


def text_has_chinese(value: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in str(value or ""))


def clean_suite_shot_name(value: str) -> str:
    text = trim_text(str(value or ""), 120)
    text = re.sub(r"^\s*\d{1,2}\s*[.、_-]?\s*", "", text).strip()
    text = re.sub(r"^(?:请|生成|创建|制作|设计|输出|一张|一个|用于|打造)+", "", text).strip()
    return trim_text(text.strip(" ：:，,。；;、-_/"), 120)


def suite_shot_chinese_name_from_text(value: str) -> str:
    text = trim_text(str(value or ""), 240)
    if not text_has_chinese(text):
        return ""
    for separator in ("：", ":", "，", ",", "。", "；", ";", "\n"):
        if separator in text:
            candidate = clean_suite_shot_name(text.split(separator, 1)[0])
            if 2 <= len(candidate) <= 24 and text_has_chinese(candidate):
                return candidate
    match = re.search(r"([\u4e00-\u9fffA-Za-z0-9（）()]{2,24}图)", text)
    if match:
        candidate = clean_suite_shot_name(match.group(1))
        if candidate and text_has_chinese(candidate):
            return candidate
    candidate = clean_suite_shot_name(text)
    if 2 <= len(candidate) <= 18 and text_has_chinese(candidate):
        return candidate
    return ""


def suite_shot_chinese_name(raw_name: str, chinese_prompt: str, description: str, index: int) -> str:
    text = " ".join(part for part in (raw_name, chinese_prompt, description) if part)
    raw_clean = clean_suite_shot_name(raw_name)
    prompt_name = suite_shot_chinese_name_from_text(chinese_prompt) or suite_shot_chinese_name_from_text(description)
    if text_has_chinese(raw_clean) and raw_clean not in GENERIC_SUITE_SHOT_NAMES:
        cleaned = raw_clean
    elif prompt_name:
        cleaned = prompt_name
    elif text_has_chinese(raw_clean):
        cleaned = raw_clean
    else:
        rules = [
            (("首屏", "hero", "banner", "横幅", "品牌"), "首屏品牌横幅"),
            (("卖点", "feature", "infographic", "信息图", "功能", "标注"), "卖点信息图"),
            (("细节", "detail", "特写", "热点", "材质", "结构"), "细节特写图"),
            (("生活", "lifestyle", "场景", "使用", "use"), "生活场景图"),
            (("步骤", "step", "how", "安装", "维护", "流程"), "使用步骤图"),
            (("尺寸", "size", "包装", "规格", "清单"), "尺寸包装图"),
            (("对比", "compare", "comparison", "决策"), "对比说明图"),
            (("配件", "accessor", "accessories", "电池"), "配件展示图"),
            (("广告", "促销", "promo", "ad", "活动"), "促销广告图"),
            (("问答", "qa", "信任", "trust"), "问答信任图"),
        ]
        lower_text = text.lower()
        cleaned = next((label for needles, label in rules if any(needle.lower() in lower_text for needle in needles)), "套图图位")
    return trim_text(f"{index:02d} {cleaned}", 120)


def prompt_asset_json(value, fallback) -> str:
    return json.dumps(value if value is not None else fallback, ensure_ascii=False)


def row_prompt_asset(row: sqlite3.Row) -> dict:
    reference_images = parse_json_field(row["reference_images_json"])
    if not isinstance(reference_images, list):
        reference_images = []
    product_image = parse_json_field(row["product_image_json"])
    if not isinstance(product_image, dict):
        product_image = {}
    suite_shots = parse_json_field(row_value(row, "suite_shots_json", "[]"))
    if not isinstance(suite_shots, list):
        suite_shots = []
    request_json = parse_json_field(row_value(row, "request_json", "{}"))
    response_json = parse_json_field(row_value(row, "response_json", "{}"))
    return {
        "id": row["id"],
        "assetKind": normalize_prompt_asset_kind(row_value(row, "asset_kind", PROMPT_ASSET_KIND_SINGLE)),
        "title": row["title"],
        "status": normalize_prompt_asset_status(row["status"]),
        "providerModelId": row_value(row, "provider_model_id", ""),
        "referenceImages": reference_images,
        "productImage": product_image,
        "suiteShots": normalize_suite_prompt_shots(suite_shots, reference_images),
        "referenceAnalysis": row["reference_analysis"],
        "chinesePrompt": row["chinese_prompt"],
        "englishPrompt": row["english_prompt"],
        "imageAUrl": row["image_a_url"],
        "imageBUrl": row["image_b_url"],
        "comparison": row["comparison"],
        "targetPlatformId": row["target_platform_id"],
        "targetCategoryId": row["target_category_id"],
        "targetScenarioId": row["target_scenario_id"],
        "publishMode": normalize_prompt_asset_publish_mode(row["publish_mode"]),
        "publishedTemplateId": row["published_template_id"],
        "error": row["error"],
        "request": request_json if isinstance(request_json, dict) else {},
        "response": response_json if isinstance(response_json, dict) else {},
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "publishedAt": row["published_at"],
    }


def prompt_asset_by_id(conn: sqlite3.Connection, asset_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM prompt_assets WHERE id=?", (asset_id,)).fetchone()
    return row_prompt_asset(row) if row else None


def delete_prompt_asset(conn: sqlite3.Connection, asset_id: str) -> bool:
    result = conn.execute("DELETE FROM prompt_assets WHERE id=?", (asset_id,))
    return result.rowcount > 0


def mark_stale_prompt_assets_failed(conn: sqlite3.Connection, timeout_seconds: int = 300) -> int:
    now_seconds = parse_iso_seconds(now_iso())
    if not now_seconds:
        return 0
    changed = 0
    rows = conn.execute("SELECT * FROM prompt_assets WHERE status=?", (PROMPT_ASSET_STATUS_GENERATING,)).fetchall()
    for row in rows:
        asset = row_prompt_asset(row)
        progress = asset.get("request", {}).get("progress", {}) if isinstance(asset.get("request"), dict) else {}
        step = str(progress.get("step") or "")
        updated_at = str(progress.get("updatedAt") or asset.get("updatedAt") or "")
        elapsed = now_seconds - parse_iso_seconds(updated_at)
        if elapsed < timeout_seconds:
            continue
        if step == "imageA" and not asset.get("imageAUrl"):
            message = "Image A 生成超时，远端图片接口长时间未返回。请重试当前素材，或检查图片模型配置。"
        elif step == "imageB" and not asset.get("imageBUrl"):
            message = "Image B 生成超时，远端图片接口长时间未返回。请重试当前素材，或检查图片模型配置。"
        elif step in {"analysis", "prompt", "compare", "prepare"}:
            message = f"{progress.get('label') or '生成步骤'}超时，远端接口长时间未返回。请重试当前素材。"
        else:
            continue
        update_prompt_asset(conn, asset["id"], {"status": PROMPT_ASSET_STATUS_FAILED, "error": message})
        changed += 1
    if changed:
        conn.commit()
    return changed


def prompt_asset_rows(
    conn: sqlite3.Connection,
    status: str = "",
    limit: int = 50,
    offset: int = 0,
    asset_kind: str = "",
) -> list[dict]:
    safe_limit = clamp_int(limit, 1, 200)
    safe_offset = max(0, int(offset or 0))
    normalized_status = normalize_prompt_asset_status(status) if status else ""
    normalized_kind = normalize_prompt_asset_kind(asset_kind) if asset_kind else ""
    clauses = []
    params = []
    if normalized_status:
        clauses.append("status=?")
        params.append(normalized_status)
    if normalized_kind:
        clauses.append("asset_kind=?")
        params.append(normalized_kind)
    where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM prompt_assets{where_sql} ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        (*params, safe_limit, safe_offset),
    ).fetchall()
    return [row_prompt_asset(row) for row in rows]


def create_prompt_assets(
    conn: sqlite3.Connection,
    product_image,
    reference_images,
    provider_model_id: str = "",
) -> list[dict]:
    product = normalize_prompt_asset_image(product_image)
    references = normalize_prompt_asset_images(reference_images)
    if not references:
        raise AppError(HTTPStatus.BAD_REQUEST, "请至少上传一张参考图")
    created = []
    timestamp = now_iso()
    for index, reference in enumerate(references, start=1):
        asset_id = make_id("prompt_asset")
        title = trim_text(reference.get("name") or f"参考图 {index}", 200)
        conn.execute(
            """
            INSERT INTO prompt_assets
              (id, asset_kind, title, status, provider_model_id, reference_images_json, product_image_json,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                asset_id,
                PROMPT_ASSET_KIND_SINGLE,
                title,
                PROMPT_ASSET_STATUS_DRAFT,
                trim_text(provider_model_id, 120),
                prompt_asset_json([reference], []),
                prompt_asset_json(product, {}),
                timestamp,
                timestamp,
            ),
        )
        created_asset = prompt_asset_by_id(conn, asset_id)
        if created_asset:
            created.append(created_asset)
    return created


def create_suite_prompt_asset(
    conn: sqlite3.Connection,
    product_image,
    reference_images,
    provider_model_id: str = "",
    title: str = "",
) -> dict:
    product = normalize_prompt_asset_image(product_image)
    references = normalize_prompt_asset_images(reference_images, limit=20)
    if not references:
        raise AppError(HTTPStatus.BAD_REQUEST, "请至少上传一张套图参考图")
    asset_id = make_id("prompt_asset")
    timestamp = now_iso()
    asset_title = trim_text(str(title or "套图提示词"), 200)
    suite_shots = normalize_suite_prompt_shots([], references)
    conn.execute(
        """
        INSERT INTO prompt_assets
          (id, asset_kind, title, status, provider_model_id, reference_images_json, product_image_json,
           suite_shots_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            asset_id,
            PROMPT_ASSET_KIND_SUITE,
            asset_title,
            PROMPT_ASSET_STATUS_DRAFT,
            trim_text(provider_model_id, 120),
            prompt_asset_json(references, []),
            prompt_asset_json(product, {}),
            prompt_asset_json(suite_shots, []),
            timestamp,
            timestamp,
        ),
    )
    created = prompt_asset_by_id(conn, asset_id)
    if not created:
        raise AppError(HTTPStatus.INTERNAL_SERVER_ERROR, "套图提示词素材创建失败")
    return created


def update_prompt_asset(conn: sqlite3.Connection, asset_id: str, values: dict) -> dict:
    if not prompt_asset_by_id(conn, asset_id):
        raise AppError(HTTPStatus.NOT_FOUND, "提示词素材不存在")
    allowed = {
        "title": ("title", lambda value: trim_text(value, 200)),
        "status": ("status", normalize_prompt_asset_status),
        "providerModelId": ("provider_model_id", lambda value: trim_text(value, 120)),
        "assetKind": ("asset_kind", normalize_prompt_asset_kind),
        "suiteShots": (
            "suite_shots_json",
            lambda value: json.dumps(normalize_suite_prompt_shots(value), ensure_ascii=False),
        ),
        "referenceAnalysis": ("reference_analysis", lambda value: trim_text(value, PROMPT_ASSET_TEXT_LIMIT)),
        "chinesePrompt": ("chinese_prompt", lambda value: trim_text(value, PROMPT_ASSET_TEXT_LIMIT)),
        "englishPrompt": ("english_prompt", lambda value: trim_text(value, PROMPT_ASSET_TEXT_LIMIT)),
        "imageAUrl": ("image_a_url", normalize_prompt_asset_image_url),
        "imageBUrl": ("image_b_url", normalize_prompt_asset_image_url),
        "comparison": ("comparison", lambda value: trim_text(value, PROMPT_ASSET_TEXT_LIMIT)),
        "targetPlatformId": ("target_platform_id", lambda value: trim_text(value, 120)),
        "targetCategoryId": ("target_category_id", lambda value: trim_text(value, 120)),
        "targetScenarioId": ("target_scenario_id", lambda value: trim_text(value, 120)),
        "publishMode": ("publish_mode", normalize_prompt_asset_publish_mode),
        "publishedTemplateId": ("published_template_id", lambda value: trim_text(value, 160)),
        "error": ("error", lambda value: trim_text(value, 4000)),
        "request": (
            "request_json",
            lambda value: trim_text(json.dumps(sanitize_payload(value), ensure_ascii=False), PROMPT_ASSET_JSON_LIMIT),
        ),
        "response": (
            "response_json",
            lambda value: trim_text(json.dumps(sanitize_payload(value), ensure_ascii=False), PROMPT_ASSET_JSON_LIMIT),
        ),
    }
    assignments = []
    params = []
    for key, value in (values or {}).items():
        if key not in allowed:
            continue
        column, normalizer = allowed[key]
        assignments.append(f"{column}=?")
        params.append(normalizer(value))
    if assignments:
        assignments.append("updated_at=?")
        params.append(now_iso())
        params.append(asset_id)
        conn.execute(f"UPDATE prompt_assets SET {', '.join(assignments)} WHERE id=?", params)
    asset = prompt_asset_by_id(conn, asset_id)
    if not asset:
        raise AppError(HTTPStatus.NOT_FOUND, "提示词素材不存在")
    return asset


def prompt_asset_slug(value: str) -> str:
    text = str(value or "factory-style").strip().lower()
    chars = []
    for char in text:
        if char.isalnum():
            chars.append(char)
        elif chars and chars[-1] != "-":
            chars.append("-")
    slug = "".join(chars).strip("-")
    return trim_text(slug or "factory-style", 80)


def find_single_matrix_platform(config: dict, platform_id: str) -> dict | None:
    for platform in config.get("single", {}).get("matrix", {}).get("platforms", []):
        if str(platform.get("id") or "") == platform_id:
            return platform
    return None


def find_single_matrix_category(platform: dict, category_id: str) -> dict | None:
    for category in platform.get("categories", []):
        if str(category.get("id") or "") == category_id:
            return category
    return None


def make_unique_factory_scenario_id(category: dict, title: str) -> str:
    base = prompt_asset_slug(title)
    existing = {str(item.get("id") or "") for item in category.get("scenarios", [])}
    candidate = base
    index = 2
    while candidate in existing:
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def make_unique_factory_suite_preset_id(config: dict, title: str) -> str:
    base = f"factory-suite-{prompt_asset_slug(title)}"
    existing = {str(item.get("id") or "") for item in config.get("suite", {}).get("presets", [])}
    candidate = base
    index = 2
    while candidate in existing:
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def find_suite_preset(config: dict, preset_id: str) -> dict | None:
    for preset in config.get("suite", {}).get("presets", []):
        if str(preset.get("id") or "") == preset_id:
            return preset
    return None


def build_suite_preset_from_prompt_asset(asset: dict, preset_id: str, title: str) -> dict:
    base_prompt = trim_text(
        with_in_image_copy_language_rule(asset.get("chinesePrompt") or "", language="zh"),
        PROMPT_TEXT_LIMIT,
    ).strip()
    if not base_prompt:
        raise AppError(HTTPStatus.BAD_REQUEST, "套图提示词素材没有可发布的中文总提示词")
    references = normalize_prompt_asset_images(asset.get("referenceImages") or [])
    suite_shots = normalize_suite_prompt_shots(asset.get("suiteShots"), references)
    if not suite_shots:
        raise AppError(HTTPStatus.BAD_REQUEST, "套图提示词素材没有可发布的图位")
    shots = []
    used_ids = set()
    for index, shot in enumerate(suite_shots, start=1):
        shot_id_base = prompt_asset_slug(shot.get("id") or shot.get("name") or f"shot-{index}")
        shot_id = shot_id_base
        suffix = 2
        while shot_id in used_ids:
            shot_id = f"{shot_id_base}-{suffix}"
            suffix += 1
        used_ids.add(shot_id)
        shot_prompt = trim_text(str(shot.get("chinesePrompt") or ""), PROMPT_ASSET_TEXT_LIMIT).strip()
        prompt = with_in_image_copy_language_rule(
            "\n".join(part for part in (base_prompt, shot_prompt) if part),
            language="zh",
        )
        shots.append(
            {
                "id": shot_id,
                "name": trim_text(str(shot.get("name") or f"{index:02d} 套图图位"), 120),
                "size": normalize_image_size(str(shot.get("size") or "1024x1024")) or "1024x1024",
                "description": trim_text(str(shot.get("description") or "同款套图图位"), 300),
                "prompt": trim_text(prompt, PROMPT_TEXT_LIMIT),
            }
        )
    return {
        "id": preset_id,
        "title": title,
        "folder": title,
        "shots": shots,
    }


def persist_prompt_config(conn: sqlite3.Connection, prompt_config: dict) -> dict:
    normalized = normalize_prompt_config(prompt_config)
    conn.execute(
        """
        INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
        """,
        (PROMPT_CONFIG_KEY, prompt_config_json(normalized), now_iso()),
    )
    return normalized


def publish_prompt_asset(conn: sqlite3.Connection, asset_id: str, payload: dict) -> dict:
    asset = prompt_asset_by_id(conn, asset_id)
    if not asset:
        raise AppError(HTTPStatus.NOT_FOUND, "提示词素材不存在")
    chinese_prompt = trim_text(
        with_in_image_copy_language_rule(asset.get("chinesePrompt") or "", language="zh"),
        PROMPT_TEXT_LIMIT,
    ).strip()
    if not chinese_prompt:
        raise AppError(HTTPStatus.BAD_REQUEST, "提示词素材没有可发布的中文提示词")

    platform_id = trim_text(str(payload.get("platformId") or ""), 120)
    category_id = trim_text(str(payload.get("categoryId") or ""), 120)
    mode = normalize_prompt_asset_publish_mode(payload.get("mode"))
    title = trim_text(str(payload.get("title") or asset.get("title") or "同款电商图"), 200)
    config = prompt_config_settings(conn)
    platform = find_single_matrix_platform(config, platform_id)
    if not platform:
        raise AppError(HTTPStatus.BAD_REQUEST, "发布平台不存在")
    category = find_single_matrix_category(platform, category_id)
    if not category:
        raise AppError(HTTPStatus.BAD_REQUEST, "发布品类不存在")

    if mode == "overwrite":
        scenario_id = trim_text(str(payload.get("scenarioId") or ""), 120)
        scenario = next((item for item in category.get("scenarios", []) if str(item.get("id") or "") == scenario_id), None)
        if not scenario:
            raise AppError(HTTPStatus.BAD_REQUEST, "覆盖场景不存在")
        scenario["title"] = title
        scenario["prompt"] = chinese_prompt
        template_id = str(scenario.get("templateId") or f"{platform_id}-{category_id}-{scenario_id}")
    else:
        scenario_id = make_unique_factory_scenario_id(category, title)
        template_id = f"{platform_id}-{category_id}-{scenario_id}"
        category.setdefault("scenarios", []).append(
            {
                "id": scenario_id,
                "title": title,
                "prompt": chinese_prompt,
                "templateId": template_id,
            }
        )

    persist_prompt_config(conn, config)
    timestamp = now_iso()
    conn.execute(
        """
        UPDATE prompt_assets
        SET status=?, title=?, target_platform_id=?, target_category_id=?, target_scenario_id=?,
            publish_mode=?, published_template_id=?, error='', updated_at=?, published_at=?
        WHERE id=?
        """,
        (
            PROMPT_ASSET_STATUS_PUBLISHED,
            title,
            platform_id,
            category_id,
            scenario_id,
            mode,
            template_id,
            timestamp,
            timestamp,
            asset_id,
        ),
    )
    published = prompt_asset_by_id(conn, asset_id)
    if not published:
        raise AppError(HTTPStatus.NOT_FOUND, "提示词素材不存在")
    return published


def publish_suite_prompt_asset(conn: sqlite3.Connection, asset_id: str, payload: dict) -> dict:
    asset = prompt_asset_by_id(conn, asset_id)
    if not asset:
        raise AppError(HTTPStatus.NOT_FOUND, "套图提示词素材不存在")
    if normalize_prompt_asset_kind(asset.get("assetKind")) != PROMPT_ASSET_KIND_SUITE:
        raise AppError(HTTPStatus.BAD_REQUEST, "这不是套图提示词素材")
    mode = normalize_prompt_asset_publish_mode(payload.get("mode"))
    title = trim_text(str(payload.get("title") or asset.get("title") or "同款电商套图"), 200)
    config = prompt_config_settings(conn)
    presets = config.setdefault("suite", {}).setdefault("presets", [])
    if mode == "overwrite":
        preset_id = trim_text(str(payload.get("presetId") or asset.get("publishedTemplateId") or ""), 160)
        preset = find_suite_preset(config, preset_id)
        if not preset:
            raise AppError(HTTPStatus.BAD_REQUEST, "覆盖套图不存在")
    else:
        preset_id = make_unique_factory_suite_preset_id(config, title)
        preset = None

    next_preset = build_suite_preset_from_prompt_asset(asset, preset_id, title)
    if preset is not None:
        preset.clear()
        preset.update(next_preset)
    else:
        presets.append(next_preset)

    persist_prompt_config(conn, config)
    timestamp = now_iso()
    conn.execute(
        """
        UPDATE prompt_assets
        SET status=?, title=?, publish_mode=?, published_template_id=?, error='', updated_at=?, published_at=?
        WHERE id=?
        """,
        (
            PROMPT_ASSET_STATUS_PUBLISHED,
            title,
            mode,
            preset_id,
            timestamp,
            timestamp,
            asset_id,
        ),
    )
    published = prompt_asset_by_id(conn, asset_id)
    if not published:
        raise AppError(HTTPStatus.NOT_FOUND, "套图提示词素材不存在")
    return published


def client_prompt_config(config: dict) -> dict:
    safe_config = copy.deepcopy(normalize_prompt_config(config))
    safe_config.get("single", {})["templateCategories"] = [
        category for category in safe_config.get("single", {}).get("templateCategories", []) if category.get("id") != "custom"
    ]
    safe_config.get("single", {}).pop("supplementalVariantPrompt", None)
    for template in safe_config.get("single", {}).get("templates", []):
        template.pop("prompt", None)
    for platform in safe_config.get("single", {}).get("matrix", {}).get("platforms", []):
        for category in platform.get("categories", []):
            for scenario in category.get("scenarios", []):
                scenario.pop("prompt", None)
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
    allowed_video_models: list[dict] | None = None,
    deductions: list[dict] | None = None,
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
        "allowedVideoModels": allowed_video_models or [],
        "usage": usage
        or {
            "calls": 0,
            "images": 0,
            "inputTokens": 0,
            "outputTokens": 0,
            "totalTokens": 0,
        },
        "credits": max(0, int(row_value(row, "credits", DEFAULT_CREDITS))),
        "creditsUsed": max(0, float(row_value(row, "credits_used", 0))),
        "creditsRemaining": max(0, int(row_value(row, "credits", DEFAULT_CREDITS)) - float(row_value(row, "credits_used", 0))),
        "recentDeductions": deductions or [],
    }


def row_value(row: sqlite3.Row, key: str, default=""):
    if row is None:
        return default
    return row[key] if key in row.keys() else default


def normalize_user_role(value) -> str:
    role = str(value or USER_ROLE).strip().lower()
    return role if role in VALID_USER_ROLES else USER_ROLE


def auth_email(body: dict) -> str:
    return trim_text(str(body.get("email") or "").strip().lower(), 120)


def find_user_by_email(conn: sqlite3.Connection, email: str):
    if not email:
        return None
    return conn.execute("SELECT * FROM users WHERE email<>'' AND lower(email)=lower(?) LIMIT 1", (email,)).fetchone()


class AppError(Exception):
    def __init__(self, status: int, message: str, payload: dict | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.payload = payload


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

    def do_DELETE(self) -> None:
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
            if path == "/api/redeem" and method == "POST":
                return self.handle_redeem()
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
            if path == "/api/admin/redeem/batches" and method == "POST":
                return self.handle_admin_create_redeem_batch()
            if path == "/api/admin/redeem/batches" and method == "GET":
                return self.handle_admin_list_redeem_batches()
            if path.startswith("/api/admin/redeem/batches/") and path.endswith("/codes") and method == "GET":
                batch_id = unquote(path.removeprefix("/api/admin/redeem/batches/").removesuffix("/codes"))
                return self.handle_admin_list_redeem_batch_codes(batch_id)
            if path.startswith("/api/admin/redeem/codes/") and method == "DELETE":
                code_id = unquote(path.removeprefix("/api/admin/redeem/codes/"))
                return self.handle_admin_revoke_redeem_code(code_id)
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
            if path == "/api/admin/prompt-assets" and method == "GET":
                return self.handle_admin_prompt_assets(parsed.query)
            if path == "/api/admin/prompt-assets" and method == "POST":
                return self.handle_admin_create_prompt_assets()
            if path.startswith("/api/admin/prompt-assets/") and method == "PATCH":
                asset_id = unquote(path.removeprefix("/api/admin/prompt-assets/"))
                return self.handle_admin_update_prompt_asset(asset_id)
            if path.startswith("/api/admin/prompt-assets/") and method == "DELETE":
                asset_id = unquote(path.removeprefix("/api/admin/prompt-assets/"))
                return self.handle_admin_delete_prompt_asset(asset_id)
            if path.startswith("/api/admin/prompt-assets/") and method == "POST":
                prompt_asset_path = path.removeprefix("/api/admin/prompt-assets/")
                if prompt_asset_path.endswith("/generate"):
                    asset_id = unquote(prompt_asset_path.removesuffix("/generate").rstrip("/"))
                    return self.handle_admin_generate_prompt_asset(asset_id)
                if prompt_asset_path.endswith("/publish"):
                    asset_id = unquote(prompt_asset_path.removesuffix("/publish").rstrip("/"))
                    return self.handle_admin_publish_prompt_asset(asset_id)
            if path == "/prompt-config-defaults.json":
                raise AppError(HTTPStatus.NOT_FOUND, "接口不存在")
            if path.startswith("/api/"):
                raise AppError(HTTPStatus.NOT_FOUND, "接口不存在")
            return super().do_GET()
        except AppError as error:
            response = {"error": error.message}
            if error.payload:
                response.update(error.payload)
            self.json_response(response, error.status)
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
        try:
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

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
                "SELECT * FROM sessions WHERE token=? AND expires_at>?",
                (token, now),
            ).fetchone()
            if not session:
                raise AppError(HTTPStatus.UNAUTHORIZED, "登录已失效")
            user_id = row_value(session, "user_id", "")
            if not user_id:
                # built-in admin — resolve to any user with admin role or return virtual user
                user = conn.execute(
                    "SELECT * FROM users WHERE role='admin' AND disabled=0 AND email<>'' LIMIT 1"
                ).fetchone()
                if not user:
                    user = conn.execute("SELECT * FROM users WHERE email=? LIMIT 1", (ADMIN_EMAIL,)).fetchone()
                if not user:
                    raise AppError(HTTPStatus.UNAUTHORIZED, "用户不存在")
                return user
            user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            if not user:
                raise AppError(HTTPStatus.UNAUTHORIZED, "用户不存在")
            if user["disabled"]:
                conn.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
                conn.commit()
                raise AppError(HTTPStatus.FORBIDDEN, "账号已被禁用")
            if session["role"] == ADMIN_ROLE and normalize_user_role(row_value(user, "role", USER_ROLE)) != ADMIN_ROLE:
                conn.execute("DELETE FROM sessions WHERE user_id=? AND role=?", (user["id"], ADMIN_ROLE))
                conn.commit()
                raise AppError(HTTPStatus.FORBIDDEN, "管理员权限已撤销")
            return user

    def require_admin(self) -> dict:
        token = self.bearer_token()
        if not token:
            raise AppError(HTTPStatus.UNAUTHORIZED, "请先登录 B 端")
        print(f"[AUTH] require_admin token={token[:16]}...", flush=True)
        with connect() as conn:
            session = conn.execute(
                "SELECT * FROM sessions WHERE token=? AND role=? AND expires_at>?",
                (token, ADMIN_ROLE, int(time.time())),
            ).fetchone()
            if not session:
                print(f"[AUTH] require_admin session NOT FOUND", flush=True)
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
        email = auth_email(body)
        if not email or "@" not in email:
            raise AppError(HTTPStatus.BAD_REQUEST, "请输入有效邮箱")
        name = email.split("@", 1)[0]
        password = str(body.get("password") or "")
        if len(password) < 8:
            raise AppError(HTTPStatus.BAD_REQUEST, "密码至少 8 位")
        source = normalize_source(body.get("source"))
        salt, password_hash = hash_password(password)
        user_id = make_id("user")
        try:
            with connect() as conn:
                if find_user_by_email(conn, email):
                    raise AppError(HTTPStatus.CONFLICT, "邮箱已注册")
                conn.execute(
                    """
                    INSERT INTO users
                      (id, email, name, password_salt, password_hash, disabled, role, source, referrer,
                       utm_source, utm_medium, utm_campaign, source_path, credits, credits_used, created_at, last_login_at)
                    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
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
                        DEFAULT_CREDITS,
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
        with connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        self.json_response({"token": token, "user": row_user(user)})

    def handle_login(self) -> None:
        body = self.read_json()
        email = auth_email(body)
        password = str(body.get("password") or "")
        if not email or "@" not in email:
            raise AppError(HTTPStatus.BAD_REQUEST, "请输入有效邮箱")
        with connect() as conn:
            user = find_user_by_email(conn, email)
            if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
                raise AppError(HTTPStatus.UNAUTHORIZED, "邮箱或密码错误")
            if user["disabled"]:
                raise AppError(HTTPStatus.FORBIDDEN, "账号已被禁用")
            conn.execute("UPDATE users SET last_login_at=? WHERE id=?", (now_iso(), user["id"]))
        role = ADMIN_ROLE if normalize_user_role(row_value(user, "role", USER_ROLE)) == ADMIN_ROLE else "user"
        token = self.create_session(user["id"], role)
        with connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
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
            model_config = model_config_settings(conn)
            prompt_config = prompt_config_settings(conn)
            row = conn.execute("SELECT * FROM user_settings WHERE user_id=?", (user["id"],)).fetchone()
            assigned_image_models = user_allowed_image_models(conn, user["id"])
            default_image_model_id = model_config.get("defaultImageModelId") or ""
            if assigned_image_models:
                image_options = authorized_image_model_options(conn, user["id"])
                selected_image_option = next(
                    (option for option in image_options if option["providerModelId"] == default_image_model_id),
                    image_options[0] if image_options else None,
                )
            else:
                image_options = configured_model_options(conn, MODEL_KIND_IMAGE)
                selected_image_option = next(
                    (option for option in image_options if option["providerModelId"] == default_image_model_id),
                    image_options[0] if image_options else None,
                )
            assigned_video_models = user_allowed_video_models(conn, user["id"])
            video_options = authorized_video_model_options(conn, user["id"]) if assigned_video_models else []
            selected_video_option = (
                video_options[0]
                if video_options
                else None
                if assigned_video_models
                else provider_model_option(conn, model_config.get("defaultVideoModelId"), MODEL_KIND_VIDEO)
            )
            available_image_models = (
                assigned_image_models
                if assigned_image_models
                else [
                    public_provider_model_option(
                        {
                            **option,
                            "isDefault": option["providerModelId"] == default_image_model_id,
                        }
                    )
                    for option in image_options
                ]
            )
            available_video_models = assigned_video_models or (
                [public_provider_model_option(selected_video_option)] if selected_video_option else []
            )
        api_key = row["api_key"] if row else ""
        provider_image_ready = bool(selected_image_option and str(selected_image_option.get("apiKey") or "").strip())
        endpoint = (
            resolve_provider_image_endpoint(selected_image_option, selected_image_option["modelName"])
            if selected_image_option
            else row_value(row, "endpoint", "") or settings["defaultEndpoint"]
        )
        model = selected_image_option["modelName"] if selected_image_option else row_value(row, "model", "") or settings["defaultModel"]
        video_api_key = row_value(row, "video_api_key", "")
        provider_video_ready = bool(selected_video_option and str(selected_video_option.get("apiKey") or "").strip())
        video_model = selected_video_option["modelName"] if selected_video_option else row_value(row, "video_model", "")
        video_endpoint_primary = selected_video_option["baseUrl"] if selected_video_option else row_value(row, "video_endpoint_primary", "")
        video_endpoint_secondary = row_value(row, "video_endpoint_secondary", "")
        self.json_response(
            {
                "settings": {
                    "apiKeyConfigured": bool(api_key) or provider_image_ready,
                    "apiKeyMasked": mask_api_key(api_key) if api_key else ("供应商模型" if provider_image_ready else ""),
                    "imageApiKeyConfigured": bool(api_key) or provider_image_ready,
                    "imageApiKeyMasked": mask_api_key(api_key) if api_key else ("供应商模型" if provider_image_ready else ""),
                    "imageEndpoint": endpoint,
                    "imageModel": model,
                    "endpoint": endpoint,
                    "model": model,
                    "videoApiKeyConfigured": bool(video_api_key) or provider_video_ready,
                    "videoApiKeyMasked": mask_api_key(video_api_key) if video_api_key else ("供应商模型" if provider_video_ready else ""),
                    "videoModel": video_model,
                    "videoEndpointPrimary": video_endpoint_primary,
                    "videoEndpointSecondary": video_endpoint_secondary,
                    "availableImageModels": available_image_models,
                    "availableVideoModels": available_video_models,
                    "defaultImageModelId": model_config.get("defaultImageModelId") or "",
                    "defaultVideoModelId": model_config.get("defaultVideoModelId") or "",
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
        requested_image_model_id = trim_text(
            str(body.get("imageModelId") or body.get("providerModelId") or body.get("modelId") or "").strip(),
            120,
        )
        with connect() as conn:
            settings = app_settings(conn)
            model_config = model_config_settings(conn)
            prompt_config = prompt_config_settings(conn)
            row = conn.execute("SELECT * FROM user_settings WHERE user_id=?", (user["id"],)).fetchone()
            assigned_image_models = user_allowed_image_models(conn, user["id"])
            authorized_models = authorized_image_model_options(conn, user["id"])
            configured_models = (
                authorized_models
                if assigned_image_models
                else configured_model_options(conn, MODEL_KIND_IMAGE)
            )
            default_image_model_id = model_config.get("defaultImageModelId") or ""
            default_model_option = next(
                (option for option in configured_models if option["providerModelId"] == default_image_model_id),
                configured_models[0] if configured_models else None,
            )
            selected_requested_option = None
            if requested_image_model_id:
                selected_requested_option = next(
                    (option for option in authorized_models if option["providerModelId"] == requested_image_model_id),
                    None,
                )
                if not selected_requested_option:
                    raise AppError(HTTPStatus.FORBIDDEN, "无权使用该图片模型")
        if assigned_image_models and not configured_models:
            raise AppError(HTTPStatus.FORBIDDEN, "请联系管理员配置可用图片模型")
        prompt, prompt_source = resolve_generation_prompt(body, prompt_config, references)
        if requested_image_model_id:
            provider_models_to_try = [selected_requested_option] if selected_requested_option else []
        else:
            provider_models_to_try = (
                [default_model_option, *[option for option in configured_models if option is not default_model_option]]
                if default_model_option
                else configured_models
            )
        provider_models_to_try = [option for option in provider_models_to_try if option]
        if provider_models_to_try:
            if not provider_models_to_try:
                raise AppError(HTTPStatus.FORBIDDEN, "请联系管理员配置可用图片模型")
            # ── credit check ──
            credit_cost = count * GENERATION_COST_PER_IMAGE
            credits_remaining = None
            with connect() as cconn:
                credit_result = consume_credits(cconn, user["id"], credit_cost)
                if not credit_result["ok"]:
                    raise AppError(
                        HTTPStatus.TOO_MANY_REQUESTS,
                        "积分不足",
                        payload={"required": credit_cost, "remaining": credit_result["remaining"]},
                    )
                credits_remaining = credit_result["remaining"]
                cconn.commit()
            last_error = None
            for attempt_index, option in enumerate(provider_models_to_try, start=1):
                if not str(option.get("apiKey") or "").strip():
                    raise AppError(HTTPStatus.FORBIDDEN, "请联系管理员配置默认模型 Token")
                model = option["modelName"]
                provider_type = option["providerType"]
                resolved_endpoint = resolve_provider_image_endpoint(option, model, references=references)
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
                        suite_preset_id=body.get("suitePresetId") or body.get("suite_preset_id"),
                        suite_shot_id=body.get("suiteShotId") or body.get("suite_shot_id"),
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
                    # refund excess if fewer images generated than requested
                    actual_count = len(images)
                    if actual_count < count:
                        refund_amount = (count - actual_count) * GENERATION_COST_PER_IMAGE
                        with connect() as rconn:
                            refund_credits(rconn, user["id"], refund_amount)
                            refreshed_user = rconn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
                            credits_remaining = row_user(refreshed_user)["creditsRemaining"] if refreshed_user else credits_remaining
                            rconn.commit()
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
                            "creditsRemaining": credits_remaining,
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
                    if attempt_index >= len(provider_models_to_try) or not is_failoverable_upstream_error(error):
                        with connect() as rconn:
                            refund_credits(rconn, user["id"], credit_cost)
                            rconn.commit()
                        raise AppError(HTTPStatus.BAD_GATEWAY, f"远端接口 {error.status}: {error.message}")
            if last_error:
                with connect() as rconn:
                    refund_credits(rconn, user["id"], credit_cost)
                    rconn.commit()
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
                suite_preset_id=body.get("suitePresetId") or body.get("suite_preset_id"),
                suite_shot_id=body.get("suiteShotId") or body.get("suite_shot_id"),
                count=count,
                size=size,
                reference_count=len(references),
            ),
        }
        credit_cost = count * GENERATION_COST_PER_IMAGE
        with connect() as cconn:
            credit_result = consume_credits(cconn, user["id"], credit_cost)
            if not credit_result["ok"]:
                raise AppError(
                    HTTPStatus.TOO_MANY_REQUESTS,
                    "积分不足",
                    payload={"required": credit_cost, "remaining": credit_result["remaining"]},
                )
            credits_remaining = credit_result["remaining"]
            cconn.commit()
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
            actual_count = len(images)
            if actual_count < count:
                refund_amount = (count - actual_count) * GENERATION_COST_PER_IMAGE
                with connect() as rconn:
                    refund_credits(rconn, user["id"], refund_amount)
                    refreshed_user = rconn.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
                    credits_remaining = row_user(refreshed_user)["creditsRemaining"] if refreshed_user else credits_remaining
                    rconn.commit()
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
                    "creditsRemaining": credits_remaining,
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
            with connect() as rconn:
                refund_credits(rconn, user["id"], credit_cost)
                rconn.commit()
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

    def handle_redeem(self) -> None:
        """POST /api/redeem — user redeems a code for credits."""
        if not _redeem_enabled():
            raise AppError(HTTPStatus.SERVICE_UNAVAILABLE, "兑换功能暂未开放")

        user = self.require_user()
        body = self.read_json()
        code = str(body.get("code") or "").strip()
        if not code or len(code) < 4:
            raise AppError(HTTPStatus.BAD_REQUEST, "请输入兑换码")

        # rate limit
        ip = self.headers.get("x-forwarded-for", "").split(",")[0].strip() or self.client_address[0]
        if _redeem_limiter.check_and_record(user["id"], ip):
            raise AppError(HTTPStatus.TOO_MANY_REQUESTS, "操作过于频繁，请稍后再试")

        code_hash = hash_redeem_code(code)
        now = now_iso()

        with connect() as conn:
            row = conn.execute(
                "SELECT * FROM redeem_codes WHERE code_hash=? LIMIT 1", (code_hash,)
            ).fetchone()
            if not row:
                raise AppError(HTTPStatus.BAD_REQUEST, "兑换码无效或已被使用")
            if row["status"] != "active":
                if row["expires_at"] and row["expires_at"] < now:
                    raise AppError(HTTPStatus.BAD_REQUEST, "兑换码已过期")
                raise AppError(HTTPStatus.BAD_REQUEST, "兑换码无效或已被使用")
            if row["expires_at"] and row["expires_at"] < now:
                # atomically mark expired
                conn.execute(
                    "UPDATE redeem_codes SET status='expired' WHERE id=? AND status='active'",
                    (row["id"],),
                )
                conn.commit()
                raise AppError(HTTPStatus.BAD_REQUEST, "兑换码已过期")

            # atomic claim
            result = conn.execute(
                "UPDATE redeem_codes SET status='redeemed', redeemed_by=?, redeemed_at=? "
                "WHERE id=? AND status='active'",
                (user["id"], now, row["id"]),
            )
            if result.rowcount == 0:
                raise AppError(HTTPStatus.BAD_REQUEST, "兑换码无效或已被使用")

            # add credits
            result = add_credits(conn, user["id"], row["credits"])
            if not result:
                # rollback code claim
                conn.execute(
                    "UPDATE redeem_codes SET status='active', redeemed_by=NULL, redeemed_at=NULL WHERE id=?",
                    (row["id"],),
                )
                conn.commit()
                raise AppError(HTTPStatus.INTERNAL_SERVER_ERROR, "系统错误，请稍后重试")

            conn.commit()

        self.json_response({
            "creditsAdded": row["credits"],
            "creditsRemaining": result["creditsRemaining"],
            "creditsTotal": result["credits"],
        })

    def handle_admin_login(self) -> None:
        body = self.read_json()
        email = str(body.get("email") or body.get("name") or "").strip().lower()
        password = str(body.get("password") or "")
        print(f"[AUTH] admin_login email={email} pwd_len={len(password)}", flush=True)
        # built-in admin
        if email == ADMIN_EMAIL and password == ADMIN_PASSWORD:
            token = self.create_session(None, ADMIN_ROLE)
            print(f"[AUTH] admin_login builtin token={token[:16]}...", flush=True)
            self.json_response({"token": token, "admin": {"email": ADMIN_EMAIL, "role": ADMIN_ROLE, "source": "builtin"}})
            return

        with connect() as conn:
            user = find_user_by_email(conn, email)
            if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
                raise AppError(HTTPStatus.UNAUTHORIZED, "B 端账号或密码错误")
            if user["disabled"]:
                raise AppError(HTTPStatus.FORBIDDEN, "管理员账号已被禁用")
            if normalize_user_role(row_value(user, "role", USER_ROLE)) != ADMIN_ROLE:
                raise AppError(HTTPStatus.FORBIDDEN, "该账号没有 B 端管理员权限")
            conn.execute("UPDATE users SET last_login_at=? WHERE id=?", (now_iso(), user["id"]))
        token = self.create_session(user["id"], ADMIN_ROLE)
        print(f"[AUTH] admin_login db user={user['email']} token={token[:16]}...", flush=True)
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
            # Recent deduction history per user
            deduction_rows = conn.execute(
                """
                SELECT user_id, count, created_at, request_json
                FROM generation_logs
                WHERE status='completed' AND count > 0
                ORDER BY created_at DESC
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
                  provider_models.model_kind,
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
        deductions_by_user: dict[str, list[dict]] = {}
        for drow in deduction_rows:
            uid = drow["user_id"]
            if uid not in deductions_by_user:
                deductions_by_user[uid] = []
            if len(deductions_by_user[uid]) < 20:
                req = {}
                try:
                    req = json.loads(drow["request_json"] or "{}")
                except (json.JSONDecodeError, TypeError):
                    pass
                deductions_by_user[uid].append({
                    "count": drow["count"],
                    "createdAt": drow["created_at"],
                    "hasTemplate": bool(req.get("templateId")),
                })
        settings_by_user = {row["user_id"]: row for row in settings_rows}
        access_by_user: dict[str, dict[str, list[dict]]] = {}
        for row in access_rows:
            model_kind = normalize_model_kind(row["model_kind"])
            access_by_user.setdefault(
                row["user_id"],
                {MODEL_KIND_IMAGE: [], MODEL_KIND_VIDEO: []},
            )[model_kind].append(
                    {
                        "id": row["model_id"],
                        "providerId": row["provider_id"],
                        "providerName": row["provider_name"],
                        "providerType": normalize_provider_type(row["provider_type"]),
                        "baseUrl": row["base_url"],
                        "modelName": row["model_name"],
                        "modelKind": model_kind,
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
                        access_by_user.get(row["id"], {}).get(MODEL_KIND_IMAGE, []),
                        access_by_user.get(row["id"], {}).get(MODEL_KIND_VIDEO, []),
                        deductions_by_user.get(row["id"], []),
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
                set_user_model_access(conn, user_id, body.get("allowedImageModelIds"), MODEL_KIND_IMAGE)
            if "allowedVideoModelIds" in body:
                set_user_model_access(conn, user_id, body.get("allowedVideoModelIds"), MODEL_KIND_VIDEO)
        self.json_response({"ok": True})

    # ── Admin redeem code handlers ──────────────────────────────────────────

    def handle_admin_create_redeem_batch(self) -> None:
        """POST /api/admin/redeem/batches"""
        self.require_admin()
        if not _redeem_enabled():
            raise AppError(HTTPStatus.SERVICE_UNAVAILABLE, "兑换功能暂未开放")
        body = self.read_json()
        count = clamp_int(body.get("count") or 1, 1, 1000)
        credits = clamp_int(body.get("credits") or 1, 1, 100000)
        expires_at = str(body.get("expiresAt") or "").strip()[:32] or None
        note = str(body.get("note") or "").strip()[:200] or None
        batch_id = make_id("batch")
        codes = [generate_redeem_code() for _ in range(count)]
        now = now_iso()
        with connect() as conn:
            insert_stmt = (
                "INSERT INTO redeem_codes (id, code_hash, code_prefix, batch_id, credits, "
                "status, expires_at, created_by, note, created_at) "
                "VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)"
            )
            for code in codes:
                conn.execute(
                    insert_stmt,
                    (
                        make_id("rc"),
                        hash_redeem_code(code),
                        code_prefix(code),
                        batch_id,
                        credits,
                        expires_at,
                        "admin",
                        note,
                        now,
                    ),
                )
            conn.commit()
        self.json_response({
            "batchId": batch_id,
            "count": count,
            "credits": credits,
            "expiresAt": expires_at,
            "note": note,
            "codes": codes,
        })

    def handle_admin_list_redeem_batches(self) -> None:
        """GET /api/admin/redeem/batches"""
        self.require_admin()
        with connect() as conn:
            rows = conn.execute("""
                SELECT batch_id, MAX(credits) AS credits, MAX(expires_at) AS expires_at,
                       MAX(note) AS note, MAX(created_by) AS created_by,
                       MIN(created_at) AS created_at, COUNT(*) AS total,
                       SUM(CASE WHEN status='redeemed' THEN 1 ELSE 0 END) AS redeemed,
                       SUM(CASE WHEN status='revoked' THEN 1 ELSE 0 END) AS revoked
                FROM redeem_codes
                GROUP BY batch_id
                ORDER BY created_at DESC
            """).fetchall()
        self.json_response({
            "batches": [
                {
                    "batchId": row["batch_id"],
                    "credits": row["credits"],
                    "expiresAt": row["expires_at"],
                    "note": row["note"],
                    "createdBy": row["created_by"],
                    "createdAt": row["created_at"],
                    "total": row["total"],
                    "redeemed": row["redeemed"],
                    "revoked": row["revoked"],
                }
                for row in rows
            ]
        })

    def handle_admin_list_redeem_batch_codes(self, batch_id: str) -> None:
        """GET /api/admin/redeem/batches/<id>/codes"""
        self.require_admin()
        with connect() as conn:
            rows = conn.execute(
                "SELECT rc.id, rc.code_prefix, rc.credits, rc.status, rc.redeemed_by, rc.redeemed_at, "
                "rc.expires_at, rc.created_at, "
                "COALESCE(NULLIF(u.name,''), u.email, rc.redeemed_by) AS redeemed_display "
                "FROM redeem_codes rc "
                "LEFT JOIN users u ON u.id = rc.redeemed_by "
                "WHERE rc.batch_id=? ORDER BY rc.created_at ASC",
                (batch_id,),
            ).fetchall()
        self.json_response({
            "codes": [
                {
                    "id": row["id"],
                    "codePrefix": row["code_prefix"],
                    "credits": row["credits"],
                    "status": row["status"],
                    "redeemedBy": row["redeemed_display"] or row["redeemed_by"],
                    "redeemedAt": row["redeemed_at"],
                    "expiresAt": row["expires_at"],
                    "createdAt": row["created_at"],
                }
                for row in rows
            ]
        })

    def handle_admin_revoke_redeem_code(self, code_id: str) -> None:
        """DELETE /api/admin/redeem/codes/<id>"""
        self.require_admin()
        with connect() as conn:
            result = conn.execute(
                "UPDATE redeem_codes SET status='revoked' WHERE id=? AND status='active'",
                (code_id,),
            )
            if result.rowcount == 0:
                raise AppError(HTTPStatus.NOT_FOUND, "码不存在或无法作废（可能已兑换）")
            conn.commit()
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
        default_image_model_id = trim_text(str(body.get("defaultImageModelId") or "").strip(), 120)
        default_video_model_id = trim_text(str(body.get("defaultVideoModelId") or "").strip(), 120)
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
            if default_image_model_id:
                exists = conn.execute(
                    "SELECT id FROM provider_models WHERE id=? AND model_kind=? LIMIT 1",
                    (default_image_model_id, MODEL_KIND_IMAGE),
                ).fetchone()
                if not exists:
                    default_image_model_id = ""
            if default_video_model_id:
                exists = conn.execute(
                    "SELECT id FROM provider_models WHERE id=? AND model_kind=? LIMIT 1",
                    (default_video_model_id, MODEL_KIND_VIDEO),
                ).fetchone()
                if not exists:
                    default_video_model_id = ""
            for key, value in {
                DEFAULT_IMAGE_MODEL_KEY: default_image_model_id,
                DEFAULT_VIDEO_MODEL_KEY: default_video_model_id,
            }.items():
                conn.execute(
                    """
                    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
                    """,
                    (key, value, now_iso()),
                )
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
            prompt_config = persist_prompt_config(conn, prompt_config)
        self.json_response({"ok": True, "promptConfig": prompt_config})

    def handle_admin_prompt_assets(self, query: str) -> None:
        self.require_admin()
        params = parse_qs(query)
        status = params.get("status", [""])[0]
        asset_kind = params.get("assetKind", [params.get("asset_kind", [""])[0]])[0]
        limit = clamp_int(params.get("limit", ["50"])[0], 1, 200)
        try:
            offset = max(0, int(params.get("offset", ["0"])[0] or 0))
        except ValueError:
            offset = 0
        with connect() as conn:
            mark_stale_prompt_assets_failed(conn)
            assets = prompt_asset_rows(conn, status=status, limit=limit, offset=offset, asset_kind=asset_kind)
            model_options = [
                {
                    "providerModelId": option["providerModelId"],
                    "providerName": option["providerName"],
                    "modelName": option["modelName"],
                    "providerType": option["providerType"],
                    "modelKind": option.get("modelKind", MODEL_KIND_IMAGE),
                }
                for option in prompt_factory_model_options(conn)
            ]
        self.json_response({"assets": assets, "modelOptions": model_options})

    def handle_admin_create_prompt_assets(self) -> None:
        self.require_admin()
        body = self.read_json()
        with connect() as conn:
            if normalize_prompt_asset_kind(body.get("assetKind")) == PROMPT_ASSET_KIND_SUITE:
                assets = [
                    create_suite_prompt_asset(
                        conn,
                        body.get("productImage"),
                        body.get("referenceImages"),
                        provider_model_id=str(body.get("providerModelId") or ""),
                        title=str(body.get("title") or ""),
                    )
                ]
            else:
                assets = create_prompt_assets(
                    conn,
                    body.get("productImage"),
                    body.get("referenceImages"),
                    provider_model_id=str(body.get("providerModelId") or ""),
                )
        self.json_response({"assets": assets})

    def handle_admin_update_prompt_asset(self, asset_id: str) -> None:
        self.require_admin()
        body = self.read_json()
        with connect() as conn:
            asset = update_prompt_asset(conn, asset_id, body)
        self.json_response({"asset": asset})

    def handle_admin_delete_prompt_asset(self, asset_id: str) -> None:
        self.require_admin()
        with connect() as conn:
            deleted = delete_prompt_asset(conn, asset_id)
        if not deleted:
            raise AppError(HTTPStatus.NOT_FOUND, "提示词素材不存在")
        self.json_response({"ok": True})

    def handle_admin_generate_prompt_asset(self, asset_id: str) -> None:
        self.require_admin()
        body = self.read_json()
        with connect() as conn:
            asset = generate_prompt_asset(conn, asset_id, str(body.get("providerModelId") or ""))
        self.json_response({"asset": asset})

    def handle_admin_publish_prompt_asset(self, asset_id: str) -> None:
        self.require_admin()
        body = self.read_json()
        with connect() as conn:
            if str(body.get("factoryScope") or "").strip().lower() == PROMPT_ASSET_KIND_SUITE:
                asset = publish_suite_prompt_asset(conn, asset_id, body)
            else:
                asset = publish_prompt_asset(conn, asset_id, body)
            prompt_config = prompt_config_settings(conn)
        self.json_response({"asset": asset, "promptConfig": prompt_config})


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


def resolve_provider_image_endpoint(provider: dict | sqlite3.Row, model: str, references: list[dict] | None = None) -> str:
    provider_type = normalize_provider_type(provider_value(provider, "providerType", "provider_type"))
    base_url = normalize_provider_base_url(provider_value(provider, "baseUrl", "base_url"), provider_type)
    if provider_type == PROVIDER_TYPE_AOKAPI_GEMINI:
        return resolve_image_endpoint(base_url, model)
    path = "images/edits" if references else "images/generations"
    return resolve_openai_image_endpoint(base_url, path)


def resolve_openai_image_endpoint(base_url: str, path: str) -> str:
    value = str(base_url or "").rstrip("/")
    lower = value.lower()
    for suffix in ("/images/generations", "/images/edits"):
        if lower.endswith(suffix):
            return f"{value[:-len(suffix)]}/{path}"
    return f"{value}/{path}"


def resolve_openai_chat_endpoint(base_url: str) -> str:
    value = str(base_url or "").rstrip("/")
    lower = value.lower()
    if lower.endswith("/chat/completions"):
        return value
    return f"{value}/chat/completions"


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
    if references:
        image_value = [reference["url"] for reference in references if reference.get("url")]
        return (
            {
                "model": model,
                "prompt": prompt,
                "n": count,
                "size": size,
                "response_format": "b64_json",
                "image": image_value if len(image_value) > 1 else image_value[0],
            },
            "OpenAI image edit b64_json",
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


def build_gemini_text_request_body(prompt: str, references: list[dict]) -> dict:
    parts = [{"text": prompt}]
    for reference in references:
        inline_data = reference_to_inline_data(reference)
        if inline_data:
            parts.append({"inlineData": inline_data})
    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseModalities": ["TEXT"]},
    }


def build_openai_vision_text_request_body(model: str, prompt: str, references: list[dict]) -> dict:
    content = [{"type": "text", "text": prompt}]
    for reference in references:
        url = str(reference.get("url") or "").strip()
        if url:
            content.append({"type": "image_url", "image_url": {"url": url}})
    return {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are an ecommerce image prompt analyst. Return strict JSON only.",
            },
            {"role": "user", "content": content},
        ],
        "response_format": {"type": "json_object"},
    }


def call_prompt_factory_text(option: dict, prompt: str, references: list[dict]) -> dict:
    if normalize_model_kind(option.get("modelKind")) == MODEL_KIND_TEXT:
        endpoint = resolve_openai_chat_endpoint(normalize_provider_base_url(option.get("baseUrl"), option.get("providerType")))
        request_body = build_openai_vision_text_request_body(option["modelName"], prompt, references)
    else:
        endpoint = resolve_provider_image_endpoint(option, option["modelName"], references=references)
        request_body = build_gemini_text_request_body(prompt, references)
    payload = call_upstream_model_with_retry(endpoint, option["apiKey"], request_body)
    texts = extract_text_results_from_payload(payload)
    if not texts:
        raise UpstreamError(502, "模型未返回文本", payload)
    return parse_json_object_from_model_text("\n".join(texts))


def generate_prompt_asset_image(option: dict, prompt: str, references: list[dict], size: str = "1024x1024") -> str:
    endpoint = resolve_provider_image_endpoint(option, option["modelName"], references=references)
    request_body, _strategy = build_provider_image_request_body(
        prompt=prompt,
        count=1,
        size=size,
        model=option["modelName"],
        endpoint=endpoint,
        provider_type=option["providerType"],
        references=references,
    )
    payload = call_upstream_model_with_retry(endpoint, option["apiKey"], request_body)
    images = extract_image_results_from_payload(payload)
    if not images:
        raise UpstreamError(502, "接口未返回可识别的图片地址或 b64_json", payload)
    return durable_prompt_asset_image_url(images[0]["url"])


def suite_shot_validation_prompt(base_prompt: str, shot: dict) -> str:
    shot_prompt = trim_text(str(shot.get("chinesePrompt") or ""), PROMPT_ASSET_TEXT_LIMIT).strip()
    return with_in_image_copy_language_rule(
        "\n".join(part for part in (base_prompt, shot_prompt) if part),
        language="zh",
    )


def durable_prompt_asset_image_url(url: str) -> str:
    value = str(url or "").strip()
    if not value or value.startswith("data:image/"):
        return value
    if not value.lower().startswith(("http://", "https://")):
        return value
    return download_image_url_as_data_url(value)


def download_image_url_as_data_url(url: str, max_bytes: int = 8_000_000) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "image-editor-tool/1.0", "Accept": "image/*"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
            info = response.info()
            mime_type = str(info.get_content_type() if hasattr(info, "get_content_type") else info.get("Content-Type", "image/png"))
            if not mime_type.startswith("image/"):
                mime_type = "image/png"
            data = response.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise UpstreamError(502, "远程图片过大，无法保存预览", {"url": url, "maxBytes": max_bytes})
            if not data:
                raise UpstreamError(502, "远程图片为空，无法保存预览", {"url": url})
            encoded = base64.b64encode(data).decode("ascii")
            return f"data:{mime_type};base64,{encoded}"
    except urllib.error.HTTPError as error:
        raise UpstreamError(error.code, "远程图片链接无法下载", {"url": url})
    except urllib.error.URLError as error:
        raise UpstreamError(502, f"远程图片链接无法下载：{error.reason}", {"url": url})
    except (TimeoutError, socket.timeout):
        raise UpstreamError(504, "远程图片下载超时", {"url": url})


def update_prompt_asset_progress(
    conn: sqlite3.Connection,
    asset_id: str,
    step: str,
    label: str,
    detail: str,
    *,
    text_option: dict | None = None,
    image_option: dict | None = None,
) -> dict:
    request = {
        "progress": {
            "step": step,
            "label": label,
            "detail": detail,
            "updatedAt": now_iso(),
        }
    }
    if text_option:
        request["textProviderModelId"] = text_option.get("providerModelId") or ""
        request["textModel"] = text_option.get("modelName") or ""
        request["textProviderName"] = text_option.get("providerName") or ""
    if image_option:
        request["imageProviderModelId"] = image_option.get("providerModelId") or ""
        request["imageModel"] = image_option.get("modelName") or ""
        request["imageProviderName"] = image_option.get("providerName") or ""
    asset = update_prompt_asset(conn, asset_id, {"request": request})
    conn.commit()
    return asset


def prompt_asset_reference_images(asset: dict) -> list[dict]:
    return normalize_prompt_asset_images(asset.get("referenceImages") or [], limit=20)


def prompt_asset_product_image(asset: dict) -> dict:
    return normalize_prompt_asset_image(asset.get("productImage") or {})


def generate_prompt_asset(conn: sqlite3.Connection, asset_id: str, provider_model_id: str = "") -> dict:
    asset = prompt_asset_by_id(conn, asset_id)
    if not asset:
        raise AppError(HTTPStatus.NOT_FOUND, "提示词素材不存在")
    selected_model_id = provider_model_id or asset.get("providerModelId") or ""
    text_option = selected_prompt_factory_model(conn, selected_model_id)
    image_option = text_option if normalize_model_kind(text_option.get("modelKind")) == MODEL_KIND_IMAGE else selected_prompt_factory_image_model(conn)
    update_prompt_asset_progress(
        conn,
        asset_id,
        "prepare",
        "准备生成请求",
        "已选择文本理解模型与验证出图模型，准备上传参考图上下文。",
        text_option=text_option,
        image_option=image_option,
    )
    update_prompt_asset(
        conn,
        asset_id,
        {"status": PROMPT_ASSET_STATUS_GENERATING, "providerModelId": text_option["providerModelId"], "error": ""},
    )
    asset = prompt_asset_by_id(conn, asset_id) or asset
    asset_kind = normalize_prompt_asset_kind(asset.get("assetKind"))
    references = prompt_asset_reference_images(asset)
    product = prompt_asset_product_image(asset)
    text_references = [image for image in [product, *references] if image.get("url")]
    try:
        update_prompt_asset_progress(
            conn,
            asset_id,
            "analysis",
            "分析参考图风格",
            "文本理解模型正在读取参考图的构图、卖点模块、文字层级和电商风格。",
            text_option=text_option,
            image_option=image_option,
        )
        analysis_payload = call_prompt_factory_text(text_option, prompt_factory_analysis_instruction(), text_references)
        update_prompt_asset_progress(
            conn,
            asset_id,
            "prompt",
            "生成可复用提示词",
            "正在把参考图分析转换成中文和英文 Prompt，要求不依赖参考图也能复刻风格。",
            text_option=text_option,
            image_option=image_option,
        )
        prompt_instruction = (
            prompt_factory_suite_prompt_instruction(analysis_payload, len(references))
            if asset_kind == PROMPT_ASSET_KIND_SUITE
            else prompt_factory_prompt_instruction(analysis_payload)
        )
        prompt_payload = call_prompt_factory_text(text_option, prompt_instruction, [product] if product else [])
        chinese_prompt = trim_text(
            with_in_image_copy_language_rule(str(prompt_payload.get("chinesePrompt") or ""), language="zh"),
            PROMPT_ASSET_TEXT_LIMIT,
        )
        english_prompt = trim_text(
            with_in_image_copy_language_rule(str(prompt_payload.get("englishPrompt") or ""), language="en"),
            PROMPT_ASSET_TEXT_LIMIT,
        )
        if not chinese_prompt or not english_prompt:
            raise AppError(HTTPStatus.BAD_GATEWAY, "模型未返回完整的中英文提示词")
        asset_title = trim_text(
            str(
                prompt_payload.get("assetTitle")
                or prompt_payload.get("title")
                or prompt_payload.get("name")
                or ""
            ),
            200,
        )
        suite_shots = normalize_suite_prompt_shots(prompt_payload.get("suiteShots"), references)
        update_values = {
                "referenceAnalysis": trim_text(
                    str(
                        analysis_payload.get("chineseSummary")
                        or analysis_payload.get("summary")
                        or json.dumps(analysis_payload, ensure_ascii=False)
                    ),
                    PROMPT_ASSET_TEXT_LIMIT,
                ),
                "chinesePrompt": chinese_prompt,
                "englishPrompt": english_prompt,
                "suiteShots": suite_shots if asset_kind == PROMPT_ASSET_KIND_SUITE else asset.get("suiteShots", []),
                "request": {
                    "providerModelId": text_option["providerModelId"],
                    "textProviderModelId": text_option["providerModelId"],
                    "imageProviderModelId": image_option["providerModelId"],
                    "referenceCount": len(references),
                    "hasProductImage": bool(product),
                    "assetKind": asset_kind,
                },
        }
        if asset_title:
            update_values["title"] = asset_title
        partial = update_prompt_asset(conn, asset_id, update_values)
        if asset_kind == PROMPT_ASSET_KIND_SUITE:
            image_b_url = ""
            comparison = "未上传商品原图，已生成套图提示词但未生成 Prompt + 原图图片。"
            if product:
                update_prompt_asset_progress(
                    conn,
                    asset_id,
                    "imageB",
                    "生成 Prompt + 原图图片",
                    "验证出图模型正在按每个套图图位分别使用商品原图和对应 Prompt，逐张测试是否可下发复用。",
                    text_option=text_option,
                    image_option=image_option,
                )
                generated_count = 0
                for shot_index, shot in enumerate(suite_shots):
                    shot_prompt = suite_shot_validation_prompt(chinese_prompt, shot)
                    shot_size = normalize_image_size(str(shot.get("size") or "1024x1024")) or "1024x1024"
                    shot_image_url = generate_prompt_asset_image(image_option, shot_prompt, [product], size=shot_size)
                    shot["promptOnlyImageUrl"] = shot_image_url
                    shot["imageError"] = ""
                    if not image_b_url:
                        image_b_url = shot_image_url
                    generated_count += 1
                    update_prompt_asset(
                        conn,
                        asset_id,
                        {
                            "imageBUrl": image_b_url,
                            "suiteShots": suite_shots,
                            "comparison": f"已生成 {generated_count} 张 Prompt + 原图图片",
                        },
                    )
                    conn.commit()
                conn.commit()
                comparison = f"已生成 {generated_count} 张 Prompt + 原图图片"
            return update_prompt_asset(
                conn,
                asset_id,
                {
                    "status": PROMPT_ASSET_STATUS_GENERATED,
                    "imageAUrl": "",
                    "imageBUrl": image_b_url,
                    "comparison": comparison,
                    "suiteShots": suite_shots,
                    "response": {"analysis": analysis_payload, "prompt": prompt_payload},
                    "error": "",
                },
            )
        image_a_url = ""
        image_b_url = ""
        comparison = "未上传商品原图，已生成提示词但未生成 Prompt + 原图图片。"
        if product:
            update_prompt_asset_progress(
                conn,
                asset_id,
                "imageB",
                "生成 Prompt + 原图图片",
                "验证出图模型正在只使用商品原图和生成 Prompt，测试提示词是否可下发复用。",
                text_option=text_option,
                image_option=image_option,
            )
            image_b_url = generate_prompt_asset_image(image_option, chinese_prompt, [product])
            update_prompt_asset(conn, asset_id, {"imageBUrl": image_b_url})
            conn.commit()
            comparison = "已生成 1 张 Prompt + 原图图片"
        return update_prompt_asset(
            conn,
            asset_id,
            {
                "status": PROMPT_ASSET_STATUS_GENERATED,
                "imageAUrl": image_a_url,
                "imageBUrl": image_b_url,
                "comparison": comparison,
                "suiteShots": suite_shots if asset_kind == PROMPT_ASSET_KIND_SUITE else asset.get("suiteShots", []),
                "response": {"analysis": analysis_payload, "prompt": prompt_payload},
                "error": "",
            },
        )
    except AppError as error:
        update_prompt_asset(conn, asset_id, {"status": PROMPT_ASSET_STATUS_FAILED, "error": error.message})
        raise
    except UpstreamError as error:
        update_prompt_asset(conn, asset_id, {"status": PROMPT_ASSET_STATUS_FAILED, "error": f"API {error.status}: {error.message}"})
        raise AppError(HTTPStatus.BAD_GATEWAY, f"远端接口 {error.status}: {error.message}")
    except Exception as error:
        update_prompt_asset(conn, asset_id, {"status": PROMPT_ASSET_STATUS_FAILED, "error": str(error)})
        raise


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
        prompt = with_in_image_copy_language_rule(with_reference_context(prompt, references, prompt_config), language="zh")
        return with_strict_product_reference(prompt, prompt_config), "template"

    suite_preset_id = trim_text(str(body.get("suitePresetId") or body.get("suite_preset_id") or "").strip(), 160)
    suite_shot_id = trim_text(str(body.get("suiteShotId") or body.get("suite_shot_id") or "").strip(), 160)
    if suite_preset_id or suite_shot_id:
        prompt = suite_shot_private_prompt(prompt_config, suite_preset_id, suite_shot_id)
        if not prompt:
            raise AppError(HTTPStatus.BAD_REQUEST, "套图模板或图位不存在")
        prompt = with_in_image_copy_language_rule(with_reference_context(prompt, references, prompt_config), language="zh")
        return with_strict_product_reference(prompt, prompt_config), "suite-template"

    prompt = trim_text(str(body.get("prompt") or "").strip(), 8000)
    if not prompt:
        raise AppError(HTTPStatus.BAD_REQUEST, "请选择模板")
    return with_in_image_copy_language_rule(prompt, language="zh"), "prompt"


def single_template_prompt(prompt_config: dict, template_id: str) -> str:
    for template in prompt_config.get("single", {}).get("templates", []):
        if str(template.get("id") or "") == template_id:
            return trim_text(str(template.get("prompt") or "").strip(), 8000)
    return ""


def suite_shot_private_prompt(prompt_config: dict, preset_id: str, shot_id: str) -> str:
    if not preset_id or not shot_id:
        return ""
    for preset in prompt_config.get("suite", {}).get("presets", []):
        if str(preset.get("id") or "") != preset_id:
            continue
        for shot in preset.get("shots", []):
            if str(shot.get("id") or "") == shot_id:
                return trim_text(str(shot.get("prompt") or "").strip(), 8000)
    return ""


def prompt_text(template: str, values: dict) -> str:
    text = str(template or "")
    for key, value in values.items():
        text = text.replace("{" + str(key) + "}", str(value))
    return text


def with_in_image_copy_language_rule(prompt: str, *, language: str = "zh") -> str:
    text = str(prompt or "").strip()
    if any(needle in text for needle in IN_IMAGE_COPY_LANGUAGE_NEEDLES):
        return text
    rule = IN_IMAGE_COPY_LANGUAGE_RULE_EN if language == "en" else IN_IMAGE_COPY_LANGUAGE_RULE_ZH
    return "\n\n".join(part for part in (text, rule) if part)


def prompt_factory_analysis_instruction() -> str:
    return """
Analyze the ecommerce reference image and optional product image. Return strict JSON only with keys:
chineseSummary, summary, imageType, canvasRatio, productPlacement, backgroundLighting,
textHierarchy, englishCopySuggestions, riskPoints. Focus on layout, labels, icons,
callouts, typography, scene style, and seller realism.
chineseSummary must be written in Simplified Chinese for a B-side admin reviewer. It should explain the reusable layout, visual style, product placement, text hierarchy, and risk notes captured from the reference image.
All visible in-image copy in generated images must be in English. Translate any visible Chinese copy into concise English.
""".strip()


def prompt_factory_prompt_instruction(analysis: dict) -> str:
    return f"""
Create reusable prompt-only ecommerce image prompts from this reference analysis. Return strict JSON only:
{{"assetTitle":"short Chinese asset title", "chinesePrompt":"...", "englishPrompt":"..."}}

Rules:
- assetTitle must be a concise Simplified Chinese title based on the model's understanding of the reference image and product scene, not the uploaded filename.
- The prompts must work with only one uploaded original product image and text prompt.
- Do not mention a separate reference image.
- Preserve exact product identity: shape, color, proportions, material, screen, buttons, ports, openings, logo, accessories, and visible construction.
- The Chinese prompt must include this exact built-in rule: {IN_IMAGE_COPY_LANGUAGE_RULE_ZH}
- The English prompt must include this exact built-in rule: {IN_IMAGE_COPY_LANGUAGE_RULE_EN}
- Avoid fake certifications, platform logos, rankings, discount badges, unsupported percentages, and unverifiable medical or technical claims.

Reference analysis JSON:
{json.dumps(analysis, ensure_ascii=False)}
""".strip()


def prompt_factory_suite_prompt_instruction(analysis: dict, reference_count: int) -> str:
    return f"""
Create reusable prompt-only ecommerce suite prompts from this multi-image reference analysis. Return strict JSON only:
{{"assetTitle":"short Chinese suite asset title", "chinesePrompt":"overall suite style prompt", "englishPrompt":"overall suite style prompt in English", "suiteShots":[{{"name":"01 ...", "size":"1024x1024", "description":"...", "chinesePrompt":"shot-level prompt", "englishPrompt":"shot-level prompt in English"}}]}}

Rules:
- assetTitle must be a concise Simplified Chinese title based on the uploaded reference images and product scene, not the uploaded filename.
- Create exactly {max(1, reference_count)} suiteShots: one and only one shot for each uploaded reference image, preserving reference image order. Do not invent extra shots when there is only one reference image.
- Name each shot in Simplified Chinese from the actual visual purpose and content of that specific reference image. Avoid generic names such as "首屏品牌横幅", "卖点信息图", "细节特写图", "Hero Banner", or "Feature Infographic" unless those exact words are visibly justified by the reference.
- Each name should be concise, specific, and product-aware, such as "屏幕参数细节图" or "指夹血氧仪功能贴标图".
- The overall prompts must describe the unified ecommerce suite style, product consistency, layout rhythm, lighting, text hierarchy, and seller realism.
- Each suiteShots item must describe one C-side suite image slot that can work with only one uploaded original product image and text prompt.
- Do not mention a separate reference image in final prompts.
- Preserve exact product identity across the whole suite: shape, color, proportions, material, screen, buttons, ports, openings, logo, accessories, and visible construction.
- The Chinese prompt and each Chinese shot prompt must include or inherit this rule: {IN_IMAGE_COPY_LANGUAGE_RULE_ZH}
- The English prompt and each English shot prompt must include or inherit this rule: {IN_IMAGE_COPY_LANGUAGE_RULE_EN}
- Avoid fake certifications, platform logos, rankings, discount badges, unsupported percentages, and unverifiable medical or technical claims.

Reference analysis JSON:
{json.dumps(analysis, ensure_ascii=False)}
""".strip()


def prompt_factory_reference_assisted_prompt(asset: dict) -> str:
    prompt = "\n".join(
        part
        for part in [
            "Use the uploaded original product image as the product identity to preserve.",
            "Use the uploaded ecommerce reference image as layout, composition, text hierarchy, lighting, and seller-style guidance.",
            asset.get("chinesePrompt")
            or asset.get("englishPrompt")
            or "Create a realistic ecommerce product image matching the reference style.",
        ]
        if part
    )
    return with_in_image_copy_language_rule(prompt, language="zh")


def prompt_factory_comparison_instruction() -> str:
    return """
Compare the reference ecommerce image, Image A, and Image B. Return strict JSON only with keys similarityScore and comparison.
similarityScore must be an integer from 0 to 100 that scores how well Image B can reproduce the reference ecommerce style while preserving product identity.
In comparison, mention only the most important match/drift and one concrete next adjustment.
Write the comparison in Simplified Chinese for a B-side admin reviewer. Do not answer in English.
""".strip()


def prompt_factory_similarity_score_text(value: str) -> str:
    text = trim_text(str(value or ""), PROMPT_ASSET_TEXT_LIMIT).strip()
    if not text:
        return "相似度待复核"
    payload = None
    if text.startswith("{"):
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = None
    if isinstance(payload, dict):
        for key in ("similarityScore", "similarity_score", "score", "similarity"):
            raw_score = payload.get(key)
            if raw_score is None:
                continue
            try:
                score = int(round(float(raw_score)))
            except (TypeError, ValueError):
                continue
            score = max(0, min(100, score))
            return f"相似度 {score}分"
    match = re.search(r"(?:相似度|similarity|score)\D{0,12}(\d{1,3})", text, re.IGNORECASE)
    if match:
        score = max(0, min(100, int(match.group(1))))
        return f"相似度 {score}分"
    return text if text.startswith("相似度") and len(text) <= 24 else "相似度待复核"


def normalize_prompt_factory_comparison_text(value: str) -> str:
    text = trim_text(str(value or ""), PROMPT_ASSET_TEXT_LIMIT)
    if not text:
        return "对比结论为空，请重试当前素材。"
    score_text = prompt_factory_similarity_score_text(text)
    if score_text.startswith("相似度"):
        return score_text
    chinese_chars = sum(1 for char in text if "\u4e00" <= char <= "\u9fff")
    if chinese_chars >= 8:
        return text
    return trim_text(f"对比结论：模型返回了英文结论，请人工复核。原始结论：{text}", PROMPT_ASSET_TEXT_LIMIT)


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
    suite_preset_id="",
    suite_shot_id="",
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
    if prompt_source == "suite-template":
        return {
            "suitePresetId": str(suite_preset_id or ""),
            "suiteShotId": str(suite_shot_id or ""),
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
    if is_openai_image_edit_request(endpoint, body):
        return call_upstream_model_multipart(endpoint, api_key, body)
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


def is_openai_image_edit_request(endpoint: str, body: dict) -> bool:
    return str(endpoint or "").rstrip("/").lower().endswith("/images/edits") and bool((body or {}).get("image"))


def call_upstream_model_multipart(endpoint: str, api_key: str, body: dict):
    if shutil.which("curl"):
        try:
            return call_upstream_model_multipart_curl(endpoint, api_key, body)
        except FileNotFoundError:
            pass
        except subprocess.TimeoutExpired:
            raise UpstreamError(504, "请求远端模型超时", {"error": "curl timeout"})
        except UpstreamError:
            raise
        except Exception as error:
            raise UpstreamError(502, str(error), {"error": str(error)})
    return call_upstream_model_multipart_urllib(endpoint, api_key, body)


def call_upstream_model_multipart_urllib(endpoint: str, api_key: str, body: dict):
    data, content_type = encode_openai_image_edit_multipart(body)
    request = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            "Content-Type": content_type,
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
    except UpstreamError:
        raise
    except Exception as error:
        raise UpstreamError(502, str(error), {"error": str(error)})


def call_upstream_model_multipart_curl(endpoint: str, api_key: str, body: dict):
    marker = "\n__AIDX_HTTP_STATUS__:"
    temp_paths: list[str] = []
    try:
        config_lines = [
            "silent",
            "show-error",
            f"max-time = {curl_config_quote(str(UPSTREAM_TIMEOUT_SECONDS))}",
            'request = "POST"',
            f"url = {curl_config_quote(endpoint)}",
            f"header = {curl_config_quote('Authorization: ' + authorization_header_value(api_key, endpoint))}",
        ]
        for key, value in body.items():
            if key == "image" or value is None:
                continue
            config_lines.append(f"form-string = {curl_config_quote(f'{key}={value}')}")
        image_values = body.get("image")
        if not isinstance(image_values, list):
            image_values = [image_values]
        for index, image_value in enumerate(image_values):
            image_file = image_data_url_file(image_value, index)
            with tempfile.NamedTemporaryFile(delete=False, suffix=f".{image_file['extension']}") as image_temp:
                image_temp.write(image_file["data"])
                temp_paths.append(image_temp.name)
            form_value = (
                f"image=@{temp_paths[-1]};"
                f"type={image_file['mimeType']};"
                f"filename={image_file['filename']}"
            )
            config_lines.append(f"form = {curl_config_quote(form_value)}")
        config_lines.append(f"write-out = {curl_config_quote(marker + '%{http_code}')}")
        completed = subprocess.run(
            ["curl", "--config", "-"],
            input="\n".join(config_lines).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=UPSTREAM_TIMEOUT_SECONDS + 10,
            check=False,
        )
    finally:
        for temp_path in temp_paths:
            try:
                os.unlink(temp_path)
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


def encode_openai_image_edit_multipart(body: dict) -> tuple[bytes, str]:
    boundary = f"----ImageStudio{secrets.token_urlsafe(12)}"
    chunks: list[bytes] = []
    image_values = body.get("image")
    if not isinstance(image_values, list):
        image_values = [image_values]
    for key, value in body.items():
        if key == "image" or value is None:
            continue
        chunks.extend(multipart_field(boundary, key, str(value)))
    for index, image_value in enumerate(image_values):
        chunks.extend(multipart_image_field(boundary, image_value, index))
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def multipart_field(boundary: str, name: str, value: str) -> list[bytes]:
    return [
        f"--{boundary}\r\n".encode("utf-8"),
        f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
        value.encode("utf-8"),
        b"\r\n",
    ]


def multipart_image_field(boundary: str, image_value, index: int) -> list[bytes]:
    image_file = image_data_url_file(image_value, index)
    return [
        f"--{boundary}\r\n".encode("utf-8"),
        f'Content-Disposition: form-data; name="image"; filename="{image_file["filename"]}"\r\n'.encode("utf-8"),
        f"Content-Type: {image_file['mimeType']}\r\n\r\n".encode("utf-8"),
        image_file["data"],
        b"\r\n",
    ]


def image_data_url_file(image_value, index: int) -> dict:
    inline_data = reference_to_inline_data({"url": image_value})
    if not inline_data:
        raise UpstreamError(400, "参考图必须是 data:image 格式", {"error": "invalid image reference"})
    mime_type = inline_data.get("mimeType") or "image/png"
    try:
        image_bytes = base64.b64decode(inline_data.get("data") or "", validate=True)
    except (ValueError, binascii.Error):
        raise UpstreamError(400, "参考图 base64 无效", {"error": "invalid image base64"})
    extension = image_extension_from_mime_type(mime_type)
    return {
        "data": image_bytes,
        "mimeType": mime_type,
        "extension": extension,
        "filename": f"reference{index + 1 if index else ''}.{extension}",
    }


def image_extension_from_mime_type(mime_type: str) -> str:
    normalized = str(mime_type or "").split(";", 1)[0].lower()
    return {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }.get(normalized, "png")


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


def extract_text_results_from_payload(payload) -> list[str]:
    texts: list[str] = []
    if isinstance(payload, dict):
        for candidate in payload.get("candidates") or []:
            content = candidate.get("content") if isinstance(candidate, dict) else {}
            for part in (content or {}).get("parts") or []:
                if isinstance(part, dict) and part.get("text"):
                    texts.append(str(part.get("text") or ""))
        for choice in payload.get("choices") or []:
            if not isinstance(choice, dict):
                continue
            content = choice.get("message", {}).get("content") if isinstance(choice.get("message"), dict) else ""
            text = content or choice.get("text") or ""
            if text:
                texts.append(str(text))
        if payload.get("text"):
            texts.append(str(payload.get("text")))
    elif isinstance(payload, str):
        texts.append(payload)
    return [text for text in texts if text.strip()]


def parse_json_object_from_model_text(text: str) -> dict:
    value = str(text or "").strip()
    candidates = [value]
    if "```" in value:
        parts = value.split("```")
        for part in parts:
            cleaned = part.strip()
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            candidates.append(cleaned)
    start = value.find("{")
    end = value.rfind("}")
    if start >= 0 and end > start:
        candidates.append(value[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise AppError(HTTPStatus.BAD_GATEWAY, "模型返回的 JSON 无法解析")


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
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (bytes, bytearray)):
        return f"[binary payload: {len(value)} bytes]"
    if not isinstance(value, str):
        return str(value)
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
