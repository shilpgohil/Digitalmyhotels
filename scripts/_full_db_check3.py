# -*- coding: utf-8 -*-
"""Full DB + API verification."""
import sys, json, urllib.request, urllib.error
from datetime import date

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://digitalmyhotels-api-sg.onrender.com"
NEON_SYNC = (
    "host=ep-royal-cell-azlddqmb-pooler.c-3.ap-southeast-1.aws.neon.tech "
    "dbname=neondb user=neondb_owner password=npg_XS48EVkFOGQr "
    "sslmode=require connect_timeout=30"
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
            raw = r.read(); return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except: return e.code, {"error": raw.decode("utf-8","replace")[:400]}
    except Exception as exc:
        return 0, {"error": str(exc)}

import psycopg2, psycopg2.extras
conn = psycopg2.connect(NEON_SYNC)
conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

def db(sql, params=()):
    try: cur.execute(sql, params); return [dict(r) for r in cur.fetchall()]
    except Exception as ex: print(f"  SQL ERR: {ex}"); return []

today = date.today()
print("DB connected OK. Today =", today)

# ══════════════════════════════════════════════════════════════
print("\n=== 1. ALL HOTELS — STATUS + SUBSCRIPTION ===")
rows = db("""
    SELECT
        h.id::text, h.name, h.status,
        s.status AS sub_status,
        s.expiry_date,
        s.grace_days,
        (s.expiry_date + (COALESCE(s.grace_days,7) || ' days')::interval)::date AS grace_end,
        (s.expiry_date - CURRENT_DATE) AS days_until_exp,
        (CURRENT_DATE - s.expiry_date) AS days_past_exp,
        CURRENT_DATE > (s.expiry_date + (COALESCE(s.grace_days,7) || ' days')::interval)::date AS truly_expired
    FROM hotels h
    LEFT JOIN LATERAL (
        SELECT * FROM subscriptions WHERE hotel_id = h.id
        ORDER BY created_at DESC LIMIT 1
    ) s ON TRUE
    ORDER BY s.expiry_date NULLS LAST
""")
for h in rows:
    expiry = h.get("expiry_date")
    grace_end = h.get("grace_end")
    truly = h.get("truly_expired")
    sub_s = h.get("sub_status") or "NO_SUB"
    # days are integers from psycopg2 (interval days)
    days_until_raw = h.get("days_until_exp")
    days_past_raw = h.get("days_past_exp")
    days_until = days_until_raw.days if hasattr(days_until_raw, "days") else (days_until_raw or 0)
    days_past  = days_past_raw.days  if hasattr(days_past_raw,  "days") else (days_past_raw  or 0)

    if expiry is None:
        flag = "[NO_SUBSCRIPTION — always accessible]"
    elif truly:
        flag = f"[TRULY EXPIRED — {days_past}d past grace_end={grace_end}]"
    elif expiry < today:
        left = (grace_end - today).days if grace_end else "?"
        flag = f"[IN GRACE — {left}d left until hard block]"
    elif days_until <= 7:
        flag = f"[EXPIRING SOON — {days_until}d]"
    else:
        flag = f"[ACTIVE — {days_until}d left]"
    print(f"  {h['name'][:30]:30} hotel={h['status']:10} sub={sub_s:14} {flag}")


# ══════════════════════════════════════════════════════════════
print("\n=== 2. SUPER ADMIN ACCOUNTS ===")
sa_rows = db("SELECT email, full_name, is_active, must_reset_password FROM users WHERE is_super_admin=TRUE ORDER BY created_at")
for u in sa_rows:
    print(f"  {u['email']:45} | {u['full_name']:20} | active={u['is_active']} must_reset={u['must_reset_password']}")
if not sa_rows:
    print("  (none found)")


# ══════════════════════════════════════════════════════════════
print("\n=== 3. SA API LOGIN ===")
sa_token = None
for u in sa_rows:
    for pwd in ["Admin@12345", "SuperAdmin@12345", "SuperAdmin@123", "Platform@123", "ChangeMe123!", "Admin123#"]:
        s, d = http("POST", "/api/v1/auth/login", {"email": u["email"], "password": pwd})
        if s == 200 and (d.get("user") or {}).get("is_super_admin"):
            sa_token = d["access_token"]
            print(f"  SA login OK: {u['email']} / {pwd}")
            break
    if sa_token: break

if sa_token:
    sd, dash = http("GET", "/api/v1/super-admin/dashboard", token=sa_token)
    if sd == 200:
        print(f"  Dashboard: total={dash.get('total_hotels')} active={dash.get('active_hotels')} "
              f"expired={dash.get('expired_hotels')} recently_expired={dash.get('recently_expired')} "
              f"expiring_soon={dash.get('expiring_soon')}")

    se, exph = http("GET", "/api/v1/super-admin/hotels?status=expired&recent_days=30&expiring_within=7&limit=100", token=sa_token)
    print(f"  Expired/expiring list: {exph.get('total')} hotels")
    for h in (exph.get("items") or []):
        ex = h.get("expiry_date")
        days = (date.fromisoformat(ex) - today).days if ex else None
        print(f"    '{h.get('name')}' hotel={h.get('status')} sub={h.get('subscription_status')} days_until_exp={days}")
else:
    print("  SA login failed with all tried passwords")


# ══════════════════════════════════════════════════════════════
print("\n=== 4. ENFORCEMENT CHECK — expired+past-grace but hotel.status='active' ===")
exp_check = db("""
    SELECT h.name, h.status,
           s.expiry_date, s.grace_days,
           (s.expiry_date + (COALESCE(s.grace_days,7)||' days')::interval)::date AS grace_end
    FROM hotels h
    JOIN LATERAL (
        SELECT * FROM subscriptions WHERE hotel_id=h.id ORDER BY created_at DESC LIMIT 1
    ) s ON TRUE
    WHERE CURRENT_DATE > (s.expiry_date + (COALESCE(s.grace_days,7)||' days')::interval)::date
      AND h.status = 'active'
""")
if exp_check:
    print(f"  WARNING: {len(exp_check)} hotel(s) past grace but still 'active':")
    for h in exp_check:
        print(f"    {h['name']} | expiry={h['expiry_date']} | grace_end={h['grace_end']}")
else:
    print("  OK: No hotels past grace+expiry that are still marked active")


# ══════════════════════════════════════════════════════════════
print("\n=== 5. IN-GRACE HOTELS (sub lapsed but still within grace window) ===")
grace_rows = db("""
    SELECT h.name, h.status, s.expiry_date, s.grace_days,
           (s.expiry_date + (COALESCE(s.grace_days,7)||' days')::interval)::date AS grace_end
    FROM hotels h
    JOIN LATERAL (
        SELECT * FROM subscriptions WHERE hotel_id=h.id ORDER BY created_at DESC LIMIT 1
    ) s ON TRUE
    WHERE CURRENT_DATE > s.expiry_date
      AND CURRENT_DATE <= (s.expiry_date + (COALESCE(s.grace_days,7)||' days')::interval)::date
""")
for h in grace_rows:
    left = (h["grace_end"] - today).days
    print(f"  {h['name']} | hotel={h['status']} | expiry={h['expiry_date']} | grace_end={h['grace_end']} | {left}d left")
if not grace_rows:
    print("  (none currently in grace period)")


# ══════════════════════════════════════════════════════════════
print("\n=== 6. GUEST DUPLICATES (same name per hotel) ===")
dups = db("""
    SELECT h.name AS hotel, g.full_name, COUNT(*) AS cnt,
           array_agg(g.normalized_phone ORDER BY g.created_at) AS phones
    FROM guests g JOIN hotels h ON h.id=g.hotel_id
    GROUP BY h.name, LOWER(g.full_name)
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC LIMIT 20
""")
for d in dups:
    print(f"  '{d['full_name']}' in '{d['hotel']}': {d['cnt']}x phones={d['phones']}")
if not dups:
    print("  No duplicate guest names within any hotel")


# ══════════════════════════════════════════════════════════════
print("\n=== 7. ROOM STATUS BREAKDOWN ===")
room_rows = db("""
    SELECT h.name, r.status, COUNT(*) AS cnt
    FROM rooms r JOIN hotels h ON h.id=r.hotel_id
    GROUP BY h.name, r.status ORDER BY h.name, r.status
""")
for r in room_rows:
    print(f"  {r['name'][:28]:28} | {r['status']:25} | {r['cnt']}")


# ══════════════════════════════════════════════════════════════
print("\n=== 8. GUEST DOCUMENTS ===")
doc_rows = db("""
    SELECT h.name, d.side, COUNT(*) AS cnt
    FROM guest_documents d JOIN hotels h ON h.id=d.hotel_id
    GROUP BY h.name, d.side ORDER BY h.name, d.side
""")
for r in doc_rows:
    print(f"  {r['name'][:28]:28} | {r['side']:10} | {r['cnt']}")


# ══════════════════════════════════════════════════════════════
print("\n=== 9. INVOICE SUMMARY ===")
inv_rows = db("""
    SELECT h.name, i.status, COUNT(*) AS cnt
    FROM invoices i JOIN hotels h ON h.id=i.hotel_id
    GROUP BY h.name, i.status ORDER BY h.name, i.status
""")
for r in inv_rows:
    print(f"  {r['name'][:28]:28} | {r['status']:12} | {r['cnt']}")


# ══════════════════════════════════════════════════════════════
print("\n=== 10. CURRENT IN-HOUSE GUESTS ===")
inhouse = db("""
    SELECT h.name, COUNT(*) AS cnt
    FROM bookings b JOIN hotels h ON h.id=b.hotel_id
    WHERE b.status='checked_in'
    GROUP BY h.name ORDER BY cnt DESC
""")
for r in inhouse:
    print(f"  {r['name']:30} | {r['cnt']} in-house")
if not inhouse:
    print("  (no guests currently checked in)")


# ══════════════════════════════════════════════════════════════
print("\n=== 11. DRAFT DOCUMENTS ===")
draft_rows = db("""
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER(WHERE created_at < NOW()-INTERVAL '7 days') AS older_7d
    FROM guest_draft_documents
""")
if draft_rows:
    r = draft_rows[0]
    print(f"  Total: {r['total']} | Older than 7d (pending sweep): {r['older_7d']}")


conn.close()
print("\n=== COMPLETE ===")
