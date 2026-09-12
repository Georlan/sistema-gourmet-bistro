"""Serialize provider setup per contract across processes, including commits."""
from contextlib import contextmanager
import threading
from sqlalchemy import text

_locks = [threading.Lock() for _ in range(64)]

@contextmanager
def checkout_lock(db, protocol):
    import hashlib
    key = int.from_bytes(hashlib.sha256(('koma-checkout:'+protocol).encode()).digest()[:8], 'big', signed=True)
    if db.get_bind().dialect.name == 'postgresql':
        # Dedicated short transaction: API setup commits cannot release this lock.
        with db.get_bind().begin() as connection:
            connection.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key':key})
            yield
    else:
        with _locks[key % len(_locks)]:
            yield
