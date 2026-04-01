import logging
import sys
import datetime


class _LocalTimezoneFormatter(logging.Formatter):
    """Formatter that emits timestamps in local wall-clock time (respects TZ env var)."""

    def formatTime(self, record, datefmt=None):
        # datetime.fromtimestamp uses time.localtime() which honours the TZ env var
        dt = datetime.datetime.fromtimestamp(record.created)
        if datefmt:
            return dt.strftime(datefmt)
        return dt.strftime('%Y-%m-%dT%H:%M:%S') + f',{record.msecs:03.0f}'


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        h = logging.StreamHandler(sys.stdout)
        h.setFormatter(_LocalTimezoneFormatter(
            '{"time":"%(asctime)s","level":"%(levelname)s","name":"%(name)s","msg":"%(message)s"}'
        ))
        logger.addHandler(h)
    logger.setLevel(logging.INFO)
    return logger
