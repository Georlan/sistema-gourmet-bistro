"""Prepared central marketing lane. Disabled until authenticated inbound proof exists.

A purchase, phone number or opening WhatsApp is never verified interaction or
marketing permission. There is deliberately no HTTP endpoint for operators to
assert those facts; a future authenticated inbound adapter must establish them.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import os
import re
import uuid
from zoneinfo import ZoneInfo
from dataclasses import dataclass
from fastapi import HTTPException
from sqlalchemy.orm import Session
from ..crm_models import CrmCampanha, CrmClientePreferencia, CrmContatoCliente
from ..models import Cliente, ConfiguracaoRestaurante, Restaurante, IntegrationOutbox
from ..timezone_utils import OPERATIONAL_TIMEZONE, to_utc
from .central_whatsapp import transport_configuration, platform_operator_enabled, recipient_fingerprint, phones_match
from .customer_whatsapp_dispatch import opted_out
from .whatsapp_sender_gate import sender_available

EVENT_NAME = 'koma.whatsapp.campaign'
NAMESPACE = uuid.UUID('dd8e12d4-eab4-4ea1-a484-57907ba95b94')
INTERACTION_DAYS = 21
COOLDOWN_DAYS = 7
DAILY_LIMIT = 5
CAMPAIGN_TIMEZONE = ZoneInfo('America/Fortaleza')


def campaign_now():
    return dt.datetime.now(dt.timezone.utc)


def next_campaign_window(now, *, next_day=False):
    local = to_utc(now).astimezone(CAMPAIGN_TIMEZONE)
    if next_day or local.hour >= 21:
        local = local + dt.timedelta(days=1)
    elif local.hour >= 10:
        return None
    return local.replace(hour=10, minute=0, second=0, microsecond=0).astimezone(dt.timezone.utc)


class CampaignDeferred(Exception):
    def __init__(self, until):
        self.until = until


def enabled() -> bool:
    return os.getenv('KOMA_CENTRAL_WA_CAMPAIGNS_ENABLED', 'false').lower() == 'true'


def policy():
    return dict(enabled=enabled(), interaction_days=INTERACTION_DAYS, cooldown_days=COOLDOWN_DAYS,
                daily_limit=DAILY_LIMIT, daily_scope='shared_sender', proof_required=True, start_hour=10, end_hour=21, timezone='America/Fortaleza')


@dataclass(frozen=True)
class CampaignNotice:
    restaurant_id: int
    campaign_id: str
    customer_id: str
    recipient_hash: str
    template_hash: str
    event_id: str


def interaction_verified(pref, rid, phone, now=None):
    now = to_utc(now or campaign_now())
    if pref is None or pref.whatsapp_marketing_opt_in is not True or pref.opt_out_marketing:
        return False
    try:
        digest = recipient_fingerprint(rid, phone)
    except (ValueError, TypeError):
        return False
    at = to_utc(pref.whatsapp_interaction_at)
    return bool(at and at <= now and now-at <= dt.timedelta(days=INTERACTION_DAYS)
                and digest == pref.whatsapp_interaction_phone_hash)


def released_transport(rid):
    cfg = transport_configuration()
    if not enabled() or cfg is None:
        raise HTTPException(409, 'Campanhas pelo número do KÔMA aguardam liberação. Nenhum envio foi criado.')
    raw_allowed = os.getenv('KOMA_CENTRAL_WA_CAMPAIGN_RESTAURANT_IDS', '')
    parts = [part.strip() for part in raw_allowed.split(',')]
    if not parts or any(not value.isdecimal() for value in parts) or rid not in {int(value) for value in parts}:
        raise HTTPException(409, 'Campanhas centrais não foram liberadas para este restaurante.')
    return cfg


def eligible(db, rid, campaign_id, customer_id, *, now=None, reserved_event_id=None):
    now = to_utc(now or campaign_now())
    cfg = released_transport(rid)
    tenant = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=rid).one_or_none()
    if not platform_operator_enabled(rid, tenant) or not sender_available(db, cfg):
        raise HTTPException(409, 'Canal central não liberado ou suspenso para este restaurante.')
    campaign = db.query(CrmCampanha).filter_by(restaurante_id=rid, id=str(campaign_id)).one_or_none()
    client = db.query(Cliente).filter_by(restaurante_id=rid, id=str(customer_id)).one_or_none()
    if campaign is None or client is None:
        raise HTTPException(404, 'Campanha ou cliente não encontrado neste restaurante.')
    if campaign.status != 'EM_EXECUCAO':
        raise HTTPException(409, 'A campanha precisa estar em execução.')
    pref = db.query(CrmClientePreferencia).filter_by(restaurante_id=rid, cliente_id=client.id).one_or_none()
    try:
        digest = recipient_fingerprint(rid, client.telefone)
    except (ValueError, TypeError):
        raise HTTPException(409, 'Telefone inválido; nenhum envio criado.') from None
    if pref is None or pref.opt_out_marketing or opted_out(db, rid, digest):
        raise HTTPException(409, 'Cliente sem autorização de marketing ou com descadastro ativo.')
    interaction = to_utc(pref.whatsapp_interaction_at)
    if (pref.whatsapp_marketing_opt_in is not True or pref.whatsapp_interaction_phone_hash != digest
            or interaction is None or interaction > now or now - interaction > dt.timedelta(days=INTERACTION_DAYS)):
        raise HTTPException(409, 'Sem interação recebida e verificada nos últimos 21 dias para este telefone. Campanha bloqueada.')
    last = None if reserved_event_id and pref.whatsapp_campaign_last_event_id == reserved_event_id else to_utc(pref.whatsapp_campaign_last_sent_at)
    # Include historical confirmed contacts; preparation/copying are not sends.
    prior = db.query(CrmContatoCliente.criado_em).filter(
        CrmContatoCliente.restaurante_id == rid, CrmContatoCliente.cliente_id == client.id,
        CrmContatoCliente.acao_executada == 'CONTATO_MANUAL_CONFIRMADO',
    ).order_by(CrmContatoCliente.criado_em.desc()).first()
    if prior and (last is None or to_utc(prior[0]) > last):
        last = to_utc(prior[0])
    if last and now - last < dt.timedelta(days=COOLDOWN_DAYS):
        raise HTTPException(409, 'Cliente protegido pelo intervalo de 7 dias entre campanhas.')
    return cfg, campaign, client, pref, digest


def enqueue_campaign(db: Session, rid: int, campaign_id: str, customer_id: str):
    released_transport(rid)
    # A tenant-owned row serializes duplicate requests without provider I/O.
    db.query(Cliente.id).filter_by(restaurante_id=rid, id=str(customer_id)).with_for_update().first()
    cfg, campaign, client, pref, digest = eligible(db, rid, campaign_id, customer_id)
    from .outbox.publisher import enqueue_outbox_event_in_session
    notice = CampaignNotice(rid, str(campaign.id), str(client.id), digest,
        hashlib.sha256(campaign.template_mensagem.encode()).hexdigest(),
        str(uuid.uuid5(NAMESPACE, f'{rid}:{campaign.id}:{client.id}')))
    row = enqueue_outbox_event_in_session(db, notice, event_name=EVENT_NAME,
        aggregate_type='central_whatsapp_campaign', aggregate_id=str(campaign.id))
    if row.status == "pending" and not row.next_retry_at:
        row.next_retry_at = next_campaign_window(campaign_now())
    row.max_attempts = 1
    return row


def resolve_campaign(db, snapshot, *, include_link=False):
    rid = int(snapshot['restaurante_id'])
    payload = snapshot.get('payload') or {}
    if payload.get('restaurant_id') != rid:
        raise HTTPException(409, 'Evento e restaurante divergentes.')
    cfg, campaign, client, pref, digest = eligible(db, rid, payload.get('campaign_id'), payload.get('customer_id'), reserved_event_id=snapshot.get('event_id'))
    if digest != payload.get('recipient_hash') or hashlib.sha256(campaign.template_mensagem.encode()).hexdigest() != payload.get('template_hash'):
        raise HTTPException(409, 'Contato ou mensagem alterado; campanha bloqueada.')
    from .customer_whatsapp_dispatch import snapshot_time
    now = campaign_now()
    if now - snapshot_time(snapshot) > dt.timedelta(hours=48) or snapshot_time(snapshot) > now:
        raise HTTPException(409, 'Campanha preparada expirou; nenhum envio.')
    if not sender_available(db, cfg, created_at=snapshot_time(snapshot)):
        raise HTTPException(409, 'Campanha anterior à retomada do remetente.')
    if not include_link:
        return client.telefone, ""
    if next_campaign_window(now):
        raise HTTPException(409, "Janela promocional encerrada durante a verificação; nenhum envio.")
    from .customer_crm import get_customer_crm_profile, validate_campaign_coupon
    from .plan_entitlements import has_plan_entitlement, ENTITLEMENT_LOYALTY
    profile = get_customer_crm_profile(db, restaurante_id=rid, cliente_id=client.id,
        loyalty_enabled=has_plan_entitlement(db, rid, ENTITLEMENT_LOYALTY))['cliente']
    favorites = profile.get('produtos_favoritos') or []
    product = favorites[0].get('nome') if favorites else 'uma opção do nosso cardápio'
    benefit = profile.get('beneficio_disponivel') if profile.get('elegivel_resgate') else ''
    coupon = validate_campaign_coupon(db, restaurante_id=rid, cupom_id=campaign.cupom_id)
    if coupon:
        benefit = f'cupom {coupon.codigo}'
    replacements = {'nome': (client.nome or 'Cliente').split()[0], 'produto_favorito': product,
        'beneficio': benefit or 'as condições do programa de fidelidade, quando aplicáveis',
        'bloco_beneficio': (' ' + benefit) if benefit else ''}
    text = re.sub(r'\{(nome|produto_favorito|beneficio|bloco_beneficio)\}', lambda m: str(replacements[m.group(1)]), campaign.template_mensagem, flags=re.I)
    if re.search(r'\{[^}]+\}', text):
        raise HTTPException(409, 'A mensagem tem campos não reconhecidos; revise a campanha.')
    restaurant = db.query(Restaurante).filter_by(id=rid).one()
    label = ' '.join(restaurant.nome.split())[:100]
    from .whatsapp_opt_out import opt_out_url
    link = opt_out_url(rid, client.telefone, db) if include_link else ''
    return client.telefone, f'*KÔMA | {label}*\n\n{text}\n\nPromoção enviada pelo KÔMA em nome de {label}.\nParar de receber: {link}'


def reserve_campaign(db, snapshot, sender_state):
    """Called with the shared sender lock held: five attempts/day across tenants."""
    rid = int(snapshot['restaurante_id'])
    payload = snapshot['payload']
    pref = db.query(CrmClientePreferencia).filter_by(restaurante_id=rid, cliente_id=payload['customer_id']).populate_existing().with_for_update().one()
    eligible(db, rid, payload['campaign_id'], payload['customer_id'])
    now = campaign_now()
    window = next_campaign_window(now)
    if window:
        raise CampaignDeferred(window)
    day = now.astimezone(CAMPAIGN_TIMEZONE).date().isoformat()
    if sender_state.campaign_day != day:
        sender_state.campaign_day, sender_state.campaign_attempts = day, 0
    if int(sender_state.campaign_attempts or 0) >= DAILY_LIMIT:
        raise CampaignDeferred(next_campaign_window(now, next_day=True))
    sender_state.campaign_attempts = int(sender_state.campaign_attempts or 0) + 1
    pref.whatsapp_campaign_last_sent_at = now  # Conservative reservation, not delivery proof.
    pref.whatsapp_campaign_last_event_id = snapshot['event_id']


def dispatch_campaign(db, snapshot):
    from .central_whatsapp import dispatch_registered_message
    from .outbox.dispatcher import settle_outbox_event
    try:
        target, message = resolve_campaign(db, snapshot)
    except HTTPException:
        settle_outbox_event(db, snapshot['id'], status='dead_letter',
            last_error='Campanha inelegível, expirada ou sem interação comprovada; nenhum envio.', worker_id=snapshot.get('locked_by'))
        return False
    return dispatch_registered_message(db, snapshot, transport_configuration(), target, message, campaign=True)
