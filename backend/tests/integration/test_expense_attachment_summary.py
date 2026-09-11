"""Regression: add expense w/ vendor + net banking + receipt (client bug repro)
and the stat-card summary endpoint."""

from __future__ import annotations

from datetime import date

import pytest
from httpx import AsyncClient

from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_add_expense_client_repro(client: AsyncClient, hotel_a: HotelFixture) -> None:
    email, password = hotel_a.credentials("owner")
    headers = auth_headers(await login(client, email, password))

    cats = await client.get("/api/v1/expenses/categories", headers=headers)
    assert cats.status_code == 200, cats.text
    cleaning = next(c for c in cats.json() if c["name"] == "Cleaning")

    vendor = await client.post(
        "/api/v1/expenses/vendors",
        json={"name": "CleanCo Distributors", "phone": None, "gstin": None},
        headers=headers,
    )
    assert vendor.status_code == 201, vendor.text

    # Exactly what InlineAddExpense sends.
    expense = await client.post(
        "/api/v1/expenses",
        json={
            "amount": "500",
            "description": "Cleaning supplies",
            "expense_date": str(date.today()),
            "category_id": cleaning["id"],
            "vendor_id": vendor.json()["id"],
            "payment_method": "bank_transfer",
            "submit": True,
        },
        headers=headers,
    )
    assert expense.status_code == 201, expense.text
    expense_id = expense.json()["id"]

    # Attachment PUT like apiUpload does (multipart, jpeg).
    put = await client.put(
        f"/api/v1/expenses/{expense_id}/attachment",
        files={"file": ("receipt.jpg", b"\xff\xd8\xff\xe0fakejpegbytes", "image/jpeg")},
        headers=headers,
    )
    assert put.status_code == 200, put.text
    assert put.json()["has_attachment"] is True

    # New stat-card summary endpoint.
    summary = await client.get("/api/v1/expenses/summary", headers=headers)
    assert summary.status_code == 200, summary.text
    body = summary.json()
    # pending_amount was added in the 24h-noshow/pending-support batch.
    assert set(body) == {
        "total_amount", "today_amount", "month_amount", "entries", "pending_amount"
    }
    # The newly created expense is SUBMITTED (not yet approved), so:
    #   - today_amount  = approved+paid only → may be 0 if no prior approved expense today
    #   - pending_amount = submitted only → should be >= 500.0
    assert float(body["pending_amount"]) >= 500.0
    assert body["entries"] >= 1
