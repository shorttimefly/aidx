# Image Prompt Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a B-side image prompt factory that turns ecommerce reference images into saved prompt assets and publishes reviewed prompts into the existing C-side platform/category/scenario template matrix.

**Architecture:** Add a `prompt_assets` SQLite-backed admin library for generated prompt materials, then publish selected assets into `app_settings.prompt_config_json`. The backend owns persistence, generation workflow, and prompt-matrix mutation; the existing B-side prompt configuration page gains a new `图片提示词工厂` group for upload, review, retry, and publish actions. C-side behavior remains unchanged because published assets become normal single-image scenarios.

**Tech Stack:** Python `server.py` with SQLite and `unittest`; static `admin.html` / `admin.js` / `styles.css`; Node CJS static structure tests; existing Gemini/AOKAPI image provider request helpers.

---

## File Structure

- Modify `server.py`
  - Add `prompt_assets` schema in `init_db`.
  - Add prompt asset row helpers, CRUD helpers, publish helpers, compatible model lookup, text/image generation helpers, and admin route handlers.
  - Extend single prompt matrix normalization so appended custom scenarios survive normalization.
- Modify `admin.js`
  - Add factory state, prompt group, dynamic renderer, upload handlers, asset API calls, sequential generation queue, prompt editing, retry, and publish UI behavior.
- Modify `styles.css`
  - Add compact admin styles for factory upload zones, asset list, validation previews, and publish controls.
- Create `tests/test_prompt_assets.py`
  - Backend storage, publish, normalization, and generation-helper tests.
- Create `tests/admin-prompt-factory-ui.test.cjs`
  - Static B-side UI/JS structure test.
- Keep `docs/superpowers/specs/2026-06-20-image-prompt-factory-design.md`
  - Source spec; no implementation edits required.

The current directory is not a git repository. For every checkpoint step, run `git rev-parse --is-inside-work-tree`; if it succeeds, commit the listed files. If it fails with `fatal: not a git repository`, record the checkpoint in the task output and continue without git commands.

---

### Task 1: Prompt Asset Storage

**Files:**
- Modify: `server.py`
- Create: `tests/test_prompt_assets.py`

- [ ] **Step 1: Write failing storage tests**

Create `tests/test_prompt_assets.py` with this initial content:

```python
import json
from pathlib import Path
import tempfile
import unittest

import server


DATA_IMAGE = "data:image/png;base64,aW1hZ2U="


class PromptAssetStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temp_dir.cleanup)
        server.STORAGE_DIR = Path(self.temp_dir.name)
        server.DB_PATH = server.STORAGE_DIR / "image_studio.sqlite"
        server.init_db()

    def test_init_db_creates_prompt_assets_table(self):
        with server.connect() as conn:
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='prompt_assets'"
            ).fetchone()

        self.assertIsNotNone(row)

    def test_create_prompt_assets_creates_one_asset_per_reference(self):
        product = {"name": "product.png", "size": "1024x1024", "url": DATA_IMAGE}
        references = [
            {"name": "ref-1.png", "size": "1024x1024", "url": DATA_IMAGE},
            {"name": "ref-2.png", "size": "1200x900", "url": DATA_IMAGE + "2"},
        ]

        with server.connect() as conn:
            assets = server.create_prompt_assets(conn, product, references, provider_model_id="model_1")
            rows = server.prompt_asset_rows(conn, limit=10)

        self.assertEqual(len(assets), 2)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["status"], "draft")
        self.assertEqual(rows[0]["productImage"]["name"], "product.png")
        self.assertEqual(rows[0]["referenceImages"][0]["name"], "ref-1.png")
        self.assertEqual(rows[0]["providerModelId"], "model_1")

    def test_update_prompt_asset_persists_editable_fields(self):
        with server.connect() as conn:
            created = server.create_prompt_assets(
                conn,
                {},
                [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE}],
            )[0]
            updated = server.update_prompt_asset(
                conn,
                created["id"],
                {
                    "title": "Feature infographic",
                    "chinesePrompt": "中文提示词",
                    "englishPrompt": "English prompt",
                    "comparison": "Looks close",
                    "targetPlatformId": "amazon-aplus",
                    "targetCategoryId": "3c-digital-accessories",
                    "publishMode": "append",
                },
            )

        self.assertEqual(updated["title"], "Feature infographic")
        self.assertEqual(updated["chinesePrompt"], "中文提示词")
        self.assertEqual(updated["englishPrompt"], "English prompt")
        self.assertEqual(updated["comparison"], "Looks close")
        self.assertEqual(updated["targetPlatformId"], "amazon-aplus")
        self.assertEqual(updated["targetCategoryId"], "3c-digital-accessories")
        self.assertEqual(updated["publishMode"], "append")

    def test_prompt_asset_rows_filters_status(self):
        with server.connect() as conn:
            assets = server.create_prompt_assets(
                conn,
                {},
                [
                    {"name": "ref-a.png", "size": "1024x1024", "url": DATA_IMAGE},
                    {"name": "ref-b.png", "size": "1024x1024", "url": DATA_IMAGE + "b"},
                ],
            )
            server.update_prompt_asset(conn, assets[0]["id"], {"status": "generated"})
            generated = server.prompt_asset_rows(conn, status="generated", limit=10)

        self.assertEqual([row["id"] for row in generated], [assets[0]["id"]])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run storage tests to verify they fail**

Run:

```bash
python3 -m unittest tests.test_prompt_assets.PromptAssetStorageTests -v
```

Expected: FAIL with `AttributeError: module 'server' has no attribute 'create_prompt_assets'` or `sqlite3.OperationalError: no such table: prompt_assets`.

- [ ] **Step 3: Add prompt asset schema and helper functions**

In `server.py`, add constants near the other prompt constants:

```python
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
PROMPT_ASSET_TEXT_LIMIT = 20_000
PROMPT_ASSET_JSON_LIMIT = 180_000
```

In `init_db`, add this table and index after `image_feedback`:

```python
            CREATE TABLE IF NOT EXISTS prompt_assets (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'draft',
              provider_model_id TEXT NOT NULL DEFAULT '',
              reference_images_json TEXT NOT NULL DEFAULT '[]',
              product_image_json TEXT NOT NULL DEFAULT '{}',
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

            CREATE INDEX IF NOT EXISTS idx_prompt_assets_status_updated ON prompt_assets(status, updated_at);
```

Add helper functions near `prompt_config_settings`:

```python
def normalize_prompt_asset_status(value) -> str:
    status = str(value or PROMPT_ASSET_STATUS_DRAFT).strip().lower()
    return status if status in VALID_PROMPT_ASSET_STATUSES else PROMPT_ASSET_STATUS_DRAFT


def normalize_prompt_asset_publish_mode(value) -> str:
    mode = str(value or "append").strip().lower()
    return mode if mode in VALID_PROMPT_ASSET_PUBLISH_MODES else "append"


def normalize_prompt_asset_image(value) -> dict:
    if not isinstance(value, dict):
        return {}
    url = str(value.get("url") or "").strip()
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


def prompt_asset_json(value, fallback) -> str:
    return json.dumps(value if value is not None else fallback, ensure_ascii=False)


def row_prompt_asset(row: sqlite3.Row) -> dict:
    reference_images = parse_json_field(row["reference_images_json"])
    if not isinstance(reference_images, list):
        reference_images = []
    product_image = parse_json_field(row["product_image_json"])
    if not isinstance(product_image, dict):
        product_image = {}
    request_json = parse_json_field(row_value(row, "request_json", "{}"))
    response_json = parse_json_field(row_value(row, "response_json", "{}"))
    return {
        "id": row["id"],
        "title": row["title"],
        "status": normalize_prompt_asset_status(row["status"]),
        "providerModelId": row_value(row, "provider_model_id", ""),
        "referenceImages": reference_images,
        "productImage": product_image,
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


def prompt_asset_rows(conn: sqlite3.Connection, status: str = "", limit: int = 50, offset: int = 0) -> list[dict]:
    safe_limit = clamp_int(limit, 1, 200)
    safe_offset = max(0, int(offset or 0))
    normalized_status = normalize_prompt_asset_status(status) if status else ""
    if normalized_status:
        rows = conn.execute(
            "SELECT * FROM prompt_assets WHERE status=? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (normalized_status, safe_limit, safe_offset),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM prompt_assets ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            (safe_limit, safe_offset),
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
              (id, title, status, provider_model_id, reference_images_json, product_image_json,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                asset_id,
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


def update_prompt_asset(conn: sqlite3.Connection, asset_id: str, values: dict) -> dict:
    if not prompt_asset_by_id(conn, asset_id):
        raise AppError(HTTPStatus.NOT_FOUND, "提示词素材不存在")
    allowed = {
        "title": ("title", lambda value: trim_text(value, 200)),
        "status": ("status", normalize_prompt_asset_status),
        "providerModelId": ("provider_model_id", lambda value: trim_text(value, 120)),
        "referenceAnalysis": ("reference_analysis", lambda value: trim_text(value, PROMPT_ASSET_TEXT_LIMIT)),
        "chinesePrompt": ("chinese_prompt", lambda value: trim_text(value, PROMPT_ASSET_TEXT_LIMIT)),
        "englishPrompt": ("english_prompt", lambda value: trim_text(value, PROMPT_ASSET_TEXT_LIMIT)),
        "imageAUrl": ("image_a_url", lambda value: trim_text(value, PROMPT_ASSET_JSON_LIMIT)),
        "imageBUrl": ("image_b_url", lambda value: trim_text(value, PROMPT_ASSET_JSON_LIMIT)),
        "comparison": ("comparison", lambda value: trim_text(value, PROMPT_ASSET_TEXT_LIMIT)),
        "targetPlatformId": ("target_platform_id", lambda value: trim_text(value, 120)),
        "targetCategoryId": ("target_category_id", lambda value: trim_text(value, 120)),
        "targetScenarioId": ("target_scenario_id", lambda value: trim_text(value, 120)),
        "publishMode": ("publish_mode", normalize_prompt_asset_publish_mode),
        "publishedTemplateId": ("published_template_id", lambda value: trim_text(value, 160)),
        "error": ("error", lambda value: trim_text(value, 4000)),
        "request": ("request_json", lambda value: trim_text(json.dumps(sanitize_payload(value), ensure_ascii=False), PROMPT_ASSET_JSON_LIMIT)),
        "response": ("response_json", lambda value: trim_text(json.dumps(sanitize_payload(value), ensure_ascii=False), PROMPT_ASSET_JSON_LIMIT)),
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
```

- [ ] **Step 4: Run storage tests to verify they pass**

Run:

```bash
python3 -m unittest tests.test_prompt_assets.PromptAssetStorageTests -v
```

Expected: PASS, four tests run successfully.

- [ ] **Step 5: Checkpoint**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If this prints `true`, run:

```bash
git add server.py tests/test_prompt_assets.py
git commit -m "feat: add prompt asset storage"
```

If it prints `fatal: not a git repository`, record `Checkpoint: prompt asset storage complete; git unavailable`.

---

### Task 2: Publish Into Single Prompt Matrix

**Files:**
- Modify: `server.py`
- Modify: `tests/test_prompt_assets.py`

- [ ] **Step 1: Add failing publish and normalization tests**

Append these tests to `PromptAssetStorageTests` in `tests/test_prompt_assets.py`:

```python
    def test_normalize_prompt_config_preserves_custom_scenario_in_existing_category(self):
        config = server.default_prompt_config()
        category = config["single"]["matrix"]["platforms"][0]["categories"][0]
        category["scenarios"].append(
            {
                "id": "factory-custom-style",
                "title": "Factory custom style",
                "prompt": "生成同款电商图",
                "templateId": "amazon-aplus-3c-digital-accessories-factory-custom-style",
            }
        )

        normalized = server.normalize_prompt_config(config)
        scenarios = normalized["single"]["matrix"]["platforms"][0]["categories"][0]["scenarios"]
        templates = normalized["single"]["templates"]

        self.assertTrue(any(item["id"] == "factory-custom-style" for item in scenarios))
        self.assertTrue(
            any(item["id"] == "amazon-aplus-3c-digital-accessories-factory-custom-style" for item in templates)
        )

    def test_publish_prompt_asset_append_adds_scenario_to_prompt_config(self):
        with server.connect() as conn:
            asset = server.create_prompt_assets(
                conn,
                {},
                [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE}],
            )[0]
            server.update_prompt_asset(
                conn,
                asset["id"],
                {"title": "Factory infographic", "chinesePrompt": "发布到C端的中文提示词"},
            )
            published = server.publish_prompt_asset(
                conn,
                asset["id"],
                {
                    "platformId": "amazon-aplus",
                    "categoryId": "3c-digital-accessories",
                    "mode": "append",
                    "title": "Factory infographic",
                },
            )
            config = server.prompt_config_settings(conn)

        self.assertEqual(published["status"], "published")
        self.assertTrue(published["publishedTemplateId"].startswith("amazon-aplus-3c-digital-accessories-"))
        prompts = [template["prompt"] for template in config["single"]["templates"]]
        self.assertIn("发布到C端的中文提示词", prompts)

    def test_publish_prompt_asset_overwrite_replaces_existing_scenario_prompt(self):
        with server.connect() as conn:
            asset = server.create_prompt_assets(
                conn,
                {},
                [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE}],
            )[0]
            server.update_prompt_asset(
                conn,
                asset["id"],
                {"title": "Updated brand story", "chinesePrompt": "覆盖后的提示词"},
            )
            published = server.publish_prompt_asset(
                conn,
                asset["id"],
                {
                    "platformId": "amazon-aplus",
                    "categoryId": "3c-digital-accessories",
                    "scenarioId": "brand-story",
                    "mode": "overwrite",
                    "title": "Updated brand story",
                },
            )
            config = server.prompt_config_settings(conn)

        self.assertEqual(published["publishedTemplateId"], "amazon-aplus-3c-digital-accessories-brand-story")
        first = config["single"]["matrix"]["platforms"][0]["categories"][0]["scenarios"][0]
        self.assertEqual(first["title"], "Updated brand story")
        self.assertEqual(first["prompt"], "覆盖后的提示词")

    def test_publish_prompt_asset_rejects_invalid_target_without_mutation(self):
        with server.connect() as conn:
            before = json.dumps(server.prompt_config_settings(conn), ensure_ascii=False)
            asset = server.create_prompt_assets(
                conn,
                {},
                [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE}],
            )[0]
            server.update_prompt_asset(conn, asset["id"], {"chinesePrompt": "有效提示词"})

            with self.assertRaises(server.AppError) as caught:
                server.publish_prompt_asset(
                    conn,
                    asset["id"],
                    {"platformId": "missing", "categoryId": "3c-digital-accessories", "mode": "append"},
                )
            after = json.dumps(server.prompt_config_settings(conn), ensure_ascii=False)

        self.assertEqual(caught.exception.status, 400)
        self.assertEqual(before, after)
```

- [ ] **Step 2: Run publish tests to verify they fail**

Run:

```bash
python3 -m unittest tests.test_prompt_assets.PromptAssetStorageTests -v
```

Expected: FAIL with `AttributeError: module 'server' has no attribute 'publish_prompt_asset'` and the custom-scenario preservation test failing because normalization drops appended scenarios.

- [ ] **Step 3: Preserve custom scenarios during normalization**

In `server.py`, add these helpers near `normalize_single_prompt_config`:

```python
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
```

Then call it in `normalize_single_prompt_config` immediately after `apply_legacy_single_template_overrides(...)`:

```python
    merge_single_matrix_custom_scenarios(single, source_single if isinstance(source_single, dict) else None)
```

- [ ] **Step 4: Add publish helpers**

Add these helpers near the prompt config functions in `server.py`:

```python
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
    chinese_prompt = trim_text(asset.get("chinesePrompt") or "", PROMPT_TEXT_LIMIT).strip()
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
            now_iso(),
            now_iso(),
            asset_id,
        ),
    )
    published = prompt_asset_by_id(conn, asset_id)
    if not published:
        raise AppError(HTTPStatus.NOT_FOUND, "提示词素材不存在")
    return published
```

Update `handle_admin_put_prompt_config` to use `persist_prompt_config`:

```python
    def handle_admin_put_prompt_config(self) -> None:
        self.require_admin()
        body = self.read_json()
        prompt_config = normalize_prompt_config(body.get("promptConfig"))
        with connect() as conn:
            prompt_config = persist_prompt_config(conn, prompt_config)
        self.json_response({"ok": True, "promptConfig": prompt_config})
```

- [ ] **Step 5: Run publish tests to verify they pass**

Run:

```bash
python3 -m unittest tests.test_prompt_assets.PromptAssetStorageTests -v
```

Expected: PASS, all storage and publish tests run successfully.

- [ ] **Step 6: Checkpoint**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If this prints `true`, run:

```bash
git add server.py tests/test_prompt_assets.py
git commit -m "feat: publish prompt assets to template matrix"
```

If it prints `fatal: not a git repository`, record `Checkpoint: prompt asset publishing complete; git unavailable`.

---

### Task 3: Prompt Factory Model Workflow Helpers

**Files:**
- Modify: `server.py`
- Modify: `tests/test_prompt_assets.py`

- [ ] **Step 1: Add failing generation helper tests**

Append these tests to `PromptAssetStorageTests`:

```python
    def seed_gemini_provider(self, conn):
        provider_id = "provider_1"
        model_id = "model_1"
        now = server.now_iso()
        conn.execute(
            """
            INSERT INTO model_providers (id, name, provider_type, base_url, api_key, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                provider_id,
                "AOKAPI Gemini",
                server.PROVIDER_TYPE_AOKAPI_GEMINI,
                server.DEFAULT_ENDPOINT,
                "test-token",
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO provider_models (id, provider_id, model_name, model_kind, priority, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, 10, 1, ?, ?)
            """,
            (model_id, provider_id, "gemini-2.5-flash-image", server.MODEL_KIND_IMAGE, now, now),
        )
        return model_id

    def test_prompt_factory_model_options_only_returns_gemini_image_models(self):
        with server.connect() as conn:
            model_id = self.seed_gemini_provider(conn)
            options = server.prompt_factory_model_options(conn)

        self.assertEqual([option["providerModelId"] for option in options], [model_id])
        self.assertEqual(options[0]["providerType"], server.PROVIDER_TYPE_AOKAPI_GEMINI)

    def test_parse_json_object_from_model_text_extracts_fenced_json(self):
        payload = server.parse_json_object_from_model_text(
            'Here is the result:\n```json\n{"analysis":"布局", "score": 8}\n```'
        )

        self.assertEqual(payload["analysis"], "布局")
        self.assertEqual(payload["score"], 8)

    def test_generate_prompt_asset_with_mocked_upstream_saves_prompts_images_and_comparison(self):
        calls = []
        original_call = server.call_upstream_model_with_retry
        try:
            def fake_call(endpoint, api_key, body):
                calls.append(body)
                index = len(calls)
                if index == 1:
                    return {"candidates": [{"content": {"parts": [{"text": '{"summary":"reference layout","imageType":"feature infographic"}'}]}}]}
                if index == 2:
                    return {"candidates": [{"content": {"parts": [{"text": '{"chinesePrompt":"中文同款提示词","englishPrompt":"English prompt"}'}]}}]}
                if index == 3:
                    return {"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": "QUFB"}}]}}]}
                if index == 4:
                    return {"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": "QkJC"}}]}}]}
                return {"candidates": [{"content": {"parts": [{"text": '{"comparison":"Image B matches the structure"}'}]}}]}

            server.call_upstream_model_with_retry = fake_call
            with server.connect() as conn:
                model_id = self.seed_gemini_provider(conn)
                asset = server.create_prompt_assets(
                    conn,
                    {"name": "product.png", "size": "1024x1024", "url": DATA_IMAGE},
                    [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE + "r"}],
                    provider_model_id=model_id,
                )[0]
                generated = server.generate_prompt_asset(conn, asset["id"])
        finally:
            server.call_upstream_model_with_retry = original_call

        self.assertEqual(generated["status"], "generated")
        self.assertEqual(generated["referenceAnalysis"], "reference layout")
        self.assertEqual(generated["chinesePrompt"], "中文同款提示词")
        self.assertEqual(generated["englishPrompt"], "English prompt")
        self.assertTrue(generated["imageAUrl"].startswith("data:image/png;base64,"))
        self.assertTrue(generated["imageBUrl"].startswith("data:image/png;base64,"))
        self.assertEqual(generated["comparison"], "Image B matches the structure")
        self.assertEqual(len(calls), 5)

    def test_generate_prompt_asset_requires_compatible_gemini_provider(self):
        with server.connect() as conn:
            asset = server.create_prompt_assets(
                conn,
                {},
                [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE}],
            )[0]
            with self.assertRaises(server.AppError) as caught:
                server.generate_prompt_asset(conn, asset["id"])

        self.assertEqual(caught.exception.status, 400)
        self.assertIn("AOKAPI / Gemini", caught.exception.message)
```

- [ ] **Step 2: Run generation helper tests to verify they fail**

Run:

```bash
python3 -m unittest tests.test_prompt_assets.PromptAssetStorageTests -v
```

Expected: FAIL with `AttributeError: module 'server' has no attribute 'prompt_factory_model_options'`.

- [ ] **Step 3: Add text extraction and JSON parsing helpers**

Add these helpers near `extract_image_results_from_payload` in `server.py`:

```python
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
```

- [ ] **Step 4: Add compatible model and workflow helpers**

Add these helpers near provider model option helpers in `server.py`:

```python
def prompt_factory_model_options(conn: sqlite3.Connection) -> list[dict]:
    return [
        option
        for option in configured_model_options(conn, MODEL_KIND_IMAGE)
        if normalize_provider_type(option.get("providerType")) == PROVIDER_TYPE_AOKAPI_GEMINI
    ]


def selected_prompt_factory_model(conn: sqlite3.Connection, provider_model_id: str = "") -> dict:
    options = prompt_factory_model_options(conn)
    if provider_model_id:
        selected = next((option for option in options if option["providerModelId"] == provider_model_id), None)
        if selected:
            return selected
        raise AppError(HTTPStatus.BAD_REQUEST, "选择的提示词生成模型不可用")
    if not options:
        raise AppError(HTTPStatus.BAD_REQUEST, "请先配置可用的 AOKAPI / Gemini 图片模型")
    return options[0]
```

Add these prompt builders near prompt text helpers:

```python
def prompt_factory_analysis_instruction() -> str:
    return """
Analyze the ecommerce reference image and optional product image. Return strict JSON only with keys:
summary, imageType, canvasRatio, productPlacement, backgroundLighting, textHierarchy,
englishCopySuggestions, riskPoints. Focus on layout, labels, icons, callouts, typography,
scene style, and seller realism. Translate any visible Chinese copy into concise English.
""".strip()


def prompt_factory_prompt_instruction(analysis: dict) -> str:
    return f"""
Create reusable prompt-only ecommerce image prompts from this reference analysis. Return strict JSON only:
{{"chinesePrompt":"...", "englishPrompt":"..."}}

Rules:
- The prompts must work with only one uploaded original product image and text prompt.
- Do not mention a separate reference image.
- Preserve exact product identity: shape, color, proportions, material, screen, buttons, ports, openings, logo, accessories, and visible construction.
- Use concise English text inside generated images.
- Avoid fake certifications, platform logos, rankings, discount badges, unsupported percentages, and unverifiable medical or technical claims.

Reference analysis JSON:
{json.dumps(analysis, ensure_ascii=False)}
""".strip()


def prompt_factory_reference_assisted_prompt(asset: dict) -> str:
    return "\n".join(
        part
        for part in [
            "Use the uploaded original product image as the product identity to preserve.",
            "Use the uploaded ecommerce reference image as layout, composition, text hierarchy, lighting, and seller-style guidance.",
            asset.get("chinesePrompt") or asset.get("englishPrompt") or "Create a realistic ecommerce product image matching the reference style.",
        ]
        if part
    )


def prompt_factory_comparison_instruction() -> str:
    return """
Compare the reference ecommerce image, Image A, and Image B. Return strict JSON only with key comparison.
Mention what matched, what drifted, product fidelity risks, text or claim risks, and one concrete next adjustment.
Keep the comparison concise for a B-side admin reviewer.
""".strip()
```

Add workflow helpers near image request helpers:

```python
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


def call_prompt_factory_text(option: dict, prompt: str, references: list[dict]) -> dict:
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
    return images[0]["url"]


def prompt_asset_reference_images(asset: dict) -> list[dict]:
    return normalize_prompt_asset_images(asset.get("referenceImages") or [], limit=20)


def prompt_asset_product_image(asset: dict) -> dict:
    return normalize_prompt_asset_image(asset.get("productImage") or {})


def generate_prompt_asset(conn: sqlite3.Connection, asset_id: str, provider_model_id: str = "") -> dict:
    asset = prompt_asset_by_id(conn, asset_id)
    if not asset:
        raise AppError(HTTPStatus.NOT_FOUND, "提示词素材不存在")
    selected_model_id = provider_model_id or asset.get("providerModelId") or ""
    option = selected_prompt_factory_model(conn, selected_model_id)
    update_prompt_asset(
        conn,
        asset_id,
        {"status": PROMPT_ASSET_STATUS_GENERATING, "providerModelId": option["providerModelId"], "error": ""},
    )
    asset = prompt_asset_by_id(conn, asset_id) or asset
    references = prompt_asset_reference_images(asset)
    product = prompt_asset_product_image(asset)
    text_references = [image for image in [product, *references] if image.get("url")]
    try:
        analysis_payload = call_prompt_factory_text(option, prompt_factory_analysis_instruction(), text_references)
        prompt_payload = call_prompt_factory_text(option, prompt_factory_prompt_instruction(analysis_payload), [product] if product else [])
        chinese_prompt = trim_text(str(prompt_payload.get("chinesePrompt") or ""), PROMPT_ASSET_TEXT_LIMIT)
        english_prompt = trim_text(str(prompt_payload.get("englishPrompt") or ""), PROMPT_ASSET_TEXT_LIMIT)
        if not chinese_prompt or not english_prompt:
            raise AppError(HTTPStatus.BAD_GATEWAY, "模型未返回完整的中英文提示词")
        partial = update_prompt_asset(
            conn,
            asset_id,
            {
                "referenceAnalysis": trim_text(str(analysis_payload.get("summary") or json.dumps(analysis_payload, ensure_ascii=False)), PROMPT_ASSET_TEXT_LIMIT),
                "chinesePrompt": chinese_prompt,
                "englishPrompt": english_prompt,
                "request": {"providerModelId": option["providerModelId"], "referenceCount": len(references), "hasProductImage": bool(product)},
            },
        )
        image_a_url = ""
        image_b_url = ""
        comparison = "未上传商品原图，未验证产品迁移。"
        if product:
            image_a_url = generate_prompt_asset_image(option, prompt_factory_reference_assisted_prompt(partial), [product, *references])
            image_b_url = generate_prompt_asset_image(option, chinese_prompt, [product])
            comparison_payload = call_prompt_factory_text(
                option,
                prompt_factory_comparison_instruction(),
                [image for image in [references[0] if references else {}, {"name": "Image A", "url": image_a_url}, {"name": "Image B", "url": image_b_url}] if image.get("url")],
            )
            comparison = trim_text(str(comparison_payload.get("comparison") or json.dumps(comparison_payload, ensure_ascii=False)), PROMPT_ASSET_TEXT_LIMIT)
        return update_prompt_asset(
            conn,
            asset_id,
            {
                "status": PROMPT_ASSET_STATUS_GENERATED,
                "imageAUrl": image_a_url,
                "imageBUrl": image_b_url,
                "comparison": comparison,
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
```

- [ ] **Step 5: Run generation helper tests to verify they pass**

Run:

```bash
python3 -m unittest tests.test_prompt_assets.PromptAssetStorageTests -v
```

Expected: PASS, including the mocked five-call generation workflow.

- [ ] **Step 6: Checkpoint**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If this prints `true`, run:

```bash
git add server.py tests/test_prompt_assets.py
git commit -m "feat: generate prompt assets with gemini providers"
```

If it prints `fatal: not a git repository`, record `Checkpoint: prompt asset generation complete; git unavailable`.

---

### Task 4: Admin Prompt Asset APIs

**Files:**
- Modify: `server.py`
- Create: `tests/admin-prompt-assets-api.test.cjs`

- [ ] **Step 1: Add failing static API route test**

Create `tests/admin-prompt-assets-api.test.cjs`:

```javascript
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.join(__dirname, "..", "server.py"), "utf8");

for (const route of [
  'path == "/api/admin/prompt-assets" and method == "GET"',
  'path == "/api/admin/prompt-assets" and method == "POST"',
  'path.startswith("/api/admin/prompt-assets/") and method == "PATCH"',
  'path.endswith("/generate")',
  'path.endswith("/publish")'
]) {
  assert.ok(server.includes(route), `${route} should be routed`);
}

for (const handler of [
  "def handle_admin_prompt_assets",
  "def handle_admin_create_prompt_assets",
  "def handle_admin_update_prompt_asset",
  "def handle_admin_generate_prompt_asset",
  "def handle_admin_publish_prompt_asset"
]) {
  assert.ok(server.includes(handler), `${handler} should exist`);
}

console.log("admin prompt asset API route tests passed");
```

- [ ] **Step 2: Run route test to verify it fails**

Run:

```bash
node tests/admin-prompt-assets-api.test.cjs
```

Expected: FAIL with an assertion that `/api/admin/prompt-assets` route strings are missing.

- [ ] **Step 3: Add route entries**

In `Handler.route`, add these branches after `/api/admin/prompt-config` routes and before `/prompt-config-defaults.json`:

```python
            if path == "/api/admin/prompt-assets" and method == "GET":
                return self.handle_admin_prompt_assets(parsed.query)
            if path == "/api/admin/prompt-assets" and method == "POST":
                return self.handle_admin_create_prompt_assets()
            if path.startswith("/api/admin/prompt-assets/") and method == "PATCH":
                asset_id = unquote(path.removeprefix("/api/admin/prompt-assets/"))
                return self.handle_admin_update_prompt_asset(asset_id)
            if path.startswith("/api/admin/prompt-assets/") and method == "POST":
                prompt_asset_path = path.removeprefix("/api/admin/prompt-assets/")
                if prompt_asset_path.endswith("/generate"):
                    asset_id = unquote(prompt_asset_path.removesuffix("/generate").rstrip("/"))
                    return self.handle_admin_generate_prompt_asset(asset_id)
                if prompt_asset_path.endswith("/publish"):
                    asset_id = unquote(prompt_asset_path.removesuffix("/publish").rstrip("/"))
                    return self.handle_admin_publish_prompt_asset(asset_id)
```

- [ ] **Step 4: Add handler methods**

Add these methods inside `Handler`, directly after `handle_admin_put_prompt_config`:

```python
    def handle_admin_prompt_assets(self, query: str) -> None:
        self.require_admin()
        params = parse_qs(query)
        status = params.get("status", [""])[0]
        limit = clamp_int(params.get("limit", ["50"])[0], 1, 200)
        offset = max(0, int(params.get("offset", ["0"])[0] or 0))
        with connect() as conn:
            assets = prompt_asset_rows(conn, status=status, limit=limit, offset=offset)
            model_options = [
                {
                    "providerModelId": option["providerModelId"],
                    "providerName": option["providerName"],
                    "modelName": option["modelName"],
                    "providerType": option["providerType"],
                }
                for option in prompt_factory_model_options(conn)
            ]
        self.json_response({"assets": assets, "modelOptions": model_options})

    def handle_admin_create_prompt_assets(self) -> None:
        self.require_admin()
        body = self.read_json()
        with connect() as conn:
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
            asset = publish_prompt_asset(conn, asset_id, body)
            prompt_config = prompt_config_settings(conn)
        self.json_response({"asset": asset, "promptConfig": prompt_config})
```

- [ ] **Step 5: Run API route test and backend unit tests**

Run:

```bash
node tests/admin-prompt-assets-api.test.cjs
python3 -m unittest tests.test_prompt_assets.PromptAssetStorageTests -v
```

Expected: both commands PASS.

- [ ] **Step 6: Checkpoint**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If this prints `true`, run:

```bash
git add server.py tests/admin-prompt-assets-api.test.cjs tests/test_prompt_assets.py
git commit -m "feat: expose admin prompt asset APIs"
```

If it prints `fatal: not a git repository`, record `Checkpoint: admin prompt asset APIs complete; git unavailable`.

---

### Task 5: B-Side Factory UI Structure

**Files:**
- Modify: `admin.js`
- Modify: `styles.css`
- Create: `tests/admin-prompt-factory-ui.test.cjs`

- [ ] **Step 1: Add failing UI structure test**

Create `tests/admin-prompt-factory-ui.test.cjs`:

```javascript
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const admin = fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

assert.ok(admin.includes('{ id: "factory", label: "图片提示词工厂" }'));
assert.ok(admin.includes("promptAssets: []"));
assert.ok(admin.includes("factoryProductImage"));
assert.ok(admin.includes("factoryReferenceImages"));
assert.ok(admin.includes("function renderPromptFactoryConfig"));
assert.ok(admin.includes('id="factoryProductImageInput"'));
assert.ok(admin.includes('id="factoryReferenceImagesInput"'));
assert.ok(admin.includes('id="generateFactoryAssetsBtn"'));
assert.ok(admin.includes('id="promptFactoryAssetList"'));
assert.ok(admin.includes('id="promptFactoryAssetDetail"'));
assert.ok(admin.includes('data-factory-action="publish"'));
assert.ok(admin.includes('data-factory-action="retry"'));
assert.ok(admin.includes('data-factory-action="save"'));
assert.ok(admin.includes("loadPromptAssets"));
assert.ok(admin.includes("createPromptAssets"));
assert.ok(admin.includes("generatePromptAsset"));
assert.ok(admin.includes("publishPromptAsset"));

for (const selector of [
  ".prompt-factory-shell",
  ".prompt-factory-create",
  ".prompt-factory-library",
  ".prompt-factory-asset-list",
  ".prompt-factory-preview-grid",
  ".prompt-factory-publish-row"
]) {
  assert.ok(styles.includes(selector), `${selector} should be styled`);
}

console.log("admin prompt factory UI tests passed");
```

- [ ] **Step 2: Run UI structure test to verify it fails**

Run:

```bash
node tests/admin-prompt-factory-ui.test.cjs
```

Expected: FAIL with missing `图片提示词工厂` prompt group.

- [ ] **Step 3: Add factory state and prompt group**

In `admin.js`, update `PROMPT_GROUPS`:

```js
const PROMPT_GROUPS = [
  { id: "single", label: "单图模板" },
  { id: "suite", label: "套图生成" },
  { id: "refinement", label: "二次编辑" },
  { id: "reference", label: "参考图规则" },
  { id: "probe", label: "入参探测" },
  { id: "factory", label: "图片提示词工厂" }
];
```

Add state fields to `state`:

```js
  promptAssets: [],
  factoryModelOptions: [],
  factoryProductImage: null,
  factoryReferenceImages: [],
  activePromptAssetId: "",
  factoryStatusFilter: "",
```

Update `loadDashboard` so prompt assets load after prompt config exists:

```js
async function loadDashboard() {
  await Promise.all([loadSummary(), loadUsers(), loadLogs(), loadFeedbacks(), loadPromptConfig()]);
  await loadPromptAssets();
}
```

- [ ] **Step 4: Add asset API functions**

Add these functions after `loadPromptConfig`:

```js
async function loadPromptAssets() {
  const params = new URLSearchParams({ limit: "100" });
  if (state.factoryStatusFilter) params.set("status", state.factoryStatusFilter);
  const payload = await adminFetch(`/prompt-assets?${params.toString()}`);
  state.promptAssets = payload.assets || [];
  state.factoryModelOptions = payload.modelOptions || [];
  if (!state.activePromptAssetId && state.promptAssets[0]) state.activePromptAssetId = state.promptAssets[0].id;
  renderPromptConfigEditor();
}

async function createPromptAssets() {
  if (!state.factoryReferenceImages.length) {
    showToast("请先上传参考图", true);
    return;
  }
  const modelSelect = document.getElementById("factoryModelSelect");
  const payload = await adminFetch("/prompt-assets", {
    method: "POST",
    body: JSON.stringify({
      productImage: state.factoryProductImage || {},
      referenceImages: state.factoryReferenceImages,
      providerModelId: modelSelect?.value || ""
    })
  });
  state.promptAssets = [...(payload.assets || []), ...state.promptAssets];
  state.activePromptAssetId = payload.assets?.[0]?.id || state.activePromptAssetId;
  renderPromptConfigEditor();
  showToast(`已创建 ${(payload.assets || []).length} 条提示词素材`);
}

async function savePromptAsset(assetId) {
  const detail = document.getElementById("promptFactoryAssetDetail");
  if (!detail) return;
  const body = {
    title: detail.querySelector("[data-factory-field='title']")?.value || "",
    chinesePrompt: detail.querySelector("[data-factory-field='chinesePrompt']")?.value || "",
    englishPrompt: detail.querySelector("[data-factory-field='englishPrompt']")?.value || "",
    comparison: detail.querySelector("[data-factory-field='comparison']")?.value || "",
    targetPlatformId: detail.querySelector("[data-factory-field='targetPlatformId']")?.value || "",
    targetCategoryId: detail.querySelector("[data-factory-field='targetCategoryId']")?.value || "",
    targetScenarioId: detail.querySelector("[data-factory-field='targetScenarioId']")?.value || "",
    publishMode: detail.querySelector("[data-factory-field='publishMode']")?.value || "append"
  };
  const payload = await adminFetch(`/prompt-assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  replacePromptAsset(payload.asset);
  renderPromptConfigEditor();
  showToast("提示词素材已保存");
}

async function generatePromptAsset(assetId, button = null) {
  const modelSelect = document.getElementById("factoryModelSelect");
  setBusy(button, "生成中", true);
  try {
    const payload = await adminFetch(`/prompt-assets/${encodeURIComponent(assetId)}/generate`, {
      method: "POST",
      body: JSON.stringify({ providerModelId: modelSelect?.value || "" })
    });
    replacePromptAsset(payload.asset);
    renderPromptConfigEditor();
    showToast("提示词与验证图已生成");
  } catch (error) {
    await loadPromptAssets();
    showToast(error.message, true);
  } finally {
    setBusy(button, "重试当前素材", false);
  }
}

async function publishPromptAsset(assetId, button = null) {
  const detail = document.getElementById("promptFactoryAssetDetail");
  if (!detail) return;
  const mode = detail.querySelector("[data-factory-field='publishMode']")?.value || "append";
  if (mode === "overwrite" && !window.confirm("覆盖已有 C 端场景？这个操作会替换原场景标题和提示词。")) return;
  setBusy(button, "发布中", true);
  try {
    await savePromptAsset(assetId);
    const body = {
      platformId: detail.querySelector("[data-factory-field='targetPlatformId']")?.value || "",
      categoryId: detail.querySelector("[data-factory-field='targetCategoryId']")?.value || "",
      scenarioId: detail.querySelector("[data-factory-field='targetScenarioId']")?.value || "",
      mode,
      title: detail.querySelector("[data-factory-field='title']")?.value || ""
    };
    const payload = await adminFetch(`/prompt-assets/${encodeURIComponent(assetId)}/publish`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    replacePromptAsset(payload.asset);
    if (payload.promptConfig) state.promptConfig = payload.promptConfig;
    renderPromptConfigEditor();
    showToast("已发布到 C 端模板");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, "发布到 C 端", false);
  }
}

function replacePromptAsset(asset) {
  if (!asset?.id) return;
  const index = state.promptAssets.findIndex((entry) => entry.id === asset.id);
  if (index >= 0) state.promptAssets.splice(index, 1, asset);
  else state.promptAssets.unshift(asset);
}
```

- [ ] **Step 5: Add renderer shell**

Update `renderPromptConfigEditor` renderers:

```js
  const renderers = {
    single: renderSinglePromptConfig,
    suite: renderSuitePromptConfig,
    refinement: renderRefinementPromptConfig,
    reference: renderReferencePromptConfig,
    probe: renderProbePromptConfig,
    factory: renderPromptFactoryConfig
  };
```

Add the renderer after `renderProbePromptConfig`:

```js
function renderPromptFactoryConfig(config) {
  const activeAsset = state.promptAssets.find((asset) => asset.id === state.activePromptAssetId) || state.promptAssets[0] || null;
  const counts = promptAssetCounts();
  return `
    <section class="prompt-factory-shell">
      <div class="prompt-factory-create">
        <h4>生成提示词素材</h4>
        <label class="field admin-prompt-field">
          <span>商品原图（可选）</span>
          <input id="factoryProductImageInput" type="file" accept="image/*" />
        </label>
        <div class="prompt-factory-upload-preview">${renderFactoryImagePreview(state.factoryProductImage, "未上传商品原图")}</div>
        <label class="field admin-prompt-field">
          <span>参考图（可多选）</span>
          <input id="factoryReferenceImagesInput" type="file" accept="image/*" multiple />
        </label>
        <div class="prompt-factory-reference-list">${renderFactoryReferenceImages()}</div>
        <label class="field admin-prompt-field">
          <span>生成模型</span>
          <select id="factoryModelSelect">
            ${state.factoryModelOptions.length ? state.factoryModelOptions.map((option) => `<option value="${escapeAttr(option.providerModelId)}">${escapeHtml(option.providerName)} / ${escapeHtml(option.modelName)}</option>`).join("") : `<option value="">请配置 AOKAPI / Gemini 图片模型</option>`}
          </select>
        </label>
        <button class="primary-button" id="generateFactoryAssetsBtn" type="button" ${state.factoryModelOptions.length ? "" : "disabled"}>生成提示词与验证图</button>
      </div>
      <div class="prompt-factory-library">
        <div class="prompt-factory-toolbar">
          ${renderFactoryStatusButton("", "全部", counts.all)}
          ${renderFactoryStatusButton("draft", "草稿", counts.draft)}
          ${renderFactoryStatusButton("generated", "待发布", counts.generated)}
          ${renderFactoryStatusButton("failed", "失败", counts.failed)}
          ${renderFactoryStatusButton("published", "已发布", counts.published)}
        </div>
        <div class="prompt-factory-workspace">
          <div class="prompt-factory-asset-list" id="promptFactoryAssetList">${renderPromptFactoryAssetList()}</div>
          <div class="prompt-factory-asset-detail" id="promptFactoryAssetDetail">${activeAsset ? renderPromptFactoryAssetDetail(activeAsset, config) : renderPromptFactoryEmptyDetail()}</div>
        </div>
      </div>
    </section>
  `;
}
```

- [ ] **Step 6: Add renderer helper functions**

Add these helper functions after `renderPromptFactoryConfig`:

```js
function promptAssetCounts() {
  return state.promptAssets.reduce(
    (counts, asset) => {
      counts.all += 1;
      counts[asset.status] = (counts[asset.status] || 0) + 1;
      return counts;
    },
    { all: 0, draft: 0, generated: 0, failed: 0, published: 0 }
  );
}

function renderFactoryStatusButton(status, label, count) {
  const active = (state.factoryStatusFilter || "") === status;
  return `<button class="small-button ${active ? "primary" : ""}" type="button" data-factory-status="${escapeAttr(status)}">${escapeHtml(label)} ${Number(count || 0)}</button>`;
}

function renderFactoryImagePreview(image, emptyText) {
  if (!image?.url) return `<div class="empty-state compact-empty">${escapeHtml(emptyText)}</div>`;
  return `<figure class="prompt-factory-thumb"><img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.name || "图片")}" /><figcaption>${escapeHtml(image.name || "图片")}</figcaption></figure>`;
}

function renderFactoryReferenceImages() {
  if (!state.factoryReferenceImages.length) return `<div class="empty-state compact-empty">未上传参考图</div>`;
  return state.factoryReferenceImages.map((image) => renderFactoryImagePreview(image, "")).join("");
}

function renderPromptFactoryAssetList() {
  if (!state.promptAssets.length) return `<div class="empty-state compact-empty">暂无提示词素材</div>`;
  return state.promptAssets
    .map(
      (asset) => `
        <button class="prompt-factory-asset-row ${asset.id === state.activePromptAssetId ? "active" : ""}" type="button" data-factory-asset-id="${escapeAttr(asset.id)}">
          <strong>${escapeHtml(asset.title || "未命名素材")}</strong>
          <span class="status-chip ${promptAssetStatusClass(asset.status)}">${escapeHtml(promptAssetStatusLabel(asset.status))}</span>
          <small>${escapeHtml(asset.comparison || asset.error || asset.chinesePrompt || "等待生成")}</small>
        </button>
      `
    )
    .join("");
}

function renderPromptFactoryEmptyDetail() {
  return `<div class="empty-state"><strong>选择或创建提示词素材</strong><span>上传参考图后会在这里审核提示词、验证图和发布目标。</span></div>`;
}

function renderPromptFactoryAssetDetail(asset, config) {
  const platforms = config.single?.matrix?.platforms || [];
  const selectedPlatform = platforms.find((platform) => platform.id === asset.targetPlatformId) || platforms[0] || { categories: [] };
  const selectedCategory = (selectedPlatform.categories || []).find((category) => category.id === asset.targetCategoryId) || selectedPlatform.categories?.[0] || { scenarios: [] };
  const publishMode = asset.publishMode || "append";
  return `
    <div class="prompt-factory-detail-head">
      <label class="field admin-prompt-field">
        <span>素材标题</span>
        <input type="text" data-factory-field="title" value="${escapeAttr(asset.title || "")}" />
      </label>
      <span class="status-chip ${promptAssetStatusClass(asset.status)}">${escapeHtml(promptAssetStatusLabel(asset.status))}</span>
    </div>
    <section class="prompt-factory-section">
      <h4>参考分析</h4>
      <textarea rows="4" data-factory-field="referenceAnalysis">${escapeHtml(asset.referenceAnalysis || "")}</textarea>
    </section>
    <section class="prompt-factory-section">
      <h4>中文 Prompt</h4>
      <textarea rows="7" data-factory-field="chinesePrompt">${escapeHtml(asset.chinesePrompt || "")}</textarea>
    </section>
    <section class="prompt-factory-section">
      <h4>English Prompt</h4>
      <textarea rows="7" data-factory-field="englishPrompt">${escapeHtml(asset.englishPrompt || "")}</textarea>
    </section>
    <div class="prompt-factory-preview-grid">
      ${renderFactoryValidationImage("Image A", asset.imageAUrl)}
      ${renderFactoryValidationImage("Image B", asset.imageBUrl)}
    </div>
    <section class="prompt-factory-section">
      <h4>对比结论</h4>
      <textarea rows="4" data-factory-field="comparison">${escapeHtml(asset.comparison || asset.error || "")}</textarea>
    </section>
    <section class="prompt-factory-publish-row">
      <label class="field compact-field"><span>平台</span><select data-factory-field="targetPlatformId">${platforms.map((platform) => `<option value="${escapeAttr(platform.id)}" ${platform.id === selectedPlatform.id ? "selected" : ""}>${escapeHtml(platform.label || platform.id)}</option>`).join("")}</select></label>
      <label class="field compact-field"><span>品类</span><select data-factory-field="targetCategoryId">${(selectedPlatform.categories || []).map((category) => `<option value="${escapeAttr(category.id)}" ${category.id === selectedCategory.id ? "selected" : ""}>${escapeHtml(category.label || category.id)}</option>`).join("")}</select></label>
      <label class="field compact-field"><span>方式</span><select data-factory-field="publishMode"><option value="append" ${publishMode === "append" ? "selected" : ""}>追加新场景</option><option value="overwrite" ${publishMode === "overwrite" ? "selected" : ""}>覆盖已有场景</option></select></label>
      <label class="field compact-field"><span>${publishMode === "overwrite" ? "覆盖场景" : "新场景名"}</span>${publishMode === "overwrite" ? `<select data-factory-field="targetScenarioId">${(selectedCategory.scenarios || []).map((scenario) => `<option value="${escapeAttr(scenario.id)}" ${scenario.id === asset.targetScenarioId ? "selected" : ""}>${escapeHtml(scenario.title || scenario.id)}</option>`).join("")}</select>` : `<input type="text" data-factory-field="targetScenarioId" value="${escapeAttr(asset.targetScenarioId || "")}" aria-label="留空则按标题生成" />`}</label>
    </section>
    <div class="admin-action-row prompt-factory-actions">
      <button class="small-button" type="button" data-factory-action="save" data-asset-id="${escapeAttr(asset.id)}">保存草稿</button>
      <button class="small-button" type="button" data-factory-action="retry" data-asset-id="${escapeAttr(asset.id)}">重试当前素材</button>
      <button class="primary-button" type="button" data-factory-action="publish" data-asset-id="${escapeAttr(asset.id)}">发布到 C 端</button>
    </div>
  `;
}

function renderFactoryValidationImage(label, url) {
  return `<figure class="prompt-factory-validation"><strong>${escapeHtml(label)}</strong>${url ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(label)}" />` : `<div class="empty-state compact-empty">未生成</div>`}</figure>`;
}

function promptAssetStatusLabel(status) {
  return { draft: "草稿", generating: "生成中", generated: "待发布", published: "已发布", failed: "失败" }[status] || "草稿";
}

function promptAssetStatusClass(status) {
  return { generated: "ready", published: "ready", failed: "danger", generating: "neutral", draft: "neutral" }[status] || "neutral";
}
```

- [ ] **Step 7: Add factory styles**

Append to `styles.css`:

```css
.prompt-factory-shell {
  display: grid;
  grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.prompt-factory-create,
.prompt-factory-library,
.prompt-factory-asset-detail {
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 8px;
  background: #fff;
  padding: 14px;
}

.prompt-factory-toolbar,
.prompt-factory-actions,
.prompt-factory-publish-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.prompt-factory-workspace {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 12px;
  margin-top: 12px;
}

.prompt-factory-asset-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 720px;
  overflow: auto;
}

.prompt-factory-asset-row {
  width: 100%;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 8px;
  background: #f8fafc;
  padding: 10px;
  text-align: left;
  display: grid;
  gap: 5px;
  cursor: pointer;
}

.prompt-factory-asset-row.active {
  border-color: #111827;
  background: #fff;
}

.prompt-factory-reference-list,
.prompt-factory-upload-preview,
.prompt-factory-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.prompt-factory-thumb,
.prompt-factory-validation {
  margin: 0;
  display: grid;
  gap: 6px;
}

.prompt-factory-thumb img,
.prompt-factory-validation img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid rgba(15, 23, 42, 0.1);
}

.prompt-factory-detail-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.prompt-factory-section {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.prompt-factory-section h4 {
  margin: 0;
}

.prompt-factory-section textarea,
.prompt-factory-asset-detail textarea {
  width: 100%;
  resize: vertical;
}

@media (max-width: 980px) {
  .prompt-factory-shell,
  .prompt-factory-workspace {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: Run UI structure test**

Run:

```bash
node tests/admin-prompt-factory-ui.test.cjs
```

Expected: PASS.

- [ ] **Step 9: Checkpoint**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If this prints `true`, run:

```bash
git add admin.js styles.css tests/admin-prompt-factory-ui.test.cjs
git commit -m "feat: add prompt factory admin UI shell"
```

If it prints `fatal: not a git repository`, record `Checkpoint: prompt factory UI shell complete; git unavailable`.

---

### Task 6: B-Side Factory Interactions

**Files:**
- Modify: `admin.js`
- Modify: `tests/admin-prompt-factory-ui.test.cjs`

- [ ] **Step 1: Extend failing UI interaction test**

Append these assertions to `tests/admin-prompt-factory-ui.test.cjs` before the final `console.log`:

```javascript
for (const fn of [
  "function bindPromptFactoryEvents",
  "function fileToFactoryImage",
  "function readFactoryImageFiles",
  "function runFactoryBatchGeneration",
  "function handlePromptFactoryClick",
  "function handlePromptFactoryChange"
]) {
  assert.ok(admin.includes(fn), `${fn} should exist`);
}

assert.ok(admin.includes('els.promptConfigEditor.addEventListener("click", handlePromptFactoryClick)'));
assert.ok(admin.includes('els.promptConfigEditor.addEventListener("change", handlePromptFactoryChange)'));
assert.ok(admin.includes("await generatePromptAsset(asset.id"));
```

- [ ] **Step 2: Run UI interaction test to verify it fails**

Run:

```bash
node tests/admin-prompt-factory-ui.test.cjs
```

Expected: FAIL with missing `function bindPromptFactoryEvents`.

- [ ] **Step 3: Wire dynamic event handlers**

In `bindEvents`, after the existing `els.promptConfigEditor.addEventListener("input", ...)`, add:

```js
  bindPromptFactoryEvents();
```

Add these functions near the factory render helpers:

```js
function bindPromptFactoryEvents() {
  els.promptConfigEditor.addEventListener("click", handlePromptFactoryClick);
  els.promptConfigEditor.addEventListener("change", handlePromptFactoryChange);
}

async function handlePromptFactoryClick(event) {
  const statusButton = event.target.closest("[data-factory-status]");
  if (statusButton) {
    state.factoryStatusFilter = statusButton.dataset.factoryStatus || "";
    await loadPromptAssets();
    return;
  }
  const assetButton = event.target.closest("[data-factory-asset-id]");
  if (assetButton) {
    state.activePromptAssetId = assetButton.dataset.factoryAssetId;
    renderPromptConfigEditor();
    return;
  }
  const generateButton = event.target.closest("#generateFactoryAssetsBtn");
  if (generateButton) {
    await createPromptAssets();
    await runFactoryBatchGeneration(generateButton);
    return;
  }
  const actionButton = event.target.closest("[data-factory-action]");
  if (!actionButton) return;
  const assetId = actionButton.dataset.assetId;
  if (actionButton.dataset.factoryAction === "save") await savePromptAsset(assetId);
  if (actionButton.dataset.factoryAction === "retry") await generatePromptAsset(assetId, actionButton);
  if (actionButton.dataset.factoryAction === "publish") await publishPromptAsset(assetId, actionButton);
}

async function handlePromptFactoryChange(event) {
  if (event.target.id === "factoryProductImageInput") {
    const images = await readFactoryImageFiles(event.target.files, 1);
    state.factoryProductImage = images[0] || null;
    renderPromptConfigEditor();
    return;
  }
  if (event.target.id === "factoryReferenceImagesInput") {
    state.factoryReferenceImages = await readFactoryImageFiles(event.target.files, 20);
    renderPromptConfigEditor();
    return;
  }
  if (event.target.dataset.factoryField === "targetPlatformId" || event.target.dataset.factoryField === "targetCategoryId" || event.target.dataset.factoryField === "publishMode") {
    const active = state.promptAssets.find((asset) => asset.id === state.activePromptAssetId);
    if (!active) return;
    if (event.target.dataset.factoryField === "targetPlatformId") {
      active.targetPlatformId = event.target.value;
      active.targetCategoryId = "";
      active.targetScenarioId = "";
    }
    if (event.target.dataset.factoryField === "targetCategoryId") {
      active.targetCategoryId = event.target.value;
      active.targetScenarioId = "";
    }
    if (event.target.dataset.factoryField === "publishMode") active.publishMode = event.target.value;
    renderPromptConfigEditor();
  }
}

async function readFactoryImageFiles(fileList, limit) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/")).slice(0, limit);
  const images = [];
  for (const file of files) {
    images.push(await fileToFactoryImage(file));
  }
  return images;
}

function fileToFactoryImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({ name: file.name || "图片", size: "", url: String(reader.result || "") });
    };
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function runFactoryBatchGeneration(button) {
  const pendingAssets = state.promptAssets.filter((asset) => asset.status === "draft");
  if (!pendingAssets.length) return;
  setBusy(button, "批量生成中", true);
  try {
    for (const asset of pendingAssets) {
      await generatePromptAsset(asset.id);
    }
  } finally {
    setBusy(button, "生成提示词与验证图", false);
  }
}
```

- [ ] **Step 4: Run UI interaction test**

Run:

```bash
node tests/admin-prompt-factory-ui.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If this prints `true`, run:

```bash
git add admin.js tests/admin-prompt-factory-ui.test.cjs
git commit -m "feat: wire prompt factory admin interactions"
```

If it prints `fatal: not a git repository`, record `Checkpoint: prompt factory interactions complete; git unavailable`.

---

### Task 7: Full Regression Verification

**Files:**
- No new files.
- Verify: `server.py`, `admin.js`, `styles.css`, `tests/test_prompt_assets.py`, `tests/admin-prompt-assets-api.test.cjs`, `tests/admin-prompt-factory-ui.test.cjs`

- [ ] **Step 1: Run backend prompt tests**

Run:

```bash
python3 -m unittest tests.test_prompt_assets tests.test_prompt_config -v
```

Expected: PASS for prompt asset tests and existing prompt config tests.

- [ ] **Step 2: Run admin UI static tests**

Run:

```bash
node tests/admin-prompt-assets-api.test.cjs
node tests/admin-prompt-factory-ui.test.cjs
node tests/admin-model-provider-ui.test.cjs
node tests/admin-key-config-ui.test.cjs
node tests/single-template-ui.test.cjs
```

Expected: all commands PASS.

- [ ] **Step 3: Run broader existing test sweep**

Run:

```bash
for test in tests/*.cjs; do node "$test"; done
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Expected: all CJS and Python tests PASS.

- [ ] **Step 4: Start local server for manual smoke test**

Run:

```bash
python3 server.py
```

Expected: server starts on `http://localhost:8787`. Keep the session running while doing the smoke test.

- [ ] **Step 5: Manual B-side smoke test**

Open `http://localhost:8787/admin-login.html`, log in with `admin@example.com / change-me`, and verify:

- `提示词配置` contains a `图片提示词工厂` group.
- The factory group shows product upload, reference upload, model select, generate button, asset list, and detail panel.
- If no AOKAPI / Gemini model is configured, the model select shows `请配置 AOKAPI / Gemini 图片模型` and generation is disabled.

- [ ] **Step 6: Manual publish smoke test without upstream call**

Use the API or browser state to create/edit a prompt asset with a Chinese prompt, then publish append mode. Verify `/api/admin/prompt-config` contains the appended scenario and that C-side `/api/settings` includes the new scenario metadata but not prompt text.

Use this `curl` shape after replacing `$TOKEN` with the admin token from local storage:

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/admin/prompt-assets
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"referenceImages":[{"name":"ref.png","size":"1024x1024","url":"data:image/png;base64,aW1hZ2U="}]}' \
  http://localhost:8787/api/admin/prompt-assets
```

Expected: created asset appears in the B-side factory list. Edit and publish it through the UI.

- [ ] **Step 7: Stop local server**

If `python3 server.py` is running in the foreground, press `Ctrl-C`.

- [ ] **Step 8: Final checkpoint**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If this prints `true`, run:

```bash
git add server.py admin.js styles.css tests/test_prompt_assets.py tests/admin-prompt-assets-api.test.cjs tests/admin-prompt-factory-ui.test.cjs docs/superpowers/specs/2026-06-20-image-prompt-factory-design.md docs/superpowers/plans/2026-06-20-image-prompt-factory.md
git commit -m "feat: add image prompt factory"
```

If it prints `fatal: not a git repository`, record `Final checkpoint: image prompt factory implementation verified; git unavailable`.

---

## Self-Review Notes

- Spec coverage: storage table, B-side library, Gemini-compatible model reuse, Image A/Image B/comparison workflow, publish append/overwrite, C-side unchanged behavior, privacy, and tests are each mapped to tasks above.
- Red-flag scan: no `TBD`, `TODO`, or unexpanded implementation steps remain in this plan.
- Type consistency: plan uses `prompt_assets` DB columns, camelCase API fields, and existing helper names consistently: `providerModelId`, `referenceImages`, `productImage`, `chinesePrompt`, `englishPrompt`, `imageAUrl`, `imageBUrl`, `targetPlatformId`, `targetCategoryId`, `targetScenarioId`, and `publishMode`.
