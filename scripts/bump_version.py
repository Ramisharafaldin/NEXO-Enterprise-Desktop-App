#!/usr/bin/env python3
"""
NEXO Unified Semantic Version Synchronization Script
Synchronizes the application release version consistently across all core locations:
  1. VERSION
  2. package.json
  3. backend/server.py (fallback return in get_app_version())
  4. README.md (top release badge & Current Release Version bullet)

Usage:
  python scripts/bump_version.py 0.1.14
  python scripts/bump_version.py v0.1.14
  python scripts/bump_version.py --part patch|minor|major
  python scripts/bump_version.py --hook (git pre-commit hook mode)
"""

import sys
import os
import re
import json
import argparse
import subprocess
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
VERSION_FILE = REPO_DIR / "VERSION"
PACKAGE_JSON = REPO_DIR / "package.json"
SERVER_PY = REPO_DIR / "backend" / "server.py"
README_MD = REPO_DIR / "README.md"

def read_current_version() -> str:
    """Reads current version string from VERSION or package.json."""
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
    """Parses major, minor, patch numbers from semver string."""
    clean = ver_str.lstrip("v").strip()
    parts = clean.split(".")
    major = int(parts[0]) if len(parts) > 0 and parts[0].isdigit() else 0
    minor = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
    patch = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
    return major, minor, patch

def bump_semver(ver_str: str, part: str) -> str:
    """Calculates next semver based on segment to bump."""
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
    """Updates VERSION plain text file."""
    VERSION_FILE.write_text(f"{new_ver}\n", encoding="utf-8", newline="\n")

def update_package_json(new_ver: str):
    """Updates version field in package.json."""
    if not PACKAGE_JSON.exists():
        return
    try:
        content = PACKAGE_JSON.read_text(encoding="utf-8")
        data = json.loads(content)
        data["version"] = new_ver
        PACKAGE_JSON.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
    except Exception as e:
        print(f"[NEXO] Warning: Could not update package.json: {e}", file=sys.stderr)

def update_server_py(new_ver: str):
    """Updates fallback version return in backend/server.py get_app_version()."""
    if not SERVER_PY.exists():
        return
    try:
        content = SERVER_PY.read_text(encoding="utf-8")
        pattern = r'(def get_app_version\(\) -> str:.*?return\s+")[0-9]+\.[0-9]+\.[0-9]+(")'
        new_content = re.sub(pattern, rf'\g<1>{new_ver}\g<2>', content, flags=re.DOTALL)
        if new_content != content:
            SERVER_PY.write_text(new_content, encoding="utf-8", newline="\n")
    except Exception as e:
        print(f"[NEXO] Warning: Could not update backend/server.py: {e}", file=sys.stderr)

def update_readme_md(new_ver: str):
    """
    Updates README.md:
      - Top release badge: [![Release](https://img.shields.io/badge/Release-v0.1.13-2196F3?style=flat-square)]()
      - Dedicated bullet: - **Current Release Version:** v0.1.19
    """
    if not README_MD.exists():
        return
    try:
        content = README_MD.read_text(encoding="utf-8")
        v_tag = f"v{new_ver}"

        # 1. Update top release badge
        content = re.sub(
            r'(\[!\[Release\]\(https://img\.shields\.io/badge/Release-)[^-\)]+(-[0-9a-zA-Z]+\?style=flat-square\)\)\]\(\))',
            rf'\g<1>{v_tag}\g<2>',
            content
        )

        # 2. Update dedicated Current Release Version bullet in Core Capabilities
        content = re.sub(
            r'(-\s+\*\*Current Release Version:\*\*\s*)(?:<!--\s*VERSION_START\s*-->)?v?[0-9]+\.[0-9]+\.[0-9]+(?:<!--\s*VERSION_END\s*-->)?',
            rf'\g<1>{v_tag}',
            content
        )

        README_MD.write_text(content, encoding="utf-8", newline="\n")
    except Exception as e:
        print(f"[NEXO] Warning: Could not update README.md: {e}", file=sys.stderr)

def sync_all(new_ver: str):
    """Syncs version across all 4 locations."""
    clean_ver = new_ver.lstrip("v").strip()
    update_version_file(clean_ver)
    update_package_json(clean_ver)
    update_server_py(clean_ver)
    update_readme_md(clean_ver)
    return clean_ver

def main():
    parser = argparse.ArgumentParser(description="NEXO Semantic Version Synchronizer")
    parser.add_argument("version", nargs="?", help="Target version to set (e.g. 0.1.14 or v0.1.14)")
    parser.add_argument("--part", choices=["patch", "minor", "major"], default=None, help="Semantic segment to bump if version not specified")
    parser.add_argument("--hook", action="store_true", help="Pre-commit hook mode (checks git staged files)")
    args = parser.parse_args()

    if args.hook:
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
        except Exception:
            pass

    current_ver = read_current_version()

    if args.version:
        target_ver = args.version.lstrip("v").strip()
    elif args.part:
        target_ver = bump_semver(current_ver, args.part)
    elif args.hook:
        target_ver = bump_semver(current_ver, "patch")
    else:
        print(f"Current NEXO version: v{current_ver}")
        print("Usage: python scripts/bump_version.py <version>")
        print("Example: python scripts/bump_version.py 0.1.14")
        sys.exit(1)

    clean_ver = sync_all(target_ver)

    if args.hook:
        try:
            subprocess.run(["git", "add", "VERSION", "package.json", "backend/server.py", "README.md"], cwd=REPO_DIR, check=True)
            print(f"[NEXO] Auto-bumped version to v{clean_ver}")
        except Exception as e:
            print(f"[NEXO] Warning: git add failed: {e}", file=sys.stderr)
    else:
        print(f"[NEXO] Successfully synchronized version from v{current_ver} to v{clean_ver}:")
        print("  - VERSION")
        print("  - package.json")
        print("  - backend/server.py")
        print("  - README.md (top badge & Current Release Version bullet)")

if __name__ == "__main__":
    main()
