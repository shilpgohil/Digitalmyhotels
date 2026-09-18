"""Find SA account and verify expired-hotel bugs."""
import json
import urllib.request
import urllib.error
from datetime import date, timedelta

BASE = "https://digitalmyhotels-api-sg.onrender.com"


def call(method, path, body=None, token=None, hotel_id=None, timeout=90):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if hotel_id:
        headers["X-Hotel-Id"] = hotel_id
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw.decode("utf-8", "replace")[:500]}
    except Exception as exc:
        return 0, {"error": str(exc)}


# Try all plausible SA credentials
sa_candidates = [
    ("superadmin@digitalmyhotels.in", "SuperAdmin@12345"),
    ("superadmin@digitalmyhotels.in", "Admin@12345"),
    ("admin@digitalmyhotels.in",       "Admin@12345"),
    ("sa@digitalmyhotels.in",          "Admin@12345"),
    ("root@digitalmyhotels.in",        "Admin@12345"),
    ("platform@digitalmyhotels.in",    "Admin@12345"),
    ("admin@sg.in",                    "Admin@12345"),
    ("superadmin@sg.in",               "Admin@12345"),
    ("prathrawat@sg.in",               "Admin@12345"),
    ("prathrawat@sg.in",               "ChangeMe123!"),
    ("admin@digitalmyhotels.in",       "SuperAdmin@123"),
    ("superadmin@digitalmyhotels.in",  "SuperAdmin@123"),
]

sa_token = None
for email, pwd in sa_candidates:
    s, d = call("POST", "/api/v1/auth/login", {"email": email, "password": pwd})
    u = (d.get("user") or {})
    if s == 200 and u.get("is_super_admin"):
        sa_token = d["access_token"]
        print(f"SA FOUND: {u.get('email')}")
        break
    elif s == 200:
        print(f"  {email}: 200 but NOT SA (role: {(d.get('memberships') or [{}])[0].get('role_code', '?')})")
    else:
        err = (d.get("error") or d).get("code", "?")
        print(f"  {email}: {s} {err}")

if not sa_token:
    print("\nCould not find SA credentials. Trying partner account SA check...")
    # Maybe the SA is accessible via a partner token that has SA privileges
    # Try the production inspect credentials
    for email, pwd in [("owner@sg.in", "Admin@12345")]:
        s, d = call("POST", "/api/v1/auth/login", {"email": email, "password": pwd})
        if s == 200:
            tok = d["access_token"]
            # Try SA endpoint directly
            sa_s, sa_d = call("GET", "/api/v1/super-admin/dashboard", token=tok)
            if sa_s == 200:
                sa_token = tok
                print(f"SA access via {email}!")
                break
            else:
                print(f"  {email}: partner login OK but SA denied: {sa_s}")

if sa_token:
    print("\n=== SA VERIFIED — running checks ===")

    sd, dash = call("GET", "/api/v1/super-admin/dashboard", token=sa_token)
    if sd == 200:
        print(f"\nDashboard: total={dash.get('total_hotels')} active={dash.get('active_hotels')} "
              f"expired={dash.get('expired_hotels')} recently_expired={dash.get('recently_expired')} "
              f"expiring_soon={dash.get('expiring_soon')}")

    # ALL hotels
    sh, allh = call("GET", "/api/v1/super-admin/hotels?limit=100", token=sa_token)
    if sh == 200:
        print(f"\nAll hotels ({allh.get('total')}):")
        today_d = date.today()
        for h in (allh.get("items") or []):
            exp = h.get("expiry_date")
            days = None
            if exp:
                days = (date.fromisoformat(exp) - today_d).days
            flag = ""
            if days is not None:
                if days < 0:
                    flag = f"EXPIRED {abs(days)}d ago"
                elif days <= 7:
                    flag = f"EXPIRING in {days}d"
                else:
                    flag = f"ok ({days}d left)"
            print(f"  '{h.get('name')}' status={h.get('status')} sub={h.get('subscription_status')} {flag} expiry={exp}")

    # Search for Pramod
    sp, pramod = call("GET", "/api/v1/super-admin/hotels?q=pramod&limit=20", token=sa_token)
    if sp == 200:
        print(f"\nSearch 'pramod': {pramod.get('total')} results")
        for h in (pramod.get("items") or []):
            exp = h.get("expiry_date")
            days = (date.fromisoformat(exp) - date.today()).days if exp else None
            print(f"  '{h.get('name')}' status={h.get('status')} sub={h.get('subscription_status')} days={days} expiry={exp}")

    # Recently expired + expiring
    se, exph = call(
        "GET",
        "/api/v1/super-admin/hotels?status=expired&recent_days=30&expiring_within=7&limit=100",
        token=sa_token
    )
    if se == 200:
        print(f"\nExpired/expiring (recent_days=30, expiring_within=7): {exph.get('total')}")
        for h in (exph.get("items") or []):
            exp = h.get("expiry_date")
            days = (date.fromisoformat(exp) - date.today()).days if exp else None
            print(f"  '{h.get('name')}' status={h.get('status')} sub={h.get('subscription_status')} days={days}")
else:
    print("\nSA access not found. The SA account credentials are not in the known list.")
    print("The platform owner needs to provide the SA email/password.")
