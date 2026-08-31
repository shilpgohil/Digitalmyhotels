"""Fix rootDir on Render service and trigger fresh deploy."""
import json
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
            return {"raw": raw[:500]}, e.code


# Update service — add rootDir
print("=== Updating service to set rootDir=backend ===")
update = {
    "rootDir": "backend",
    "serviceDetails": {
        "buildCommand": "pip install -r requirements.txt",
        "preDeployCommand": "alembic upgrade head",
        "startCommand": "uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1",
        "healthCheckPath": "/health",
    }
}
result, code = call("PATCH", f"/services/{SVC}", update)
print(f"  HTTP {code}")
if code == 200:
    s = result.get("service", result)
    details = s.get("serviceDetails", {})
    print(f"  rootDir set: {s.get('rootDir', details.get('rootDir', 'NOT SET'))}")
    print(f"  Full serviceDetails: {json.dumps(details, indent=2)[:400]}")
else:
    print(f"  Response: {json.dumps(result)[:500]}")

# Clear cache and trigger fresh deploy
print("\n=== Triggering fresh deploy with cache cleared ===")
deploy, dcode = call("POST", f"/services/{SVC}/deploys", {"clearCache": "clear"})
print(f"  HTTP {dcode}")
if isinstance(deploy, dict):
    dep = deploy.get("deploy", deploy)
    did = dep.get("id", str(deploy)[:80])
    print(f"  Deploy ID: {did}")
    print(f"  Status: {dep.get('status')}")
    print(f"\n✓ Watch build at: https://dashboard.render.com/web/{SVC}/deploys")
    print("  Backend URL: https://digitalmyhotels-api.onrender.com")
