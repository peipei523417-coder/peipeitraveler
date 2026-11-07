"""Parser fixtures only, not real native-build verification."""
import importlib.util
import plistlib
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("versions", Path(__file__).with_name("verify-native-versions.py"))
versions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(versions)


class VersionTests(unittest.TestCase):
    def test_expected_ios_source(self):
        self.assertEqual(versions.source_versions()["ios"], {"version": "6.1.81", "build": "123"})

    def test_expected_android_source(self):
        self.assertEqual(versions.source_versions()["android"], {"version": "1.3.37", "build": "164"})

    def test_packaged_mismatch_blocks_upload(self):
        with self.assertRaises(ValueError):
            versions.assert_match({"version": "6.1.81", "build": "123"}, {"version": "6.1.80", "build": "122"})

    def test_ipa_binary_plist(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.ipa"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Payload/App.app/Info.plist", plistlib.dumps({
                    "CFBundleIdentifier": "com.peipeigo.travel",
                    "CFBundleShortVersionString": "6.1.81", "CFBundleVersion": "123"
                }, fmt=plistlib.FMT_BINARY))
            self.assertEqual(versions.ipa_version(path), {"version": "6.1.81", "build": "123"})

    def test_aab_manifest(self):
        xml = '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.peitravel.smartplanner" android:versionName="1.3.37" android:versionCode="164"/>'
        self.assertEqual(versions.manifest_version(xml), {"version": "1.3.37", "build": "164"})

    def test_invalid_version_rejected(self):
        with self.assertRaises(ValueError):
            versions.validate("unknown", "164")


if __name__ == "__main__":
    unittest.main()