"""Verify Hotel Pramod bugs via prathrawat@sg.in"""
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


print("=" * 60)
print("HOTEL PRAMOD VERIFICATION")
print("=" * 60)

s, d = call("POST", "/api/v1/auth/login",
            {"email": "prathrawat@sg.in", "password": "Admin@12345"})
print(f"Login: {s}")
if s != 200:
    print("FAIL:", d)
    exit()

token = d["access_token"]
memberships = d.get("memberships", [])
hotel_id = memberships[0]["hotel_id"] if memberships else None
user = d.get("user") or {}
is_sa = user.get("is_super_admin", False)
role = memberships[0].get("role_code") if memberships else "?"
print(f"  email={user.get('email')} hotel_id={hotel_id} role={role} is_sa={is_sa}")

# Hotel info
s2, hotel = call("GET", "/api/v1/hotels/me", token=token, hotel_id=hotel_id)
print(f"\nHotel: {hotel.get('name')} | status={hotel.get('status')}")

# Subscription
s3, sub = call("GET", "/api/v1/hotels/me/subscription", token=token, hotel_id=hotel_id)
print(f"Subscription ({s3}): {sub}")
today = date.today()
exp_str = sub.get("expiry_date")
if exp_str:
    exp_d = date.fromisoformat(exp_str)
    grace = sub.get("grace_days") or 7
    grace_end = exp_d + timedelta(days=grace)
    days_left = (exp_d - today).days
    print(f"  expiry={exp_d} | grace_end={grace_end} | today={today} | days_left={days_left}")
    if today > grace_end:
        print("  >>>  TRULY EXPIRED (past grace period) — should be blocked")
    elif today > exp_d:
        print(f"  >>>  IN GRACE PERIOD ({(grace_end - today).days}d remaining) — still allowed")
    else:
        print(f"  >>>  ACTIVE ({days_left}d until expiry)")
else:
    print("  No subscription / no expiry date")

# Can they make a booking? (test expiry enforcement)
print(f"\n[Enforcement test: Can read bookings?]")
s4, bk = call("GET", "/api/v1/bookings?limit=1", token=token, hotel_id=hotel_id)
print(f"  GET /bookings: {s4} {'BLOCKED' if s4 == 403 else 'ALLOWED'}")

s5, cg = call("GET", "/api/v1/current-guests?limit=1", token=token, hotel_id=hotel_id)
print(f"  GET /current-guests: {s5} {'BLOCKED' if s5 == 403 else 'ALLOWED'}")

# Try creating a booking (write operation — should be blocked if expired)
print(f"\n[Enforcement test: Create operations blocked?]")
s6, _ = call("POST", "/api/v1/bookings", {
    "primary_guest_id": "00000000-0000-0000-0000-000000000000",
    "room_ids": [],
    "check_in_date": str(today + timedelta(days=1)),
    "check_out_date": str(today + timedelta(days=2)),
    "adults": 1,
    "children": 0,
}, token=token, hotel_id=hotel_id)
print(f"  POST /bookings: {s6} {'BLOCKED' if s6 == 403 else 'NOT blocked (bug!)' if s6 != 422 else '422 validation (normal)'}")

# Check rooms
s7, rooms = call("GET", "/api/v1/rooms?limit=20", token=token, hotel_id=hotel_id)
print(f"\nRooms: {rooms.get('total')} total")
from collections import Counter
statuses = Counter(r.get("status") for r in (rooms.get("items") or []))
print(f"  Status breakdown: {dict(statuses)}")

# Guest search for duplicates
print(f"\n[Duplicate guest check for Hotel Pramod]")
s8, gsearch = call("GET", "/api/v1/guests/search?phone=9",
                   token=token, hotel_id=hotel_id)
items = gsearch.get("items") or []
print(f"  Search results: {len(items)}")
names = [i.get("full_name") for i in items]
from collections import Counter as C
dupes = {n: cnt for n, cnt in C(names).items() if cnt > 1}
print(f"  Duplicates: {dupes if dupes else 'None'}")
for item in items[:8]:
    print(f"    {item.get('full_name')} | {item.get('phone_masked')} | cross={item.get('cross_hotel')}")

# Storage
s9, storage = call("GET", "/api/v1/storage/health", token=token, hotel_id=hotel_id)
print(f"\nStorage: backend={storage.get('backend')} write={storage.get('write_ok')} persist={storage.get('files_persist_across_restarts')}")

# Check guests for documents
print(f"\n[Guests & documents]")
sg, glist = call("GET", "/api/v1/guests?limit=5", token=token, hotel_id=hotel_id)
for g in (glist.get("items") or [])[:4]:
    gid = g.get("id")
    sdoc, docs = call("GET", f"/api/v1/guests/{gid}/documents", token=token, hotel_id=hotel_id)
    doc_info = [(d.get("side"), d.get("document_type")) for d in (docs if isinstance(docs, list) else [])]
    print(f"  {g.get('full_name')} | id_last4={g.get('id_last4')} | docs={doc_info}")

print("\n=== DONE ===")
