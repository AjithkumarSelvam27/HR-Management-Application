"""Dev mailer: no SMTP is configured, so messages are printed to the server console.

Swap `send_email` for a real provider (SMTP, SES, SendGrid...) before going live.
"""
import os


def app_url() -> str:
    return os.environ.get("APP_URL", "http://localhost:4200")


def send_email(to: str, subject: str, body: str) -> None:
    print(f"\n--- EMAIL to {to} ---\nSubject: {subject}\n{body}\n---------------------\n", flush=True)
