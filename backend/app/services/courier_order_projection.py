"""Read-only courier handoff. No partner payloads, payment writes or remote calls.

Provider adapters persist through OrderApplicationService + ExternalOrderReference.
Only the Caixa dispatch/assignment decides which deliveries reach this projection.
"""
from collections import defaultdict
from decimal import Decimal
from sqlalchemy import and_, or_
from ..models import ExternalOrderReference, Lancamento
from .order_financials import money, payable_total, open_balance
from .order_item_composition import load_item_modifiers

_PROVIDER_LABELS = {'ifood': 'iFood', '99food': '99Food', 'keeta': 'Keeta', 'whatsapp': 'WhatsApp', 'api': 'API'}
_LOCAL_PROVIDERS = {'whatsapp', 'api'}


def load_courier_references(db, restaurant_id, check_ids):
    if not check_ids:
        return {}
    launch_ids = db.query(Lancamento.id).filter(Lancamento.restaurante_id == restaurant_id, Lancamento.comanda_id.in_(check_ids))
    rows = db.query(ExternalOrderReference.provider, ExternalOrderReference.external_order_id,
                    ExternalOrderReference.internal_order_id, Lancamento.comanda_id).outerjoin(
        Lancamento, and_(Lancamento.id == ExternalOrderReference.internal_order_id, Lancamento.restaurante_id == restaurant_id)
    ).filter(ExternalOrderReference.restaurante_id == restaurant_id,
             or_(ExternalOrderReference.internal_order_id.in_(check_ids), ExternalOrderReference.internal_order_id.in_(launch_ids))).all()
    result = defaultdict(list)
    for row in rows:
        result[row.comanda_id or row.internal_order_id].append({'provider': row.provider, 'reference': row.external_order_id})
    return dict(result)


def courier_confirmation(order, references):
    # Native receipt codes must never be used to pretend that a marketplace acknowledged delivery.
    unsupported = any(ref['provider'].strip().lower() not in _LOCAL_PROVIDERS for ref in references)
    if unsupported:
        return {'mode': 'partner_pending', 'enabled': False, 'code_length': None,
                'reason': 'A conclusão com este parceiro ainda não está conectada. Confira com o Caixa.'}
    coded = bool(order.delivery_receipt_secret)
    return {'mode': 'koma_code' if coded else 'local', 'enabled': True,
            'code_length': 4 if coded else None, 'reason': None}


def courier_payment(order):
    total = payable_total(order)
    due = Decimal('0.00') if order.online_payment_status == 'approved' else open_balance(order)
    raw_method = str(order.delivery_forma_pagamento or '').strip().casefold()
    method = {'dinheiro': 'cash', 'cash': 'cash', 'credit': 'card', 'debit': 'card',
              'credito': 'card', 'crédito': 'card', 'debito': 'card', 'débito': 'card',
              'cartao': 'card', 'cartão': 'card', 'cartao_credito': 'card', 'cartao_debito': 'card',
              'pix': 'pix', 'online_pix': 'pix'}.get(raw_method, 'unknown')
    online_unconfirmed = order.online_payment_status not in {None, '', 'approved'}
    status = 'check' if online_unconfirmed else 'paid' if due == 0 and total > 0 else 'not_due' if due == 0 else 'collect'
    change_for = money(order.delivery_troco_para) if method == 'cash' and due > 0 and order.delivery_troco_para is not None else None
    change = max(Decimal('0.00'), change_for - due) if change_for is not None and change_for >= due else None
    return {'status': status, 'method': method, 'amount_due': float(due),
            'change_for': float(change_for) if change_for is not None else None,
            'change_amount': float(change) if change is not None else None,
            'change_needs_check': change_for is not None and change_for < due}


def project_courier_orders(db, restaurant_id, orders):
    if not orders:
        return []
    from ..delivery_address_snapshot import load_delivery_address_snapshots
    references = load_courier_references(db, restaurant_id, [order.id for order in orders])
    addresses = load_delivery_address_snapshots(db, restaurante_id=restaurant_id, comanda_ids=[order.id for order in orders])
    modifiers = load_item_modifiers(db, restaurant_id, [item.id for order in orders for item in order.itens if item.status != 'cancelado'])
    result = []
    for order in orders:
        refs = references.get(order.id, [])
        origins = {launch.origem for launch in order.lancamentos}
        provider = refs[0]['provider'] if len({ref['provider'] for ref in refs}) == 1 else 'external' if refs else 'cardapio' if 'cardapio' in origins else 'caixa' if 'caixa' in origins else 'koma'
        source = {'channel': provider, 'label': _PROVIDER_LABELS.get(provider, {'cardapio': 'Cardápio', 'caixa': 'Caixa', 'koma': 'KÔMA'}.get(provider, 'Parceiro')), 'references': refs}
        groups = {}
        for item in order.itens:
            if item.status == 'cancelado':
                continue
            selected = tuple(mod.nome for mod in modifiers.get(item.id, []))
            name = item.produto.nome if item.produto else 'Item'
            key = (name, item.observacao or '', selected, str(item.preco_unit))
            if key not in groups:
                groups[key] = {'name': name, 'quantity': 0, 'notes': item.observacao or None, 'modifiers': list(selected)}
            groups[key]['quantity'] += 1
        items = list(groups.values())
        address = addresses.get(order.id)
        route = ', '.join(str(address.get(key) or '').strip() for key in ('logradouro', 'numero', 'bairro', 'cidade', 'uf') if address.get(key)) if address else order.delivery_endereco
        destination = {'label': route, 'complement': address.get('complemento') if address else None,
                       'reference': address.get('referencia') if address else None, 'route_query': route}
        payment = courier_payment(order)
        result.append({
            'id': order.id, 'numero_pedido': order.numero_pedido,
            'requires_delivery_code': bool(order.delivery_receipt_secret),
            'cliente_nome': order.identificador or 'Cliente', 'delivery_endereco': order.delivery_endereco,
            'delivery_taxa': float(money(order.delivery_taxa)), 'delivery_status': order.delivery_status,
            'total': float(payable_total(order)), 'valor_pago': float(money(order.valor_pago)),
            'valor_a_cobrar': payment['amount_due'],
            'itens_resumo': ', '.join(f"{item['quantity']}x {item['name']}" for item in items),
            'criado_em': order.criado_em.isoformat() if order.criado_em else None,
            'source': source, 'destination': destination, 'payment': payment, 'items': items,
            'confirmation': courier_confirmation(order, refs),
        })
    return result
