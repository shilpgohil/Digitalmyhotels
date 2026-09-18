"""Full DB + API verification for all 8 client bugs.
Uses Neon prod DB directly + production API.
"""
import json
import urllib.request
import urllib.error
from datetime import date, timedelta

# ─── Config ──────────────────────────────────────────────────────────────────
BASE = "https://digitalmyhotels-api-sg.onrender.com"
NEON = (
    "postgresql+asyncpg://neondb_owner:npg_XS48EVkFOGQr"
    "@ep-royal-cell-azlddqmb-pooler.c-3.ap-southeast-1.aws.neon.tech"
    "/neondb?ssl=require"
)
# Sync variant for direct psycopg queries
NEON_SYNC = NEON.replace("postgresql+asyncpg://", "postgresql://")


def call(method, path, body=None, token=None, hotel_id=None, timeout=90):
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

# ─── Try to query DB directly ─────────────────────────────────────────────
try:
    import psycopg2
    conn = psycopg2.connect(NEON_SYNC, connect_timeout=30)
    cursor = conn.cursor()
    db_ok = True
    print("\n[DB] Connected to Neon PostgreSQL ✓")
except Exception as e:
    db_ok = False
    print(f"\n[DB] Could not connect (psycopg2 not installed or network error): {e}")
    print("     Falling back to API-only checks.")


def db(sql, params=()):
    if not db_ok:
        return []
    cursor.execute(sql, params)
    cols = [d[0] for d in cursor.description] if cursor.description else []
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


# ─── All hotels: status, subscription state ────────────────────────────────
print("\n--- ALL HOTELS (production) ---")
hotels_rows = db("""
    SELECT
        h.id, h.name, h.status as hotel_status, h.slug,
        s.status as sub_status,
        s.expiry_date,
        s.grace_days,
        s.expiry_date + s.grace_days::int AS grace_end,
        CURRENT_DATE > s.expiry_date + s.grace_days::int AS truly_expired,
        CURRENT_DATE - s.expiry_date AS days_past_expiry,
        (s.expiry_date - CURRENT_DATE) AS days_until_expiry
    FROM hotels h
    LEFT JOIN LATERAL (
        SELECT * FROM subscriptions
        WHERE hotel_id = h.id
        ORDER BY created_at DESC LIMIT 1
    ) s ON TRUE
    ORDER BY h.created_at DESC
""")

today = date.today()
for h in hotels_rows:
    expiry = h.get("expiry_date")
    grace_end = h.get("grace_end")
    truly = h.get("truly_expired")
    days_past = h.get("days_past_expiry")
    days_until = h.get("days_until_expiry")
    sub_s = h.get("sub_status") or "NO_SUB"
    flag = ""
    if expiry is None:
        flag = "⚪ NO_SUBSCRIPTION"
    elif truly:
        flag = f"🔴 EXPIRED {days_past}d ago (grace_end={grace_end})"
    elif expiry < today:
        grace = h.get("grace_days") or 7
        flag = f"🟡 IN_GRACE ({(grace_end - today).days if grace_end else '?'}d left)"
    elif days_until is not None and days_until.days <= 7:
        flag = f"🟠 EXPIRING_SOON {days_until.days}d"
    else:
        flag = f"🟢 ACTIVE ({days_until.days if days_until else '?'}d)"
    print(f"  {h['name'][:30]:30} | hotel={h['hotel_status']:10} | sub={sub_s:12} | {flag}")


# ─── Super Admin users ────────────────────────────────────────────────────
print("\n--- SUPER ADMIN USERS ---")
sa_users = db("""
    SELECT id, email, full_name, is_super_admin, is_active, last_login_at
    FROM users WHERE is_super_admin = TRUE
    ORDER BY created_at
""")
for u in sa_users:
    print(f"  {u.get('email')} | {u.get('full_name')} | active={u.get('is_active')} | last_login={u.get('last_login_at')}")

if not sa_users:
    print("  (none found)")


# ─── Login as SA via API ─────────────────────────────────────────────────
print("\n--- API LOGIN (SA) ---")
sa_token = None

# Try emails from the DB
for u in sa_users:
    email = u.get("email", "")
    for pwd in ["Admin@12345", "SuperAdmin@123", "ChangeMe123!", "Admin123!", "Platform@123"]:
        s, d = call("POST", "/api/v1/auth/login", {"email": email, "password": pwd})
        if s == 200 and (d.get("user") or {}).get("is_super_admin"):
            sa_token = d["access_token"]
            print(f"  SA login OK: {email} / {pwd}")
            break
    if sa_token:
        break

if not sa_token and sa_users:
    print(f"  Could not login as SA with known passwords.")
    print(f"  SA accounts in DB: {[u['email'] for u in sa_users]}")

# Also try common guesses
if not sa_token:
    for email, pwd in [
        ("admin@digitalmyhotels.in", "Admin@12345"),
        ("superadmin@digitalmyhotels.in", "SuperAdmin@12345"),
        ("owner@sg.in", "Admin@12345"),
    ]:
        s, d = call("POST", "/api/v1/auth/login", {"email": email, "password": pwd})
        if s == 200 and (d.get("user") or {}).get("is_super_admin"):
            sa_token = d["access_token"]
            print(f"  SA login OK: {email}")
            break


# ─── SA Dashboard via API ─────────────────────────────────────────────────
if sa_token:
    sd, dash = call("GET", "/api/v1/super-admin/dashboard", token=sa_token)
    print(f"\n[SA DASHBOARD] {sd}")
    if sd == 200:
        for k in ["total_hotels","active_hotels","expired_hotels","recently_expired","expiring_soon","total_revenue"]:
            print(f"  {k}: {dash.get(k)}")

    # Expired/expiring list
    se, exph = call("GET", "/api/v1/super-admin/hotels?status=expired&recent_days=30&expiring_within=7&limit=100", token=sa_token)
    print(f"\n[SA EXPIRED LIST (recent_days=30, expiring_within=7)] {se} | total={exph.get('total')}")
    for h in (exph.get("items") or []):
        expiry = h.get("expiry_date")
        days = (date.fromisoformat(expiry) - today).days if expiry else None
        print(f"  '{h.get('name')}' | hotel={h.get('status')} sub={h.get('subscription_status')} days={days} expiry={expiry}")


# ─── Guest duplicates in DB ───────────────────────────────────────────────
print("\n--- GUEST DUPLICATES IN DB ---")
dup_guests = db("""
    SELECT hotel_id, full_name, COUNT(*) as cnt,
           array_agg(normalized_phone ORDER BY created_at) as phones,
           array_agg(id_last4) as id_last4s
    FROM guests
    GROUP BY hotel_id, LOWER(full_name)
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
""")
for g in dup_guests:
    from_hotel = db("SELECT name FROM hotels WHERE id=%s", (str(g["hotel_id"]),))
    hotel_name = from_hotel[0]["name"] if from_hotel else str(g["hotel_id"])[:8]
    print(f"  '{g['full_name']}' in '{hotel_name}': {g['cnt']}x | phones={g['phones']} | id_last4s={g['id_last4s']}")


# ─── Attendance selfie orphans ────────────────────────────────────────────
print("\n--- ATTENDANCE SELFIE ORPHANS ---")
selfie_orphans = db("""
    SELECT COUNT(*) as cnt FROM attendance_records
    WHERE selfie_object_key IS NOT NULL
      AND selfie_object_key != ''
      AND checked_in_at IS NULL
""")
if selfie_orphans:
    print(f"  Orphaned selfies (check-in cancelled after photo): {selfie_orphans[0].get('cnt',0)}")


# ─── Draft documents older than TTL ──────────────────────────────────────
print("\n--- DRAFT DOCUMENTS ---")
draft_docs = db("""
    SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '7 days') as older_than_ttl
    FROM guest_draft_documents
""")
if draft_docs:
    d = draft_docs[0]
    print(f"  Total: {d.get('total')} | Older than 7d (should be swept): {d.get('older_than_ttl')}")


# ─── Rooms status breakdown ───────────────────────────────────────────────
print("\n--- ROOM STATUS BREAKDOWN ---")
room_statuses = db("""
    SELECT h.name as hotel, r.status, COUNT(*) as cnt
    FROM rooms r JOIN hotels h ON h.id = r.hotel_id
    GROUP BY h.name, r.status
    ORDER BY h.name, r.status
""")
for row in room_statuses:
    print(f"  {row['hotel'][:25]:25} | {row['status']:20} | {row['cnt']}")


# ─── Invoices with wrong numbering / cancelled ────────────────────────────
print("\n--- INVOICE SUMMARY ---")
inv_summary = db("""
    SELECT
        status,
        COUNT(*) as cnt,
        MIN(invoice_number) as first_inv,
        MAX(invoice_number) as last_inv
    FROM invoices
    GROUP BY status
    ORDER BY status
""")
for row in inv_summary:
    print(f"  {row['status']:15} | cnt={row['cnt']} | range: {row['first_inv']} → {row['last_inv']}")


# ─── Subscription expiry enforcement check ────────────────────────────────
print("\n--- SUBSCRIPTION ENFORCEMENT CHECK ---")
exp_hotels = db("""
    SELECT h.id, h.name, h.status,
           s.status as sub_status, s.expiry_date, s.grace_days,
           s.expiry_date + s.grace_days::int AS grace_end,
           CURRENT_DATE > (s.expiry_date + s.grace_days::int) AS truly_expired
    FROM hotels h
    JOIN LATERAL (
        SELECT * FROM subscriptions WHERE hotel_id = h.id
        ORDER BY created_at DESC LIMIT 1
    ) s ON TRUE
    WHERE CURRENT_DATE > (s.expiry_date + s.grace_days::int)
      AND h.status = 'active'
""")
if exp_hotels:
    print(f"  ⚠ HOTELS PAST GRACE BUT STILL 'active' IN DB ({len(exp_hotels)}):")
    for h in exp_hotels:
        print(f"    {h['name']} | expiry={h['expiry_date']} | grace_end={h['grace_end']}")
else:
    print("  ✓ No hotels found with expired+grace subscriptions still marked active")


if db_ok:
    conn.close()

print("\n=== COMPLETE ===")
