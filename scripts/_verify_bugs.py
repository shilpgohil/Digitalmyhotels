"""Live platform bug verification — owner@sg.in / Admin@12345"""
import json
import urllib.request
import urllib.error
from datetime import date, timedelta
from collections import Counter

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
print("LIVE BUG VERIFICATION  |  owner@sg.in")
print("=" * 60)

# ─── Partner login ────────────────────────────────────────────────
s, data = call("POST", "/api/v1/auth/login",
               {"email": "owner@sg.in", "password": "Admin@12345"})
print(f"\n[PARTNER LOGIN] {s}")
if s != 200:
    print("  FAIL:", data)
    partner_token = hotel_id = None
else:
    partner_token = data["access_token"]
    memberships = data.get("memberships", [])
    hotel_id = memberships[0]["hotel_id"] if memberships else None
    user = data.get("user") or {}
    is_sa = user.get("is_super_admin", False)
    print(f"  email={user.get('email')} hotel={hotel_id} role={memberships[0].get('role_code') if memberships else '?'} is_super_admin={is_sa}")

    # ── BUG 2: Expired hotel can still login? ──────────────────────
    print("\n[BUG-2: Expired hotel login?]")
    s2, hotel = call("GET", "/api/v1/hotels/me", token=partner_token, hotel_id=hotel_id)
    sub_s, sub = call("GET", "/api/v1/hotels/me/subscription",
                      token=partner_token, hotel_id=hotel_id)
    print(f"  Hotel: {hotel.get('name')} | hotel.status={hotel.get('status')}")
    print(f"  Sub: status={sub.get('status')} expiry={sub.get('expiry_date')} grace_days={sub.get('grace_days')}")
    today = date.today()
    exp_str = sub.get("expiry_date")
    if exp_str:
        exp_d = date.fromisoformat(exp_str)
        grace = sub.get("grace_days") or 0
        grace_end = exp_d + timedelta(days=grace)
        print(f"  today={today} expiry={exp_d} grace_end={grace_end}")
        if today > grace_end:
            print("  STATUS: TRULY EXPIRED (past grace) — should be blocked")
        elif today > exp_d:
            print("  STATUS: In grace period — still allowed (correct)")
        else:
            print("  STATUS: Active — not expired")
    else:
        print("  No subscription found")

    # ── BUG 3/4: Subscription enforcement test ─────────────────────
    print("\n[BUG-2b: Can we make bookings? (should be blocked if expired)]")
    s_book, book_test = call("GET", "/api/v1/bookings?limit=1",
                              token=partner_token, hotel_id=hotel_id)
    print(f"  GET /bookings: {s_book} (403 if blocked)")

    # ── BUG 1: Room stat cards ─────────────────────────────────────
    print("\n[BUG-1: Room stat card data]")
    s4, rooms = call("GET", "/api/v1/rooms?limit=50", token=partner_token, hotel_id=hotel_id)
    statuses = Counter(r.get("status") for r in (rooms.get("items") or []))
    print(f"  Rooms total: {rooms.get('total')} | status breakdown: {dict(statuses)}")
    arriving = sum(1 for r in (rooms.get("items") or []) if r.get("arriving_today"))
    with_next_bk = sum(1 for r in (rooms.get("items") or []) if r.get("next_booking_date"))
    print(f"  arriving_today rooms: {arriving} | has_next_booking: {with_next_bk}")

    # ── BUG 7: Draft restore room amounts ─────────────────────────
    print("\n[BUG-7: Room availability (prices in availability response?)]")
    today_str = date.today().isoformat()
    tom_str = (date.today() + timedelta(days=1)).isoformat()
    s5, avail = call("GET",
                     f"/api/v1/rooms/availability?check_in={today_str}&check_out={tom_str}",
                     token=partner_token, hotel_id=hotel_id)
    avail_rooms = avail.get("available") or []
    print(f"  Available rooms: {len(avail_rooms)}")
    for r in avail_rooms[:3]:
        price = r.get("room_type_base_price")
        print(f"    Room {r.get('room_number')} | base_price={price} | next_booking={r.get('next_booking_date')}")
    if not avail_rooms:
        print("  No available rooms — all occupied/booked")

    # ── BUG 5: Guest edit — existing documents ─────────────────────
    print("\n[BUG-5: Guest documents — do existing guests have saved docs?]")
    s6, glist = call("GET", "/api/v1/guests?limit=5", token=partner_token, hotel_id=hotel_id)
    guests = glist.get("items") or []
    for g in guests[:3]:
        gid = g.get("id")
        sdocs, docs = call("GET", f"/api/v1/guests/{gid}/documents",
                           token=partner_token, hotel_id=hotel_id)
        doc_sides = [d.get("side") for d in (docs if isinstance(docs, list) else [])]
        print(f"  {g.get('full_name')} | id_last4={g.get('id_last4')} | docs={doc_sides}")

    # ── BUG 2b: Duplicate guest search results ─────────────────────
    print("\n[BUG-2b: Guest search duplicates?]")
    s7, gsearch = call("GET", "/api/v1/guests/search?phone=9",
                       token=partner_token, hotel_id=hotel_id)
    items = gsearch.get("items") or []
    names = [i.get("full_name") for i in items]
    dupes = {n: c for n, c in Counter(names).items() if c > 1}
    print(f"  Results: {len(items)} | Duplicates: {dupes if dupes else 'None'}")
    for item in items[:5]:
        print(f"    {item.get('full_name')} | {item.get('phone_masked')} | cross_hotel={item.get('cross_hotel')}")

    # ── Storage (photos) ───────────────────────────────────────────
    print("\n[STORAGE: Photos persisted?]")
    ss, storage = call("GET", "/api/v1/storage/health",
                       token=partner_token, hotel_id=hotel_id)
    print(f"  backend={storage.get('backend')} | write={storage.get('write_ok')} | read={storage.get('read_ok')} | persist={storage.get('files_persist_across_restarts')} | err={storage.get('error')}")

# ─── Super Admin checks ────────────────────────────────────────────
print("\n" + "=" * 60)
print("SUPER ADMIN CHECKS")
print("=" * 60)

sa_creds = [
    ("owner@sg.in",                  "Admin@12345"),     # might be SA too
    ("superadmin@digitalmyhotels.in", "Admin@12345"),
    ("admin@sg.in",                  "Admin@12345"),
]
sa_token = None
for em, pw in sa_creds:
    s, d = call("POST", "/api/v1/auth/login", {"email": em, "password": pw})
    u = (d.get("user") or {})
    if s == 200 and u.get("is_super_admin"):
        sa_token = d["access_token"]
        print(f"\nSA login OK: {u.get('email')}")
        break
    else:
        print(f"SA attempt {em}: {s} | is_sa={u.get('is_super_admin', '?')}")

if sa_token:
    # ── SA Dashboard counts ────────────────────────────────────────
    sd, dash = call("GET", "/api/v1/super-admin/dashboard", token=sa_token)
    print(f"\n[SA-DASH] {sd}")
    if sd == 200:
        print(f"  total={dash.get('total_hotels')} active={dash.get('active_hotels')} "
              f"expired={dash.get('expired_hotels')} recently_expired={dash.get('recently_expired')} "
              f"expiring_soon={dash.get('expiring_soon')}")
        print(f"  total_revenue={dash.get('total_revenue')}")

    # ── BUG 3: Recently expired list ──────────────────────────────
    se, exp = call(
        "GET",
        "/api/v1/super-admin/hotels?status=expired&recent_days=30&expiring_within=7&limit=50",
        token=sa_token
    )
    print(f"\n[SA BUG-3/4: Expired+expiring list] {se}")
    if se == 200:
        items = exp.get("items") or []
        print(f"  total={exp.get('total')} showing={len(items)}")
        for h in items:
            days_diff = None
            if h.get("expiry_date"):
                exp_d = date.fromisoformat(h["expiry_date"])
                days_diff = (exp_d - date.today()).days
            print(f"  '{h.get('name')}' | status={h.get('status')} sub={h.get('subscription_status')} expiry={h.get('expiry_date')} days_until={days_diff}")

    # ── Search for Hotel Pramod ────────────────────────────────────
    sp, pramod = call("GET", "/api/v1/super-admin/hotels?q=pramod&limit=10", token=sa_token)
    print(f"\n[SA: Search 'pramod'] {sp}")
    for h in (pramod.get("items") or []):
        print(f"  '{h.get('name')}' | status={h.get('status')} sub={h.get('subscription_status')} expiry={h.get('expiry_date')}")

    # ── All hotels to see full picture ─────────────────────────────
    sh, all_h = call("GET", "/api/v1/super-admin/hotels?limit=100", token=sa_token)
    print(f"\n[SA: ALL hotels] {sh} | total={all_h.get('total')}")
    for h in (all_h.get("items") or []):
        exp_d = h.get("expiry_date")
        days_until = None
        if exp_d:
            days_until = (date.fromisoformat(exp_d) - date.today()).days
        print(f"  '{h.get('name')}' | status={h.get('status')} | sub={h.get('subscription_status')} | expiry={exp_d} | days={days_until}")

print("\n=== VERIFICATION COMPLETE ===")
