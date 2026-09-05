"""Local process ownership and bounded logs; never changes system printers."""
from contextlib import contextmanager
import logging
from logging.handlers import RotatingFileHandler
import errno
import os

from pairing import credentials_path


class AgentAlreadyRunning(RuntimeError):
    pass


@contextmanager
def single_instance(path=None):
    path = path or credentials_path().with_name("agent.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if exc.errno not in (errno.EACCES, errno.EAGAIN):
                raise
            raise AgentAlreadyRunning("O conector do Kôma já está em execução.") from exc
        # Closing releases the lock, including after a crash. Keep the inode:
        # deleting a lock file permits concurrent owners on Unix.
        yield


def configure_file_logging():
    path = credentials_path().with_name("agent.log")
    path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(path, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logging.getLogger().addHandler(handler)
