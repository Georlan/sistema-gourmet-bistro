"""Worker assíncrono e contínuo para processamento e despacho da IntegrationOutbox."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import uuid
from typing import Optional

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from ...database import TenantSession, engine, tenant_session_scope
from ..order_chat_retention import purge_expired_closed_conversations_in_session
from ..scheduled_orders import release_due_scheduled_orders_in_session
from .dispatcher import DEFAULT_STALE_TIMEOUT_SECONDS, dispatch_pending_outbox_events

logger = logging.getLogger("koma.outbox.worker")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=TenantSession)


def discover_active_restaurant_ids(db: Session) -> list[int]:
    """Descobre IDs de restaurantes disponíveis para varredura do worker multi-tenant.

    No PostgreSQL, utiliza a função SECURITY DEFINER `koma_internal.list_public_restaurants()`
    autorizada para o papel `koma_app` sem depender de tenant contextual prévio.
    No SQLite (testes/local), consulta diretamente a tabela `restaurantes`.

    Fail-closed: Qualquer erro de banco, permissão ou migração ausente é propagado
    (não engolido como lista vazia), garantindo que o worker trate o erro no loop,
    faça retry e o incidente seja observável em métricas/logs.
    """
    bind = db.get_bind()
    if bind and bind.dialect.name == "postgresql":
        result = db.execute(
            text("SELECT id FROM koma_internal.list_public_restaurants()")
        ).scalars().all()
    else:
        result = db.execute(
            text("SELECT id FROM restaurantes")
        ).scalars().all()

    return [int(rid) for rid in result if rid is not None]


class OutboxWorker:
    """Worker de execução em segundo plano para envio contínuo da Outbox."""

    def __init__(
        self,
        *,
        poll_interval_seconds: float = 2.0,
        batch_size: int = 20,
        worker_id: Optional[str] = None,
        stale_timeout_seconds: int = DEFAULT_STALE_TIMEOUT_SECONDS,
        chat_retention_enabled: Optional[bool] = None,
        chat_retention_days: Optional[int] = None,
        chat_retention_batch_size: Optional[int] = None,
        chat_retention_sweep_seconds: Optional[float] = None,
    ):
        self.poll_interval_seconds = poll_interval_seconds
        self.batch_size = batch_size
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        self.stale_timeout_seconds = stale_timeout_seconds
        self.chat_retention_enabled = (
            os.getenv("ORDER_CHAT_RETENTION_ENABLED", "false").lower() == "true"
            if chat_retention_enabled is None
            else bool(chat_retention_enabled)
        )
        self.chat_retention_days = max(
            1,
            int(
                os.getenv("ORDER_CHAT_RETENTION_DAYS", "90")
                if chat_retention_days is None
                else chat_retention_days
            ),
        )
        self.chat_retention_batch_size = max(
            1,
            min(
                500,
                int(
                    os.getenv("ORDER_CHAT_RETENTION_BATCH_SIZE", "100")
                    if chat_retention_batch_size is None
                    else chat_retention_batch_size
                ),
            ),
        )
        self.chat_retention_sweep_seconds = max(
            300.0,
            float(
                os.getenv("ORDER_CHAT_RETENTION_SWEEP_SECONDS", "21600")
                if chat_retention_sweep_seconds is None
                else chat_retention_sweep_seconds
            ),
        )
        self.is_running = False
        self._stop_event: Optional[asyncio.Event] = None
        self._task: Optional[asyncio.Task] = None
        self._wake_event: Optional[asyncio.Event] = None
        self._loop = None
        self._next_chat_retention_sweep_at = 0.0

    def wake(self):
        """Commit notification is a hint; periodic reconciliation stays durable."""
        if self._loop and not self._loop.is_closed() and self._wake_event:
            self._loop.call_soon_threadsafe(self._wake_event.set)

    def run_once(
        self,
        *,
        restaurant_id: Optional[int] = None,
        client: Optional[httpx.Client] = None,
    ) -> dict[str, int]:
        """Executa um ciclo único de despacho de forma síncrona sob isolamento RLS para cada tenant."""
        db: TenantSession = SessionLocal()
        aggregated_stats = {
            "claimed": 0,
            "delivered": 0,
            "failed": 0,
            "dead_letter": 0,
            "recovered_stale": 0,
            "total": 0,
            "scheduled_released": 0,
        }
        try:
            if restaurant_id is not None:
                target_tenant_ids = [restaurant_id]
            else:
                target_tenant_ids = discover_active_restaurant_ids(db)

            for rid in target_tenant_ids:
                try:
                    with tenant_session_scope(db, rid):
                        released = release_due_scheduled_orders_in_session(
                            db,
                            restaurante_id=rid,
                        )
                        if released:
                            db.commit()
                            aggregated_stats["scheduled_released"] += released
                            logger.info(
                                "[SCHEDULED ORDERS] %d pedido(s) liberado(s) para o tenant %s.",
                                released,
                                rid,
                            )

                        stats = dispatch_pending_outbox_events(
                            db,
                            batch_size=self.batch_size,
                            worker_id=self.worker_id,
                            stale_timeout_seconds=self.stale_timeout_seconds,
                            restaurant_id=rid,
                            client=client,
                        )
                        for key in (
                            "claimed",
                            "delivered",
                            "failed",
                            "dead_letter",
                            "recovered_stale",
                            "total",
                        ):
                            aggregated_stats[key] += stats.get(key, 0)
                except Exception as tenant_exc:
                    db.rollback()
                    logger.error(
                        "[OUTBOX WORKER] Erro ao processar outbox do tenant %s: %s",
                        rid,
                        tenant_exc,
                        exc_info=True,
                    )

            return aggregated_stats
        finally:
            db.close()

    def run_chat_retention_sweep(
        self,
        *,
        restaurant_id: Optional[int] = None,
    ) -> dict[str, int]:
        """Executa um sweep limitado da retenção de chat sob o contexto RLS de cada tenant."""
        aggregated_stats = {
            "conversations_deleted": 0,
            "messages_deleted": 0,
            "push_subscriptions_deleted": 0,
        }
        if not self.chat_retention_enabled:
            return aggregated_stats

        db: TenantSession = SessionLocal()
        try:
            if restaurant_id is not None:
                target_tenant_ids = [restaurant_id]
            else:
                target_tenant_ids = discover_active_restaurant_ids(db)

            for rid in target_tenant_ids:
                try:
                    with tenant_session_scope(db, rid):
                        stats = purge_expired_closed_conversations_in_session(
                            db,
                            restaurante_id=rid,
                            retention_days=self.chat_retention_days,
                            batch_size=self.chat_retention_batch_size,
                        )
                        if stats["conversations_deleted"]:
                            db.commit()
                        for key in aggregated_stats:
                            aggregated_stats[key] += stats.get(key, 0)
                except Exception as tenant_exc:
                    db.rollback()
                    logger.error(
                        "[CHAT RETENTION] Erro ao processar retenção do tenant %s: %s",
                        rid,
                        tenant_exc,
                        exc_info=True,
                    )

            return aggregated_stats
        finally:
            db.close()

    async def run_loop(self) -> None:
        """Loop contínuo de varredura assíncrona com tratamento de paradas graciosas."""
        logger.info(
            "[OUTBOX WORKER] Iniciando worker %s (intervalo=%0.1fs, lote=%d)",
            self.worker_id,
            self.poll_interval_seconds,
            self.batch_size,
        )
        self.is_running = True
        if self._stop_event is None:
            self._stop_event = asyncio.Event()
        self._loop = asyncio.get_running_loop()
        self._wake_event = asyncio.Event()
        idle_delay = self.poll_interval_seconds

        while self.is_running and not self._stop_event.is_set():
            try:
                loop = asyncio.get_running_loop()
                self._wake_event.clear()
                stats = await loop.run_in_executor(None, self.run_once)

                retention_deleted = 0
                if (
                    self.chat_retention_enabled
                    and loop.time() >= self._next_chat_retention_sweep_at
                ):
                    retention_stats = await loop.run_in_executor(
                        None,
                        self.run_chat_retention_sweep,
                    )
                    self._next_chat_retention_sweep_at = (
                        loop.time() + self.chat_retention_sweep_seconds
                    )
                    retention_deleted = retention_stats["conversations_deleted"]
                    if retention_deleted:
                        logger.info(
                            "[CHAT RETENTION] Sweep concluído: %s",
                            retention_stats,
                        )

                if (
                    stats["total"] > 0
                    or stats["recovered_stale"] > 0
                    or stats["scheduled_released"] > 0
                    or retention_deleted > 0
                ):
                    logger.debug("[OUTBOX WORKER] Ciclo concluído: %s", stats)
                    await asyncio.sleep(0.1)
                    idle_delay = self.poll_interval_seconds
                else:
                    try:
                        await asyncio.wait_for(self._wake_event.wait(), timeout=idle_delay)
                        idle_delay = self.poll_interval_seconds
                    except asyncio.TimeoutError:
                        idle_delay = min(10.0, idle_delay * 2)

            except asyncio.CancelledError:
                logger.info("[OUTBOX WORKER] Recebido cancelamento no worker %s.", self.worker_id)
                break
            except Exception as exc:
                logger.error(
                    "[OUTBOX WORKER] Erro não tratado no ciclo do worker %s: %s",
                    self.worker_id,
                    exc,
                    exc_info=True,
                )
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
        self.wake()

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
        batch_size=int(os.getenv("OUTBOX_BATCH_SIZE", "20")),
    )

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    task = worker.start()
    await stop_event.wait()
    await worker.stop()


if __name__ == "__main__":
    asyncio.run(_run_standalone_cli())
