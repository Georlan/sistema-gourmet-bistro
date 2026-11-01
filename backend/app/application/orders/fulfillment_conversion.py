"""Conversão logística restrita, com prévia autoritativa e detecção de estado antigo."""
import hashlib
import datetime
import json
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session
from typing import Any
from ...models import Comanda, Mesa, Pagamento, OnlinePaymentIntent, ConfiguracaoRestaurante, ActivityLog, ExternalOrderReference
from ...operational_models import AtendimentoMesa, AtendimentoComanda
from ...fiscal_models import FiscalDocument
from ...delivery_address_snapshot import load_delivery_address_snapshot, revise_delivery_address_snapshot
from ...domain.orders.types import FulfillmentType, normalize_to_fulfillment
from ...domain.orders.errors import OrderDomainError
from ...services.order_financials import active_items_subtotal, payable_total, money, is_quick_counter_sale
from .addressing import delivery_address_from_payload
from .service import OrderApplicationService
from ...services.operational_modes import mode_is_allowed
from ...services.clientes import normalizar_telefone_cliente


def locked_order(db: Session, rid: int, order_id: str) -> Comanda:
    # Mesa primeiro: mesma ordem das operações que criam/transferem atendimento.
    source = db.query(Comanda.mesa_id).filter(Comanda.restaurante_id == rid, Comanda.id == order_id).first()
    if source is None:
        raise HTTPException(404, 'Comanda não encontrada')
    table_id = source[0]
    if table_id is not None:
        table = db.query(Mesa).filter(Mesa.restaurante_id == rid, Mesa.id == table_id).with_for_update().first()
        if table is None:
            raise HTTPException(409, 'Mesa não encontrada. Atualize os pedidos.')
    order = db.query(Comanda).filter(Comanda.restaurante_id == rid, Comanda.id == order_id).with_for_update(of=Comanda).first()
    if order is None:
        raise HTTPException(404, 'Comanda não encontrada')
    if order.mesa_id != table_id:
        raise HTTPException(409, 'O pedido mudou de mesa. Atualize e tente novamente.')
    return order


def blocked_reason(db: Session, order: Comanda) -> str | None:
    rid = order.restaurante_id
    table_order = bool(order.mesa_id)
    allowed_states = {'analise', 'pendente', 'aceito', 'producao', 'pronto'}
    if order.fechada or order.status_comanda or (order.delivery_status not in allowed_states and not (table_order and order.delivery_status is None)):
        return 'Pedido encerrado, em trânsito ou sem etapa operacional compatível.'
    if is_quick_counter_sale(order) or any(launch.origem == 'smartpos' for launch in order.lancamentos):
        return 'Venda rápida ou SmartPOS não permite esta conversão.'
    if normalize_to_fulfillment(order.tipo) == FulfillmentType.DINE_IN and not table_order:
        return 'Consumo sem mesa ainda não permite esta conversão.'
    if table_order:
        active_orders = db.query(Comanda.id).filter(Comanda.restaurante_id == rid, Comanda.mesa_id == order.mesa_id, Comanda.fechada == False).all()
        if len(active_orders) != 1:
            return 'A mesa possui mais de uma comanda aberta; não é possível converter apenas uma.'
        launches = [launch for launch in order.lancamentos if launch.status not in {'cancelado', 'recusado'}]
        if len(launches) != 1 or launches[0].status not in {'pendente', 'aceito', 'producao', 'pronto'}:
            return 'A mesa possui mais de um pedido ou um pedido já finalizado.'
        if any(item.status == 'entregue' for item in order.itens):
            return 'A mesa possui itens já servidos; não é possível convertê-los em entrega.'
        links = db.query(AtendimentoComanda).filter_by(restaurante_id=rid, comanda_id=order.id).all()
        linked_ids = {link.atendimento_id for link in links}
        open_accounts = db.query(AtendimentoMesa.id).filter_by(restaurante_id=rid, mesa_id=order.mesa_id, status='aberto').all()
        if any(account_id not in linked_ids for (account_id,) in open_accounts):
            return 'A mesa possui outro atendimento ativo; revise a conta antes de converter.'
        for link in links:
            account = db.query(AtendimentoMesa).filter_by(restaurante_id=rid, id=link.atendimento_id).with_for_update().first()
            if account is None or account.status != 'aberto' or account.mesa_id != order.mesa_id or account.principal_id is not None:
                return 'Atendimento inconsistente ou mesclado não permite conversão automática.'
            linked = db.query(AtendimentoComanda.id).filter_by(restaurante_id=rid, atendimento_id=account.id).count()
            children = db.query(AtendimentoMesa.id).filter_by(restaurante_id=rid, principal_id=account.id, status='aberto').count()
            if linked != 1 or children:
                return 'Atendimento com outras comandas ou mesas não permite conversão automática.'
    if order.cupom_id or money(order.valor_desconto_cupom) > 0 or money(order.valor_desconto_cashback) > 0:
        return 'Pedido com cupom ou cashback exige revisão financeira antes da conversão.'
    if db.query(ExternalOrderReference.id).filter(ExternalOrderReference.restaurante_id == rid, ExternalOrderReference.internal_order_id.in_([order.id, *(launch.id for launch in order.lancamentos)])).first():
        return 'Pedidos de integração externa não permitem esta conversão.'
    if order.motoboy_id:
        return 'Remova a atribuição do entregador pelo fluxo logístico antes de alterar o tipo.'
    if money(order.valor_pago) > 0 or order.online_payment_status is not None or any(item.pago for item in order.itens):
        return 'Pedido com pagamento registrado ou online não permite alteração de modalidade.'
    if db.query(Pagamento.id).filter(Pagamento.restaurante_id == rid, Pagamento.comanda_id == order.id, Pagamento.status != 'cancelado').first():
        return 'Pedido possui cobrança ou pagamento registrado.'
    if db.query(OnlinePaymentIntent.id).filter(OnlinePaymentIntent.restaurante_id == rid, OnlinePaymentIntent.comanda_id == order.id).first():
        return 'Pedido possui cobrança online; a modalidade não pode ser alterada.'
    if db.query(FiscalDocument.id).filter(FiscalDocument.restaurante_id == rid, FiscalDocument.comanda_id == order.id).first():
        return 'Pedido possui documento fiscal; a modalidade não pode ser alterada.'
    if not any(item.status != 'cancelado' for item in order.itens):
        return 'Pedido sem itens ativos não permite conversão.'
    return None


def options(db: Session, order: Comanda) -> dict[str, Any]:
    reason = blocked_reason(db, order)
    current = normalize_to_fulfillment(order.tipo)
    target = 'delivery' if current in {FulfillmentType.PICKUP, FulfillmentType.DINE_IN} else 'pickup'
    config = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == order.restaurante_id).with_for_update(of=ConfiguracaoRestaurante).first()
    candidates = [target, 'delivery'] if current == FulfillmentType.DELIVERY else (['delivery', 'pickup'] if current == FulfillmentType.DINE_IN and order.mesa_id else [target])
    enabled = [mode for mode in candidates if mode_is_allowed(config, 'delivery' if mode == 'delivery' else 'retirada')
               and (mode != 'delivery' or (config is not None and config.delivery_ativo))]
    if not reason and not enabled:
        reason = 'A modalidade de destino não está habilitada no restaurante.'
    return {'options': [] if reason else enabled,
            'blocked_reason': reason,
            'address_snapshot': load_delivery_address_snapshot(db, restaurante_id=order.restaurante_id, comanda_id=order.id)}


def preview(db: Session, order: Comanda, payload: dict[str, Any]):
    available = options(db, order)
    if available['blocked_reason']:
        raise HTTPException(409, available['blocked_reason'])
    target = payload.get('fulfillment')
    allowed = available['options']
    if target not in allowed:
        raise HTTPException(409, 'Transição de modalidade não permitida.')
    address = None
    phone = order.delivery_telefone or ''
    try:
        if target == 'delivery':
            phone = normalizar_telefone_cliente(str(payload.get('telefone') or phone))
            config = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == order.restaurante_id).with_for_update(of=ConfiguracaoRestaurante).first()
            if config is None or not config.delivery_ativo:
                raise HTTPException(409, 'Entrega não está habilitada no restaurante.')
            address = delivery_address_from_payload(payload.get('address_snapshot'))
            if address is None:
                raise HTTPException(422, 'Informe o endereço de entrega.')
            if not phone:
                raise HTTPException(422, 'Informe o telefone de contato para entrega.')
            if active_items_subtotal(order) < money(config.pedido_minimo):
                raise HTTPException(422, 'O pedido não atinge o mínimo configurado para entrega.')
            fee = OrderApplicationService.resolve_server_delivery_fee(db, order.restaurante_id, FulfillmentType.DELIVERY,
                active_items_subtotal(order), neighborhood=address.neighborhood, delivery_address=address)
        else:
            config = db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == order.restaurante_id).with_for_update(of=ConfiguracaoRestaurante).first()
            if config and config.pedido_minimo_retirada and active_items_subtotal(order) < money(config.pedido_minimo):
                raise HTTPException(422, 'O pedido não atinge o mínimo configurado para retirada.')
            fee = Decimal('0.00')
    except (OrderDomainError, TypeError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    old_total = payable_total(order)
    new_total = max(Decimal('0.00'), active_items_subtotal(order) + fee - money(order.valor_desconto_cupom) - money(order.valor_desconto_cashback))
    if order.delivery_troco_para and money(order.delivery_troco_para) < new_total:
        raise HTTPException(409, 'O novo total excede o valor informado para troco. Ajuste o pagamento antes de converter.')
    # A prévia vincula destino, preço e todas as dimensões mutáveis relevantes.
    state = {'id': order.id, 'tenant': order.restaurante_id, 'tipo': order.tipo, 'status': order.delivery_status,
             'fee': str(order.delivery_taxa), 'paid': str(order.valor_pago), 'target': target,
             'address': address.to_snapshot() if address else None, 'phone': phone,
             'previous_phone': order.delivery_telefone, 'previous_address': order.delivery_endereco, 'new_total': str(new_total), 'new_fee': str(fee),
             'discounts': [str(order.valor_desconto_cupom), str(order.valor_desconto_cashback)],
             'payment_method': order.delivery_forma_pagamento, 'change': str(order.delivery_troco_para),
             'table': order.mesa_id, 'launches': sorted((str(l.id), l.status) for l in order.lancamentos),
             'items': sorted((str(i.id), i.status, str(i.preco_unit), bool(i.pago)) for i in order.itens)}
    token = hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()
    return {'fulfillment': target, 'previous_fee': float(order.delivery_taxa or 0), 'delivery_fee': float(fee),
            'previous_total': float(old_total), 'total': float(new_total), 'token': token}, address


def apply(db: Session, order: Comanda, payload: dict[str, Any], operator_id: str):
    quote, address = preview(db, order, payload)
    if not payload.get('token') or payload['token'] != quote['token']:
        raise HTTPException(409, 'O pedido ou a taxa mudou. Recalcule e confirme a alteração novamente.')
    reason = str(payload.get('motivo') or '').strip()
    if not 3 <= len(reason) <= 500:
        raise HTTPException(422, 'Informe um motivo entre 3 e 500 caracteres.')
    previous_type = order.tipo
    previous_table = order.mesa_id
    previous_address = load_delivery_address_snapshot(
        db,
        restaurante_id=order.restaurante_id,
        comanda_id=order.id,
    )
    address_revision = None
    if address:
        address_revision = revise_delivery_address_snapshot(
            db,
            restaurante_id=order.restaurante_id,
            comanda_id=order.id,
            address=address,
            operator_id=operator_id,
            reason=reason,
        )
        order.delivery_endereco = address.to_legacy_address()
        order.delivery_bairro = address.neighborhood
        order.delivery_telefone = normalizar_telefone_cliente(str(payload.get('telefone') or order.delivery_telefone or ''))
    if previous_table:
        for link in db.query(AtendimentoComanda).filter_by(restaurante_id=order.restaurante_id, comanda_id=order.id).all():
            account = db.query(AtendimentoMesa).filter_by(restaurante_id=order.restaurante_id, id=link.atendimento_id).with_for_update().one()
            account.status = 'fechado'
            account.fechado_em = datetime.datetime.now(datetime.timezone.utc)
        if order.delivery_status is None:
            order.delivery_status = next(launch.status for launch in order.lancamentos if launch.status not in {'cancelado', 'recusado'})
        order.mesa_id = None
    order.tipo = 'Delivery' if quote['fulfillment'] == 'delivery' else 'Retirada'
    order.delivery_taxa = quote['delivery_fee']
    db.add(ActivityLog(restaurante_id=order.restaurante_id, garcom_id=operator_id, action='CONVERT_FULFILLMENT',
        details=json.dumps({'comanda_id': order.id, 'fulfillment_original': previous_type, 'fulfillment_atual': order.tipo,
            'delivery_status_preservado': order.delivery_status, 'delivery_taxa_anterior': quote['previous_fee'],
            'delivery_taxa_atual': quote['delivery_fee'], 'endereco_corrigido': bool(
                address and previous_address is not None and previous_address != address.to_snapshot()
            ), 'address_revision_id': getattr(address_revision, 'id', None),
            'mesa_origem': previous_table, 'motivo': reason}, ensure_ascii=False, sort_keys=True)))
    from ...services.order_chat_service import queue_order_tracking_refresh
    queue_order_tracking_refresh(db, order.restaurante_id, order.id)
    return quote
