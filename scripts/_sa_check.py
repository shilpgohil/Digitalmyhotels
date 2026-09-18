# -*- coding: utf-8 -*-
import sys, json, urllib.request, urllib.error
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://digitalmyhotels-api-sg.onrender.com"

def login(email, pwd):
    data = json.dumps({"email": email, "password": pwd}).encode()
    req = urllib.request.Request(
        f"{BASE}/api/v1/auth/login", data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except: return e.code, {"error": e.read().decode("utf-8","replace")}

s, d = login("superadmin@digitalmyhotels.in", "Admin@12345")
print(f"Status: {s}")
u = d.get("user") or {}
print(f"is_super_admin: {u.get('is_super_admin')}")
err = (d.get("error") or {})
print(f"code: {err.get('code')} | msg: {err.get('message')}")
if s == 200:
    print("SA LOGIN SUCCESS")
    tok = d["access_token"]
    import urllib.request as ur
    req2 = ur.Request(f"{BASE}/api/v1/super-admin/dashboard",
                      headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"})
    with ur.urlopen(req2, timeout=30) as r2:
        dash = json.loads(r2.read())
    print(f"Dashboard: total={dash.get('total_hotels')} active={dash.get('active_hotels')} "
          f"expired={dash.get('expired_hotels')} recently_expired={dash.get('recently_expired')} "
          f"expiring_soon={dash.get('expiring_soon')}")
