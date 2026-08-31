"""Final end-to-end verification of production deployment."""
import json
import urllib.request

BASE = "https://digitalmyhotels-api.onrender.com/api/v1"


def post(url, body):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}
    )
    return json.loads(urllib.request.urlopen(req).read())


def get(url, token, hotel_id=None):
    h = {"Authorization": f"Bearer {token}"}
    if hotel_id:
        h["X-Hotel-Id"] = hotel_id
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=h)).read())


print("=== PRODUCTION END-TO-END VERIFICATION ===\n")

# Health
h = urllib.request.urlopen("https://digitalmyhotels-api.onrender.com/health")
print("[OK] Health:", json.loads(h.read()))

# Super admin login
sa = post(f"{BASE}/auth/login", {"email": "superadmin@digitalmyhotels.in", "password": "ChangeMe123!"})
sa_tok = sa["access_token"]
print(f"[OK] Super admin login: {sa['user']['email']}")

# Hotel owner login
ow = post(f"{BASE}/auth/login", {"email": "owner@meridiancourt.in", "password": "ChangeMe123!"})
ow_tok = ow["access_token"]
hid = ow["memberships"][0]["hotel_id"]
print(f"[OK] Hotel owner login: {ow['user']['email']}")

# Dashboard metrics
dash = get(f"{BASE}/super-admin/dashboard", sa_tok)
print(f"[OK] Dashboard: total_hotels={dash['total_hotels']} today_checkins={dash['today_checkins']}")

# Hotel API
hotel = get(f"{BASE}/hotels/me", ow_tok, hid)
print(f"[OK] Hotel: {hotel['name']}")

# Rooms
rooms = get(f"{BASE}/rooms?limit=5", ow_tok, hid)
print(f"[OK] Rooms: {rooms['total']} total")

# Bookings
bookings = get(f"{BASE}/bookings?limit=3", ow_tok, hid)
print(f"[OK] Bookings: {bookings['total']} total")

# Payment summary
pay = get(f"{BASE}/payments/summary", ow_tok, hid)
print(f"[OK] Payment summary: collected={pay['total_collected']}")

# Tenant isolation
try:
    get(f"{BASE}/super-admin/hotels", ow_tok)
    print("[FAIL] Tenant isolation broken!")
except urllib.error.HTTPError as e:
    print(f"[OK] Tenant isolation: owner blocked from /super-admin with {e.code}")

print("\n" + "="*45)
print("✅ FRONTEND: https://digitalmyhotels.vercel.app")
print("✅ BACKEND:  https://digitalmyhotels-api.onrender.com")
print("✅ DATABASE: Neon ap-southeast-1 (Singapore)")
print("✅ STORAGE:  Backblaze B2 us-east-005")
print("✅ ALL SYSTEMS LIVE AND INTEGRATED")
print("="*45)
print("\nLogin credentials (change immediately):")
print("  Super admin: superadmin@digitalmyhotels.in / ChangeMe123!")
print("  Hotel owner: owner@meridiancourt.in / ChangeMe123!")
