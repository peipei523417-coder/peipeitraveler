"""Fail closed on source/artifact version mismatches; never uploads anything."""
import argparse
import json
import plistlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def validate(version, build):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or not re.fullmatch(r"[1-9]\d*", build):
        raise ValueError(f"Invalid version/build: {version} / {build}")
    return {"version": version, "build": build}


def source_versions(root=ROOT):
    project = (root / "ios/App/App.xcodeproj/project.pbxproj").read_text()
    configs = {}
    for body, name in re.findall(r"buildSettings = \{(.*?)\};\s*name = (Debug|Release);", project, re.S):
        if not re.search(r"PRODUCT_BUNDLE_IDENTIFIER\s*=\s*\"?com\.peipeigo\.travel\"?;", body):
            continue
        version = re.search(r"MARKETING_VERSION\s*=\s*\"?([\d.]+)\"?;", body)
        build = re.search(r"CURRENT_PROJECT_VERSION\s*=\s*\"?(\d+)\"?;", body)
        if version is None or build is None or name in configs:
            raise ValueError("Missing or ambiguous App version settings")
        configs[name] = validate(version.group(1), build.group(1))
    if set(configs) != {"Debug", "Release"} or configs["Debug"] != configs["Release"]:
        raise ValueError("iOS Debug/Release versions must exist and match")
    with (root / "ios/App/App/Info.plist").open("rb") as file:
        info = plistlib.load(file)
    if (info.get("CFBundleShortVersionString"), info.get("CFBundleVersion")) != (
        "$(MARKETING_VERSION)", "$(CURRENT_PROJECT_VERSION)"
    ):
        raise ValueError("Info.plist must inherit the Xcode version settings")
    gradle = (root / "android/app/build.gradle").read_text()
    names = re.findall(r'\bversionName\s+"([\d.]+)"', gradle)
    codes = re.findall(r"\bversionCode\s+(\d+)", gradle)
    if len(names) != 1 or len(codes) != 1:
        raise ValueError("Missing or ambiguous Android versions")
    return {"ios": configs["Release"], "android": validate(names[0], codes[0])}


def ipa_version(path):
    with zipfile.ZipFile(path) as archive:
        entries = [name for name in archive.namelist() if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", name)]
        if len(entries) != 1:
            raise ValueError("IPA must contain exactly one main app Info.plist")
        info = plistlib.loads(archive.read(entries[0]))
    if info.get("CFBundleIdentifier") != "com.peipeigo.travel":
        raise ValueError("Unexpected IPA bundle identifier")
    return validate(str(info["CFBundleShortVersionString"]), str(info["CFBundleVersion"]))


def manifest_version(xml):
    manifest = ET.fromstring(xml)
    if manifest.get("package") != "com.peitravel.smartplanner":
        raise ValueError("Unexpected AAB package identifier")
    namespace = "{http://schemas.android.com/apk/res/android}"
    return validate(manifest.attrib[namespace + "versionName"], manifest.attrib[namespace + "versionCode"])


def assert_match(expected, actual):
    if expected != actual:
        raise ValueError(f"Version mismatch: expected {expected}, packaged {actual}; upload blocked")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--platform", choices=["ios", "android"])
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--bundletool", type=Path)
    parser.add_argument("--xcode-settings", type=Path)
    args = parser.parse_args()
    current = source_versions()
    if not args.artifact and not args.xcode_settings:
        args.snapshot.write_text(json.dumps(current))
        for platform, values in current.items():
            print(f"Configured {platform}: {values['version']} / {values['build']}")
        return
    expected = json.loads(args.snapshot.read_text())
    assert_match(expected, current)
    if args.xcode_settings:
        targets = [entry for entry in json.loads(args.xcode_settings.read_text()) if entry.get("target") == "App"]
        if len(targets) != 1:
            raise ValueError("Expected exactly one resolved App target")
        settings = targets[0]["buildSettings"]
        assert_match(expected["ios"], validate(settings["MARKETING_VERSION"], settings["CURRENT_PROJECT_VERSION"]))
        print("Resolved Release Xcode settings match source")
        return
    if args.platform == "ios":
        actual = ipa_version(args.artifact)
    elif args.platform == "android" and args.bundletool:
        result = subprocess.run([
            "java", "-jar", str(args.bundletool), "dump", "manifest",
            f"--bundle={args.artifact}", "--module=base"
        ], check=True, capture_output=True, text=True)
        actual = manifest_version(result.stdout)
    else:
        raise ValueError("Artifact verification needs a platform; AAB also needs bundletool")
    assert_match(expected[args.platform], actual)
    print(f"VERIFIED {args.platform} artifact: {actual['version']} / {actual['build']}")
    for platform, values in expected.items():
        status = "artifact verified" if platform == args.platform else "source only; verify in its own build"
        print(f"Before manual store upload — {platform}: {values['version']} / {values['build']} ({status})")
    if args.platform == "android":
        # Rename the signed file only after its actual manifest has been verified.
        destination = args.artifact.with_name(f"app-release-v{actual['version']}-{actual['build']}-signed.aab")
        args.artifact.rename(destination)
        print(f"AAB filename: {destination.name}")
        import os
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                output.write(f"artifact_name={destination.stem}\nartifact_path={destination}\n")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile, ET.ParseError) as error:
        print(f"VERSION CHECK FAILED: {error}", file=sys.stderr)
        sys.exit(1)