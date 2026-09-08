"""Unit tests for scripts/check_api_limits.py.

Tests cover:
- parse_limit_calls: extracts correct (url_fragment, limit, line_no) tuples
- check_violations: flags limits above cap, passes limits at/below cap
- ENDPOINT_CAPS: required caps are present with correct values (parametrized)
- CLI integration via main()
- _parse_caps_overrides: raises CapParseError on malformed input (testable
  without subprocess overhead — no sys.exit inside the helper)
- Known blind spots: dynamic ``${LIMIT}`` values and URLSearchParams patterns
  are explicitly documented and asserted NOT to be detected
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure scripts/ is importable
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS_DIR))

from check_api_limits import (  # noqa: E402
    ENDPOINT_CAPS,
    CapParseError,
    LimitCall,
    Violation,
    _parse_caps_overrides,
    check_violations,
    main,
    parse_limit_calls,
    scan_directory,
)


# ---------------------------------------------------------------------------
# ENDPOINT_CAPS — required entries (parametrized for clear per-cap failures)
# ---------------------------------------------------------------------------

REQUIRED_CAPS = {
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


@pytest.mark.parametrize("key,expected", list(REQUIRED_CAPS.items()))
def test_required_caps_present(key: str, expected: int) -> None:
    """Each required cap must exist with the correct value.  Parametrized so a
    missing or wrong cap produces a focused single-test failure."""
    assert key in ENDPOINT_CAPS, f"Missing cap entry: '{key}'"
    assert ENDPOINT_CAPS[key] == expected, (
        f"Cap for '{key}' should be {expected}, got {ENDPOINT_CAPS[key]}"
    )


# ---------------------------------------------------------------------------
# parse_limit_calls
# ---------------------------------------------------------------------------

def test_parse_detects_limit_in_double_quoted_url():
    src = 'fetch("/api/v1/rooms?limit=200")'
    calls = parse_limit_calls(src, "test.ts")
    assert len(calls) == 1
    assert calls[0].limit == 200
    assert "rooms" in calls[0].url_fragment
    assert calls[0].line_no == 1


def test_parse_detects_limit_in_template_literal():
    src = 'useQuery(`/api/v1/bookings?limit=100&status=${status}`)'
    calls = parse_limit_calls(src, "test.ts")
    assert len(calls) == 1
    assert calls[0].limit == 100


def test_parse_ignores_non_api_strings():
    """Strings without /api/ must not be flagged."""
    src = 'const cls = "limit=500 something"'
    calls = parse_limit_calls(src, "test.ts")
    assert calls == []


def test_parse_multiple_calls_on_separate_lines():
    src = (
        'client.get("/api/v1/guests?limit=50")\n'
        'client.get("/api/v1/expenses?limit=100")\n'
    )
    calls = parse_limit_calls(src, "test.ts")
    assert len(calls) == 2
    assert calls[0].line_no == 1
    assert calls[1].line_no == 2


def test_parse_multiple_calls_on_same_line():
    """Two limit= values on the SAME line must both be detected.  The regex
    uses finditer so multiple quoted URL literals on one line are each matched
    independently."""
    src = (
        'Promise.all([fetch("/api/v1/guests?limit=50"),'
        ' fetch("/api/v1/rooms?limit=100")])'
    )
    calls = parse_limit_calls(src, "test.ts")
    assert len(calls) == 2
    limits = {c.limit for c in calls}
    assert limits == {50, 100}
    # Both must report the same line number
    assert calls[0].line_no == calls[1].line_no == 1


def test_parse_captures_correct_line_numbers():
    src = "const a = 1;\n" * 4 + 'fetch("/api/v1/invoices?limit=50")\n'
    calls = parse_limit_calls(src, "test.ts")
    assert len(calls) == 1
    assert calls[0].line_no == 5


def test_parse_returns_empty_for_no_limits():
    src = 'fetch("/api/v1/rooms")'
    calls = parse_limit_calls(src, "test.ts")
    assert calls == []


def test_parse_single_quoted_url():
    src = "fetch('/api/v1/team?limit=100')"
    calls = parse_limit_calls(src, "test.ts")
    assert len(calls) == 1
    assert calls[0].limit == 100


# ---------------------------------------------------------------------------
# Known blind spots — asserted NOT to be detected (documented behaviour)
# ---------------------------------------------------------------------------

def test_parse_ignores_dynamic_limit_template_variable():
    """KNOWN BLIND SPOT: ``limit=${pageSize}`` uses a runtime variable, not a
    literal digit — the checker CANNOT detect this.  Test asserts the current
    (intended) behaviour so any future regex change that accidentally starts
    matching it is immediately noticed."""
    src = 'fetch(`/api/v1/bookings?limit=${pageSize}`)'
    calls = parse_limit_calls(src, "test.ts")
    assert calls == [], (
        "Dynamic limit=${variable} should not be detected — "
        "document the blind spot rather than attempting to evaluate it."
    )


def test_parse_ignores_urlsearchparams():
    """KNOWN BLIND SPOT: URLSearchParams patterns set the limit via a separate
    method call, not an inline URL literal — the checker CANNOT detect these.
    Test asserts the current (intended) behaviour."""
    src = (
        "const params = new URLSearchParams();\n"
        "params.set('limit', String(pageSize));\n"
        "fetch(`/api/v1/bookings?${params}`);\n"
    )
    calls = parse_limit_calls(src, "test.ts")
    assert calls == [], (
        "URLSearchParams patterns should not be detected — "
        "document the blind spot rather than attempting to evaluate it."
    )


# ---------------------------------------------------------------------------
# check_violations
# ---------------------------------------------------------------------------

def _make_call(url: str, limit: int, line_no: int = 1) -> LimitCall:
    return LimitCall(filename="test.ts", line_no=line_no, url_fragment=url, limit=limit)


def test_violation_when_limit_exceeds_cap():
    caps = {"bookings": 100}
    calls = [_make_call("/api/v1/bookings?limit=101", 101)]
    violations = check_violations(calls, caps)
    assert len(violations) == 1
    assert violations[0].endpoint == "bookings"
    assert violations[0].cap == 100


def test_no_violation_when_limit_equals_cap():
    caps = {"bookings": 100}
    calls = [_make_call("/api/v1/bookings?limit=100", 100)]
    violations = check_violations(calls, caps)
    assert violations == []


def test_no_violation_when_limit_below_cap():
    caps = {"rooms": 200}
    calls = [_make_call("/api/v1/rooms?limit=50", 50)]
    violations = check_violations(calls, caps)
    assert violations == []


def test_no_violation_for_unknown_endpoint():
    """Endpoints not in the caps table must not be flagged."""
    caps = {"bookings": 100}
    calls = [_make_call("/api/v1/unknown-route?limit=9999", 9999)]
    violations = check_violations(calls, caps)
    assert violations == []


def test_multiple_violations():
    caps = {"bookings": 100, "guests": 100}
    calls = [
        _make_call("/api/v1/bookings?limit=200", 200),
        _make_call("/api/v1/guests?limit=150", 150),
        _make_call("/api/v1/guests?limit=50", 50),  # OK
    ]
    violations = check_violations(calls, caps)
    assert len(violations) == 2


def test_specificity_longer_key_wins():
    """super-admin/hotels is more specific than just 'hotels' if both were present."""
    caps = {"hotels": 50, "super-admin/hotels": 100}
    # URL matches both keys; the longer one should win
    calls = [_make_call("/api/v1/super-admin/hotels?limit=75", 75)]
    violations = check_violations(calls, caps)
    # 75 <= 100 (super-admin/hotels cap) → no violation
    assert violations == []


def test_specificity_shorter_key_would_flag():
    """If super-admin/hotels key is absent, fall back to 'hotels'."""
    caps = {"hotels": 50}
    calls = [_make_call("/api/v1/super-admin/hotels?limit=75", 75)]
    violations = check_violations(calls, caps)
    # 75 > 50 (hotels cap) → violation
    assert len(violations) == 1
    assert violations[0].endpoint == "hotels"


def test_current_guests_cap_at_200():
    """Regression test: current-guests cap must be 200 (the 3305ac4 fix)."""
    calls = [_make_call("/api/v1/current-guests?limit=200", 200)]
    violations = check_violations(calls, ENDPOINT_CAPS)
    assert violations == [], "limit=200 on current-guests must not be a violation"


def test_current_guests_cap_exceeded_at_201():
    calls = [_make_call("/api/v1/current-guests?limit=201", 201)]
    violations = check_violations(calls, ENDPOINT_CAPS)
    assert len(violations) == 1
    assert violations[0].endpoint == "current-guests"


# ---------------------------------------------------------------------------
# Violation.format() output
# ---------------------------------------------------------------------------

def test_violation_format_contains_key_fields():
    call = _make_call("/api/v1/bookings?limit=200", 200, line_no=42)
    v = Violation(call=call, endpoint="bookings", cap=100)
    fmt = v.format()
    assert "42" in fmt        # line number
    assert "200" in fmt       # actual limit
    assert "100" in fmt       # cap
    assert "bookings" in fmt  # endpoint name


# ---------------------------------------------------------------------------
# _parse_caps_overrides — testable without sys.exit
# ---------------------------------------------------------------------------

def test_parse_caps_valid():
    result = _parse_caps_overrides(["bookings=200", "rooms=500"])
    assert result == {"bookings": 200, "rooms": 500}


def test_parse_caps_strips_whitespace():
    result = _parse_caps_overrides([" bookings = 200 "])
    assert result == {"bookings": 200}


def test_parse_caps_empty_list():
    assert _parse_caps_overrides([]) == {}


def test_parse_caps_none():
    assert _parse_caps_overrides(None) == {}  # type: ignore[arg-type]


def test_parse_caps_invalid_no_equals_raises():
    """Missing '=' must raise CapParseError, NOT call sys.exit."""
    with pytest.raises(CapParseError, match="expected KEY=N"):
        _parse_caps_overrides(["no-equals-sign"])


def test_parse_caps_invalid_non_integer_raises():
    """Non-integer value must raise CapParseError, NOT call sys.exit."""
    with pytest.raises(CapParseError, match="must be integer"):
        _parse_caps_overrides(["rooms=abc"])


# ---------------------------------------------------------------------------
# CLI integration via main()
# ---------------------------------------------------------------------------

def test_main_exits_0_on_no_violations(tmp_path: Path):
    f = tmp_path / "page.ts"
    f.write_text('fetch("/api/v1/bookings?limit=50")', encoding="utf-8")
    rc = main([str(tmp_path)])
    assert rc == 0


def test_main_exits_1_on_violation(tmp_path: Path):
    f = tmp_path / "page.ts"
    f.write_text('fetch("/api/v1/bookings?limit=999")', encoding="utf-8")
    rc = main([str(tmp_path)])
    assert rc == 1


def test_main_exits_2_on_missing_path():
    rc = main(["/nonexistent/path/that/does/not/exist"])
    assert rc == 2


def test_main_json_output(tmp_path: Path, capsys):
    f = tmp_path / "page.tsx"
    f.write_text('client.get("/api/v1/guests?limit=200")', encoding="utf-8")
    rc = main([str(tmp_path), "--json"])
    captured = capsys.readouterr()
    import json as _json
    data = _json.loads(captured.out)
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["limit"] == 200
    assert data[0]["cap"] == 100
    assert rc == 1


def test_main_caps_override(tmp_path: Path):
    """--caps should allow raising a cap to permit a higher limit."""
    f = tmp_path / "page.tsx"
    f.write_text('fetch("/api/v1/bookings?limit=150")', encoding="utf-8")
    # Default cap is 100 → violation; override to 200 → OK
    rc = main([str(tmp_path), "--caps", "bookings=200"])
    assert rc == 0


def test_main_caps_add_new_endpoint(tmp_path: Path):
    """Adding a new cap entry for an unknown endpoint should flag violations."""
    f = tmp_path / "page.tsx"
    f.write_text('fetch("/api/v1/new-route?limit=999")', encoding="utf-8")
    # Without the override: no violation (endpoint unknown)
    rc_no_cap = main([str(tmp_path)])
    assert rc_no_cap == 0
    # With the override: violation flagged
    rc_with_cap = main([str(tmp_path), "--caps", "new-route=50"])
    assert rc_with_cap == 1


def test_main_invalid_caps_entry_returns_2(tmp_path: Path):
    """A malformed --caps entry (no '=') must produce exit code 2, not raise."""
    f = tmp_path / "page.ts"
    f.write_text('fetch("/api/v1/bookings?limit=50")', encoding="utf-8")
    rc = main([str(tmp_path), "--caps", "no-equals-sign"])
    assert rc == 2


def test_main_invalid_caps_value_returns_2(tmp_path: Path):
    """A --caps entry with a non-integer value must produce exit code 2, not raise."""
    f = tmp_path / "page.ts"
    f.write_text('fetch("/api/v1/bookings?limit=50")', encoding="utf-8")
    rc = main([str(tmp_path), "--caps", "bookings=not-a-number"])
    assert rc == 2


# ---------------------------------------------------------------------------
# scan_directory — returns (calls, file_count) tuple
# ---------------------------------------------------------------------------

def test_scan_directory_returns_tuple(tmp_path: Path):
    """scan_directory must return a (list, int) tuple."""
    f = tmp_path / "page.ts"
    f.write_text('fetch("/api/v1/bookings?limit=50")', encoding="utf-8")
    result = scan_directory(tmp_path)
    assert isinstance(result, tuple) and len(result) == 2
    calls, count = result
    assert isinstance(calls, list)
    assert isinstance(count, int)


def test_scan_directory_counts_source_files(tmp_path: Path):
    """file_count must equal the number of TS/TSX/JS/JSX files in the tree,
    regardless of whether they contain any limit= calls."""
    (tmp_path / "a.ts").write_text('fetch("/api/v1/bookings?limit=50")', encoding="utf-8")
    (tmp_path / "b.tsx").write_text("export const x = 1;", encoding="utf-8")  # no limit
    (tmp_path / "c.py").write_text("# not a JS file", encoding="utf-8")       # ignored
    _, count = scan_directory(tmp_path)
    assert count == 2  # only .ts and .tsx
