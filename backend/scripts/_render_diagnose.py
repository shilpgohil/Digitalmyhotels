"""Diagnose Render deployment failure."""
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


# Full service details
svc, _ = call("GET", f"/services/{SVC}")
s = svc.get("service", svc)
details = s.get("serviceDetails", {})
print("=== Full service details ===")
print(json.dumps(details, indent=2))

# Deploys
deps, _ = call("GET", f"/services/{SVC}/deploys?limit=5")
print("\n=== Deploys ===")
for item in (deps if isinstance(deps, list) else []):
    d = item.get("deploy", item)
    print(f"  {d.get('id')} status={d.get('status')} trigger={d.get('trigger', {}).get('type')} "
          f"error={d.get('error', {}).get('message', '') if d.get('error') else ''}")

# Runtime logs (runtime, not build)
logs, code = call("GET", f"/services/{SVC}/logs?limit=30")
print(f"\n=== Runtime logs (HTTP {code}) ===")
if isinstance(logs, list):
    for entry in logs[-20:]:
        t = entry.get("text", "") if isinstance(entry, dict) else str(entry)
        print(f"  {t}")
elif isinstance(logs, dict):
    print(json.dumps(logs, indent=2)[:1000])
