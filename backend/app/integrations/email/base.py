from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class EmailMessage:
    to: str
    subject: str
    body_text: str
    body_html: str | None = None


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


def get_email_backend() -> EmailBackend:
    settings = get_settings()
    if settings.email_backend == "console":
        return ConsoleEmailBackend()
    return StubEmailBackend()
