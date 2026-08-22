from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Item, Lancamento
from ..operational_models import AtendimentoComanda
from .atendimentos import get_launch_identity, get_table_family_snapshot


def build_table_family_view(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
) -> list[dict]:
    """Read model da mesa para a UI.

    A família financeira vem do atendimento atual, mas o rótulo do pedido vem
    sempre do lançamento ORIGINAL. Assim um item movido da Conta #46 para a
    Conta #51 continua aparecendo como "Pedido #46-B" na mesa destino, em vez
    de ganhar um ID fictício ou cair novamente para `l-xxxx`.
    """
    families = get_table_family_snapshot(db, restaurante_id, mesa_id)
    for family in families:
        command_ids = [
            row[0]
            for row in db.query(AtendimentoComanda.comanda_id)
            .filter(
                AtendimentoComanda.restaurante_id == restaurante_id,
                AtendimentoComanda.atendimento_id == family["atendimento_id"],
            )
            .all()
        ]
        if not command_ids:
            family["lancamentos"] = []
            continue

        launch_ids = [
            row[0]
            for row in db.query(Item.lancamento_id)
            .filter(
                Item.restaurante_id == restaurante_id,
                Item.comanda_id.in_(command_ids),
                Item.status != "cancelado",
            )
            .distinct()
            .all()
            if row[0]
        ]
        launches = (
            db.query(Lancamento)
            .filter(
                Lancamento.restaurante_id == restaurante_id,
                Lancamento.id.in_(launch_ids),
            )
            .order_by(Lancamento.timestamp.asc(), Lancamento.id.asc())
            .all()
            if launch_ids
            else []
        )
        projected = []
        for launch in launches:
            identity = get_launch_identity(db, restaurante_id, launch.id)
            projected.append(
                {
                    "lancamento_id": launch.id,
                    "sequencia": identity.sequencia if identity is not None else None,
                    "pedido_id": identity.label if identity is not None else None,
                    "timestamp": launch.timestamp,
                    "atendimento_origem_id": identity.atendimento_id if identity is not None else None,
                    "transferido": (
                        identity.atendimento_id != family["atendimento_id"]
                        if identity is not None
                        else False
                    ),
                    "identity_status": "persisted" if identity is not None else "missing",
                }
            )
        family["lancamentos"] = projected
    return families
