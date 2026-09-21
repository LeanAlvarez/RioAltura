"""Heartbeat job: proves the scheduler is alive. No real work."""

import logging

logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_SECONDS = 60


def heartbeat() -> None:
    logger.info("heartbeat")
