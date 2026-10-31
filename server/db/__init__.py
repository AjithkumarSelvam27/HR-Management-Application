import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from sqlalchemy import create_engine

load_dotenv()  # idempotent — safe even if main.py already called it

engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True, pool_recycle=3600)


def utcnow() -> datetime:
    """Naive UTC datetime — all DATETIME columns hold UTC."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
