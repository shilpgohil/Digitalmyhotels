"""Get deploy error from Render API."""
import json
import urllib.error
import urllib.request

KEY = "rnd_9ZDHORtwgArjvCZGNuUYxgNYpldx"
SVC = "srv-da9hg71f2nfc73fj7m90"
DEP = "dep-da9hhdks728c73dpnngg"
H = {"Authorization": f"Bearer {KEY}", "Accept": "application/json"}

req = urllib.request.Request(
    f"https://api.render.com/v1/services/{SVC}/deploys/{DEP}", headers=H
)
data = json.loads(urllib.request.urlopen(req).read())
d = data.get("deploy", data)
print("Status:", d.get("status"))
print("Error:", json.dumps(d.get("error"), indent=2))
print("Commit:", d.get("commit", {}).get("message") if d.get("commit") else "no commit info")
print("Trigger:", d.get("trigger"))
print("FinishedAt:", d.get("finishedAt"))
# Print everything
print("\nFull deploy data:")
print(json.dumps(d, indent=2)[:2000])
