"""Verify every t("key") call in the frontend resolves to a real i18n key.

Usage: python scripts/check_i18n_usage.py
Maps each translator variable to its useTranslations("namespace") in the same
file, then checks namespace.key exists in en.json (parity with hi.json is
checked separately).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend" / "src"
MESSAGES = ROOT / "frontend" / "src" / "i18n" / "messages" / "en.json"

USE_RE = re.compile(r"const\s+(\w+)\s*=\s*useTranslations\(\s*[\"'](\w+)[\"']\s*\)")
CALL_RE = re.compile(r"\b(\w+)\(\s*[\"']([\w.]+)[\"']")
TEMPLATE_RE = re.compile(r"\b(\w+)\(\s*`([^`]*)`")


def flat_keys(data: dict, prefix: str = "") -> set[str]:
    out: set[str] = set()
    for key, value in data.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out |= flat_keys(value, path)
        else:
            out.add(path)
    return out


def main() -> int:
    keys = flat_keys(json.loads(MESSAGES.read_text(encoding="utf-8")))
    problems: list[str] = []

    for file in SRC.rglob("*.tsx"):
        text = file.read_text(encoding="utf-8")
        translators = dict(USE_RE.findall(text))
        if not translators:
            continue
        for var, key in CALL_RE.findall(text):
            if var not in translators:
                continue
            full = f"{translators[var]}.{key}"
            if full not in keys:
                problems.append(f"{file.relative_to(ROOT)}: {var}(\"{key}\") -> missing {full}")
        for var, template in TEMPLATE_RE.findall(text):
            if var not in translators or "${" not in template:
                continue
            # Dynamic keys like `status_${x}` — check the static prefix has at
            # least one matching key.
            prefix = template.split("${")[0]
            ns = translators[var]
            if prefix and not any(k.startswith(f"{ns}.{prefix}") for k in keys):
                problems.append(
                    f"{file.relative_to(ROOT)}: dynamic {var}(`{template}`) has no keys "
                    f"starting with {ns}.{prefix}"
                )

    if problems:
        print(f"{len(problems)} unresolved i18n usages:")
        for p in problems:
            print(" ", p)
        return 1
    print("All i18n usages resolve to existing keys.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
