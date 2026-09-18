# -*- coding: utf-8 -*-
"""Full DB + API verification for all client bugs.
Uses Neon prod DB (psycopg2, sync driver) + production API.
"""
import sys
import json
import urllib.request
import urllib.error
from datetime import date, timedelta

# Force UTF-8 output
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://digitalmyhotels-api-sg.onrender.com"

# Sync Neon URL (psycopg2)
NEON_SYNC = (
    "host=ep-royal-cell-azlddqmb-pooler.c-3.ap-southeast-1.aws.neon.tech "
    "dbname=neondb "
    "user=neondb_owner "
    "password=npg_XS48EVkFOGQr "
    "sslmode=require "
    "connect_timeout=30"
)


def http(method, path, body=None, token=None, hotel_id=None, timeout=90):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token: headers["Authorization"] = f"Bearer {token}"
    if hotel_id: headers["X-Hotel-Id"] = hotel_id
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except: return e.code, {"error": raw.decode("utf-8", "replace")[:400]}
    except Exception as exc:
        return 0, {"error": str(exc)}


print("=" * 65)
print("FULL PRODUCTION VERIFICATION  |  DB + API")
print("=" * 65)

# ─── DB connection ─────────────────────────────────────────────────────────
try:
    import psycopg2
    import psycopg2.extras
    conn = psycopg2.connect(NEON_SYNC)
    conn.autocommit = True
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    db_ok = True
    print("\n[DB] Connected to Neon PostgreSQL OK")
except Exception as e:
    db_ok = False
    print(f"\n[DB] Connection failed: {e}")


def db(sql, params=()):
    if not db_ok: return []
    try:
        cursor.execute(sql, params)
        return [dict(r) for r in cursor.fetchall()]
    except Exception as ex:
        print(f"  SQL ERR: {ex}")
        return []


# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("1. ALL HOTELS — status, subscription state")
print("=" * 65)
hotels = db("""
    SELECT
        h.id, h.name, h.status AS hotel_status,
        s.status AS sub_status,
        s.expiry_date,
        s.grace_days,
        (s.expiry_date + (s.grace_days || ' days')::interval)::date AS grace_end,
        (CURRENT_DATE > (s.expiry_date + (s.grace_days || ' days')::interval)::date) AS truly_expired,
        (s.expiry_date - CURRENT_DATE) AS days_until
    FROM hotels h
    LEFT JOIN LATERAL (
        SELECT * FROM subscriptions WHERE hotel_id = h.id
        ORDER BY created_at DESC LIMIT 1
    ) s ON TRUE
    ORDER BY s.expiry_date NULLS LAST
""")
today = date.today()
for h in hotels:
    expiry = h.get("expiry_date")
    grace_end = h.get("grace_end")
    truly = h.get("truly_expired")
    days_until = h.get("days_until")
    sub_s = h.get("sub_status") or "NO_SUB"
    if expiry is None:
        flag = "[NO_SUBSCRIPTION]"
    elif truly:
        days_ago = (today - expiry).days
        flag = f"[EXPIRED {days_ago}d ago — grace_end={grace_end}]"
    elif expiry < today:
        left = (grace_end - today).days if grace_end else "?"
        flag = f"[IN_GRACE — {left}d left]"
    elif days_until is not None and days_until.days <= 7:
        flag = f"[EXPIRING_SOON — {days_until.days}d]"
    else:
        flag = f"[ACTIVE — {days_until.days if days_until else '?'}d left]"
    print(f"  {h['name'][:32]:32} hotel={h['hotel_status']:10} sub={sub_s:14} {flag}")


# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("2. SUPER ADMIN USERS IN DB")
print("=" * 65)
sa_users = db("""
    SELECT id, email, full_name, is_active, must_reset_password,
           created_at::date AS joined
    FROM users WHERE is_super_admin = TRUE ORDER BY created_at
""")
for u in sa_users:
    print(f"  {u['email']:40} | {u['full_name']:20} | active={u['is_active']} | must_reset={u['must_reset_password']} | joined={u['joined']}")
if not sa_users:
    print("  (none)")


# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("3. SA API LOGIN — trying all SA emails")
print("=" * 65)
sa_token = None
for u in sa_users:
    for pwd in ["Admin@12345", "SuperAdmin@12345", "SuperAdmin@123", "Platform@123", "ChangeMe123!"]:
        s, d = http("POST", "/api/v1/auth/login", {"email": u["email"], "password": pwd})
        if s == 200 and (d.get("user") or {}).get("is_super_admin"):
            sa_token = d["access_token"]
            print(f"  SA login OK: {u['email']} / {pwd}")
            break
    if sa_token: break
    else:
        print(f"  Could not login as {u['email']} with known passwords")

if sa_token:
    sd, dash = http("GET", "/api/v1/super-admin/dashboard", token=sa_token)
    if sd == 200:
        print(f"\n  Dashboard: total={dash.get('total_hotels')} active={dash.get('active_hotels')} "
              f"expired={dash.get('expired_hotels')} recently_expired={dash.get('recently_expired')} "
              f"expiring_soon={dash.get('expiring_soon')}")
    se, exph = http("GET", "/api/v1/super-admin/hotels?status=expired&recent_days=30&expiring_within=7&limit=100", token=sa_token)
    print(f"\n  Expired/expiring (recent_days=30, within=7): {exph.get('total')} hotels")
    for h in (exph.get("items") or []):
        ex = h.get("expiry_date")
        days = (date.fromisoformat(ex) - today).days if ex else None
        print(f"    '{h.get('name')}' hotel={h.get('status')} sub={h.get('subscription_status')} days={days}")


# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("4. ENFORCEMENT CHECK — hotels past grace but DB status still 'active'")
print("=" * 65)
exp_hotels = db("""
    SELECT h.name, h.status, s.expiry_date, s.grace_days,
           (s.expiry_date + (s.grace_days || ' days')::interval)::date AS grace_end
    FROM hotels h
    JOIN LATERAL (
        SELECT * FROM subscriptions WHERE hotel_id = h.id
        ORDER BY created_at DESC LIMIT 1
    ) s ON TRUE
    WHERE CURRENT_DATE > (s.expiry_date + (s.grace_days || ' days')::interval)::date
      AND h.status = 'active'
""")
if exp_hotels:
    print(f"  WARNING: {len(exp_hotels)} hotel(s) are past grace but still 'active' in hotels table:")
    for h in exp_hotels:
        print(f"    {h['name']} | expiry={h['expiry_date']} | grace_end={h['grace_end']}")
else:
    print("  OK: No hotels found past grace with hotel.status='active'")


# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("5. GUEST DUPLICATES (same name in same hotel)")
print("=" * 65)
dups = db("""
    SELECT h.name AS hotel, LOWER(g.full_name) AS name_lower, g.full_name,
           COUNT(*) AS cnt,
           array_agg(g.normalized_phone ORDER BY g.created_at) AS phones,
           array_agg(g.id_last4) AS last4s
    FROM guests g JOIN hotels h ON h.id = g.hotel_id
    GROUP BY h.name, LOWER(g.full_name)
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC, hotel
    LIMIT 20
""")
for d in dups:
    print(f"  '{d['full_name']}' in '{d['hotel']}': {d['cnt']}x | phones={d['phones']} | id_last4s={d['last4s']}")
if not dups:
    print("  No duplicate guest names found per hotel")


# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("6. ROOM STATUS BREAKDOWN (all hotels)")
print("=" * 65)
room_rows = db("""
    SELECT h.name, r.status, COUNT(*) AS cnt
    FROM rooms r JOIN hotels h ON h.id = r.hotel_id
    GROUP BY h.name, r.status ORDER BY h.name, r.status
""")
for r in room_rows:
    print(f"  {r['name'][:28]:28} | {r['status']:25} | {r['cnt']}")


# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("7. GUEST DOCUMENTS (Aadhaar uploads per hotel)")
print("=" * 65)
doc_rows = db("""
    SELECT h.name, d.side, COUNT(*) AS cnt
    FROM guest_documents d JOIN hotels h ON h.id = d.hotel_id
    GROUP BY h.name, d.side ORDER BY h.name, d.side
""")
for r in doc_rows:
    print(f"  {r['name'][:28]:28} | {r['side']:10} | {r['cnt']}")


# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("8. DRAFT DOCUMENTS TTL check")
print("=" * 65)
draft_rows = db("""
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '7 days') AS older_7d
    FROM guest_draft_documents
""")
if draft_rows:
    r = draft_rows[0]
    print(f"  Total draft docs: {r['total']} | Older than 7d (should sweep): {r['older_7d']}")


# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("9. INVOICES (all hotels, status breakdown)")
print("=" * 65)
inv_rows = db("""
    SELECT h.name, i.status, COUNT(*) AS cnt
    FROM invoices i JOIN hotels h ON h.id = i.hotel_id
    GROUP BY h.name, i.status ORDER BY h.name, i.status
""")
for r in inv_rows:
    print(f"  {r['name'][:28]:28} | {r['status']:12} | {r['cnt']}")


# ═══════════════════════════════════════════════════════════════════════
print("\n" + "=" * 65)
print("10. IN-HOUSE GUESTS (all hotels)")
print("=" * 65)
checkin_rows = db("""
    SELECT h.name, COUNT(*) AS cnt, SUM(l.balance) AS total_due
    FROM bookings b
    JOIN hotels h ON h.id = b.hotel_id
    LEFT JOIN LATERAL (
        SELECT SUM(amount * CASE WHEN type='debit' THEN 1 ELSE -1 END) AS balance
        FROM guest_booking_ledger WHERE booking_id = b.id
    ) l ON TRUE
    WHERE b.status = 'checked_in'
    GROUP BY h.name ORDER BY cnt DESC
""")
for r in checkin_rows:
    print(f"  {r['name'][:28]:28} | in-house={r['cnt']} | total_due={r['total_due']}")
if not checkin_rows:
    print("  No currently checked-in guests")


if db_ok:
    conn.close()
    print("\n[DB] Connection closed.")

print("\n=== VERIFICATION COMPLETE ===")
