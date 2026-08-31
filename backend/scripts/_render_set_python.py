"""Add PYTHON_VERSION env var to Render service and trigger deploy."""
import json
import time
import urllib.error
import urllib.request

KEY = "rnd_9ZDHORtwgArjvCZGNuUYxgNYpldx"
SVC = "srv-da9hg71f2nfc73fj7m90"
H = {"Authorization": f"Bearer {KEY}", "Accept": "application/json", "Content-Type": "application/json"}


def call(method, path, body=None):
    url = f"https://api.render.com/v1{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method, headers=H)
    try:
        r = urllib.request.urlopen(req)
        raw = r.read()
        return json.loads(raw) if raw else {}, r.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return json.loads(raw), e.code
        except Exception:
            return {"raw": raw[:300]}, e.code


# First get current env vars
print("=== Getting current env vars ===")
current, code = call("GET", f"/services/{SVC}/env-vars")
print(f"  HTTP {code}  count={len(current) if isinstance(current, list) else 'N/A'}")

# Add PYTHON_VERSION to the existing env vars
existing = current if isinstance(current, list) else []
# Remove any existing PYTHON_VERSION entry
existing = [e for e in existing if e.get("key") != "PYTHON_VERSION"]
existing.append({"key": "PYTHON_VERSION", "value": "3.11.0"})

print("=== Updating env vars with PYTHON_VERSION=3.11.0 ===")
result, code = call("PUT", f"/services/{SVC}/env-vars", existing)
print(f"  HTTP {code}")

# Small wait then trigger new deploy
time.sleep(2)
print("=== Triggering deploy ===")
deploy, dcode = call("POST", f"/services/{SVC}/deploys", {"clearCache": "clear"})
if isinstance(deploy, dict):
    dep = deploy.get("deploy", deploy)
    print(f"  HTTP {dcode}  Deploy: {dep.get('id', str(deploy)[:60])}  status={dep.get('status')}")
else:
    print(f"  HTTP {dcode}")

print(f"\n✓ Build starting — watch at: https://dashboard.render.com/web/{SVC}/deploys")
print("  Expected build time: ~3-5 minutes")

# Poll status
print("\n=== Polling deploy status every 30s ===")
for i in range(12):  # up to 6 minutes
    time.sleep(30)
    deps, _ = call("GET", f"/services/{SVC}/deploys?limit=1")
    if isinstance(deps, list) and deps:
        d = deps[0].get("deploy", deps[0])
        status = d.get("status", "unknown")
        print(f"  [{i*30+30}s] {d.get('id')} status={status}")
        if status in ("live", "deactivated"):
            print("\n✅ Backend is LIVE at: https://digitalmyhotels-api.onrender.com")
            break
        elif status == "build_failed":
            print("\n❌ Build failed again — check dashboard")
            break
