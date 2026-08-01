"""Regras compartilhadas para identificar clientes por telefone."""

from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Cliente


def normalizar_telefone_cliente(telefone: str) -> str:
    """Retorna apenas DDD+número e rejeita identificadores ambíguos."""
    normalizado = "".join(caractere for caractere in (telefone or "") if caractere.isdigit())
    if len(normalizado) not in {10, 11}:
        raise ValueError("Telefone do cliente deve conter DDD e 10 ou 11 dígitos.")
    return normalizado


def cadastrar_ou_atualizar_cliente(
    db: Session,
    *,
    restaurante_id: int,
    telefone: str,
    nome: str,
    endereco: Optional[str] = None,
) -> Cliente:
    """Cria ou atualiza uma única ficha por restaurante e telefone.

    A restrição única no banco continua sendo a última linha de defesa. O
    savepoint permite recuperar de duas primeiras compras simultâneas sem
    desfazer o restante da transação do pedido.
    """
    telefone_normalizado = normalizar_telefone_cliente(telefone)
    nome_normalizado = nome.strip()
    endereco_normalizado = (endereco or "").strip() or None

    cliente = db.query(Cliente).filter(
        Cliente.restaurante_id == restaurante_id,
        Cliente.telefone == telefone_normalizado,
    ).first()

    if cliente is None:
        novo_cliente = Cliente(
            id=str(uuid.uuid4()),
            restaurante_id=restaurante_id,
            telefone=telefone_normalizado,
            nome=nome_normalizado,
            endereco=endereco_normalizado,
            saldo_pontos=0,
            saldo_cashback=0.0,
        )
        try:
            with db.begin_nested():
                db.add(novo_cliente)
                db.flush([novo_cliente])
            cliente = novo_cliente
        except IntegrityError:
            cliente = db.query(Cliente).filter(
                Cliente.restaurante_id == restaurante_id,
                Cliente.telefone == telefone_normalizado,
            ).one()

    cliente.nome = nome_normalizado
    if endereco_normalizado is not None:
        cliente.endereco = endereco_normalizado
    db.flush([cliente])
    return cliente
