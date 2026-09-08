"""Detect explicit ``limit=N`` literals in frontend API calls that exceed the
backend route caps.

If any frontend file contains a fetch/query call whose URL literal includes a
``limit=N`` query parameter where ``N`` exceeds the maintained cap for that
endpoint, this tool prints an actionable message and exits nonzero.

Usage
-----
    # Check the whole frontend src tree:
    python scripts/check_api_limits.py

    # Check a specific directory:
    python scripts/check_api_limits.py frontend/src/app/(partner)/rooms

    # JSON output (for CI consumption):
    python scripts/check_api_limits.py --json

Exit codes
----------
    0  All limits within cap.
    1  At least one violation found.
    2  Usage error.

Importable surface (for unit tests)
------------------------------------
    ENDPOINT_CAPS   dict[str, int]  canonical cap table
    parse_limit_calls(source, filename)  → list[LimitCall]
    check_violations(calls, caps)        → list[Violation]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Canonical backend cap table
# ---------------------------------------------------------------------------
# Keys are URL path fragments that appear in frontend fetch strings.
# The value is the backend's ``le=N`` (or equivalent) Query cap.
# Update this dict whenever a backend route cap changes.
# ---------------------------------------------------------------------------
ENDPOINT_CAPS: dict[str, int] = {
    "current-guests": 200,
    "rooms": 200,
    "bookings": 100,
    "guests": 100,
    "payments": 100,
    "expenses": 100,
    "invoices": 100,
    "team": 100,
    "super-admin/hotels": 100,
}

# ---------------------------------------------------------------------------
# Regex: match any URL string literal that contains "limit=<digits>"
#
# Pattern breakdown:
#   (?:[`"'])             opening quote (backtick, double, or single)
#   (?P<url>[^\s`"']+)    URL characters up to the closing quote
#   (?:[`"'])             closing quote (not captured)
#   ...limit=(?P<limit>\d+) the limit parameter inside the URL
# ---------------------------------------------------------------------------
_LIMIT_RE = re.compile(
    r"""(?:[`"'])(?P<url>[^`"'\n]*?limit=(?P<limit>\d+)[^`"'\n]*)(?:[`"'])""",
    re.VERBOSE,
)

# Patterns that indicate the string is actually a URL / API call rather than
# a CSS class or other unrelated string.  We only flag strings that look like
# API paths (start with /api/ or are template literals with substitution).
_API_PATH_RE = re.compile(r"/api/")


@dataclass
class LimitCall:
    """A single ``limit=N`` occurrence found in source code."""

    filename: str
    line_no: int
    url_fragment: str
    limit: int


@dataclass
class Violation:
    """A LimitCall whose limit value exceeds the endpoint cap."""

    call: LimitCall
    endpoint: str
    cap: int

    def format(self) -> str:  # noqa: A003
        return (
            f"{self.call.filename}:{self.call.line_no}  "
            f"URL fragment='{self.call.url_fragment}'  "
            f"limit={self.call.limit} > cap({self.endpoint})={self.cap}"
        )


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def parse_limit_calls(source: str, filename: str = "<source>") -> list[LimitCall]:
    """Return every URL string literal containing ``limit=N`` found in *source*.

    Only strings that contain ``/api/`` are considered (avoids false positives
    from CSS, test fixtures, etc.).
    """
    calls: list[LimitCall] = []
    # Work line-by-line so we can report line numbers
    for line_no, line in enumerate(source.splitlines(), start=1):
        for m in _LIMIT_RE.finditer(line):
            url = m.group("url")
            if not _API_PATH_RE.search(url):
                continue
            try:
                limit = int(m.group("limit"))
            except ValueError:
                continue
            calls.append(LimitCall(filename=filename, line_no=line_no, url_fragment=url, limit=limit))
    return calls


def check_violations(calls: list[LimitCall], caps: dict[str, int] | None = None) -> list[Violation]:
    """Cross-reference *calls* against *caps* and return any violations.

    A violation occurs when ``call.limit > cap`` for the most-specific matching
    endpoint key.  Matching is done by scanning the URL fragment for each key
    in *caps*; the *longest* matching key wins (specificity).
    """
    if caps is None:
        caps = ENDPOINT_CAPS
    violations: list[Violation] = []
    for call in calls:
        # Find the most specific (longest) matching endpoint key
        matched_key: str | None = None
        for key in caps:
            if key in call.url_fragment:
                if matched_key is None or len(key) > len(matched_key):
                    matched_key = key
        if matched_key is not None:
            cap = caps[matched_key]
            if call.limit > cap:
                violations.append(Violation(call=call, endpoint=matched_key, cap=cap))
    return violations


# ---------------------------------------------------------------------------
# File-tree scanning
# ---------------------------------------------------------------------------

_SOURCE_EXTS = {".ts", ".tsx", ".js", ".jsx"}


def scan_directory(root: Path) -> list[LimitCall]:
    """Recursively scan *root* for TypeScript/JavaScript source files and
    return all LimitCall instances found."""
    all_calls: list[LimitCall] = []
    for path in sorted(root.rglob("*")):
        if path.suffix in _SOURCE_EXTS and path.is_file():
            try:
                source = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            filename = str(path)
            all_calls.extend(parse_limit_calls(source, filename))
    return all_calls


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Detect frontend limit= values that exceed backend route caps.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "path",
        nargs="?",
        default=None,
        help=(
            "Directory or file to scan.  Defaults to frontend/src relative to "
            "the repo root (inferred from this script's location)."
        ),
    )
    p.add_argument(
        "--json",
        dest="json_output",
        action="store_true",
        help="Output violations as JSON array instead of human-readable text.",
    )
    p.add_argument(
        "--caps",
        metavar="KEY=N",
        nargs="*",
        help=(
            "Override or extend caps, e.g. --caps bookings=200 new-route=50. "
            "Merged on top of ENDPOINT_CAPS."
        ),
    )
    return p


def _parse_caps_overrides(overrides: list[str]) -> dict[str, int]:
    result: dict[str, int] = {}
    for item in overrides or []:
        if "=" not in item:
            print(f"Invalid --caps entry (expected KEY=N): {item!r}", file=sys.stderr)
            sys.exit(2)
        key, _, val = item.partition("=")
        try:
            result[key.strip()] = int(val.strip())
        except ValueError:
            print(f"Invalid --caps value (N must be integer): {item!r}", file=sys.stderr)
            sys.exit(2)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    caps = dict(ENDPOINT_CAPS)
    if args.caps:
        caps.update(_parse_caps_overrides(args.caps))

    # Resolve scan root
    if args.path:
        scan_root = Path(args.path)
    else:
        script_dir = Path(__file__).resolve().parent
        scan_root = script_dir.parent / "frontend" / "src"

    if not scan_root.exists():
        print(f"ERROR: path does not exist: {scan_root}", file=sys.stderr)
        return 2

    calls = scan_directory(scan_root) if scan_root.is_dir() else parse_limit_calls(
        scan_root.read_text(encoding="utf-8", errors="replace"), str(scan_root)
    )
    violations = check_violations(calls, caps)

    if args.json_output:
        print(json.dumps(
            [
                {
                    "file": v.call.filename,
                    "line": v.call.line_no,
                    "url_fragment": v.call.url_fragment,
                    "limit": v.call.limit,
                    "endpoint": v.endpoint,
                    "cap": v.cap,
                }
                for v in violations
            ],
            indent=2,
        ))
    else:
        if violations:
            print(f"API limit violations found ({len(violations)}):")
            for v in violations:
                print(f"  VIOLATION: {v.format()}")
        else:
            scanned = sum(
                1
                for p in (scan_root.rglob("*") if scan_root.is_dir() else [scan_root])
                if p.is_file() and p.suffix in _SOURCE_EXTS
            )
            print(f"OK — no limit violations found (scanned {scanned} source files).")

    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
