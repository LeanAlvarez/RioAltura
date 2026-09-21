"""Entry point: python -m jobs"""

from app.logging_config import configure_logging

from jobs.scheduler import build_scheduler, run
from jobs.settings import get_settings


def main() -> None:
    configure_logging(get_settings().log_level)
    run(build_scheduler())


if __name__ == "__main__":
    main()
