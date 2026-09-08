"""Unit tests for scripts/check_api_limits.py.

Tests cover:
- parse_limit_calls: extracts correct (url_fragment, limit, line_no) tuples
- check_violations: flags limits above cap, passes limits at/below cap
- ENDPOINT_CAPS: required caps are present with correct values
- CLI integration via main()
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure scripts/ is importable
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS_DIR))

from check_api_limits import (  # noqa: E402
    ENDPOINT_CAPS,
    LimitCall,
    Violation,
    check_violations,
    main,
    parse_limit_calls,
)


# ---------------------------------------------------------------------------
# ENDPOINT_CAPS — required entries
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


def test_required_caps_present():
    for key, expected in REQUIRED_CAPS.items():
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
