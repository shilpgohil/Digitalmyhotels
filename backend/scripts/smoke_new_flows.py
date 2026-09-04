"""End-to-end smoke test for the client updated-figma flows (local stack).

Exercises against http://127.0.0.1:8001 with the seeded demo hotel:
  1. Walk-in atomic book-and-checkin with guest_type/times + Form C foreign guest
  2. Foreign guest details readable back
  3. Restaurant + damage charges against the stay
  4. Restaurant billing report includes the charge
  5. Advance booking with future dates + times
  6. Checkout with authorization (dues path)
  7. Role checks: housekeeping blocked from book-and-checkin and restaurant report

Run: .venv\\Scripts\\python.exe -m scripts.smoke_new_flows
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import date, timedelta

import httpx

BASE = "http://127.0.0.1:8001"
PASSWORD = "ChangeMe123!"
OWNER = "owner@meridiancourt.in"

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(name)
        print(f"  OK   {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL {name} {detail}")


async def login(client: httpx.AsyncClient, email: str) -> dict:
    r = await client.post(f"{BASE}/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    r.raise_for_status()
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


async def main() -> None:
    # Digits-only suffix — used in phone numbers, which reject hex letters.
    suffix = str(uuid.uuid4().int)[:6]
    today = date.today()
    async with httpx.AsyncClient(timeout=30) as client:
        h = await login(client, OWNER)

        # Fresh room type + room to avoid conflicts with existing data.
        rt = await client.post(
            f"{BASE}/api/v1/rooms/types",
            json={
                "code": f"SM{suffix[:3].upper()}",
                "name": f"Smoke {suffix}",
                "base_price": "1500.00",
            },
            headers=h,
        )
        check("create room type", rt.status_code == 201, rt.text[:200])
        room = await client.post(
            f"{BASE}/api/v1/rooms",
            json={"room_number": f"S{suffix[:4]}", "room_type_id": rt.json()["id"]},
            headers=h,
        )
        check("create room", room.status_code == 201, room.text[:200])
        room_id = room.json()["id"]

        guest = await client.post(
            f"{BASE}/api/v1/guests",
            json={"full_name": "Smoke Foreign Guest", "phone": f"98{suffix}11"[:10]},
            headers=h,
        )
        check("create guest", guest.status_code == 201, guest.text[:200])
        guest_id = guest.json()["id"]

        # 1. Atomic walk-in with Form C
        bci = await client.post(
            f"{BASE}/api/v1/checkins/book-and-checkin",
            json={
                "booking": {
                    "primary_guest_id": guest_id,
                    "room_ids": [room_id],
                    "check_in_date": str(today),
                    "check_out_date": str(today + timedelta(days=2)),
                    "adults": 1,
                    "guest_type": "business",
                    "check_in_time": "14:00",
                    "check_out_time": "11:00",
                },
                "terms_acknowledged": True,
                "foreign_guest": {
                    "passport_number": "P1234567",
                    "visa_type": "Tourist",
                    "nationality": "German",
                    "coming_from_country": "Germany",
                    "purpose_of_visit": "Tourism",
                },
            },
            headers=h,
        )
        check("walk-in book-and-checkin", bci.status_code == 201, bci.text[:300])
        booking_id = bci.json()["booking_id"]
        check("registration issued", bool(bci.json().get("registration_numbers")))

        bk = await client.get(f"{BASE}/api/v1/bookings/{booking_id}", headers=h)
        check(
            "booking checked_in + fields",
            bk.json().get("status") == "checked_in"
            and bk.json().get("guest_type") == "business"
            and bk.json().get("check_in_time") == "14:00",
            bk.text[:300],
        )

        # 2. Form C readable
        fg = await client.get(f"{BASE}/api/v1/bookings/{booking_id}/foreign-guests", headers=h)
        check(
            "foreign guest stored",
            fg.status_code == 200
            and len(fg.json()) == 1
            and fg.json()[0]["passport_number"] == "P1234567",
            fg.text[:300],
        )

        # 3. Restaurant + damage charges
        rc = await client.post(
            f"{BASE}/api/v1/charges",
            json={
                "booking_id": booking_id,
                "category": "restaurant",
                "description": "Dinner order",
                "quantity": 1,
                "rate": "950.00",
            },
            headers=h,
        )
        check("restaurant charge", rc.status_code == 201, rc.text[:300])
        dc = await client.post(
            f"{BASE}/api/v1/charges",
            json={
                "booking_id": booking_id,
                "category": "damage",
                "description": "Broken lamp",
                "quantity": 1,
                "rate": "500.00",
            },
            headers=h,
        )
        check("damage charge", dc.status_code == 201, dc.text[:300])

        # 4. Restaurant billing report
        rb = await client.get(
            f"{BASE}/api/v1/reports/restaurant-billing",
            params={"from_date": str(today), "to_date": str(today)},
            headers=h,
        )
        found = any(
            "Dinner" in str(i) or i["guest_name"] == "Smoke Foreign Guest"
            for i in rb.json().get("items", [])
        )
        check("restaurant billing report", rb.status_code == 200 and found, rb.text[:300])

        # 5. Advance booking (future)
        guest2 = await client.post(
            f"{BASE}/api/v1/guests",
            json={"full_name": "Smoke Advance Guest", "phone": f"97{suffix}22"[:10]},
            headers=h,
        )
        adv = await client.post(
            f"{BASE}/api/v1/bookings",
            json={
                "primary_guest_id": guest2.json()["id"],
                "room_ids": [room_id],
                "check_in_date": str(today + timedelta(days=10)),
                "check_out_date": str(today + timedelta(days=12)),
                "guest_type": "family",
                "check_in_time": "13:00",
            },
            headers=h,
        )
        check("advance booking (future, same room ok)", adv.status_code == 201, adv.text[:300])

        # 6. Checkout with dues authorization (owner can authorize)
        co = await client.post(
            f"{BASE}/api/v1/checkouts",
            json={"booking_id": booking_id, "allow_due": True, "due_reason": "Smoke test dues"},
            headers=h,
        )
        check("checkout w/ authorization", co.status_code == 201, co.text[:300])
        # Final total: room (2x1500) + restaurant 950 + damage 500 = 4950 (+GST)
        final_total = float(co.json().get("final_total", 0))
        check("checkout total includes charges", final_total >= 4450.0, str(final_total))

        # 7. Role checks — housekeeping blocked
        hk_email = None
        team = await client.get(f"{BASE}/api/v1/team", headers=h)
        if team.status_code == 200:
            for m in team.json().get("items", []):
                if m.get("role_code") == "housekeeping":
                    hk_email = m.get("email")
                    break
        if hk_email:
            try:
                hk = await login(client, hk_email)
                blocked1 = await client.post(
                    f"{BASE}/api/v1/checkins/book-and-checkin", json={}, headers=hk
                )
                check(
                    "housekeeping blocked from book-and-checkin",
                    blocked1.status_code == 403,
                    str(blocked1.status_code),
                )
                blocked2 = await client.get(
                    f"{BASE}/api/v1/reports/restaurant-billing",
                    params={"from_date": str(today), "to_date": str(today)},
                    headers=hk,
                )
                check(
                    "housekeeping blocked from restaurant report",
                    blocked2.status_code == 403,
                    str(blocked2.status_code),
                )
            except Exception as exc:  # login may fail if password differs
                print(f"  SKIP housekeeping role checks ({exc})")
        else:
            print("  SKIP housekeeping role checks (no housekeeping member seeded)")

        # ── Phase 2/3 additions ────────────────────────────────────────────

        # 8. Day-use booking with hourly pricing.
        du_rt = await client.post(
            f"{BASE}/api/v1/rooms/types",
            json={
                "code": f"DU{suffix[:3].upper()}",
                "name": f"Smoke DayUse {suffix}",
                "base_price": "2000.00",
                "hourly_rate": "250.00",
            },
            headers=h,
        )
        check("day-use room type w/ hourly rate", du_rt.status_code == 201, du_rt.text[:200])
        du_room = await client.post(
            f"{BASE}/api/v1/rooms",
            json={"room_number": f"D{suffix[:4]}", "room_type_id": du_rt.json()["id"]},
            headers=h,
        )
        check("day-use room", du_room.status_code == 201, du_room.text[:200])
        du_guest = await client.post(
            f"{BASE}/api/v1/guests",
            json={"full_name": "Smoke DayUse Guest", "phone": f"97{str(uuid.uuid4().int)[:8]}"},
            headers=h,
        )
        check("day-use guest", du_guest.status_code == 201, du_guest.text[:200])
        du = await client.post(
            f"{BASE}/api/v1/bookings",
            json={
                "primary_guest_id": du_guest.json()["id"],
                "room_ids": [du_room.json()["id"]],
                "check_in_date": str(today),
                "check_out_date": str(today),
                "check_in_time": "10:00",
                "check_out_time": "14:30",
            },
            headers=h,
        )
        check("day-use booking created", du.status_code == 201, du.text[:300])
        if du.status_code == 201:
            # 4.5 hrs → 5 billable hrs × 250 = 1250
            check(
                "day-use hourly price (5h x 250 = 1250)",
                float(du.json()["total_amount"]) == 1250.0,
                du.json()["total_amount"],
            )
            # Same-day second booking on the same room must conflict.
            du2 = await client.post(
                f"{BASE}/api/v1/bookings",
                json={
                    "primary_guest_id": du_guest.json()["id"],
                    "room_ids": [du_room.json()["id"]],
                    "check_in_date": str(today),
                    "check_out_date": str(today + timedelta(days=1)),
                },
                headers=h,
            )
            check("day-use blocks the calendar day", du2.status_code == 409, str(du2.status_code))

        # 9. Rate override flows into totals.
        ro_guest = await client.post(
            f"{BASE}/api/v1/guests",
            json={"full_name": "Smoke Override Guest", "phone": f"96{str(uuid.uuid4().int)[:8]}"},
            headers=h,
        )
        ro = await client.post(
            f"{BASE}/api/v1/bookings",
            json={
                "primary_guest_id": ro_guest.json()["id"],
                "room_ids": [room_id],
                "check_in_date": str(today + timedelta(days=20)),
                "check_out_date": str(today + timedelta(days=21)),
                "rate_overrides": [{"room_id": room_id, "rate": "1200"}],
            },
            headers=h,
        )
        check("rate-override booking", ro.status_code == 201, ro.text[:300])
        if ro.status_code == 201:
            check(
                "override rate used (1 night x 1200)",
                float(ro.json()["total_amount"]) == 1200.0,
                ro.json()["total_amount"],
            )

        # 10. Settlement preview matches checkout math shape.
        if du.status_code == 201:
            prev = await client.get(
                f"{BASE}/api/v1/checkouts/{du.json()['id']}/preview",
                headers=h,
            )
            check("settlement preview", prev.status_code == 200, prev.text[:200])
            if prev.status_code == 200:
                p = prev.json()
                check(
                    "preview totals coherent (due = total - paid)",
                    float(p["due"])
                    == max(float(p["final_total"]) - float(p["effective_paid"]), 0.0),
                    str(p),
                )

        # 11. Vendor GSTIN validation rejects garbage with a clear message.
        bad_vendor = await client.post(
            f"{BASE}/api/v1/expenses/vendors",
            json={"name": "Smoke Vendor", "gstin": "NOTAGSTIN123456"},
            headers=h,
        )
        check(
            "vendor bad GSTIN rejected (422)",
            bad_vendor.status_code == 422,
            bad_vendor.text[:200],
        )

    print(f"\n{'=' * 50}\n{len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("FAILED:", *FAILED, sep="\n  - ")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
