"""Check Render service status and latest deploy."""
import json
import urllib.request

KEY = "rnd_9ZDHORtwgArjvCZGNuUYxgNYpldx"
SVC = "srv-da9hg71f2nfc73fj7m90"
H = {"Authorization": f"Bearer {KEY}", "Accept": "application/json"}


def get(path):
    req = urllib.request.Request(f"https://api.render.com/v1{path}", headers=H)
    try:
        return json.loads(urllib.request.urlopen(req).read())
    except Exception as e:
        return {"error": str(e)}


svc = get(f"/services/{SVC}")
s = svc.get("service", svc)
details = s.get("serviceDetails", {})
print("=== Service ===")
print(f"  Name:   {s.get('name')}")
print(f"  Status: {s.get('status')}")
print(f"  URL:    {details.get('url', 'pending...')}")
print(f"  Region: {s.get('region')}")
print(f"  Dashboard: https://dashboard.render.com/web/{SVC}")

print("\n=== Latest deploys ===")
deploys = get(f"/services/{SVC}/deploys?limit=3")
for item in (deploys if isinstance(deploys, list) else []):
    dep = item.get("deploy", item)
    commit_msg = dep.get("commit", {}).get("message", "—")[:50] if dep.get("commit") else "—"
    print(f"  {dep.get('id')} status={dep.get('status')} msg={commit_msg}")
