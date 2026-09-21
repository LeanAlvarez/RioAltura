"""Health checks."""

import logging

from sqlalchemy import Engine, text

logger = logging.getLogger(__name__)


def check_db(engine: Engine) -> bool:
    """Return True when a trivial query succeeds against the database."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:  # noqa: BLE001 - any failure means "db: error"
        logger.warning("database health check failed: %s", exc)
        return False
