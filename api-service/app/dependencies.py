from collections.abc import Iterator

from fastapi import Depends
from sqlalchemy.orm import Session

from .db import SessionLocal


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
