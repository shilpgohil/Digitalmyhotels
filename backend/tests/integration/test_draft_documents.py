"""Check-in draft photo persistence (client 16/09).

Queued co-guest photos are uploaded to hotel-scoped draft storage on
"Save Draft"; the draft JSON stores only object keys. Covers:
- upload → download round-trip
- delete is idempotent
- tenant isolation: hotel B can never read hotel A's draft photo
- TTL sweep removes expired rows
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.guest import GuestDraftDocument
from app.services.guests import sweep_expired_draft_documents
from tests.integration.conftest import HotelFixture, auth_headers, login

pytestmark = pytest.mark.asyncio(loop_scope="session")

# Tiny JPEG payload — content-type is what the service validates.
_JPEG = b"\xff\xd8\xff\xe0fakejpegbytes"


async def _headers(client: AsyncClient, hotel: HotelFixture):
    email, password = hotel.credentials("owner")
    token = await login(client, email, password)
    return {**auth_headers(token), "X-Hotel-Id": str(hotel.hotel.id)}


async def _upload(client: AsyncClient, headers) -> str:
    resp = await client.post(
        "/api/v1/guests/draft-documents",
        files={"file": ("front.jpg", _JPEG, "image/jpeg")},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["key"]


async def test_draft_doc_roundtrip_and_delete(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    key = await _upload(client, headers)
    assert f"hotels/{hotel_a.hotel.id}/draft-docs/" in key

    got = await client.get(
        f"/api/v1/guests/draft-documents/content?key={key}", headers=headers
    )
    assert got.status_code == 200, got.text
    assert got.content == _JPEG
    assert got.headers["content-type"].startswith("image/jpeg")

    deleted = await client.delete(
        f"/api/v1/guests/draft-documents?key={key}", headers=headers
    )
    assert deleted.status_code == 204
    # Idempotent — second delete is still a 204.
    deleted2 = await client.delete(
        f"/api/v1/guests/draft-documents?key={key}", headers=headers
    )
    assert deleted2.status_code == 204
    gone = await client.get(
        f"/api/v1/guests/draft-documents/content?key={key}", headers=headers
    )
    assert gone.status_code == 404


async def test_draft_doc_tenant_isolation(
    client: AsyncClient, hotel_a: HotelFixture, hotel_b: HotelFixture
) -> None:
    headers_a = await _headers(client, hotel_a)
    headers_b = await _headers(client, hotel_b)
    key = await _upload(client, headers_a)

    # Hotel B can neither read nor (effectively) delete hotel A's photo.
    read_b = await client.get(
        f"/api/v1/guests/draft-documents/content?key={key}", headers=headers_b
    )
    assert read_b.status_code == 404
    await client.delete(
        f"/api/v1/guests/draft-documents?key={key}", headers=headers_b
    )
    still_there = await client.get(
        f"/api/v1/guests/draft-documents/content?key={key}", headers=headers_a
    )
    assert still_there.status_code == 200


async def test_draft_doc_ttl_sweep(
    client: AsyncClient, hotel_a: HotelFixture, db_session: AsyncSession
) -> None:
    headers = await _headers(client, hotel_a)
    key = await _upload(client, headers)

    # Age the row past the TTL, then sweep.
    await db_session.execute(
        update(GuestDraftDocument)
        .where(GuestDraftDocument.object_key == key)
        .values(created_at=datetime.now(UTC) - timedelta(days=8))
    )
    await db_session.commit()

    removed = await sweep_expired_draft_documents(db_session)
    assert removed >= 1

    gone = await client.get(
        f"/api/v1/guests/draft-documents/content?key={key}", headers=headers
    )
    assert gone.status_code == 404


async def test_draft_doc_rejects_non_image(
    client: AsyncClient, hotel_a: HotelFixture
) -> None:
    headers = await _headers(client, hotel_a)
    resp = await client.post(
        "/api/v1/guests/draft-documents",
        files={"file": ("notes.txt", b"not-an-image", "text/plain")},
        headers=headers,
    )
    assert resp.status_code == 422
