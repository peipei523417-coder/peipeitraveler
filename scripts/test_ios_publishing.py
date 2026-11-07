"""Exercise the actual final Codemagic gate with IPA fixtures, not native builds."""
import json
import os
import plistlib
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class IosPublishingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run([
            "node", "-e",
            "console.log(JSON.stringify(require('yaml').parse(require('fs').readFileSync('codemagic.yaml','utf8'))))",
        ], cwd=ROOT, check=True, capture_output=True, text=True)
        cls.workflow = json.loads(result.stdout)["workflows"]["ios-build"]
        cls.gate = cls.workflow["scripts"][-1]["script"]

    def run_gate(self, version, build):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            snapshot = subprocess.run([
                "python3", "scripts/verify-native-versions.py", "--snapshot", str(root / "native-versions.json"),
            ], cwd=ROOT, check=True, capture_output=True)
            unverified = root / "ipa-unverified"
            unverified.mkdir()
            with zipfile.ZipFile(unverified / "App.ipa", "w") as archive:
                archive.writestr("Payload/App.app/Info.plist", plistlib.dumps({
                    "CFBundleIdentifier": "com.peipeigo.travel",
                    "CFBundleShortVersionString": version,
                    "CFBundleVersion": build,
                }, fmt=plistlib.FMT_BINARY))
            result = subprocess.run(["bash", "-c", self.gate], cwd=ROOT,
                                    env={**os.environ, "CM_BUILD_DIR": folder},
                                    capture_output=True, text=True)
            published = list((root / "ipa").glob("*.ipa"))
            return result.returncode, len(published)

    def test_expected_ipa_is_exposed_for_upload(self):
        self.assertEqual(self.run_gate("6.1.81", "123"), (0, 1))

    def test_old_ipa_blocks_upload(self):
        code, artifacts = self.run_gate("6.1.80", "122")
        self.assertNotEqual(code, 0)
        self.assertEqual(artifacts, 0)

    def test_unapproved_newer_ipa_blocks_upload(self):
        code, artifacts = self.run_gate("6.1.82", "124")
        self.assertNotEqual(code, 0)
        self.assertEqual(artifacts, 0)

    def test_testflight_uses_existing_integration(self):
        self.assertEqual(self.workflow["integrations"]["app_store_connect"], "codemagic-final")
        self.assertEqual(self.workflow["publishing"]["app_store_connect"]["auth"], "integration")
        self.assertIs(self.workflow["publishing"]["app_store_connect"]["submit_to_testflight"], True)

    def test_no_automatic_app_store_submission(self):
        self.assertIs(self.workflow["publishing"]["app_store_connect"]["submit_to_app_store"], False)

    def test_only_verified_directory_is_published(self):
        self.assertEqual(self.workflow["artifacts"], ["$CM_BUILD_DIR/ipa/*.ipa"])
        self.assertTrue(all(not step.get("ignore_failure", False) for step in self.workflow["scripts"]))


if __name__ == "__main__":
    unittest.main()