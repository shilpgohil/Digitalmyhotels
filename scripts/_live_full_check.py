# -*- coding: utf-8 -*-
"""Full live platform health check before new bug round."""
import sys, json, urllib.request, urllib.error
from datetime import date

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "https://digitalmyhotels-api-sg.onrender.com"
NEON = ("host=ep-royal-cell-azlddqmb-pooler.c-3.ap-southeast-1.aws.neon.tech "
        "dbname=neondb user=neondb_owner password=npg_XS48EVkFOGQr "
        "sslmode=require connect_timeout=30")

import psycopg2, psycopg2.extras
conn = psycopg2.connect(NEON); conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
def db(sql): cur.execute(sql); return [dict(r) for r in cur.fetchall()]

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
        except: return e.code, {"error": raw.decode("utf-8","replace")[:300]}
    except Exception as exc: return 0, {"error": str(exc)}

today = date.today()
print(f"Live check — {today}\n")

# Partner login
s, d = http("POST", "/api/v1/auth/login", {"email":"owner@sg.in","password":"Admin@12345"})
tok = d.get("access_token"); m = (d.get("memberships") or [{}])[0]
hid = m.get("hotel_id"); role = m.get("role_code")
print(f"[LOGIN] {s} | {(d.get('user') or {}).get('email')} | role={role} | hotel={hid}")

# API health
s2, h2 = http("GET", "/api/v1/hotels/me", token=tok, hotel_id=hid)
s3, stor = http("GET", "/api/v1/storage/health", token=tok, hotel_id=hid)
s4, sub = http("GET", "/api/v1/hotels/me/subscription", token=tok, hotel_id=hid)
print(f"[HOTEL] {h2.get('name')} | status={h2.get('status')}")
print(f"[STORAGE] backend={stor.get('backend')} write={stor.get('write_ok')} persist={stor.get('files_persist_across_restarts')}")
print(f"[SUB] status={sub.get('status')} expiry={sub.get('expiry_date')}")

# DB migration state
print("\n=== MIGRATION STATE ===")
migs = db("SELECT version_num FROM alembic_version")
print(f"Current head: {migs[0]['version_num'] if migs else 'NONE'}")
# Check the new column exists
cols = db("SELECT column_name FROM information_schema.columns WHERE table_name='guest_registrations' ORDER BY ordinal_position")
print(f"guest_registrations columns: {[c['column_name'] for c in cols]}")

# Check hotels
print("\n=== HOTELS (production) ===")
hotels = db("""
    SELECT h.name, h.status,
           s.status as sub_status, s.expiry_date,
           (s.expiry_date + (coalesce(s.grace_days,7)::text||' days')::interval)::date AS grace_end
    FROM hotels h
    LEFT JOIN LATERAL (SELECT * FROM subscriptions WHERE hotel_id=h.id ORDER BY created_at DESC LIMIT 1) s ON TRUE
    ORDER BY s.expiry_date NULLS LAST
""")
for h in hotels:
    expiry = h.get("expiry_date"); sub_s = h.get("sub_status") or "NO_SUB"
    grace_end = h.get("grace_end")
    if expiry is None: flag = "NO_SUBSCRIPTION"
    elif grace_end and today > grace_end: flag = f"TRULY EXPIRED (grace ended {grace_end})"
    elif expiry < today: flag = f"IN GRACE (ends {grace_end})"
    elif (expiry - today).days <= 7: flag = f"EXPIRING SOON ({(expiry-today).days}d)"
    else: flag = f"ACTIVE ({(expiry-today).days}d left)"
    print(f"  {h['name'][:28]:28} | hotel={h['status']:10} sub={sub_s:14} {flag}")

# Check in-house guests
print("\n=== IN-HOUSE GUESTS ===")
inhouse = db("""
    SELECT h.name, b.booking_number, b.status, b.payment_status,
           b.check_in_date, b.check_out_date
    FROM bookings b JOIN hotels h ON h.id=b.hotel_id
    WHERE b.status='checked_in'
    ORDER BY h.name, b.check_in_date
""")
for r in inhouse:
    print(f"  {r['name'][:20]:20} {r['booking_number']} chkin={r['check_in_date']} chkout={r['check_out_date']} pay={r['payment_status']}")
if not inhouse: print("  (none)")

# Check recent registrations with alternate_contact_phone
print("\n=== ALTERNATE CONTACT PHONE USAGE (new feature) ===")
alt_rows = db("""
    SELECT h.name, gr.alternate_contact_phone, gr.is_primary, gr.created_at::date
    FROM guest_registrations gr JOIN hotels h ON h.id=gr.hotel_id
    WHERE gr.alternate_contact_phone IS NOT NULL
    ORDER BY gr.created_at DESC LIMIT 10
""")
if alt_rows:
    for r in alt_rows: print(f"  {r['name']} | is_primary={r['is_primary']} | alt_phone={r['alternate_contact_phone']} | date={r['created_at']}")
else:
    print("  (none set yet — field exists in DB)")

conn.close()
print("\n=== DONE ===")
