from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from ..models import Comanda, Pagamento
from ..operational_models import AtendimentoMesa
from .financeiro import money
from .refund_guard import remaining_refund_allocations_guarded


def _command_label(command: Comanda | None) -> str:
    if command is None:
        return "Pagamento"
    tipo = str(command.tipo or "").strip().lower()
    if command.mesa_id:
        return f"Mesa {command.mesa_id}"
    if "retirada" in tipo:
        return f"Retirada #{command.numero_pedido}"
    if tipo in {"delivery", "entrega"}:
        return f"Delivery #{command.numero_pedido}"
    return f"Pedido #{command.numero_pedido}"


def refundable_payment_payload_human(
    db: Session,
    restaurante_id: int,
    payment: Pagamento,
) -> dict[str, object]:
    rows = remaining_refund_allocations_guarded(db, restaurante_id, payment)
    command_ids = {str(row["comanda_id"]) for row in rows if row.get("comanda_id")}
    attendance_ids = {
        str(row["atendimento_id"])
        for row in rows
        if row.get("atendimento_id")
    }
    commands = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.id.in_(command_ids),
        )
        .all()
        if command_ids
        else []
    )
    command_map = {str(command.id): command for command in commands}
    attendances = (
        db.query(AtendimentoMesa)
        .filter(
            AtendimentoMesa.restaurante_id == restaurante_id,
            AtendimentoMesa.id.in_(attendance_ids),
        )
        .all()
        if attendance_ids
        else []
    )
    attendance_map = {
        str(attendance.id): attendance
        for attendance in attendances
    }

    primary_command = command_map.get(str(payment.comanda_id))
    available = money(sum(
        (money(row.get("disponivel", 0)) for row in rows),
        Decimal("0.00"),
    ))

    origins = []
    for row in rows:
        attendance_id = str(row["atendimento_id"]) if row.get("atendimento_id") else None
        attendance = attendance_map.get(attendance_id) if attendance_id else None
        command = command_map.get(str(row.get("comanda_id") or ""))
        if attendance is not None:
            label = f"Conta #{attendance.numero_conta}"
            if attendance.mesa_id:
                label += f" · Mesa {attendance.mesa_id}"
            if command is not None and command.numero_pedido:
                label += f" · Pedido #{command.numero_pedido}"
            elif command is not None:
                label += f" · Parte {str(command.id)[-6:]}"
        else:
            label = _command_label(command)
        origins.append({
            "comanda_id": row["comanda_id"],
            "atendimento_id": row.get("atendimento_id"),
            "label": label,
            "valor_original": float(money(row.get("original", 0))),
            "valor_estornado": float(money(row.get("estornado", 0))),
            "saldo_estornavel": float(money(row.get("disponivel", 0))),
            "bloqueado": bool(row.get("bloqueado", False)),
            "motivo_bloqueio": row.get("motivo_bloqueio"),
        })

    return {
        "id": payment.id,
        "comanda_id": payment.comanda_id,
        "turno_id": payment.turno_id,
        "valor_original": float(money(payment.valor)),
        "saldo_estornavel": float(available),
        "metodo_original": payment.metodo,
        "status": payment.status,
        "criado_em": payment.criado_em,
        "origem": _command_label(primary_command),
        "numero_pedido": getattr(primary_command, "numero_pedido", None) if primary_command else None,
        "mesa_id": getattr(primary_command, "mesa_id", None) if primary_command else None,
        "origens_financeiras": origins,
        "bloqueado": any(origin["bloqueado"] for origin in origins),
    }
