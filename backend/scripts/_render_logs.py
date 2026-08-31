"""Get deploy logs for the failed Render deploy."""
import json
import urllib.error
import urllib.request

KEY = "rnd_9ZDHORtwgArjvCZGNuUYxgNYpldx"
SVC = "srv-da9hg71f2nfc73fj7m90"
DEP = "dep-da9hg7qcns4c73d8v7qg"   # latest
H = {"Authorization": f"Bearer {KEY}", "Accept": "application/json"}


def get(path):
    req = urllib.request.Request(f"https://api.render.com/v1{path}", headers=H)
    try:
        return json.loads(urllib.request.urlopen(req).read()), 200
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode() or "{}"), e.code


# Get deploy details
dep, code = get(f"/services/{SVC}/deploys/{DEP}")
d = dep.get("deploy", dep)
print("Deploy status:", d.get("status"))
print("Finished:", d.get("finishedAt"))

# Get logs
logs, code = get(f"/services/{SVC}/deploys/{DEP}/logs?limit=100")
print(f"\n=== Build logs (HTTP {code}) ===")
if isinstance(logs, list):
    for entry in logs[-40:]:
        print(entry.get("text", entry))
elif isinstance(logs, dict):
    print(json.dumps(logs, indent=2)[:2000])
