#!/usr/bin/env python3
"""
NEXO Automatic Semantic Versioning Script
Increments application version in VERSION and package.json.
Can be invoked manually (e.g. `python scripts/bump_version.py --part minor`)
or automatically by the Git pre-commit hook (`python scripts/bump_version.py --hook`).
"""

import sys
import os
import json
import argparse
import subprocess
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
VERSION_FILE = REPO_DIR / "VERSION"
PACKAGE_JSON = REPO_DIR / "package.json"

def read_current_version() -> str:
    if VERSION_FILE.exists():
        raw = VERSION_FILE.read_text(encoding="utf-8").strip()
        if raw:
            return raw.lstrip("v")
    if PACKAGE_JSON.exists():
        try:
            data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
            return data.get("version", "0.1.0").lstrip("v")
        except Exception:
            pass
    return "0.1.0"

def parse_semver(ver_str: str):
    parts = ver_str.split(".")
    major = int(parts[0]) if len(parts) > 0 and parts[0].isdigit() else 0
    minor = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
    patch = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
    return major, minor, patch

def bump(ver_str: str, part: str) -> str:
    major, minor, patch = parse_semver(ver_str)
    if part == "major":
        major += 1
        minor = 0
        patch = 0
    elif part == "minor":
        minor += 1
        patch = 0
    else:  # patch
        patch += 1
    return f"{major}.{minor}.{patch}"

def update_version_file(new_ver: str):
    VERSION_FILE.write_text(f"{new_ver}\n", encoding="utf-8", newline="\n")

def update_package_json(new_ver: str):
    if PACKAGE_JSON.exists():
        try:
            content = PACKAGE_JSON.read_text(encoding="utf-8")
            data = json.loads(content)
            data["version"] = new_ver
            PACKAGE_JSON.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
        except Exception as e:
            print(f"[NEXO] Warning: Could not update package.json: {e}", file=sys.stderr)

def main():
    parser = argparse.ArgumentParser(description="NEXO Semantic Version Bumper")
    parser.add_argument("--part", choices=["patch", "minor", "major"], default="patch", help="Semantic segment to bump")
    parser.add_argument("--hook", action="store_true", help="Pre-commit hook mode (checks git staged files)")
    args = parser.parse_args()

    if args.hook:
        # Check if VERSION is already staged by the developer
        try:
            res = subprocess.run(
                ["git", "diff", "--cached", "--name-only"],
                cwd=REPO_DIR,
                capture_output=True,
                text=True,
                check=True
            )
            staged_files = [f.strip().replace("\\", "/") for f in res.stdout.splitlines() if f.strip()]
            if "VERSION" in staged_files:
                print("[NEXO] VERSION already staged, skipping auto-bump.")
                sys.exit(0)
        except Exception as e:
            # If git fails or not a repo, proceed with warning
            pass

    current_ver = read_current_version()
    new_ver = bump(current_ver, args.part)

    update_version_file(new_ver)
    update_package_json(new_ver)

    if args.hook:
        try:
            subprocess.run(["git", "add", "VERSION", "package.json"], cwd=REPO_DIR, check=True)
            print(f"[NEXO] Auto-bumped version to v{new_ver}")
        except Exception as e:
            print(f"[NEXO] Warning: git add failed: {e}", file=sys.stderr)
    else:
        print(f"[NEXO] Bumped version from v{current_ver} to v{new_ver}")

if __name__ == "__main__":
    main()
