from __future__ import annotations

import base64
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class EmailAttachment:
    filename: str
    content: bytes
    content_type: str = "application/pdf"


@dataclass
class EmailMessage:
    to: str
    subject: str
    body_text: str
    body_html: str | None = None
    attachments: list[EmailAttachment] = field(default_factory=list)


class EmailBackend(ABC):
    @abstractmethod
    async def send(self, message: EmailMessage) -> None:
        ...


class StubEmailBackend(EmailBackend):
    async def send(self, message: EmailMessage) -> None:
        logger.info("email.stub to=%s subject=%s", message.to, message.subject)


class ConsoleEmailBackend(EmailBackend):
    async def send(self, message: EmailMessage) -> None:
        print(f"[EMAIL] To: {message.to}\nSubject: {message.subject}\n\n{message.body_text}")


class ResendEmailBackend(EmailBackend):
    """Resend (resend.com) HTTP API — supports attachments."""

    async def send(self, message: EmailMessage) -> None:
        import httpx

        from app.core.errors import ValidationAppError

        settings = get_settings()
        if not settings.resend_api_key:
            raise ValidationAppError(
                "Email is not configured on this server (missing API key)",
                code="email_not_configured",
            )
        payload: dict = {
            "from": settings.email_from,
            "to": [message.to],
            "subject": message.subject,
            "text": message.body_text,
        }
        if message.body_html:
            payload["html"] = message.body_html
        if message.attachments:
            payload["attachments"] = [
                {
                    "filename": a.filename,
                    "content": base64.b64encode(a.content).decode("ascii"),
                }
                for a in message.attachments
            ]
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json=payload,
            )
        if resp.status_code >= 400:
            logger.error("email.resend_failed status=%s body=%s", resp.status_code, resp.text[:300])
            raise ValidationAppError(
                "Email provider rejected the message", code="email_send_failed"
            )


def get_email_backend() -> EmailBackend:
    settings = get_settings()
    if settings.email_backend == "console":
        return ConsoleEmailBackend()
    if settings.email_backend == "resend":
        return ResendEmailBackend()
    return StubEmailBackend()
