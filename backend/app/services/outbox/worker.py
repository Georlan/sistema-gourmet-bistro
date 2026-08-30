"""Worker assíncrono e contínuo para processamento e despacho da IntegrationOutbox."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import uuid
from typing import Optional
from sqlalchemy.orm import sessionmaker

from ...database import TenantSession, engine
from .dispatcher import DEFAULT_STALE_TIMEOUT_SECONDS, dispatch_pending_outbox_events

logger = logging.getLogger("koma.outbox.worker")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=TenantSession)


class OutboxWorker:
    """Worker de execução em segundo plano para envio contínuo da Outbox."""

    def __init__(
        self,
        *,
        poll_interval_seconds: float = 2.0,
        batch_size: int = 50,
        worker_id: Optional[str] = None,
        stale_timeout_seconds: int = DEFAULT_STALE_TIMEOUT_SECONDS,
    ):
        self.poll_interval_seconds = poll_interval_seconds
        self.batch_size = batch_size
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        self.stale_timeout_seconds = stale_timeout_seconds
        self.is_running = False
        self._stop_event: Optional[asyncio.Event] = None
        self._task: Optional[asyncio.Task] = None

    def run_once(self, *, restaurant_id: Optional[int] = None) -> dict[str, int]:
        """Executa um ciclo único de despacho de forma síncrona."""
        db: TenantSession = SessionLocal()
        try:
            return dispatch_pending_outbox_events(
                db,
                batch_size=self.batch_size,
                worker_id=self.worker_id,
                stale_timeout_seconds=self.stale_timeout_seconds,
                restaurant_id=restaurant_id,
            )
        finally:
            db.close()

    async def run_loop(self) -> None:
        """Loop contínuo de varredura assíncrona com tratamento de paradas graciosas."""
        logger.info("[OUTBOX WORKER] Iniciando worker %s (intervalo=%0.1fs, lote=%d)", self.worker_id, self.poll_interval_seconds, self.batch_size)
        self.is_running = True
        if self._stop_event is None:
            self._stop_event = asyncio.Event()

        while self.is_running and not self._stop_event.is_set():
            try:
                loop = asyncio.get_running_loop()
                stats = await loop.run_in_executor(None, self.run_once)

                # Se havia trabalho para fazer, processa o próximo lote com menor latência
                if stats["total"] > 0 or stats["recovered_stale"] > 0:
                    logger.debug("[OUTBOX WORKER] Ciclo concluído: %s", stats)
                    await asyncio.sleep(0.1)
                else:
                    await asyncio.sleep(self.poll_interval_seconds)

            except asyncio.CancelledError:
                logger.info("[OUTBOX WORKER] Recebido cancelamento no worker %s.", self.worker_id)
                break
            except Exception as exc:
                logger.error("[OUTBOX WORKER] Erro não tratado no ciclo do worker %s: %s", self.worker_id, exc, exc_info=True)
                await asyncio.sleep(2.0)

        self.is_running = False
        logger.info("[OUTBOX WORKER] Worker %s finalizado.", self.worker_id)

    def start(self) -> asyncio.Task:
        """Inicia a execução do worker como uma tarefa asyncio em segundo plano."""
        if self.is_running and self._task and not self._task.done():
            return self._task

        self.is_running = True
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self.run_loop())
        return self._task

    async def stop(self, timeout_seconds: float = 5.0) -> None:
        """Sinaliza parada graciosa para o worker e aguarda encerramento."""
        self.is_running = False
        if self._stop_event:
            self._stop_event.set()

        if self._task:
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=timeout_seconds)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
            self._task = None


# Instância singleton padrão da aplicação
default_outbox_worker = OutboxWorker()


async def _run_standalone_cli():
    """Função de entrada para rodar como processo daemon CLI independente."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    worker = OutboxWorker(
        poll_interval_seconds=float(os.getenv("OUTBOX_POLL_INTERVAL", "2.0")),
        batch_size=int(os.getenv("OUTBOX_BATCH_SIZE", "50")),
    )

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass  # Windows fallback

    task = worker.start()
    await stop_event.wait()
    await worker.stop()


if __name__ == "__main__":
    asyncio.run(_run_standalone_cli())
