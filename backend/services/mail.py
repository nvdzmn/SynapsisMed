"""Email delivery for approved patient messages, through a Gmail account.

Every message goes to the one inbox named in PATIENT_MAIL_SINK.  A patient's own
address is never used, so nothing can reach a real person by accident.
"""
import asyncio, os, smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from fastapi import HTTPException
from .xai import load_local_env

GMAIL_HOST = "smtp.gmail.com"
GMAIL_PORT = 465

def mail_settings() -> dict:
    load_local_env()
    return {"sender": (os.getenv("GMAIL_ADDRESS") or "").strip(), "password": (os.getenv("GMAIL_APP_PASSWORD") or "").replace(" ", ""), "sink": (os.getenv("PATIENT_MAIL_SINK") or "").strip()}

def mail_status() -> dict:
    """What is set up, without revealing any of it."""
    settings = mail_settings()
    missing = [name for name, key in (("GMAIL_ADDRESS", "sender"), ("GMAIL_APP_PASSWORD", "password"), ("PATIENT_MAIL_SINK", "sink")) if not settings[key]]
    return {"ready": not missing, "missing": missing, "recipient": settings["sink"] or None}

def build_message(settings: dict, subject: str, body: str, patient_name: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = f"SynapseMed care team <{settings['sender']}>"
    message["To"] = settings["sink"]
    message["Subject"] = " ".join(subject.split()) or "A message from your care team"
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain="synapsemed.local")
    message.set_content(f"{body.strip()}\n\n--\nSynapseMed demo. Written for {patient_name}, a synthetic record, and delivered to the test inbox only.\n")
    return message

def deliver(settings: dict, message: EmailMessage) -> None:
    with smtplib.SMTP_SSL(GMAIL_HOST, GMAIL_PORT, timeout=20) as server:
        server.login(settings["sender"], settings["password"])
        server.send_message(message)

async def send_patient_message(subject: str, body: str, patient_name: str) -> dict:
    status = mail_status()
    if not status["ready"]: raise HTTPException(503, f"Email delivery is not set up. Add {', '.join(status['missing'])} to backend/.env.")
    settings = mail_settings(); message = build_message(settings, subject, body, patient_name)
    try: await asyncio.to_thread(deliver, settings, message)
    except smtplib.SMTPAuthenticationError: raise HTTPException(502, "Gmail refused the sign-in. Check GMAIL_ADDRESS and use an app password, not the account password.")
    except (smtplib.SMTPException, OSError) as exc: raise HTTPException(502, f"The message was approved but could not be delivered: {type(exc).__name__}")
    return {"recipient": settings["sink"], "message_id": message["Message-ID"]}
