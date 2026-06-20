import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

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

    def test_create_suite_prompt_asset_keeps_reference_set_together(self):
        product = {"name": "product.png", "size": "1024x1024", "url": DATA_IMAGE}
        references = [
            {"name": "hero-ref.png", "size": "1792x1024", "url": DATA_IMAGE + "a"},
            {"name": "detail-ref.png", "size": "1024x1024", "url": DATA_IMAGE + "b"},
            {"name": "comparison-ref.png", "size": "1792x1024", "url": DATA_IMAGE + "c"},
        ]

        with server.connect() as conn:
            asset = server.create_suite_prompt_asset(
                conn,
                product,
                references,
                provider_model_id="model_1",
                title="A+ 同款套图",
            )
            suite_rows = server.prompt_asset_rows(conn, asset_kind="suite", limit=10)
            single_rows = server.prompt_asset_rows(conn, asset_kind="single", limit=10)

        self.assertEqual(asset["assetKind"], "suite")
        self.assertEqual(asset["title"], "A+ 同款套图")
        self.assertEqual(len(asset["referenceImages"]), 3)
        self.assertEqual([row["id"] for row in suite_rows], [asset["id"]])
        self.assertEqual(single_rows, [])

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

    def test_update_prompt_asset_preserves_large_validation_image_data_urls(self):
        large_image = "data:image/png;base64," + ("A" * 260_000)
        with server.connect() as conn:
            created = server.create_prompt_assets(
                conn,
                {},
                [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE}],
            )[0]
            updated = server.update_prompt_asset(conn, created["id"], {"imageAUrl": large_image})
            reloaded = server.prompt_asset_by_id(conn, created["id"])

        self.assertEqual(updated["imageAUrl"], large_image)
        self.assertEqual(reloaded["imageAUrl"], large_image)

    def test_delete_prompt_asset_removes_history_asset(self):
        with server.connect() as conn:
            created = server.create_prompt_assets(
                conn,
                {},
                [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE}],
            )[0]
            deleted = server.delete_prompt_asset(conn, created["id"])
            missing = server.prompt_asset_by_id(conn, created["id"])

        self.assertTrue(deleted)
        self.assertIsNone(missing)

    def test_prompt_factory_similarity_score_text_reads_json_score(self):
        text = server.prompt_factory_similarity_score_text(
            '{"similarityScore":82,"summary":"结构接近"}'
        )

        self.assertEqual(text, "相似度 82分")

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

    def test_mark_stale_generating_prompt_assets_waits_five_minutes_before_failing(self):
        with server.connect() as conn:
            asset = server.create_prompt_assets(
                conn,
                {"name": "product.png", "size": "1024x1024", "url": DATA_IMAGE},
                [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE}],
            )[0]
            server.update_prompt_asset(
                conn,
                asset["id"],
                {
                    "status": "generating",
                    "request": {
                        "progress": {
                            "step": "imageA",
                            "label": "生成 Image A",
                            "updatedAt": "2026-06-20T05:45:01Z",
                        }
                    },
                },
            )
            with mock.patch("server.now_iso", return_value="2026-06-20T05:47:32Z"):
                not_yet_changed = server.mark_stale_prompt_assets_failed(conn)
                still_generating = server.prompt_asset_by_id(conn, asset["id"])
            with mock.patch("server.now_iso", return_value="2026-06-20T05:50:02Z"):
                changed = server.mark_stale_prompt_assets_failed(conn)
                updated = server.prompt_asset_by_id(conn, asset["id"])

        self.assertEqual(not_yet_changed, 0)
        self.assertEqual(still_generating["status"], "generating")
        self.assertEqual(changed, 1)
        self.assertEqual(updated["status"], "failed")
        self.assertIn("Image A", updated["error"])
        self.assertIn("超时", updated["error"])

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
        published_prompt = next(prompt for prompt in prompts if "发布到C端的中文提示词" in prompt)
        self.assertIn("图片中的所有可见文案", published_prompt)

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
        self.assertIn("覆盖后的提示词", first["prompt"])
        self.assertIn("图片中的所有可见文案", first["prompt"])

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

    def test_publish_suite_prompt_asset_append_adds_c_side_suite_preset(self):
        with server.connect() as conn:
            asset = server.create_suite_prompt_asset(
                conn,
                {"name": "product.png", "size": "1024x1024", "url": DATA_IMAGE},
                [
                    {"name": "hero-ref.png", "size": "1792x1024", "url": DATA_IMAGE + "a"},
                    {"name": "detail-ref.png", "size": "1024x1024", "url": DATA_IMAGE + "b"},
                ],
                title="同款 A+ 套图",
            )
            server.update_prompt_asset(
                conn,
                asset["id"],
                {
                    "chinesePrompt": "整套统一风格：真实电商摄影，产品一致。",
                    "suiteShots": [
                        {
                            "name": "01 首屏横幅",
                            "size": "1792x1024",
                            "description": "品牌故事和文案安全区",
                            "chinesePrompt": "横版 A+ 首屏横幅，保留标题安全区。",
                        },
                        {
                            "name": "02 细节卖点图",
                            "size": "1024x1024",
                            "description": "结构细节和卖点模块",
                            "chinesePrompt": "方形细节信息图，保留 3 个标注区域。",
                        },
                    ],
                },
            )
            published = server.publish_suite_prompt_asset(
                conn,
                asset["id"],
                {"mode": "append", "title": "同款 A+ 套图"},
            )
            config = server.prompt_config_settings(conn)
            client_config = server.client_prompt_config(config)

        self.assertEqual(published["status"], "published")
        self.assertTrue(published["publishedTemplateId"].startswith("factory-suite-"))
        preset = next(item for item in config["suite"]["presets"] if item["id"] == published["publishedTemplateId"])
        self.assertEqual(preset["title"], "同款 A+ 套图")
        self.assertEqual(len(preset["shots"]), 2)
        self.assertIn("整套统一风格", preset["shots"][0]["prompt"])
        self.assertIn("图片中的所有可见文案", preset["shots"][0]["prompt"])
        client_preset = next(item for item in client_config["suite"]["presets"] if item["id"] == published["publishedTemplateId"])
        self.assertEqual(client_preset["shots"][0]["name"], "01 首屏横幅")
        self.assertNotIn("prompt", client_preset["shots"][0])

    def test_generate_suite_prompt_asset_creates_prompt_only_image_per_shot_with_chinese_names(self):
        calls = []
        original_call = server.call_upstream_model_with_retry
        try:
            def fake_call(endpoint, api_key, body):
                calls.append((endpoint, body))
                index = len(calls)
                if index == 1:
                    return {"choices": [{"message": {"content": '{"summary":"two image ecommerce suite"}'}}]}
                if index == 2:
                    return {
                        "choices": [
                            {
                                "message": {
                                    "content": json.dumps(
                                        {
                                            "chinesePrompt": "整套统一蓝白医疗电商风格。",
                                            "englishPrompt": "Unified blue and white ecommerce suite.",
                                            "suiteShots": [
                                                {
                                                    "name": "Hero Banner",
                                                    "size": "1024x1024",
                                                    "description": "main selling hero",
                                                    "chinesePrompt": "生成首屏品牌横幅，展示产品主体和核心标题安全区。",
                                                    "englishPrompt": "Create a hero banner.",
                                                },
                                                {
                                                    "name": "Feature Infographic",
                                                    "size": "1024x1024",
                                                    "description": "feature callouts",
                                                    "chinesePrompt": "生成卖点信息图，展示三个核心功能标注。",
                                                    "englishPrompt": "Create a feature infographic.",
                                                },
                                            ],
                                        },
                                        ensure_ascii=False,
                                    )
                                }
                            }
                        ]
                    }
                if index == 3:
                    self.assertIn("首屏品牌横幅", body["prompt"])
                    self.assertEqual(body["image"], DATA_IMAGE)
                    return {"data": [{"b64_json": "QUFB"}]}
                if index == 4:
                    self.assertIn("卖点信息图", body["prompt"])
                    self.assertEqual(body["image"], DATA_IMAGE)
                    return {"data": [{"b64_json": "QkJC"}]}
                self.fail(f"unexpected upstream call {index}")

            server.call_upstream_model_with_retry = fake_call
            with server.connect() as conn:
                text_model_id, _ = self.seed_muskapis_prompt_factory_providers(conn)
                asset = server.create_suite_prompt_asset(
                    conn,
                    {"name": "product.png", "size": "1024x1024", "url": DATA_IMAGE},
                    [
                        {"name": "hero-ref.png", "size": "1024x1024", "url": DATA_IMAGE + "a"},
                        {"name": "feature-ref.png", "size": "1024x1024", "url": DATA_IMAGE + "b"},
                    ],
                    provider_model_id=text_model_id,
                    title="同款套图",
                )
                generated = server.generate_prompt_asset(conn, asset["id"])
        finally:
            server.call_upstream_model_with_retry = original_call

        self.assertEqual(generated["status"], "generated")
        self.assertEqual(generated["imageAUrl"], "")
        self.assertEqual(generated["imageBUrl"], "")
        self.assertEqual(len(generated["suiteShots"]), 2)
        self.assertEqual(generated["suiteShots"][0]["name"], "01 首屏品牌横幅")
        self.assertEqual(generated["suiteShots"][1]["name"], "02 卖点信息图")
        self.assertTrue(generated["suiteShots"][0]["promptOnlyImageUrl"].startswith("data:image/png;base64,"))
        self.assertTrue(generated["suiteShots"][1]["promptOnlyImageUrl"].startswith("data:image/png;base64,"))
        self.assertEqual(generated["suiteShots"][0]["referenceImageUrl"], "")
        self.assertEqual(len(calls), 4)

    def test_generate_suite_reference_image_for_one_shot_on_demand(self):
        calls = []
        original_call = server.call_upstream_model_with_retry
        try:
            def fake_call(endpoint, api_key, body):
                calls.append(body)
                self.assertIn("首屏品牌横幅", body["prompt"])
                self.assertIsInstance(body["image"], list)
                self.assertEqual(body["image"][0], DATA_IMAGE)
                self.assertEqual(body["image"][1], DATA_IMAGE + "a")
                return {"data": [{"b64_json": "UkVG"}]}

            server.call_upstream_model_with_retry = fake_call
            with server.connect() as conn:
                text_model_id, _ = self.seed_muskapis_prompt_factory_providers(conn)
                asset = server.create_suite_prompt_asset(
                    conn,
                    {"name": "product.png", "size": "1024x1024", "url": DATA_IMAGE},
                    [
                        {"name": "hero-ref.png", "size": "1024x1024", "url": DATA_IMAGE + "a"},
                        {"name": "feature-ref.png", "size": "1024x1024", "url": DATA_IMAGE + "b"},
                    ],
                    provider_model_id=text_model_id,
                    title="同款套图",
                )
                server.update_prompt_asset(
                    conn,
                    asset["id"],
                    {
                        "chinesePrompt": "整套统一蓝白医疗电商风格。",
                        "suiteShots": [
                            {
                                "id": "shot-1",
                                "name": "01 首屏品牌横幅",
                                "size": "1024x1024",
                                "description": "首屏视觉",
                                "chinesePrompt": "生成首屏品牌横幅。",
                                "promptOnlyImageUrl": "data:image/png;base64,QUFB",
                            },
                            {
                                "id": "shot-2",
                                "name": "02 卖点信息图",
                                "size": "1024x1024",
                                "description": "卖点视觉",
                                "chinesePrompt": "生成卖点信息图。",
                                "promptOnlyImageUrl": "data:image/png;base64,QkJC",
                            },
                        ],
                    },
                )
                updated = server.generate_suite_prompt_asset_reference_image(conn, asset["id"], "shot-1")
        finally:
            server.call_upstream_model_with_retry = original_call

        self.assertEqual(len(calls), 1)
        self.assertEqual(updated["suiteShots"][0]["referenceImageUrl"], "data:image/png;base64,UkVG")
        self.assertEqual(updated["suiteShots"][1]["referenceImageUrl"], "")

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

    def seed_muskapis_prompt_factory_providers(self, conn):
        now = server.now_iso()
        conn.execute(
            """
            INSERT INTO model_providers (id, name, provider_type, base_url, api_key, enabled, created_at, updated_at)
            VALUES ('provider_text', 'Muskapis GPT', ?, 'https://api.muskapis.com/v1', 'text-token', 1, ?, ?)
            """,
            (server.PROVIDER_TYPE_OPENAI_IMAGE, now, now),
        )
        conn.execute(
            """
            INSERT INTO provider_models (id, provider_id, model_name, model_kind, priority, enabled, created_at, updated_at)
            VALUES ('model_text', 'provider_text', 'gpt-5.5', ?, 5, 1, ?, ?)
            """,
            (server.MODEL_KIND_TEXT, now, now),
        )
        conn.execute(
            """
            INSERT INTO model_providers (id, name, provider_type, base_url, api_key, enabled, created_at, updated_at)
            VALUES ('provider_image', 'Muskapis Image', ?, 'https://api.muskapis.com/v1', 'image-token', 1, ?, ?)
            """,
            (server.PROVIDER_TYPE_MUSKAPIS_IMAGE, now, now),
        )
        conn.execute(
            """
            INSERT INTO provider_models (id, provider_id, model_name, model_kind, priority, enabled, created_at, updated_at)
            VALUES ('model_image', 'provider_image', 'gpt-image-2', ?, 10, 1, ?, ?)
            """,
            (server.MODEL_KIND_IMAGE, now, now),
        )
        return 'model_text', 'model_image'

    def test_prompt_factory_model_options_only_returns_gemini_image_models(self):
        with server.connect() as conn:
            model_id = self.seed_gemini_provider(conn)
            options = server.prompt_factory_model_options(conn)

        self.assertEqual([option["providerModelId"] for option in options], [model_id])
        self.assertEqual(options[0]["providerType"], server.PROVIDER_TYPE_AOKAPI_GEMINI)

    def test_prompt_factory_model_options_includes_gpt55_text_model(self):
        with server.connect() as conn:
            text_model_id, _ = self.seed_muskapis_prompt_factory_providers(conn)
            options = server.prompt_factory_model_options(conn)

        self.assertEqual([option["providerModelId"] for option in options], [text_model_id])
        self.assertEqual(options[0]["modelKind"], server.MODEL_KIND_TEXT)
        self.assertEqual(options[0]["baseUrl"], "https://api.muskapis.com/v1")

    def test_prompt_factory_model_options_rejects_misconfigured_gemini_provider(self):
        with server.connect() as conn:
            now = server.now_iso()
            conn.execute(
                """
                INSERT INTO model_providers (id, name, provider_type, base_url, api_key, enabled, created_at, updated_at)
                VALUES ('provider_bad', 'AOKAPI Gemini', ?, 'https://api.muskapis.com/v1', 'test-token', 1, ?, ?)
                """,
                (server.PROVIDER_TYPE_AOKAPI_GEMINI, now, now),
            )
            conn.execute(
                """
                INSERT INTO provider_models (id, provider_id, model_name, model_kind, priority, enabled, created_at, updated_at)
                VALUES ('model_bad', 'provider_bad', 'gpt-image-2', ?, 10, 1, ?, ?)
                """,
                (server.MODEL_KIND_IMAGE, now, now),
            )
            options = server.prompt_factory_model_options(conn)

        self.assertEqual(options, [])

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
                return {"candidates": [{"content": {"parts": [{"text": '{"similarityScore":82,"comparison":"Image B matches the structure"}'}]}}]}

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
        self.assertIn("中文同款提示词", generated["chinesePrompt"])
        self.assertIn("图片中的所有可见文案", generated["chinesePrompt"])
        self.assertIn("English prompt", generated["englishPrompt"])
        self.assertIn("All visible in-image copy", generated["englishPrompt"])
        self.assertTrue(generated["imageAUrl"].startswith("data:image/png;base64,"))
        self.assertTrue(generated["imageBUrl"].startswith("data:image/png;base64,"))
        self.assertEqual(generated["comparison"], "相似度 82分")
        self.assertEqual(len(calls), 5)

    def test_generate_prompt_asset_uses_gpt55_for_text_and_image_model_for_validation(self):
        calls = []
        progress_steps = []
        image_updates = []
        original_call = server.call_upstream_model_with_retry
        original_update = server.update_prompt_asset
        try:
            def tracking_update(conn, asset_id, values):
                request = values.get("request") if isinstance(values, dict) else None
                progress = request.get("progress") if isinstance(request, dict) else None
                if isinstance(progress, dict) and progress.get("step"):
                    progress_steps.append(progress["step"])
                if values.get("imageAUrl") or values.get("imageBUrl"):
                    image_updates.append({key: values.get(key) for key in ("imageAUrl", "imageBUrl") if values.get(key)})
                return original_update(conn, asset_id, values)

            def fake_call(endpoint, api_key, body):
                calls.append((endpoint, api_key, body))
                index = len(calls)
                if index == 1:
                    return {"choices": [{"message": {"content": '{"summary":"reference layout","imageType":"feature infographic"}'}}]}
                if index == 2:
                    return {"choices": [{"message": {"content": '{"chinesePrompt":"中文同款提示词","englishPrompt":"English prompt"}'}}]}
                if index == 3:
                    return {"data": [{"b64_json": "QUFB"}]}
                if index == 4:
                    return {"data": [{"b64_json": "QkJC"}]}
                return {"choices": [{"message": {"content": '{"comparison":"Image B matches the structure"}'}}]}

            server.update_prompt_asset = tracking_update
            server.call_upstream_model_with_retry = fake_call
            with server.connect() as conn:
                text_model_id, _ = self.seed_muskapis_prompt_factory_providers(conn)
                asset = server.create_prompt_assets(
                    conn,
                    {"name": "product.png", "size": "1024x1024", "url": DATA_IMAGE},
                    [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE + "r"}],
                    provider_model_id=text_model_id,
                )[0]
                generated = server.generate_prompt_asset(conn, asset["id"])
        finally:
            server.call_upstream_model_with_retry = original_call
            server.update_prompt_asset = original_update

        self.assertEqual(generated["status"], "generated")
        self.assertEqual(calls[0][0], "https://api.muskapis.com/v1/chat/completions")
        self.assertEqual(calls[0][1], "text-token")
        self.assertEqual(calls[0][2]["model"], "gpt-5.5")
        self.assertIn("image_url", calls[0][2]["messages"][1]["content"][1])
        self.assertEqual(calls[2][0], "https://api.muskapis.com/v1/images/edits")
        self.assertEqual(calls[2][1], "image-token")
        self.assertEqual(calls[2][2]["model"], "gpt-image-2")
        self.assertIn("图片中的所有可见文案", generated["chinesePrompt"])
        self.assertIn("All visible in-image copy", generated["englishPrompt"])
        self.assertIn("图片中的所有可见文案", calls[2][2]["prompt"])
        self.assertIn("图片中的所有可见文案", calls[3][2]["prompt"])
        self.assertEqual(calls[4][0], "https://api.muskapis.com/v1/chat/completions")
        self.assertEqual(len(calls), 5)
        self.assertEqual(
            progress_steps[:6],
            ["prepare", "analysis", "prompt", "imageA", "imageB", "compare"],
        )
        self.assertEqual([list(update.keys()) for update in image_updates[:2]], [["imageAUrl"], ["imageBUrl"]])

    def test_generate_prompt_asset_preserves_large_validation_images(self):
        large_a = "A" * 260_000
        large_b = "B" * 260_000
        original_call = server.call_upstream_model_with_retry
        try:
            def fake_call(endpoint, api_key, body):
                index = getattr(fake_call, "index", 0) + 1
                fake_call.index = index
                if index == 1:
                    return {"choices": [{"message": {"content": '{"summary":"reference layout","imageType":"feature infographic"}'}}]}
                if index == 2:
                    return {"choices": [{"message": {"content": '{"chinesePrompt":"中文同款提示词","englishPrompt":"English prompt"}'}}]}
                if index == 3:
                    return {"data": [{"b64_json": large_a}]}
                if index == 4:
                    return {"data": [{"b64_json": large_b}]}
                return {"choices": [{"message": {"content": '{"similarityScore":88,"comparison":"结构接近"}'}}]}

            server.call_upstream_model_with_retry = fake_call
            with server.connect() as conn:
                text_model_id, _ = self.seed_muskapis_prompt_factory_providers(conn)
                asset = server.create_prompt_assets(
                    conn,
                    {"name": "product.png", "size": "1024x1024", "url": DATA_IMAGE},
                    [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE + "r"}],
                    provider_model_id=text_model_id,
                )[0]
                generated = server.generate_prompt_asset(conn, asset["id"])
                reloaded = server.prompt_asset_by_id(conn, asset["id"])
        finally:
            server.call_upstream_model_with_retry = original_call

        self.assertEqual(len(generated["imageAUrl"]), len("data:image/png;base64,") + len(large_a))
        self.assertEqual(len(generated["imageBUrl"]), len("data:image/png;base64,") + len(large_b))
        self.assertEqual(reloaded["imageAUrl"], generated["imageAUrl"])
        self.assertEqual(reloaded["imageBUrl"], generated["imageBUrl"])
        self.assertGreater(len(reloaded["imageAUrl"]), server.PROMPT_ASSET_JSON_LIMIT)

    def test_generate_prompt_asset_requires_text_understanding_provider(self):
        with server.connect() as conn:
            asset = server.create_prompt_assets(
                conn,
                {},
                [{"name": "ref.png", "size": "1024x1024", "url": DATA_IMAGE}],
            )[0]
            with self.assertRaises(server.AppError) as caught:
                server.generate_prompt_asset(conn, asset["id"])

        self.assertEqual(caught.exception.status, 400)
        self.assertIn("文本理解模型", caught.exception.message)
        self.assertIn("gpt-5.5", caught.exception.message)


if __name__ == "__main__":
    unittest.main()
