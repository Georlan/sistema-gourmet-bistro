"""Regras compartilhadas para identificar clientes por telefone."""

from __future__ import annotations

import uuid
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Cliente, HistoricoFidelidade


CENTAVOS = Decimal("0.01")


def normalizar_telefone_cliente(telefone: str) -> str:
    """Retorna apenas DDD+número e rejeita identificadores ambíguos."""
    normalizado = "".join(caractere for caractere in (telefone or "") if caractere.isdigit())
    if len(normalizado) not in {10, 11}:
        raise ValueError("Telefone do cliente deve conter DDD e 10 ou 11 dígitos.")
    return normalizado


def normalizar_nome_cliente(nome: str) -> str:
    normalizado = " ".join((nome or "").strip().split())
    if len(normalizado) < 2:
        raise ValueError("Nome do cliente deve conter pelo menos 2 caracteres.")
    if len(normalizado) > 100:
        raise ValueError("Nome do cliente deve conter no máximo 100 caracteres.")
    return normalizado


def buscar_cliente_por_telefone(
    db: Session,
    *,
    restaurante_id: int,
    telefone: str,
    bloquear: bool = False,
) -> Optional[Cliente]:
    telefone_normalizado = normalizar_telefone_cliente(telefone)
    query = db.query(Cliente).filter(
        Cliente.restaurante_id == restaurante_id,
        Cliente.telefone == telefone_normalizado,
    )
    if bloquear:
        query = query.with_for_update()
    return query.first()


def buscar_cliente_por_id(
    db: Session,
    *,
    restaurante_id: int,
    cliente_id: str,
    bloquear: bool = False,
) -> Optional[Cliente]:
    query = db.query(Cliente).filter(
        Cliente.restaurante_id == restaurante_id,
        Cliente.id == cliente_id,
    )
    if bloquear:
        query = query.with_for_update()
    return query.first()


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
    nome_normalizado = normalizar_nome_cliente(nome)
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


def registrar_movimento_fidelidade(
    db: Session,
    *,
    cliente: Cliente,
    tipo_movimentacao: str,
    valor_delta: Decimal | float | int,
    tipo_recompensa: str,
    comanda_id: Optional[str] = None,
) -> HistoricoFidelidade:
    """Registra o ledger e o saldo materializado na mesma transação.

    ``cliente_id`` é a fonte de identidade. O telefone criptografado continua
    como snapshot de compatibilidade, nunca como chave de relacionamento.
    """
    movimento = tipo_movimentacao.strip().upper()
    recompensa = tipo_recompensa.strip().upper()
    if movimento not in {"ACUMULO", "RESGATE"}:
        raise ValueError("Movimentação de fidelidade inválida.")
    if recompensa not in {"PONTOS", "CASHBACK"}:
        raise ValueError("Tipo de recompensa inválido.")

    delta = Decimal(str(valor_delta))
    if delta <= 0:
        raise ValueError("O valor da movimentação deve ser positivo.")
    sinal = Decimal("1") if movimento == "ACUMULO" else Decimal("-1")

    if recompensa == "PONTOS":
        pontos_delta = int(delta.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if pontos_delta <= 0:
            raise ValueError("A movimentação deve alterar ao menos um ponto.")
        novo_saldo = int(cliente.saldo_pontos or 0) + (
            pontos_delta if movimento == "ACUMULO" else -pontos_delta
        )
        if novo_saldo < 0:
            raise ValueError("Saldo de pontos insuficiente.")
        cliente.saldo_pontos = novo_saldo
        valor_ledger = Decimal(pontos_delta)
    else:
        cashback_delta = delta.quantize(CENTAVOS, rounding=ROUND_HALF_UP)
        novo_saldo = Decimal(str(cliente.saldo_cashback or 0)) + (
            cashback_delta * sinal
        )
        if novo_saldo < 0:
            raise ValueError("Saldo de cashback insuficiente.")
        cliente.saldo_cashback = novo_saldo.quantize(
            CENTAVOS,
            rounding=ROUND_HALF_UP,
        )
        valor_ledger = cashback_delta

    registro = HistoricoFidelidade(
        restaurante_id=cliente.restaurante_id,
        cliente_id=cliente.id,
        cliente_telefone=cliente.telefone,
        tipo_movimentacao=movimento,
        valor_delta=valor_ledger,
        comanda_id=comanda_id,
    )
    db.add(registro)
    db.flush([cliente, registro])
    return registro


def cliente_payload(cliente: Cliente) -> dict:
    return {
        "id": cliente.id,
        "cliente": cliente.nome,
        "nome": cliente.nome,
        "telefone": cliente.telefone,
        "endereco": cliente.endereco or "",
        "pontos": int(cliente.saldo_pontos or 0),
        "saldo_pontos": int(cliente.saldo_pontos or 0),
        "saldoCashback": float(cliente.saldo_cashback or 0),
        "saldo_cashback": float(cliente.saldo_cashback or 0),
    }
