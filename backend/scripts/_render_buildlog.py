"""Fetch Render build logs via SSE-style endpoint."""
import json
import urllib.error
import urllib.request

KEY = "rnd_9ZDHORtwgArjvCZGNuUYxgNYpldx"
SVC = "srv-da9hg71f2nfc73fj7m90"
H = {"Authorization": f"Bearer {KEY}", "Accept": "application/json"}


def call(path):
    req = urllib.request.Request(f"https://api.render.com/v1{path}", headers=H)
    try:
        r = urllib.request.urlopen(req)
        raw = r.read()
        return json.loads(raw) if raw else [], r.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return {"err": raw[:300], "code": e.code}, e.code


# Get all deploys
deps, _ = call(f"/services/{SVC}/deploys?limit=5")
print("=== Recent deploys ===")
latest_id = None
for item in (deps if isinstance(deps, list) else []):
    d = item.get("deploy", item)
    did = d.get("id", "")
    status = d.get("status", "")
    created = d.get("createdAt", "")
    print(f"  {did}  status={status}  created={created}")
    if not latest_id:
        latest_id = did

if latest_id:
    print(f"\n=== Logs for {latest_id} ===")
    # Try deploy log endpoint
    for endpoint in [
        f"/services/{SVC}/deploys/{latest_id}/logs",
        f"/services/{SVC}/logs?deployId={latest_id}&limit=100",
        f"/services/{SVC}/logs?limit=50",
    ]:
        logs, code = call(endpoint)
        print(f"\n  Endpoint: {endpoint}  HTTP {code}")
        if code == 200 and logs:
            entries = logs if isinstance(logs, list) else logs.get("logs", [])
            for e in entries[-30:]:
                text = e.get("text", e) if isinstance(e, dict) else str(e)
                print(f"    {text}")
            break
        elif isinstance(logs, dict):
            print(f"    {json.dumps(logs)[:300]}")
