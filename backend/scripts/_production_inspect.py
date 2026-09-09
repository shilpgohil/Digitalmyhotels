"""Full production API + DB inspection script."""
import asyncio
import json
import urllib.request
import urllib.error

API = "https://digitalmyhotels-api-sg.onrender.com"


def call(method, path, body=None, token=None, hotel_id=None):
    url = f"{API}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if hotel_id:
        headers["X-Hotel-Id"] = hotel_id
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {"error": str(e)}


async def main():
    print("=" * 60)
    print("PRODUCTION API INSPECTION")
    print("=" * 60)

    # 1. Health check
    status, data = call("GET", "/health")
    print(f"\n[1] Health: {status} — {data}")

    # 2. Login — try multiple known accounts
    token = None
    hotel_id = None
    login_emails = [
        ("owner@sg.in", "ChangeMe123!"),
        ("prathrawat@sg.in", "ChangeMe123!"),
        ("rohilsharma47@gmail.com", "ChangeMe123!"),
        ("owner@pr.com", "ChangeMe123!"),
    ]
    for email, password in login_emails:
        status, data = call("POST", "/api/v1/auth/login", {"email": email, "password": password})
        if status == 200:
            token = data.get("access_token")
            memberships = data.get("memberships", [])
            hotel_id = memberships[0]["hotel_id"] if memberships else None
            user_email = data.get("user", {}).get("email", "?")
            print(f"\n[2] Login: {status} — user={user_email}, hotel_id={hotel_id}")
            break
        else:
            print(f"    Tried {email}: {status}")

    if not token:
        print("[2] All login attempts failed — cannot continue API tests")
        return

    def api(method, path, body=None):
        return call(method, path, body, token, hotel_id)

    # 3. Current guests
    status, data = api("GET", "/api/v1/current-guests?limit=10")
    guests = data.get("items", [])
    print(f"\n[3] Current Guests: {status} — {len(guests)} in-house")
    for g in guests[:4]:
        print(f"    {g['booking_number']} - {g['primary_guest_name']} | due=INR {g['due_amount']} | room={g['rooms']}")

    # 4. CO-GUEST SEARCH — the reported bug
    print("\n[4] Co-guest search (reported bug):")
    # OLD broken param
    s1, d1 = api("GET", "/api/v1/guests/search?q=7802912597")
    # NEW correct param
    s2, d2 = api("GET", "/api/v1/guests/search?phone=7802912597")
    # Partial prefix
    s3, d3 = api("GET", "/api/v1/guests/search?phone=780")
    print(f"    ?q=7802912597      -> {s1}, results={len(d1.get('items',[]))}")
    print(f"    ?phone=7802912597  -> {s2}, results={len(d2.get('items',[]))}")
    print(f"    ?phone=780 (prefix)-> {s3}, results={len(d3.get('items',[]))}")
    if d2.get("items"):
        g = d2["items"][0]
        print(f"    Found: {g['full_name']} | {g['phone_masked']}")

    # 5. All guests list
    s5, d5 = api("GET", "/api/v1/guests?limit=5")
    print(f"\n[5] Guests list: {s5} — total={d5.get('total',0)}")

    # 6. Notifications
    s6, d6 = api("GET", "/api/v1/notifications?limit=8")
    print(f"\n[6] Notifications: {s6} — unread={d6.get('unread',0)}")
    for n in d6.get("items", [])[:4]:
        print(f"    [{n['category']}] {n['title']} | read={n['is_read']}")

    # 7. Room status summary
    s7, d7 = api("GET", "/api/v1/rooms/status-summary")
    print(f"\n[7] Room Status: {s7} — {d7}")

    # 8. Confirmed bookings (advance)
    s8, d8 = api("GET", "/api/v1/bookings?status=confirmed&limit=5")
    print(f"\n[8] Confirmed bookings: {s8} — {d8.get('total',0)} total")
    for b in d8.get("items", [])[:3]:
        print(f"    {b['booking_number']} - {b.get('primary_guest_name','?')} | {b['check_in_date']} | guest_type={b.get('guest_type','?')}")

    # 9. Daily closing
    s9, d9 = api("GET", "/api/v1/ops/daily-closing/today")
    print(f"\n[9] Daily Closing: {s9} — status={d9.get('status')} | backdated_payments={d9.get('backdated_payments_count',0)}")

    # 10. Smart dashboard
    s10, d10 = api("GET", "/api/v1/reports/smart-dashboard")
    kpis = d10.get("kpis", {})
    print(f"\n[10] Smart Dashboard: {s10}")
    print(f"     RevPAR={kpis.get('revpar')} | ADR={kpis.get('adr')} | occupancy={d10.get('today_occupancy_pct')}%")
    print(f"     Insights: {len(d10.get('insights',[]))}")

    # 11. Plans
    s11, d11 = api("GET", "/api/v1/subscriptions/plans")
    active_plans = [p for p in d11 if p.get("is_active")]
    print(f"\n[11] Active Plans: {[p['name'] for p in active_plans]}")

    # 12. Checkout preview (if in-house guest exists)
    if guests:
        booking_id = guests[0]["booking_id"]
        s12, d12 = call("POST", f"/api/v1/checkouts/{booking_id}/quote",
                         {"charges": [], "checked_out_at": None, "expected_check_out_date": None,
                          "expected_check_out_time": None},
                         token, hotel_id)
        print(f"\n[12] Checkout quote for {guests[0]['booking_number']}: {s12}")
        if s12 == 200:
            print(f"     final_total={d12.get('final_total')} | due={d12.get('due')} | gst={d12.get('gst_amount')}")

    # 13. Expenses
    s13, d13 = api("GET", "/api/v1/expenses?limit=5")
    print(f"\n[13] Expenses: {s13} — {d13.get('total',0)} total")

    # 14. Payments summary
    from datetime import date
    today = date.today().isoformat()
    s14, d14 = api("GET", f"/api/v1/payments/summary?from_date=2026-09-01&to_date={today}")
    print(f"\n[14] Payment summary (Sep 2026): {s14}")
    if s14 == 200:
        print(f"     total_collected={d14.get('total_collected')} | cash={d14.get('cash')} | upi={d14.get('upi')}")

    print("\n" + "=" * 60)
    print("INSPECTION COMPLETE")
    print("=" * 60)

asyncio.run(main())
