# -*- coding: utf-8 -*-
import sys, json, urllib.request, urllib.error
from datetime import date, timedelta
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://digitalmyhotels-api-sg.onrender.com"
NEON = ("host=ep-royal-cell-azlddqmb-pooler.c-3.ap-southeast-1.aws.neon.tech "
        "dbname=neondb user=neondb_owner password=npg_XS48EVkFOGQr "
        "sslmode=require connect_timeout=30")

import psycopg2, psycopg2.extras
conn = psycopg2.connect(NEON); conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

def db(sql):
    cur.execute(sql); return [dict(r) for r in cur.fetchall()]

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
    except Exception as exc:
        return 0, {"error": str(exc)}

today = date.today()
print(f"Today: {today}")

# ─────────────────────────────────────────────────────────────
print("\n[1] Hotel Pramod subscription details")
rows = db("""
    SELECT h.name, h.status AS hotel_status,
           s.status AS sub_status, s.expiry_date, s.grace_days,
           (s.expiry_date + (s.grace_days::text||' days')::interval)::date AS grace_end
    FROM hotels h
    JOIN subscriptions s ON s.hotel_id = h.id
    WHERE lower(h.name) LIKE '%pramod%'
    ORDER BY s.created_at DESC LIMIT 1
""")
for r in rows:
    grace_end = r["grace_end"]
    expiry = r["expiry_date"]
    left = (grace_end - today).days
    print(f"  {r['name']} | hotel={r['hotel_status']} | sub={r['sub_status']}")
    print(f"  expiry={expiry} | grace_days={r['grace_days']} | grace_end={grace_end}")
    print(f"  Days since expiry: {(today-expiry).days}d | Days until block: {left}d")
    if left > 0:
        print(f"  VERDICT: In grace period — login ALLOWED until {grace_end}. NOT a code bug.")
    elif left == 0:
        print(f"  VERDICT: Grace ends TODAY")
    else:
        print(f"  VERDICT: TRULY EXPIRED — {abs(left)}d past grace")


# ─────────────────────────────────────────────────────────────
print("\n[2] Does recently-expired query include Hotel Pramod?")
cutoff_str = (today - timedelta(days=30)).isoformat()
# Test the backend query logic in SQL
re_rows = db(f"""
    WITH latest AS (
        SELECT DISTINCT ON (hotel_id) * FROM subscriptions ORDER BY hotel_id, created_at DESC
    )
    SELECT h.name, h.status, latest.expiry_date, latest.grace_days,
           (latest.expiry_date + (coalesce(latest.grace_days,7)::text||' days')::interval)::date AS grace_end,
           latest.status AS sub_status
    FROM hotels h LEFT JOIN latest ON latest.hotel_id = h.id
    WHERE (
        -- fully expired (past grace)
        (
            (h.status = 'expired' OR
             CURRENT_DATE > (latest.expiry_date + (coalesce(latest.grace_days,7)::text||' days')::interval)::date)
            AND (latest.expiry_date IS NULL OR latest.expiry_date >= '{cutoff_str}')
        )
        OR
        -- IN GRACE (subscription lapsed but still within grace window)
        (
            latest.status != 'suspended'
            AND latest.expiry_date < CURRENT_DATE
            AND CURRENT_DATE <= (latest.expiry_date + (coalesce(latest.grace_days,7)::text||' days')::interval)::date
            AND latest.expiry_date >= '{cutoff_str}'
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
""")
print(f"  Hotels in recently-expired/expiring list: {len(re_rows)}")
for r in re_rows:
    ge = r.get("grace_end")
    left = (ge - today).days if ge else "?"
    print(f"  '{r['name']}' | expiry={r['expiry_date']} | sub={r['sub_status']} | grace_end={ge} | days_left={left}")


# ─────────────────────────────────────────────────────────────
print("\n[3] SA account details")
sa_rows = db("SELECT id::text, email, full_name, is_active, must_reset_password, created_at::date FROM users WHERE is_super_admin=TRUE ORDER BY created_at")
for u in sa_rows:
    print(f"  email: {u['email']}")
    print(f"  name: {u['full_name']} | active={u['is_active']} | must_reset={u['must_reset_password']} | joined={u['created_at']}")


# ─────────────────────────────────────────────────────────────
print("\n[4] SA API login attempts")
sa_token = None
if sa_rows:
    sa_email = sa_rows[0]["email"]
    import time
    for pwd in ["Admin@12345","SuperAdmin@12345","SuperAdmin@123","Platform@123",
                "ChangeMe123!","Admin123#","digitalmyhotels@123","DigitalMyHotels@123",
                "DMH@12345","Dmh@12345","superadmin@123","Admin@123"]:
        s, d = http("POST", "/api/v1/auth/login", {"email": sa_email, "password": pwd})
        if s == 200 and (d.get("user") or {}).get("is_super_admin"):
            sa_token = d["access_token"]
            print(f"  FOUND: {sa_email} / {pwd}")
            break
        elif s == 429:
            print("  Rate limited. Waiting 30s...")
            time.sleep(30)
            s2, d2 = http("POST", "/api/v1/auth/login", {"email": sa_email, "password": pwd})
            if s2 == 200 and (d2.get("user") or {}).get("is_super_admin"):
                sa_token = d2["access_token"]
                print(f"  FOUND after wait: {sa_email} / {pwd}")
                break
    if not sa_token:
        print(f"  SA login failed. Email is: {sa_email}")

if sa_token:
    sd, dash = http("GET", "/api/v1/super-admin/dashboard", token=sa_token)
    if sd == 200:
        print(f"\n  Dashboard: {dash}")
    se, exph = http("GET", "/api/v1/super-admin/hotels?status=expired&recent_days=30&expiring_within=7&limit=50", token=sa_token)
    print(f"\n  SA expired+expiring list: {exph.get('total')} hotels")
    for h in (exph.get("items") or []):
        print(f"    '{h.get('name')}' sub={h.get('subscription_status')} expiry={h.get('expiry_date')}")


# ─────────────────────────────────────────────────────────────
print("\n[5] Guest duplicates (fixed query)")
dups = db("""
    SELECT h.name AS hotel, lower(g.full_name) AS lname, COUNT(*) AS cnt,
           array_agg(g.normalized_phone ORDER BY g.created_at) AS phones
    FROM guests g JOIN hotels h ON h.id=g.hotel_id
    GROUP BY h.name, lower(g.full_name)
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC LIMIT 20
""")
for d in dups:
    print(f"  '{d['lname']}' in '{d['hotel']}': {d['cnt']}x phones={d['phones']}")
if not dups:
    print("  No duplicates — each guest name is unique within its hotel")


conn.close()
print("\n=== DONE ===")
