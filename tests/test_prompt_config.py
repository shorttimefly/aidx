import json
from pathlib import Path
import tempfile
import unittest

import server


class PromptConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temp_dir.cleanup)
        server.STORAGE_DIR = Path(self.temp_dir.name)
        server.DB_PATH = server.STORAGE_DIR / "image_studio.sqlite"
        server.init_db()

    def test_init_db_seeds_v2_single_matrix_and_derived_templates(self):
        with server.connect() as conn:
            config = server.prompt_config_settings(conn)

        self.assertEqual(config["version"], 2)
        self.assertEqual(config["single"]["defaults"]["platformId"], "amazon-aplus")
        self.assertEqual(config["single"]["defaults"]["categoryId"], "3c-digital-accessories")
        self.assertEqual(config["single"]["defaults"]["scenarioId"], "brand-story")
        self.assertEqual(config["single"]["defaultTemplateId"], "amazon-aplus-3c-digital-accessories-brand-story")
        self.assertEqual(config["single"]["matrix"]["platforms"][0]["id"], "amazon-aplus")
        self.assertEqual(config["single"]["matrix"]["platforms"][0]["categories"][0]["scenarios"][0]["templateId"], "amazon-aplus-3c-digital-accessories-brand-story")
        self.assertEqual(config["single"]["templates"][0]["id"], "amazon-aplus-3c-digital-accessories-brand-story")
        self.assertEqual(config["suite"]["presets"][0]["id"], "amazon-aplus")
        self.assertEqual(config["suite"]["visualStyles"][0]["displayLabel"], "清爽质感")

    def test_saved_matrix_leaf_copy_reads_back(self):
        with server.connect() as conn:
            config = server.prompt_config_settings(conn)
            config["single"]["matrix"]["platforms"][0]["categories"][0]["scenarios"][0]["title"] = "后台改过的场景"
            conn.execute(
                "UPDATE app_settings SET value=? WHERE key='prompt_config_json'",
                (json.dumps(config, ensure_ascii=False),),
            )

        with server.connect() as conn:
            config = server.prompt_config_settings(conn)

        scenario = config["single"]["matrix"]["platforms"][0]["categories"][0]["scenarios"][0]
        self.assertEqual(scenario["title"], "后台改过的场景")
        self.assertEqual(config["single"]["templates"][0]["title"], "后台改过的场景")

    def test_invalid_prompt_config_json_falls_back_to_v2_defaults(self):
        with server.connect() as conn:
            conn.execute("UPDATE app_settings SET value='not-json' WHERE key='prompt_config_json'")

        with server.connect() as conn:
            config = server.prompt_config_settings(conn)

        self.assertEqual(config["single"]["matrix"]["platforms"][0]["id"], "amazon-aplus")
        self.assertEqual(config["single"]["templates"][0]["id"], "amazon-aplus-3c-digital-accessories-brand-story")

    def test_v1_templates_can_normalize_into_v2_matrix(self):
        legacy = {
            "version": 1,
            "single": {
                "templates": [
                    {
                        "id": "aplus-brand-story",
                        "category": "aplus",
                        "title": "旧版品牌故事",
                        "prompt": "旧版品牌故事提示词"
                    }
                ]
            }
        }

        normalized = server.normalize_prompt_config(legacy)
        first_scenario = normalized["single"]["matrix"]["platforms"][0]["categories"][0]["scenarios"][0]

        self.assertEqual(normalized["version"], 2)
        self.assertEqual(first_scenario["id"], "brand-story")
        self.assertEqual(first_scenario["title"], "旧版品牌故事")
        self.assertEqual(first_scenario["prompt"], "旧版品牌故事提示词")
        self.assertEqual(normalized["single"]["templates"][0]["id"], "amazon-aplus-3c-digital-accessories-brand-story")

    def test_single_matrix_ids_are_locked_but_leaf_copy_fields_save(self):
        with server.connect() as conn:
            config = server.prompt_config_settings(conn)

        first_platform = config["single"]["matrix"]["platforms"][0]
        first_category = first_platform["categories"][0]
        first_scenario = first_category["scenarios"][0]

        first_platform["id"] = "changed-platform"
        first_category["id"] = "changed-category"
        first_scenario["id"] = "changed-scenario"
        first_scenario["templateId"] = "changed-template-id"
        first_scenario["title"] = "可编辑标题"
        first_scenario["prompt"] = "可编辑提示词"

        normalized = server.normalize_prompt_config(config)
        scenario = normalized["single"]["matrix"]["platforms"][0]["categories"][0]["scenarios"][0]

        self.assertEqual(normalized["single"]["matrix"]["platforms"][0]["id"], "amazon-aplus")
        self.assertEqual(normalized["single"]["matrix"]["platforms"][0]["categories"][0]["id"], "3c-digital-accessories")
        self.assertEqual(scenario["id"], "brand-story")
        self.assertEqual(scenario["templateId"], "amazon-aplus-3c-digital-accessories-brand-story")
        self.assertEqual(scenario["title"], "可编辑标题")
        self.assertEqual(scenario["prompt"], "可编辑提示词")

    def test_invalid_prompt_config_size_is_rejected(self):
        with server.connect() as conn:
            config = server.prompt_config_settings(conn)

        config["suite"]["presets"][0]["shots"][0]["size"] = "wide"

        with self.assertRaises(server.AppError) as caught:
            server.normalize_prompt_config(config)

        self.assertEqual(caught.exception.status, 400)
        self.assertIn("无效套图尺寸", caught.exception.message)


if __name__ == "__main__":
    unittest.main()
