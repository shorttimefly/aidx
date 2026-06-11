import json
from pathlib import Path
import tempfile
import unittest

import server


class PromptConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        server.STORAGE_DIR = Path(self.temp_dir.name)
        server.DB_PATH = server.STORAGE_DIR / "image_studio.sqlite"
        server.init_db()

    def test_init_db_seeds_default_prompt_config(self):
        with server.connect() as conn:
            config = server.prompt_config_settings(conn)

        self.assertEqual(config["version"], 1)
        self.assertEqual(config["single"]["templates"][0]["id"], "main-white")
        self.assertEqual(config["suite"]["presets"][0]["id"], "amazon-aplus")
        self.assertEqual(config["suite"]["visualStyles"][0]["label"], "高级简洁")
        self.assertEqual(config["suite"]["visualStyles"][0]["displayLabel"], "清爽质感")
        self.assertIn("强限制", config["reference"]["strictRule"])

    def test_app_settings_returns_saved_prompt_config(self):
        with server.connect() as conn:
            config = server.prompt_config_settings(conn)
            config["single"]["templates"][0]["title"] = "后台改过的白底主图"
            conn.execute(
                "UPDATE app_settings SET value=? WHERE key='prompt_config_json'",
                (json.dumps(config, ensure_ascii=False),),
            )

        with server.connect() as conn:
            config = server.prompt_config_settings(conn)

        self.assertEqual(config["single"]["templates"][0]["title"], "后台改过的白底主图")

    def test_invalid_prompt_config_json_falls_back_to_defaults(self):
        with server.connect() as conn:
            conn.execute("UPDATE app_settings SET value='not-json' WHERE key='prompt_config_json'")

        with server.connect() as conn:
            config = server.prompt_config_settings(conn)

        self.assertEqual(config["single"]["templates"][0]["id"], "main-white")
        self.assertEqual(config["suite"]["presets"][0]["shots"][0]["id"], "aplus-hero")

    def test_stable_ids_and_template_categories_are_locked_but_copy_fields_save(self):
        with server.connect() as conn:
            config = server.prompt_config_settings(conn)

        config["single"]["templates"][0]["id"] = "changed-id"
        config["single"]["templates"][0]["category"] = "changed-category"
        config["single"]["templates"][0]["title"] = "可编辑标题"
        config["suite"]["visualStyles"][0]["displayLabel"] = "前台可见名称"
        config["suite"]["contextFallbacks"]["category"] = "可编辑默认品类文案"

        normalized = server.normalize_prompt_config(config)

        self.assertEqual(normalized["single"]["templates"][0]["id"], "main-white")
        self.assertEqual(normalized["single"]["templates"][0]["category"], "main")
        self.assertEqual(normalized["single"]["templates"][0]["title"], "可编辑标题")
        self.assertEqual(normalized["suite"]["visualStyles"][0]["displayLabel"], "前台可见名称")
        self.assertEqual(normalized["suite"]["contextFallbacks"]["category"], "可编辑默认品类文案")

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
