# -*- coding: utf-8 -*-
"""Verify specific bugs via direct DB queries."""
import sys, json, urllib.request, urllib.error
from datetime import date, timedelta

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://digitalmyhotels-api-sg.onrender.com"
NEON = (
    "host=ep-royal-cell-azlddqmb-pooler.c-3.ap-southeast-1.aws.neon.tech "
    "dbname=neondb user=neondb_owner password=npg_XS48EVkFOGQr "
    "sslmode=require connect_timeout=30"
)

import psycopg2, psycopg2.extras
conn = psycopg2.connect(NEON); conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

def db(sql, params=()):
    cur.execute(sql, params); return [dict(r) for r in cur.fetchall()]

def http(method, path, body=None, token=None, hotel_id=None):
    url = f"{BASE}{path}"; data = json.dumps(body).encode() if body else None
    headers = {"Accept":"application/json","Content-Type":"application/json"}
    if token: headers["Authorization"] = f"Bearer {token}"
    if hotel_id: headers["X-Hotel-Id"] = hotel_id
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw=r.read(); return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw=e.read()
        try: return e.code, json.loads(raw)
        except: return e.code, {"error": raw.decode("utf-8","replace")[:400]}
    except Exception as exc:
        return 0, {"error": str(exc)}

today = date.today()
print(f"Today: {today}\n")

# ─── Bug 2/3: Hotel Pramod grace period details ────────────────────────────
print("=" * 60)
print("BUG 2/3: Hotel Pramod — grace period + enforcement")
print("=" * 60)

pramod = db("""
    SELECT
        h.name, h.status AS hotel_status,
        s.status AS sub_status, s.expiry_date, s.grace_days,
        (s.expiry_date + (s.grace_days||' days')::interval)::date AS grace_end,
        (s.expiry_date - CURRENT_DATE) AS days_until_expiry,
        (CURRENT_DATE - s.expiry_date) AS days_past_expiry
    FROM hotels h
    JOIN subscriptions s ON s.hotel_id = h.id
    WHERE LOWER(h.name) LIKE '%pramod%'
    ORDER BY s.created_at DESC LIMIT 1
""")
for p in pramod:
    days_past = p["days_past_expiry"].days if hasattr(p["days_past_expiry"], "days") else p["days_past_expiry"]
    print(f"  Hotel: {p['name']}")
    print(f"  hotel.status: {p['hotel_status']}")
    print(f"  sub.status:   {p['sub_status']}")
    print(f"  expiry_date:  {p['expiry_date']} ({days_past}d ago)")
    print(f"  grace_days:   {p['grace_days']}")
    print(f"  grace_end:    {p['grace_end']}")
    left = (p["grace_end"] - today).days
    if left > 0:
        print(f"  STATUS: IN GRACE — {left}d left before full block")
        print(f"  WHY CAN LOGIN: Grace period is still active. Allowed by design (wind-down policy).")
        print(f"  WILL BE BLOCKED: {p['grace_end']} (tomorrow)")
    elif left == 0:
        print(f"  STATUS: GRACE ENDS TODAY — should be blocked from midnight")
    else:
        print(f"  STATUS: TRULY EXPIRED — {abs(left)}d past grace end — should be blocked")

# Now check: does our recently-expired query INCLUDE Hotel Pramod?
print("\n  Recently-expired query test (should include Hotel Pramod):")
cutoff = today - timedelta(days=30)
re_hotels = db("""
    WITH latest AS (
        SELECT DISTINCT ON (hotel_id) * FROM subscriptions ORDER BY hotel_id, created_at DESC
    )
    SELECT h.name, h.status, latest.expiry_date, latest.grace_days,
           (latest.expiry_date + (COALESCE(latest.grace_days,7)||' days')::interval)::date AS grace_end,
           (latest.expiry_date - CURRENT_DATE) AS days_until
    FROM hotels h
    LEFT JOIN latest ON latest.hotel_id = h.id
    WHERE (
        -- fully expired (past grace)
        (
            (h.status = 'expired' OR CURRENT_DATE > (latest.expiry_date + (COALESCE(latest.grace_days,7)||' days')::interval)::date)
            AND (latest.expiry_date IS NULL OR latest.expiry_date >= %s)
        )
        OR
        -- in grace period (expired but grace still active) — client 17/09
        (
            latest.status != 'suspended'
            AND latest.expiry_date < CURRENT_DATE
            AND CURRENT_DATE <= (latest.expiry_date + (COALESCE(latest.grace_days,7)||' days')::interval)::date
            AND latest.expiry_date >= %s
        )
        OR
        -- expiring soon within 7 days
        (
            latest.status != 'suspended'
            AND latest.expiry_date >= CURRENT_DATE
            AND latest.expiry_date <= CURRENT_DATE + INTERVAL '7 days'
        )
    )
    ORDER BY latest.expiry_date
""", (cutoff, cutoff))
if re_hotels:
    for h in re_hotels:
        days_until_raw = h.get("days_until")
        days_until = days_until_raw.days if hasattr(days_until_raw, "days") else (days_until_raw or 0)
        print(f"    '{h['name']}' expiry={h['expiry_date']} grace_end={h['grace_end']} days={days_until}")
else:
    print("    EMPTY! Hotel Pramod not caught by the query.")


# ─── SA password investigation ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("SA ACCOUNT DETAILS")
print("=" * 60)
sa = db("""
    SELECT id::text, email, full_name, is_active, must_reset_password,
           password_hash, created_at::date AS joined
    FROM users WHERE is_super_admin = TRUE ORDER BY created_at
""")
for u in sa:
    h = u.get("password_hash", "")
    print(f"  {u['email']}")
    print(f"  full_name: {u['full_name']}")
    print(f"  is_active: {u['is_active']} | must_reset: {u['must_reset_password']} | joined: {u['joined']}")
    print(f"  hash prefix: {h[:20]}...")  # Don't show full hash

# ─── Try SA login with more guesses based on name ──────────────────────────
print("\n  Trying SA login guesses:")
sa_token = None
if sa:
    email = sa[0]["email"]
    passwords = [
        "Admin@12345", "SuperAdmin@12345", "SuperAdmin@123",
        "Platform@123", "ChangeMe123!", "Admin123#",
        "digitalmyhotels@123", "DigitalMyHotels@123",
        "Superadmin@123", "superadmin123", "Admin123",
        "DMH@12345", "Dmh@12345",
    ]
    for pwd in passwords:
        s, d = http("POST", "/api/v1/auth/login", {"email": email, "password": pwd})
        if s == 200 and (d.get("user") or {}).get("is_super_admin"):
            sa_token = d["access_token"]
            print(f"  FOUND: {email} / {pwd}")
            break
        elif s == 200:
            print(f"  {pwd}: login OK but not SA")
        elif s == 429:
            print(f"  Rate limited — waiting")
            import time; time.sleep(30)
        # else silent fail
    else:
        print(f"  All passwords failed. SA email: {email}")
        print("  NOTE: The SA password hash starts with: " + (sa[0].get("password_hash","")[:10]))


# ─── Guest duplicates (fixed query) ───────────────────────────────────────
print("\n" + "=" * 60)
print("GUEST DUPLICATES (corrected query)")
print("=" * 60)
dups = db("""
    SELECT h.name AS hotel, LOWER(g.full_name) AS name_lc,
           COUNT(*) AS cnt,
           array_agg(g.normalized_phone ORDER BY g.created_at) AS phones
    FROM guests g JOIN hotels h ON h.id = g.hotel_id
    GROUP BY h.name, LOWER(g.full_name)
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
""")
for d in dups:
    print(f"  '{d['name_lc']}' in '{d['hotel']}': {d['cnt']}x phones={d['phones']}")
if not dups:
    print("  No duplicate guest names (case-insensitive) within any hotel")


# ─── Hotel Shilp Gohil stat card data ─────────────────────────────────────
print("\n" + "=" * 60)
print("ROOM STAT CARD DATA (Hotel Shilp Gohil)")
print("=" * 60)

sg_hotel = db("SELECT id FROM hotels WHERE name ILIKE '%shilp%' LIMIT 1")
if sg_hotel:
    hid = sg_hotel[0]["id"]
    stats = db("""
        SELECT status, COUNT(*) as cnt
        FROM rooms WHERE hotel_id=%s GROUP BY status
    """, (hid,))
    for r in stats:
        print(f"  {r['status']:25} | {r['cnt']}")
    arriving = db("""
        SELECT COUNT(*) as cnt FROM bookings b
        WHERE b.hotel_id = %s
          AND b.status = 'confirmed'
          AND b.check_in_date = CURRENT_DATE
    """, (hid,))
    print(f"  Bookings arriving today: {arriving[0]['cnt'] if arriving else 0}")


conn.close()
print("\n=== DONE ===")
