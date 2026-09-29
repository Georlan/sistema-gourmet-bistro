"""Retenção/minimização de PII redundante sem destruir histórico comercial.

A política não define um prazo jurídico universal. O cutoff é sempre explícito e
aprovado operacionalmente. Cliente.id, fatos de pedidos, valores e métricas
comerciais permanecem intactos para CRM; apenas snapshots redundantes de PII são
minimizados.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from typing import Any

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.engine import Connection, Engine

from ..crypt import encrypt_field
from ..delivery_address_snapshot import ComandaDeliveryAddressSnapshot
from ..models import Comanda, HistoricoFidelidade, MensagemWhatsApp, RascunhoPedido


CONFIRMATION_PHRASE = "APPLY_KOMA_PRIVACY_RETENTION"


@dataclass(frozen=True)
class RetentionPlan:
    database: str
    restaurante_id: int
    cutoff_iso: str
    counts: dict[str, int]
    fingerprint: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": "dry-run",
            "database": self.database,
            "restaurante_id": self.restaurante_id,
            "cutoff": self.cutoff_iso,
            "counts": self.counts,
            "total_candidates": sum(self.counts.values()),
            "fingerprint": self.fingerprint,
            "preserves": [
                "clientes",
                "cliente_id",
                "pedidos",
                "itens",
                "valores",
                "datas",
                "fidelidade",
                "metricas_comerciais",
            ],
            "excluded_manual_legal_review": [
                "pagamentos.cpf_cliente",
                "pagamentos.nome_cliente",
                "registros_fiscais",
                "logs_de_seguranca",
                "backups",
            ],
        }


def _database_name(connection: Connection) -> str:
    if connection.dialect.name == "postgresql":
        return str(connection.execute(text("SELECT current_database()")).scalar_one()).strip()
    return str(connection.engine.url.database or ":memory:")


def _normalized_cutoff(cutoff: datetime) -> datetime:
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)
    return cutoff.astimezone(timezone.utc)


def _effective_order_date():
    return func.coalesce(Comanda.fechado_em, Comanda.criado_em)


def _count(connection: Connection, statement) -> int:
    return int(connection.execute(statement).scalar_one())


def build_retention_plan(
    connection: Connection,
    *,
    restaurante_id: int,
    cutoff: datetime,
) -> RetentionPlan:
    cutoff = _normalized_cutoff(cutoff)

    eligible_orders = (
        (Comanda.restaurante_id == restaurante_id)
        & (Comanda.fechada.is_(True))
        & (Comanda.cliente_id.is_not(None))
        & (_effective_order_date() < cutoff)
    )
    order_ids = select(Comanda.id).where(eligible_orders)

    counts = {
        "comandas_snapshots": _count(
            connection,
            select(func.count()).select_from(Comanda.__table__).where(eligible_orders),
        ),
        "enderecos_estruturados": _count(
            connection,
            select(func.count())
            .select_from(ComandaDeliveryAddressSnapshot.__table__)
            .where(
                ComandaDeliveryAddressSnapshot.restaurante_id == restaurante_id,
                ComandaDeliveryAddressSnapshot.comanda_id.in_(order_ids),
            ),
        ),
        "mensagens_whatsapp": _count(
            connection,
            select(func.count())
            .select_from(MensagemWhatsApp.__table__)
            .where(
                MensagemWhatsApp.restaurante_id == restaurante_id,
                MensagemWhatsApp.criado_em < cutoff,
            ),
        ),
        "rascunhos_pedidos": _count(
            connection,
            select(func.count())
            .select_from(RascunhoPedido.__table__)
            .where(
                RascunhoPedido.restaurante_id == restaurante_id,
                RascunhoPedido.criado_em < cutoff,
            ),
        ),
        "fidelidade_phone_snapshots": _count(
            connection,
            select(func.count())
            .select_from(HistoricoFidelidade.__table__)
            .where(
                HistoricoFidelidade.restaurante_id == restaurante_id,
                HistoricoFidelidade.cliente_id.is_not(None),
                HistoricoFidelidade.criado_em < cutoff,
            ),
        ),
    }

    database = _database_name(connection)
    payload = json.dumps(
        {
            "database": database,
            "restaurante_id": restaurante_id,
            "cutoff": cutoff.isoformat(),
            "counts": counts,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    fingerprint = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return RetentionPlan(
        database=database,
        restaurante_id=restaurante_id,
        cutoff_iso=cutoff.isoformat(),
        counts=counts,
        fingerprint=fingerprint,
    )


def apply_retention(
    engine: Engine,
    *,
    restaurante_id: int,
    cutoff: datetime,
    expected_database: str,
    expected_fingerprint: str,
    confirmation: str,
    backup_reference: str,
) -> dict[str, Any]:
    if confirmation != CONFIRMATION_PHRASE:
        raise RuntimeError("Frase de confirmação inválida.")
    if not backup_reference.strip():
        raise RuntimeError("A aplicação exige referência de backup restaurável.")

    cutoff = _normalized_cutoff(cutoff)
    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            connection.execute(
                text("SELECT pg_advisory_xact_lock(hashtext('koma-privacy-retention-v1'))")
            )

        plan = build_retention_plan(
            connection,
            restaurante_id=restaurante_id,
            cutoff=cutoff,
        )
        if plan.database != expected_database:
            raise RuntimeError("Banco atual diverge do banco confirmado no dry-run.")
        if plan.fingerprint != expected_fingerprint:
            raise RuntimeError("O banco mudou após o dry-run; gere um novo plano.")

        eligible_orders = (
            (Comanda.restaurante_id == restaurante_id)
            & (Comanda.fechada.is_(True))
            & (Comanda.cliente_id.is_not(None))
            & (_effective_order_date() < cutoff)
        )
        order_ids = select(Comanda.id).where(eligible_orders)

        removed_addresses = connection.execute(
            delete(ComandaDeliveryAddressSnapshot).where(
                ComandaDeliveryAddressSnapshot.restaurante_id == restaurante_id,
                ComandaDeliveryAddressSnapshot.comanda_id.in_(order_ids),
            )
        ).rowcount or 0

        minimized_orders = connection.execute(
            update(Comanda)
            .where(eligible_orders)
            .values(
                identificador=encrypt_field("Cliente"),
                delivery_telefone=None,
                delivery_endereco=None,
                delivery_bairro=None,
            )
        ).rowcount or 0

        anonymized_messages = connection.execute(
            update(MensagemWhatsApp)
            .where(
                MensagemWhatsApp.restaurante_id == restaurante_id,
                MensagemWhatsApp.criado_em < cutoff,
            )
            .values(
                cliente_telefone=encrypt_field("ANONIMIZADO"),
                conteudo=encrypt_field("Conteúdo expirado pela política de retenção."),
                transcricao=encrypt_field("Removido."),
                audio_url=None,
            )
        ).rowcount or 0

        anonymized_drafts = connection.execute(
            update(RascunhoPedido)
            .where(
                RascunhoPedido.restaurante_id == restaurante_id,
                RascunhoPedido.criado_em < cutoff,
            )
            .values(
                cliente_telefone=encrypt_field("ANONIMIZADO"),
                conteudo_json=encrypt_field("{}"),
                ia_sugestao_resposta=encrypt_field("Removido."),
            )
        ).rowcount or 0

        minimized_loyalty = connection.execute(
            update(HistoricoFidelidade)
            .where(
                HistoricoFidelidade.restaurante_id == restaurante_id,
                HistoricoFidelidade.cliente_id.is_not(None),
                HistoricoFidelidade.criado_em < cutoff,
            )
            .values(cliente_telefone=encrypt_field("ANONIMIZADO"))
        ).rowcount or 0

        after = build_retention_plan(
            connection,
            restaurante_id=restaurante_id,
            cutoff=cutoff,
        )
        if after.counts["enderecos_estruturados"] != 0:
            raise RuntimeError("Validação final falhou: snapshots estruturados permaneceram.")

        return {
            "mode": "apply",
            "database": plan.database,
            "restaurante_id": restaurante_id,
            "cutoff": plan.cutoff_iso,
            "backup_reference": backup_reference,
            "fingerprint": plan.fingerprint,
            "minimized": {
                "comandas_snapshots": int(minimized_orders),
                "enderecos_estruturados": int(removed_addresses),
                "mensagens_whatsapp": int(anonymized_messages),
                "rascunhos_pedidos": int(anonymized_drafts),
                "fidelidade_phone_snapshots": int(minimized_loyalty),
            },
            "validation": "passed",
        }
