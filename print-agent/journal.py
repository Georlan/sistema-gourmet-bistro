"""
Diário de Bordo Local SQLite para Idempotência e Resiliência Off-line/On-line.
Evita novo envio dos trabalhos registrados quando a confirmação HTTP falha.
Aceitação pelo spooler não comprova saída no papel. Uma queda entre o envio ao
spooler e a gravação local deixa o resultado incerto e pode exigir conferência.
"""

import os
import sqlite3
import datetime
import time
from contextlib import contextmanager
from typing import Optional, Dict, Any, List


class PrintJournal:
    def __init__(self, db_path: str = "journal.db"):
        self.db_path = db_path
        self._last_cleanup = 0.0
        self._init_db()

    @contextmanager
    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 10000")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_db(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        with self._get_connection() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS journal_jobs (
                    job_id TEXT PRIMARY KEY,
                    idempotency_key TEXT,
                    status TEXT NOT NULL, -- 'printed', 'failed'
                    printer_name TEXT,
                    error_msg TEXT,
                    printed_at TIMESTAMP,
                    confirmed_backend INTEGER DEFAULT 0 -- 1 se complete_job foi aceito pelo backend
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_journal_ikey ON journal_jobs(idempotency_key)")
            conn.commit()

    def is_printed(self, job_id: str, idempotency_key: Optional[str] = None) -> bool:
        """Verifica se o job já foi aceito pelo spooler nesta máquina."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            if idempotency_key:
                cursor.execute(
                    "SELECT 1 FROM journal_jobs WHERE (job_id = ? OR idempotency_key = ?) AND status = 'printed'",
                    (job_id, idempotency_key)
                )
            else:
                cursor.execute(
                    "SELECT 1 FROM journal_jobs WHERE job_id = ? AND status = 'printed'",
                    (job_id,)
                )
            return cursor.fetchone() is not None

    def is_confirmed(self, job_id: str) -> bool:
        """Verifica se a impressão já foi confirmada no backend."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT confirmed_backend FROM journal_jobs WHERE job_id = ? AND status = 'printed'",
                (job_id,)
            )
            row = cursor.fetchone()
            return row is not None and row["confirmed_backend"] == 1

    def record_print_success(self, job_id: str, idempotency_key: str, printer_name: str, confirmed: bool = False):
        """Registra a aceitação pelo spooler no banco local."""
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO journal_jobs (job_id, idempotency_key, status, printer_name, printed_at, confirmed_backend)
                VALUES (?, ?, 'printed', ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    status = 'printed',
                    printer_name = EXCLUDED.printer_name,
                    printed_at = EXCLUDED.printed_at,
                    confirmed_backend = EXCLUDED.confirmed_backend
            """, (job_id, idempotency_key, printer_name, now, 1 if confirmed else 0))
            conn.commit()

    def mark_backend_confirmed(self, job_id: str):
        """Marca no journal local que o backend recebeu a confirmação."""
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE journal_jobs SET confirmed_backend = 1 WHERE job_id = ?",
                (job_id,)
            )
            if time.monotonic() - self._last_cleanup < 60:
                return
            # Mantém a deduplicação local por sete dias, limitada aos 2.000
            # trabalhos confirmados mais recentes. Pendências HTTP nunca são
            # removidas por esta manutenção.
            cutoff = (
                datetime.datetime.now(datetime.timezone.utc)
                - datetime.timedelta(days=7)
            ).isoformat()
            conn.execute(
                """
                DELETE FROM journal_jobs
                WHERE confirmed_backend = 1
                  AND printed_at < ?
                """,
                (cutoff,),
            )
            conn.execute(
                """
                DELETE FROM journal_jobs
                WHERE confirmed_backend = 1
                  AND job_id NOT IN (
                    SELECT job_id
                    FROM journal_jobs
                    WHERE confirmed_backend = 1
                    ORDER BY printed_at DESC
                    LIMIT 2000
                  )
                """
            )
            conn.commit()
            self._last_cleanup = time.monotonic()

    def get_unconfirmed_printed_jobs(self) -> List[Dict[str, Any]]:
        """Retorna trabalhos que já foram aceitos pelo spooler mas aguardam reconexão HTTP para confirmação."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT job_id, idempotency_key, printer_name
                FROM journal_jobs
                WHERE status = 'printed' AND confirmed_backend = 0
            """)
            return [dict(row) for row in cursor.fetchall()]
