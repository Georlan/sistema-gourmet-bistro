"""Bounded, read-only history of the authenticated waiter's own table launches."""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload

from ..database import get_db, require_tenant_id
from ..domain.orders.types import format_order_family_id
from ..models import Comanda, Item, Lancamento, Mesa, Usuario
from ..operational_models import AtendimentoMesa, LancamentoIdentidade
from ..security import get_current_user
from ..services.order_item_composition import load_item_modifiers

router = APIRouter(prefix='/garcom/historico', tags=['Garçom'])
LOCAL_ZONE = ZoneInfo('America/Fortaleza')


def _query(db, tenant_id, user_id):
    return db.query(Lancamento, Comanda, Mesa.nome, LancamentoIdentidade.sequencia, AtendimentoMesa.numero_conta).join(
        Comanda, and_(Comanda.id == Lancamento.comanda_id, Comanda.restaurante_id == tenant_id)
    ).outerjoin(Mesa, and_(Mesa.id == Comanda.mesa_id, Mesa.restaurante_id == tenant_id)).outerjoin(
        LancamentoIdentidade, and_(LancamentoIdentidade.lancamento_id == Lancamento.id, LancamentoIdentidade.restaurante_id == tenant_id)
    ).outerjoin(AtendimentoMesa, and_(AtendimentoMesa.id == LancamentoIdentidade.atendimento_id, AtendimentoMesa.restaurante_id == tenant_id)).filter(
        Lancamento.restaurante_id == tenant_id, Lancamento.garcom_id == user_id, Comanda.mesa_id.isnot(None)
    )


def _summary(row, count):
    launch, check, table_name, sequence, account_number = row
    return {
        'id': launch.id,
        'pedido': format_order_family_id(account_number, sequence) if account_number is not None and sequence is not None else None,
        'mesa_id': check.mesa_id,
        'mesa_nome': table_name or f'Mesa {check.mesa_id}',
        'horario': launch.timestamp.replace(tzinfo=timezone.utc).isoformat(),
        'itens_count': count,
    }


@router.get('')
def list_own_history(
    dia: str | None = None,
    antes: str | None = Query(default=None, max_length=128),
    limite: int = Query(default=20, ge=1, le=30),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    tenant_id = require_tenant_id()
    try:
        day = datetime.strptime(dia, '%Y-%m-%d').date() if dia else datetime.now(LOCAL_ZONE).date()
    except ValueError:
        raise HTTPException(status_code=422, detail='Data inválida.')
    start = datetime.combine(day, time.min, tzinfo=LOCAL_ZONE).astimezone(timezone.utc).replace(tzinfo=None)
    end = start + timedelta(days=1)
    query = _query(db, tenant_id, current_user.id).filter(Lancamento.timestamp >= start, Lancamento.timestamp < end)
    if antes:
        cursor = query.filter(Lancamento.id == antes).first()
        if cursor is None:
            raise HTTPException(status_code=422, detail='Página inválida para este histórico.')
        query = query.filter(or_(Lancamento.timestamp < cursor[0].timestamp, and_(Lancamento.timestamp == cursor[0].timestamp, Lancamento.id < antes)))
    rows = query.order_by(Lancamento.timestamp.desc(), Lancamento.id.desc()).limit(limite + 1).all()
    page = rows[:limite]
    ids = [row[0].id for row in page]
    counts = dict(db.query(Item.lancamento_id, func.count(Item.id)).filter(
        Item.restaurante_id == tenant_id, Item.lancamento_id.in_(ids)
    ).group_by(Item.lancamento_id).all()) if ids else {}
    return {'dia': day.isoformat(), 'items': [_summary(row, counts.get(row[0].id, 0)) for row in page],
            'next_cursor': page[-1][0].id if len(rows) > limite else None}


@router.get('/{launch_id}')
def own_history_detail(launch_id: str, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    tenant_id = require_tenant_id()
    row = _query(db, tenant_id, current_user.id).filter(Lancamento.id == launch_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail='Pedido não encontrado no seu histórico.')
    items = db.query(Item).options(joinedload(Item.produto)).filter(
        Item.restaurante_id == tenant_id, Item.lancamento_id == launch_id
    ).order_by(Item.id).all()
    modifiers = load_item_modifiers(db, tenant_id, [item.id for item in items]) if items else {}
    return {**_summary(row, len(items)), 'itens': [{
        'id': item.id, 'nome': item.produto.nome if item.produto else 'Produto removido',
        'preco': float(item.preco_unit), 'cliente': item.cliente_nome, 'observacao': item.observacao,
        'status': item.status, 'modificadores': [{'nome': modifier.nome, 'preco': float(modifier.preco)} for modifier in modifiers.get(str(item.id), [])],
    } for item in items]}
