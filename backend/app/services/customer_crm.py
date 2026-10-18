"""Serviço de CRM Operacional do KÔMA: Oportunidades, Perfil, Campanhas e Resultados."""

from __future__ import annotations

import datetime
import uuid
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional, Sequence

from fastapi import HTTPException, status
from sqlalchemy import and_, func, inspect as sa_inspect, or_
from sqlalchemy.orm import Session

from ..crm_models import CrmCampanha, CrmClientePreferencia, CrmContatoCliente
from ..crypt import decrypt_field
from ..financial_models import PagamentoEstorno
from ..models import (
    AvaliacaoCliente,
    Cliente,
    Comanda,
    ConfigFidelizacao,
    Cupom,
    HistoricoFidelidade,
    Item,
    Lancamento,
    Pagamento,
    Produto,
)
from ..timezone_utils import get_utc_now, to_utc
from .customer_relationship import (
    build_customer_relationship_payloads,
    load_customer_relationship_metrics,
)
from .customer_satisfaction import classify_satisfaction_rating
from .loyalty_config import effective_loyalty_config

RECENT_CONTACT_COOLDOWN_DAYS = 7
MIN_REDEEMABLE_VALUE_BRL = 1.00
DEFAULT_ATTRIBUTION_WINDOW_DAYS = 14


CRM_TABLE_NAMES = frozenset({
    "crm_clientes_preferencias", "crm_campanhas", "crm_contatos_clientes",
})


def crm_schema_available(db: Session) -> bool:
    """Only inspect schema on the tenant-bound connection; never issue DDL."""
    existing = set(sa_inspect(db.connection()).get_table_names())
    return CRM_TABLE_NAMES.issubset(existing)


def ensure_crm_tables(db: Session) -> None:
    """Fail closed until Alembic provisions CRM; runtime has no DDL rights."""
    if not crm_schema_available(db):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CRM temporariamente indisponível. Tente novamente em instantes.",
        )


def is_valid_whatsapp_phone(telefone: Optional[str]) -> bool:
    digits = "".join(ch for ch in str(telefone or "") if ch.isdigit())
    if digits.startswith("55") and len(digits) in {12, 13}:
        digits = digits[2:]
    return len(digits) in {10, 11}


def compute_customer_benefit_summary(
    *,
    saldo_pontos: int,
    saldo_cashback: float,
    loyalty_enabled: bool,
    config: Optional[Any],
) -> dict[str, Any]:
    """Diferencia saldo acumulado de saldo efetivamente resgatável no caixa."""
    pontos = max(0, int(saldo_pontos or 0))
    cashback = round(max(0.0, float(saldo_cashback or 0.0)), 2)

    if not loyalty_enabled or config is None:
        return {
            "programa_ativo": False,
            "tipo_recompensa": "PONTOS",
            "taxa_conversao": 0.0,
            "valor_ponto_em_dinheiro": 0.0,
            "saldo_acumulado_pontos": pontos,
            "saldo_acumulado_cashback": cashback,
            "valor_equivalente_pontos_brl": 0.0,
            "valor_resgatavel_brl": 0.0,
            "minimo_resgate_brl": MIN_REDEEMABLE_VALUE_BRL,
            "pontos_minimos_resgate": 0,
            "pontos_faltantes_resgate": 0,
            "elegivel_resgate": False,
            "status_beneficio": "SEM_PROGRAMA",
            "explicacao": "Programa de fidelidade não contratado ou indisponível no plano atual.",
        }

    ativo = bool(getattr(config, "ativo", False))
    tipo = str(getattr(config, "tipo_recompensa", "PONTOS") or "PONTOS").upper()
    taxa = float(getattr(config, "taxa_conversao", 1.0) or 0.0)
    valor_ponto = float(getattr(config, "valor_ponto_em_dinheiro", 0.05) or 0.0)
    valor_eq_pontos = round(pontos * valor_ponto, 2) if valor_ponto > 0 else 0.0
    pontos_minimos = (
        int(Decimal(str(MIN_REDEEMABLE_VALUE_BRL / valor_ponto)).to_integral_value(rounding=ROUND_HALF_UP))
        if valor_ponto > 0
        else 0
    )

    if not ativo:
        return {
            "programa_ativo": False,
            "tipo_recompensa": tipo,
            "taxa_conversao": taxa,
            "valor_ponto_em_dinheiro": valor_ponto,
            "saldo_acumulado_pontos": pontos,
            "saldo_acumulado_cashback": cashback,
            "valor_equivalente_pontos_brl": valor_eq_pontos,
            "valor_resgatavel_brl": 0.0,
            "minimo_resgate_brl": MIN_REDEEMABLE_VALUE_BRL,
            "pontos_minimos_resgate": pontos_minimos,
            "pontos_faltantes_resgate": 0,
            "elegivel_resgate": False,
            "status_beneficio": "PROGRAMA_PAUSADO",
            "explicacao": (
                "Saldo preservado na ficha, mas o programa de fidelidade está pausado para novos resgates."
                if (pontos > 0 or cashback > 0)
                else "Programa de fidelidade pausado."
            ),
        }

    if tipo == "PONTOS":
        elegivel = valor_eq_pontos >= MIN_REDEEMABLE_VALUE_BRL
        faltam = max(0, pontos_minimos - pontos) if pontos_minimos > 0 else 0
        if pontos == 0:
            status_ben = "SEM_SALDO"
            explicacao = "Sem pontos acumulados."
        elif elegivel:
            status_ben = "RESGATAVEL"
            explicacao = f"{pontos} pts disponíveis (equivale a R$ {valor_eq_pontos:.2f} de desconto no resgate)."
        else:
            status_ben = "SALDO_EM_FORMACAO"
            explicacao = (
                f"{pontos} pts acumulados (R$ {valor_eq_pontos:.2f}), ainda em formação — "
                f"faltam {faltam} pts para atingir o mínimo prático de R$ {MIN_REDEEMABLE_VALUE_BRL:.2f}."
            )
        return {
            "programa_ativo": True,
            "tipo_recompensa": "PONTOS",
            "taxa_conversao": taxa,
            "valor_ponto_em_dinheiro": valor_ponto,
            "saldo_acumulado_pontos": pontos,
            "saldo_acumulado_cashback": cashback,
            "valor_equivalente_pontos_brl": valor_eq_pontos,
            "valor_resgatavel_brl": valor_eq_pontos if elegivel else 0.0,
            "minimo_resgate_brl": MIN_REDEEMABLE_VALUE_BRL,
            "pontos_minimos_resgate": pontos_minimos,
            "pontos_faltantes_resgate": faltam,
            "elegivel_resgate": elegivel,
            "status_beneficio": status_ben,
            "explicacao": explicacao,
        }

    # CASHBACK
    elegivel = cashback >= MIN_REDEEMABLE_VALUE_BRL
    if cashback == 0 and pontos > 0:
        status_ben = "SALDO_MODALIDADE_ANTERIOR"
        explicacao = (
            f"Possui {pontos} pts de regra anterior preservados, mas o programa atual opera em Cashback (R$ 0,00)."
        )
    elif cashback == 0:
        status_ben = "SEM_SALDO"
        explicacao = "Sem cashback acumulado."
    elif elegivel:
        status_ben = "RESGATAVEL"
        explicacao = f"R$ {cashback:.2f} de cashback disponível para abater na próxima compra."
    else:
        status_ben = "SALDO_EM_FORMACAO"
        explicacao = (
            f"R$ {cashback:.2f} acumulado — abaixo de R$ {MIN_REDEEMABLE_VALUE_BRL:.2f} para resgate prático."
        )

    return {
        "programa_ativo": True,
        "tipo_recompensa": "CASHBACK",
        "taxa_conversao": taxa,
        "valor_ponto_em_dinheiro": valor_ponto,
        "saldo_acumulado_pontos": pontos,
        "saldo_acumulado_cashback": cashback,
        "valor_equivalente_pontos_brl": valor_eq_pontos,
        "valor_resgatavel_brl": cashback if elegivel else 0.0,
        "minimo_resgate_brl": MIN_REDEEMABLE_VALUE_BRL,
        "pontos_minimos_resgate": pontos_minimos,
        "pontos_faltantes_resgate": 0,
        "elegivel_resgate": elegivel,
        "status_beneficio": status_ben,
        "explicacao": explicacao,
    }


def enrich_customer_crm_payloads(
    db: Session,
    *,
    restaurante_id: int,
    payloads: list[dict[str, Any]],
    loyalty_enabled: bool,
    now: Optional[datetime.datetime] = None,
) -> list[dict[str, Any]]:
    """Enriquece a lista de clientes do CRM em lote (zero N+1)."""
    if not payloads:
        return []

    if not crm_schema_available(db):
        # Preserve customer lookup and balances during a rolling deployment.
        # Unknown opt-outs/history must never become a marketing audience.
        return [dict(p, opt_out_marketing=True, contato_recente=True) for p in payloads]
    utc_now = to_utc(now) if now is not None else get_utc_now()
    cliente_ids = [str(p["id"]) for p in payloads if p.get("id")]

    config = effective_loyalty_config(db, restaurante_id) if loyalty_enabled else None

    # 1. Preferências declaradas / opt-out
    prefs_rows = (
        db.query(CrmClientePreferencia)
        .filter(
            CrmClientePreferencia.restaurante_id == restaurante_id,
            CrmClientePreferencia.cliente_id.in_(cliente_ids),
        )
        .all()
    )
    prefs_by_cid = {str(row.cliente_id): row for row in prefs_rows}

    # 2. Último contato registrado por cliente
    contatos_rows = (
        db.query(CrmContatoCliente)
        .filter(
            CrmContatoCliente.restaurante_id == restaurante_id,
            CrmContatoCliente.cliente_id.in_(cliente_ids),
            CrmContatoCliente.acao_executada.in_(
                ["CONTATO_MANUAL_CONFIRMADO", "WHATSAPP_ABERTO", "MENSAGEM_COPIADA"]
            ),
        )
        .order_by(CrmContatoCliente.criado_em.desc(), CrmContatoCliente.id.desc())
        .all()
    )
    latest_contact_by_cid: dict[str, CrmContatoCliente] = {}
    latest_confirmed_by_cid: dict[str, CrmContatoCliente] = {}
    total_contacts_by_cid: dict[str, int] = {}
    for c_row in contatos_rows:
        cid = str(c_row.cliente_id)
        total_contacts_by_cid[cid] = total_contacts_by_cid.get(cid, 0) + 1
        if cid not in latest_contact_by_cid:
            latest_contact_by_cid[cid] = c_row
        if c_row.acao_executada == "CONTATO_MANUAL_CONFIRMADO":
            latest_confirmed_by_cid.setdefault(cid, c_row)

    # 3. Última avaliação de satisfação por cliente
    avaliacoes_rows = (
        db.query(AvaliacaoCliente)
        .filter(
            AvaliacaoCliente.restaurante_id == restaurante_id,
            AvaliacaoCliente.cliente_id.in_(cliente_ids),
        )
        .order_by(AvaliacaoCliente.criado_em.desc(), AvaliacaoCliente.id.desc())
        .all()
    )
    latest_review_by_cid: dict[str, AvaliacaoCliente] = {}
    for av_row in avaliacoes_rows:
        cid = str(av_row.cliente_id)
        if cid not in latest_review_by_cid:
            latest_review_by_cid[cid] = av_row

    enriched: list[dict[str, Any]] = []
    for item in payloads:
        cid = str(item["id"])
        copy_item = dict(item)
        pref = prefs_by_cid.get(cid)
        contact = latest_contact_by_cid.get(cid)
        review = latest_review_by_cid.get(cid)

        opt_out = bool(pref.opt_out_marketing) if pref else False
        motivo_opt_out = pref.motivo_opt_out if pref else None
        canal_preferido = pref.canal_preferido if pref else None
        observacoes_declaradas = pref.observacoes_declaradas if pref else None

        ultimo_contato_em: Optional[str] = None
        dias_desde_contato: Optional[int] = None
        contato_recente = False
        voltou_apos_contato = False

        ultima_compra_dt = (
            to_utc(datetime.datetime.fromisoformat(copy_item["ultima_compra_em"]))
            if copy_item.get("ultima_compra_em")
            else None
        )

        if contact is not None:
            contact_dt = to_utc(contact.criado_em)
            if contact_dt is not None:
                ultimo_contato_em = contact_dt.isoformat()
                dias_desde_contato = max(0, (utc_now - contact_dt).days)

        # Preparation remains in the activity history but cannot hide a real
        # contact or establish a customer return by itself.
        confirmed = latest_confirmed_by_cid.get(cid)
        confirmed_dt = to_utc(confirmed.criado_em) if confirmed else None
        if confirmed_dt is not None:
            contato_recente = utc_now - confirmed_dt < datetime.timedelta(days=RECENT_CONTACT_COOLDOWN_DAYS)
        voltou_apos_contato = bool(ultima_compra_dt and confirmed_dt and ultima_compra_dt > confirmed_dt)

        ultima_av_nota: Optional[int] = None
        ultima_av_comentario: Optional[str] = None
        ultima_av_em: Optional[str] = None
        ocorrencia_aberta = False
        if review is not None:
            ultima_av_nota = int(review.nota)
            ultima_av_comentario = review.comentario
            rev_dt = to_utc(review.criado_em)
            ultima_av_em = rev_dt.isoformat() if rev_dt else None
            if ultima_av_nota <= 2:
                # Ocorrência permanece aberta se o cliente não voltou a comprar nem recebeu abordagem de recuperação depois da avaliação
                comprou_depois = bool(ultima_compra_dt and rev_dt and ultima_compra_dt > rev_dt)
                abordado_depois = bool(
                    confirmed_dt
                    and rev_dt
                    and confirmed_dt >= rev_dt
                )
                ocorrencia_aberta = not comprou_depois and not abordado_depois

        beneficio = compute_customer_benefit_summary(
            saldo_pontos=int(copy_item.get("saldo_pontos", copy_item.get("pontos", 0)) or 0),
            saldo_cashback=float(copy_item.get("saldo_cashback", copy_item.get("saldoCashback", 0.0)) or 0.0),
            loyalty_enabled=loyalty_enabled,
            config=config,
        )

        raw_phone = copy_item.get("telefone")
        if raw_phone is None and "_encrypted_telefone" in copy_item:
            enc_phone = copy_item.pop("_encrypted_telefone")
            if not opt_out and not contato_recente and (
                int(copy_item.get("pedidos_concluidos") or 0) >= 1 or ocorrencia_aberta
            ):
                raw_phone = decrypt_field(enc_phone)

        copy_item.update(
            {
                "telefone_valido_whatsapp": is_valid_whatsapp_phone(raw_phone),
                "opt_out_marketing": opt_out,
                "motivo_opt_out": motivo_opt_out,
                "canal_preferido": canal_preferido,
                "observacoes_declaradas": observacoes_declaradas,
                "ultimo_contato_em": ultimo_contato_em,
                "ultimo_contato_status": contact.acao_executada if contact else None,
                "ultimo_contato_objetivo": contact.objetivo if contact else None,
                "dias_desde_ultimo_contato": dias_desde_contato,
                "total_contatos_crm": total_contacts_by_cid.get(cid, 0),
                "contato_recente": contato_recente,
                "voltou_apos_ultimo_contato": voltou_apos_contato,
                "ultima_avaliacao_nota": ultima_av_nota,
                "ultima_avaliacao_comentario": ultima_av_comentario,
                "ultima_avaliacao_em": ultima_av_em,
                "ocorrencia_aberta": ocorrencia_aberta,
                "beneficio_disponivel": beneficio,
                "elegivel_resgate": beneficio["elegivel_resgate"],
                "valor_resgatavel_brl": beneficio["valor_resgatavel_brl"],
                "status_beneficio": beneficio["status_beneficio"],
            }
        )
        enriched.append(copy_item)

    return enriched


def customer_qualifies_for_opportunity(
    customer: dict[str, Any],
    opportunity_key: str,
    *,
    include_held_back: bool = False,
) -> tuple[bool, Optional[str]]:
    """Avalia se um cliente enriquecido entra em uma oportunidade e se está retido por proteção."""
    count = int(customer.get("pedidos_concluidos") or 0)
    days = customer.get("dias_sem_comprar")
    interval = customer.get("intervalo_medio_dias")

    base_match = False
    if opportunity_key == "SECOND_PURCHASE":
        base_match = count == 1 and days is not None and 6 <= int(days) <= 30
    elif opportunity_key == "CADENCE_RECOVERY":
        base_match = (
            count >= 3
            and days is not None
            and interval is not None
            and float(interval) >= 1.0
            and float(days) > max(7.0, float(interval) * 1.5)
        )
    elif opportunity_key == "BENEFIT_REMINDER":
        base_match = (
            count >= 1
            and days is not None
            and int(days) >= 14
            and bool(customer.get("elegivel_resgate"))
        )
    elif opportunity_key == "VIP_RECOGNITION":
        base_match = count >= 5 and days is not None and int(days) <= 45
    elif opportunity_key == "OCCURRENCE_RECOVERY":
        base_match = bool(customer.get("ocorrencia_aberta"))

    if not base_match:
        return False, None

    if customer.get("opt_out_marketing"):
        return (True, "OPT_OUT") if include_held_back else (False, "OPT_OUT")
    if customer.get("contato_recente"):
        return (True, "CONTATO_RECENTE") if include_held_back else (False, "CONTATO_RECENTE")

    return True, None


def build_opportunities_catalog(
    customers: Sequence[dict[str, Any]],
    *,
    loyalty_enabled: bool,
    coupons_enabled: bool,
) -> list[dict[str, Any]]:
    """Constrói as 5 oportunidades priorizadas com contagens reais, motivos e limites."""
    specs = [
        {
            "id": "SECOND_PURCHASE",
            "segmento": "SECOND",
            "prioridade": 1,
            "titulo": "Incentivar a 2ª compra",
            "subtitulo": "Transformar estreantes em clientes recorrentes",
            "por_que_entraram": (
                "Fizeram exatamente 1 compra concluída entre 6 e 30 dias atrás e ainda não voltaram."
            ),
            "abordagem_recomendada": (
                "Agradecer a primeira visita citando o item pedido e convidar para experimentar outro destaque da casa."
            ),
            "abordagem_sem_desconto": (
                "Perguntar como foi a primeira experiência com o prato pedido e apresentar uma sugestão complementar sem desconto."
            ),
            "abordagem_com_beneficio": (
                "Oferecer um cupom de boas-vindas para a 2ª compra com pedido mínimo que preserve a margem."
                if coupons_enabled
                else "Destacar o acúmulo de pontos/cashback na próxima visita."
            ),
            "criterios": [
                "Exatamente 1 pedido fechado e pago (exclui abertos, recusados, cancelados ou 100% estornados).",
                "Janela de 6 a 30 dias desde a compra: evita incomodar quem acabou de pedir (0–5 dias).",
                "Exclui automaticamente quem optou por não receber campanhas ou já foi abordado nos últimos 7 dias.",
            ],
            "limitacoes": (
                "Clientes que compraram no balcão sem informar telefone/identificação não entram nesta contagem."
            ),
            "template_sugerido": (
                "Olá, {nome}! Tudo bem? Aqui é do restaurante. Vimos que você experimentou {produto_favorito} "
                "conosco recentemente e queríamos saber como foi sua experiência! Quando bater a vontade novamente, "
                "será um prazer receber seu pedido.{bloco_beneficio}"
            ),
        },
        {
            "id": "CADENCE_RECOVERY",
            "segmento": "CADENCE",
            "prioridade": 2,
            "titulo": "Recuperar recorrentes fora do ritmo habitual",
            "subtitulo": "Clientes fiéis que passaram do intervalo médio entre pedidos",
            "por_que_entraram": (
                "Possuem 3 ou mais compras concluídas e estão sem pedir há mais de 1,5× o intervalo médio histórico deles (mínimo de 7 dias)."
            ),
            "abordagem_recomendada": (
                "Lembrança gentil do item favorito do cliente, sem parecer cobrança, com opção de mimo ou cupom de retorno."
            ),
            "abordagem_sem_desconto": (
                "Enviar mensagem personalizada lembrando do prato favorito ({produto_favorito}) e avisando que a casa está pronta para atendê-lo."
            ),
            "abordagem_com_beneficio": (
                "Vincular cupom de retorno com validade curta (7 dias) ou lembrar saldo disponível na carteira."
            ),
            "criterios": [
                "Mínimo de 3 compras concluídas com intervalo médio histórico >= 1 dia.",
                "Dias sem comprar atuais superiores a 1,5× o intervalo médio individual (respeitando piso de 7 dias).",
                "Exclui clientes com contato nos últimos 7 dias ou com opt-out de marketing.",
            ],
            "limitacoes": (
                "Trata-se de cadência observada no histórico, não previsão estatística de churn."
            ),
            "template_sugerido": (
                "Oi, {nome}! Tudo bem? Sentimos sua falta por aqui! Faz alguns dias que você não pede {produto_favorito}. "
                "Preparamos tudo fresquinho hoje caso queira matar a saudade.{bloco_beneficio}"
            ),
        },
        {
            "id": "BENEFIT_REMINDER",
            "segmento": "BALANCE",
            "prioridade": 3,
            "titulo": "Lembrar benefícios disponíveis para resgate",
            "subtitulo": "Saldo real já conquistado e parado há 14 dias ou mais",
            "por_que_entraram": (
                "Acumularam pontos ou cashback suficientes para resgate imediato (>= R$ 1,00 na regra ativa) e não compram há pelo menos 14 dias."
            ),
            "abordagem_recomendada": (
                "Lembrar que o cliente já tem um valor conquistado esperando por ele, sem precisar criar novo desconto."
            ),
            "abordagem_sem_desconto": (
                "Avisar o valor exato disponível para resgate ({beneficio}) na próxima compra, sem necessidade de cupom extra."
            ),
            "abordagem_com_beneficio": (
                "Usar o próprio saldo de fidelidade já provisionado pelo restaurante como incentivo."
            ),
            "criterios": [
                "Programa de fidelidade ativo no restaurante.",
                "Saldo resgatável >= R$ 1,00 na modalidade ativa (clientes com saldo em formação abaixo do mínimo ficam de fora).",
                "Pelo menos 1 compra concluída e 14 dias ou mais desde a última compra.",
            ],
            "limitacoes": (
                "Não inclui clientes cujos pontos ainda não atingiram o mínimo prático de resgate."
            ),
            "template_sugerido": (
                "Olá, {nome}! Passando para lembrar que você tem {beneficio} disponível para usar no seu próximo pedido conosco. "
                "Que tal aproveitar para pedir {produto_favorito} esta semana?"
            ),
        },
        {
            "id": "VIP_RECOGNITION",
            "segmento": "VIP",
            "prioridade": 4,
            "titulo": "Reconhecer clientes frequentes",
            "subtitulo": "Valorizar quem sustenta a recorrência sem viciar em desconto",
            "por_que_entraram": (
                "Clientes ativos (última compra em até 45 dias) com 5 ou mais compras concluídas no histórico."
            ),
            "abordagem_recomendada": (
                "Reconhecimento genuíno sem desconto: agradecer a preferência e apresentar novidade do cardápio em primeira mão."
            ),
            "abordagem_sem_desconto": (
                "Mensagem de agradecimento direto do restaurante destacando os pedidos concluídos e preferência por {produto_favorito}."
            ),
            "abordagem_com_beneficio": (
                "Evitar desconto percentual desnecessário; se desejar, oferecer acompanhamento cortesia ou benefício de fidelidade."
            ),
            "criterios": [
                "5 ou mais compras concluídas e pagas.",
                "Relacionamento ativo ou recente (até 45 dias desde a última compra).",
                "Sem contato comercial nos últimos 7 dias.",
            ],
            "limitacoes": (
                "Evite enviar cupons agressivos para quem já compra regularmente pelo preço cheio."
            ),
            "template_sugerido": (
                "Oi, {nome}! Aqui é da equipe do restaurante. Queríamos agradecer de coração pela parceria — "
                "já foram vários pedidos conosco! Sempre que pedir {produto_favorito}, conte com nosso capricho especial.{bloco_beneficio}"
            ),
        },
        {
            "id": "OCCURRENCE_RECOVERY",
            "segmento": "OCCURRENCE",
            "prioridade": 5,
            "titulo": "Retomar relacionamento após ocorrência",
            "subtitulo": "Clientes que registraram avaliação insatisfeita (1 ou 2 estrelas)",
            "por_que_entraram": (
                "Registraram avaliação de 1 ou 2 estrelas vinculada à ficha e ainda não voltaram nem receberam retorno registrado."
            ),
            "abordagem_recomendada": (
                "Escuta ativa e pedido de desculpas humano antes de qualquer oferta promocional."
            ),
            "abordagem_sem_desconto": (
                "Contato direto do responsável reconhecendo o comentário registrado e explicando a correção feita na operação."
            ),
            "abordagem_com_beneficio": (
                "Após ouvir o cliente, opcionalmente disponibilizar cupom individual de cortesia para uma nova experiência."
            ),
            "criterios": [
                "Avaliação registrada com nota 1 ou 2 estrelas por cliente identificado.",
                "Sem nova compra concluída nem contato manual confirmado após a data da ocorrência.",
            ],
            "limitacoes": (
                "Exibido apenas quando há registro real de avaliação insatisfeita; ausência de compra não é tratada como reclamação."
            ),
            "template_sugerido": (
                "Olá, {nome}. Aqui é da gerência do restaurante. Lemos sua avaliação recente e lamentamos que sua experiência "
                "não tenha saído no padrão que prezamos. Já revisamos internamente o ocorrido e gostaríamos de conversar com você."
            ),
        },
    ]

    result: list[dict[str, Any]] = []
    for spec in specs:
        if spec["id"] == "BENEFIT_REMINDER" and not loyalty_enabled:
            continue

        elegiveis_ids: list[str] = []
        retidos_recente = 0
        retidos_opt_out = 0
        sem_whatsapp_valido = 0

        for c in customers:
            matched, hold_reason = customer_qualifies_for_opportunity(
                c, spec["id"], include_held_back=True
            )
            if not matched:
                continue
            if hold_reason == "OPT_OUT":
                retidos_opt_out += 1
            elif hold_reason == "CONTATO_RECENTE":
                retidos_recente += 1
            else:
                elegiveis_ids.append(str(c["id"]))
                if not c.get("telefone_valido_whatsapp"):
                    sem_whatsapp_valido += 1

        result.append(
            {
                **spec,
                "chave": spec["id"],
                "elegiveis_count": len(elegiveis_ids),
                "elegiveis_cliente_ids": elegiveis_ids,
                "cliente_ids": elegiveis_ids,
                "retidos_contato_recente_count": retidos_recente,
                "retidos_contato_recente": retidos_recente,
                "retidos_opt_out_count": retidos_opt_out,
                "sem_whatsapp_valido_count": sem_whatsapp_valido,
                "disponivel_com_dados_atuais": (
                    len(elegiveis_ids) > 0
                    if spec["id"] == "OCCURRENCE_RECOVERY"
                    else True
                ),
            }
        )

    return result


def get_customer_crm_profile(
    db: Session,
    *,
    restaurante_id: int,
    cliente_id: str,
    loyalty_enabled: bool,
    now: Optional[datetime.datetime] = None,
) -> dict[str, Any]:
    """Retorna a ficha individual completa separando dados declarados de comportamento observado."""
    ensure_crm_tables(db)
    utc_now = to_utc(now) if now is not None else get_utc_now()

    cliente = (
        db.query(Cliente)
        .filter(
            Cliente.restaurante_id == restaurante_id,
            Cliente.id == str(cliente_id),
        )
        .first()
    )
    if cliente is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cliente não encontrado neste restaurante.",
        )

    metrics = load_customer_relationship_metrics(
        db,
        restaurante_id=restaurante_id,
        cliente_ids=[cliente.id],
        now=utc_now,
        include_products=True,
    )
    base_payloads = build_customer_relationship_payloads([cliente], metrics)
    enriched_list = enrich_customer_crm_payloads(
        db,
        restaurante_id=restaurante_id,
        payloads=base_payloads,
        loyalty_enabled=loyalty_enabled,
        now=utc_now,
    )
    enriched = enriched_list[0]
    if not loyalty_enabled:
        enriched["pontos"] = 0
        enriched["saldo_pontos"] = 0
        enriched["saldoCashback"] = 0.0
        enriched["saldo_cashback"] = 0.0

    # Histórico de comandas do cliente (incluindo canceladas/estornadas para transparência)
    comandas = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.cliente_id == cliente.id,
        )
        .order_by(
            func.coalesce(Comanda.fechado_em, Comanda.criado_em).desc(),
            Comanda.id.desc(),
        )
        .limit(30)
        .all()
    )
    comanda_ids = [str(c.id) for c in comandas]

    # Estornos por comanda
    estornos_by_comanda: dict[str, Decimal] = {}
    if comanda_ids:
        est_rows = (
            db.query(Pagamento.comanda_id, func.sum(PagamentoEstorno.valor))
            .join(
                PagamentoEstorno,
                (PagamentoEstorno.pagamento_id == Pagamento.id)
                & (PagamentoEstorno.restaurante_id == Pagamento.restaurante_id),
            )
            .filter(
                Pagamento.restaurante_id == restaurante_id,
                Pagamento.comanda_id.in_(comanda_ids),
            )
            .group_by(Pagamento.comanda_id)
            .all()
        )
        for cid_val, sum_est in est_rows:
            estornos_by_comanda[str(cid_val)] = Decimal(str(sum_est or 0)).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )

    # Cupons usados
    cupom_ids = {str(c.cupom_id) for c in comandas if c.cupom_id}
    cupons_map: dict[str, str] = {}
    if cupom_ids:
        for cp in (
            db.query(Cupom.id, Cupom.codigo)
            .filter(Cupom.restaurante_id == restaurante_id, Cupom.id.in_(cupom_ids))
            .all()
        ):
            cupons_map[str(cp[0])] = str(cp[1])

    # Itens por comanda e status dos lançamentos
    itens_by_comanda: dict[str, list[str]] = {}
    lancamentos_status_by_comanda: dict[str, list[str]] = {}
    if comanda_ids:
        lanc_rows = (
            db.query(Lancamento.comanda_id, Lancamento.status)
            .filter(
                Lancamento.restaurante_id == restaurante_id,
                Lancamento.comanda_id.in_(comanda_ids),
            )
            .all()
        )
        for l_cid, l_st in lanc_rows:
            lancamentos_status_by_comanda.setdefault(str(l_cid), []).append(str(l_st or ""))

        item_rows = (
            db.query(Item.comanda_id, Produto.nome, Item.status, func.count(Item.id))
            .join(
                Produto,
                (Produto.id == Item.produto_id) & (Produto.restaurante_id == Item.restaurante_id),
            )
            .filter(
                Item.restaurante_id == restaurante_id,
                Item.comanda_id.in_(comanda_ids),
            )
            .group_by(Item.comanda_id, Produto.nome, Item.status)
            .all()
        )
        for i_cid, p_nome, i_status, qty in item_rows:
            if i_status == "cancelado":
                continue
            itens_by_comanda.setdefault(str(i_cid), []).append(f"{int(qty)}x {p_nome}")

    historico_pedidos: list[dict[str, Any]] = []
    modalidades_counter: dict[str, int] = {}
    pedidos_excluidos_count = 0
    valor_estornado_total = Decimal("0.00")

    for com in comandas:
        cid_str = str(com.id)
        bruto = Decimal(str(com.valor_pago or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        estornado = estornos_by_comanda.get(cid_str, Decimal("0.00"))
        valor_estornado_total += estornado
        liquido = max(Decimal("0.00"), bruto - estornado)

        l_statuses = lancamentos_status_by_comanda.get(cid_str, [])
        all_lanc_cancelled = bool(l_statuses) and all(
            st in ("cancelado", "recusado") for st in l_statuses
        )

        motivo_exclusao: Optional[str] = None
        if not com.fechada:
            motivo_exclusao = "Pedido em aberto (não concluído)"
        elif com.delivery_status == "recusado":
            motivo_exclusao = "Pedido recusado"
        elif com.online_payment_status not in (None, "approved"):
            motivo_exclusao = f"Pagamento online não aprovado ({com.online_payment_status})"
        elif all_lanc_cancelled:
            motivo_exclusao = "Pedido cancelado"
        elif estornado > 0 and liquido <= 0:
            motivo_exclusao = "Pagamento 100% estornado"

        contabilizado = motivo_exclusao is None
        if not contabilizado:
            pedidos_excluidos_count += 1
        else:
            mod = str(com.tipo or "Consumo no Local")
            modalidades_counter[mod] = modalidades_counter.get(mod, 0) + 1

        dt_ref = to_utc(com.fechado_em or com.criado_em)
        historico_pedidos.append(
            {
                "id": cid_str,
                "numero_pedido": com.numero_pedido,
                "tipo": com.tipo or "Consumo no Local",
                "fechada": bool(com.fechada),
                "data": dt_ref.isoformat() if dt_ref else None,
                "valor_pago_bruto": float(bruto),
                "valor_estornado": float(estornado),
                "valor_pago_liquido": float(liquido) if contabilizado else 0.0,
                "valor_desconto_cupom": float(com.valor_desconto_cupom or 0.0),
                "valor_desconto_cashback": float(com.valor_desconto_cashback or 0.0),
                "cupom_codigo": cupons_map.get(str(com.cupom_id)) if com.cupom_id else None,
                "itens_resumo": itens_by_comanda.get(cid_str, []),
                "contabilizado_no_crm": contabilizado,
                "motivo_exclusao": motivo_exclusao,
            }
        )

    modalidade_preferida = (
        max(modalidades_counter.items(), key=lambda kv: kv[1])[0]
        if modalidades_counter
        else None
    )

    # Avaliações declaradas pelo cliente
    avaliacoes = (
        db.query(AvaliacaoCliente)
        .filter(
            AvaliacaoCliente.restaurante_id == restaurante_id,
            AvaliacaoCliente.cliente_id == cliente.id,
        )
        .order_by(AvaliacaoCliente.criado_em.desc())
        .limit(10)
        .all()
    )
    avaliacoes_list = [
        {
            "id": str(av.id),
            "nota": int(av.nota),
            "classificacao": classify_satisfaction_rating(int(av.nota)),
            "comentario": av.comentario,
            "comanda_id": av.comanda_id,
            "criado_em": to_utc(av.criado_em).isoformat() if to_utc(av.criado_em) else None,
        }
        for av in avaliacoes
    ]

    # Histórico de fidelidade
    historico_fidelidade_list: list[dict[str, Any]] = []
    if loyalty_enabled:
        movs = (
            db.query(HistoricoFidelidade)
            .filter(
                HistoricoFidelidade.restaurante_id == restaurante_id,
                HistoricoFidelidade.cliente_id == cliente.id,
            )
            .order_by(HistoricoFidelidade.criado_em.desc(), HistoricoFidelidade.id.desc())
            .limit(15)
            .all()
        )
        for m in movs:
            m_dt = to_utc(m.criado_em)
            historico_fidelidade_list.append(
                {
                    "id": int(m.id),
                    "tipo_movimentacao": m.tipo_movimentacao,
                    "valor_delta": float(m.valor_delta or 0.0),
                    "comanda_id": m.comanda_id,
                    "criado_em": m_dt.isoformat() if m_dt else None,
                }
            )

    # Histórico de contatos CRM
    contatos = (
        db.query(CrmContatoCliente)
        .filter(
            CrmContatoCliente.restaurante_id == restaurante_id,
            CrmContatoCliente.cliente_id == cliente.id,
        )
        .order_by(CrmContatoCliente.criado_em.desc(), CrmContatoCliente.id.desc())
        .limit(20)
        .all()
    )
    camp_ids = {str(ct.campanha_id) for ct in contatos if ct.campanha_id}
    camp_names: dict[str, str] = {}
    if camp_ids:
        for c_id, c_nome in (
            db.query(CrmCampanha.id, CrmCampanha.nome)
            .filter(CrmCampanha.restaurante_id == restaurante_id, CrmCampanha.id.in_(camp_ids))
            .all()
        ):
            camp_names[str(c_id)] = str(c_nome)

    valid_order_dates = [
        to_utc(datetime.datetime.fromisoformat(p["data"]))
        for p in historico_pedidos
        if p["contabilizado_no_crm"] and p.get("data")
    ]
    historico_contatos_list: list[dict[str, Any]] = []
    for ct in contatos:
        ct_dt = to_utc(ct.criado_em)
        voltou = bool(
            ct_dt
            and any(od is not None and od > ct_dt for od in valid_order_dates)
        )
        historico_contatos_list.append(
            {
                "id": str(ct.id),
                "campanha_id": ct.campanha_id,
                "campanha_nome": camp_names.get(str(ct.campanha_id)) if ct.campanha_id else None,
                "objetivo": ct.objetivo,
                "abordagem_tipo": ct.abordagem_tipo,
                "canal": ct.canal,
                "acao_executada": ct.acao_executada,
                "mensagem_personalizada": ct.mensagem_personalizada,
                "observacao": ct.observacao,
                "criado_em": ct_dt.isoformat() if ct_dt else None,
                "voltou_depois": voltou,
            }
        )

    oportunidades_elegiveis: list[str] = []
    for opp_key in (
        "SECOND_PURCHASE",
        "CADENCE_RECOVERY",
        "BENEFIT_REMINDER",
        "VIP_RECOGNITION",
        "OCCURRENCE_RECOVERY",
    ):
        ok, _ = customer_qualifies_for_opportunity(enriched, opp_key, include_held_back=False)
        if ok:
            oportunidades_elegiveis.append(opp_key)

    return {
        "cliente": enriched,
        "dados_declarados": {
            "nome": cliente.nome,
            "telefone": cliente.telefone,
            "telefone_valido_whatsapp": enriched["telefone_valido_whatsapp"],
            "email": cliente.email or "",
            "endereco": cliente.endereco or "",
            "opt_out_marketing": enriched["opt_out_marketing"],
            "motivo_opt_out": enriched["motivo_opt_out"],
            "canal_preferido": enriched["canal_preferido"],
            "observacoes_declaradas": enriched["observacoes_declaradas"],
            "avaliacoes": avaliacoes_list,
        },
        "comportamento_observado": {
            "pedidos_concluidos": enriched["pedidos_concluidos"],
            "pedidos_cancelados_ou_estornados": pedidos_excluidos_count,
            "valor_pago_liquido_total": enriched["valor_pago_total"],
            "valor_estornado_total": float(valor_estornado_total),
            "ticket_medio_pago": enriched["ticket_medio_pago"],
            "primeira_compra_em": enriched.get("primeira_compra_em"),
            "ultima_compra_em": enriched.get("ultima_compra_em"),
            "dias_sem_comprar": enriched.get("dias_sem_comprar"),
            "intervalo_medio_dias": enriched.get("intervalo_medio_dias"),
            "segmento_relacionamento": enriched.get("segmento_relacionamento"),
            "modalidade_preferida": modalidade_preferida,
            "produtos_favoritos": enriched.get("produtos_favoritos", []),
            "oportunidades_elegiveis": oportunidades_elegiveis,
        },
        "beneficio": enriched["beneficio_disponivel"],
        "historico_fidelidade": historico_fidelidade_list,
        "historico_pedidos": historico_pedidos,
        "historico_contatos": historico_contatos_list,
    }


def update_customer_crm_preferences(
    db: Session,
    *,
    restaurante_id: int,
    cliente_id: str,
    opt_out_marketing: bool,
    motivo_opt_out: Optional[str] = None,
    canal_preferido: Optional[str] = None,
    observacoes_declaradas: Optional[str] = None,
) -> dict[str, Any]:
    """Atualiza preferências de comunicação e observações declaradas do cliente."""
    ensure_crm_tables(db)
    cliente = (
        db.query(Cliente)
        .filter(Cliente.restaurante_id == restaurante_id, Cliente.id == str(cliente_id))
        .first()
    )
    if cliente is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cliente não encontrado neste restaurante.",
        )

    if canal_preferido and canal_preferido not in ("whatsapp", "telefone", "presencial"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Canal preferido inválido.",
        )

    pref = (
        db.query(CrmClientePreferencia)
        .filter(
            CrmClientePreferencia.restaurante_id == restaurante_id,
            CrmClientePreferencia.cliente_id == str(cliente_id),
        )
        .first()
    )
    if pref is None:
        pref = CrmClientePreferencia(
            restaurante_id=restaurante_id,
            cliente_id=str(cliente_id),
        )
        db.add(pref)

    pref.opt_out_marketing = bool(opt_out_marketing)
    pref.motivo_opt_out = (motivo_opt_out or "").strip()[:255] or None
    pref.canal_preferido = canal_preferido or None
    pref.observacoes_declaradas = (observacoes_declaradas or "").strip()[:2000] or None
    pref.atualizado_em = get_utc_now()

    db.commit()
    db.refresh(pref)
    return {
        "cliente_id": str(cliente.id),
        "opt_out_marketing": bool(pref.opt_out_marketing),
        "motivo_opt_out": pref.motivo_opt_out,
        "canal_preferido": pref.canal_preferido,
        "observacoes_declaradas": pref.observacoes_declaradas,
        "atualizado_em": to_utc(pref.atualizado_em).isoformat() if pref.atualizado_em else None,
    }


def validate_campaign_coupon(
    db: Session,
    *,
    restaurante_id: int,
    cupom_id: Optional[str],
    now: Optional[datetime.datetime] = None,
) -> Optional[Cupom]:
    """Valida se o cupom selecionado pertence ao restaurante e está disponível para uso."""
    if not cupom_id:
        return None
    utc_now = to_utc(now) if now is not None else get_utc_now()
    cupom = (
        db.query(Cupom)
        .filter(Cupom.restaurante_id == restaurante_id, Cupom.id == str(cupom_id))
        .first()
    )
    if cupom is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cupom selecionado não pertence a este restaurante.",
        )
    if not cupom.ativo:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"O cupom '{cupom.codigo}' está desativado e não pode ser usado na abordagem.",
        )
    if cupom.valido_ate is not None:
        valido_dt = to_utc(cupom.valido_ate)
        if valido_dt is not None and utc_now > valido_dt:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"O cupom '{cupom.codigo}' está expirado.",
            )
    if cupom.limite_usos is not None and int(cupom.usos_atuais or 0) >= int(cupom.limite_usos):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"O cupom '{cupom.codigo}' atingiu o limite máximo de utilizações.",
        )
    return cupom


def create_crm_campaign(
    db: Session,
    *,
    restaurante_id: int,
    usuario_id: Optional[str],
    nome: str,
    objetivo: str,
    segmento_filtro: str,
    abordagem_tipo: str,
    cupom_id: Optional[str],
    template_mensagem: str,
    janela_atribuicao_dias: int = DEFAULT_ATTRIBUTION_WINDOW_DAYS,
    status_campanha: str = "EM_EXECUCAO",
) -> dict[str, Any]:
    """Cria uma campanha guiada validando objetivo, benefício e template."""
    ensure_crm_tables(db)
    nome_clean = (nome or "").strip()
    if len(nome_clean) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="O nome da campanha deve ter pelo menos 3 caracteres.",
        )
    template_clean = (template_mensagem or "").strip()
    if len(template_clean) < 10:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A mensagem da campanha deve ter pelo menos 10 caracteres.",
        )

    cupom = validate_campaign_coupon(db, restaurante_id=restaurante_id, cupom_id=cupom_id)
    if abordagem_tipo == "CUPOM" and cupom is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Selecione um cupom ativo quando a abordagem for com cupom.",
        )

    campanha = CrmCampanha(
        id=str(uuid.uuid4()),
        restaurante_id=restaurante_id,
        nome=nome_clean[:120],
        objetivo=objetivo,
        segmento_filtro=segmento_filtro,
        abordagem_tipo=abordagem_tipo,
        cupom_id=cupom.id if cupom else None,
        template_mensagem=template_clean,
        janela_atribuicao_dias=max(1, min(90, int(janela_atribuicao_dias or DEFAULT_ATTRIBUTION_WINDOW_DAYS))),
        status=status_campanha,
        criado_por_id=usuario_id,
        criado_em=get_utc_now(),
        atualizado_em=get_utc_now(),
    )
    db.add(campanha)
    db.commit()
    db.refresh(campanha)
    return {
        "id": str(campanha.id),
        "nome": campanha.nome,
        "objetivo": campanha.objetivo,
        "segmento_filtro": campanha.segmento_filtro,
        "abordagem_tipo": campanha.abordagem_tipo,
        "cupom_id": campanha.cupom_id,
        "cupom_codigo": cupom.codigo if cupom else None,
        "template_mensagem": campanha.template_mensagem,
        "janela_atribuicao_dias": campanha.janela_atribuicao_dias,
        "status": campanha.status,
        "criado_em": to_utc(campanha.criado_em).isoformat() if campanha.criado_em else None,
    }


def record_crm_customer_contact(
    db: Session,
    *,
    restaurante_id: int,
    usuario_id: Optional[str],
    cliente_id: str,
    campanha_id: Optional[str] = None,
    objetivo: str = "CUSTOM",
    abordagem_tipo: str = "SEM_DESCONTO",
    cupom_id: Optional[str] = None,
    canal: str = "WHATSAPP_MANUAL",
    acao_executada: str = "CONTATO_MANUAL_CONFIRMADO",
    mensagem_personalizada: Optional[str] = None,
    observacao: Optional[str] = None,
    forcar_contato_recente: bool = False,
    now: Optional[datetime.datetime] = None,
) -> dict[str, Any]:
    """Registra ação de contato por cliente respeitando opt-out, validade de telefone e cooldown."""
    ensure_crm_tables(db)
    utc_now = to_utc(now) if now is not None else get_utc_now()

    cliente = (
        db.query(Cliente)
        .filter(Cliente.restaurante_id == restaurante_id, Cliente.id == str(cliente_id))
        # Serialize confirmations from different operators before checking the
        # cooldown; a UI lock alone cannot protect concurrent sessions.
        .with_for_update()
        .first()
    )
    if cliente is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cliente não encontrado neste restaurante.",
        )

    if campanha_id:
        campanha = (
            db.query(CrmCampanha)
            .filter(
                CrmCampanha.restaurante_id == restaurante_id,
                CrmCampanha.id == str(campanha_id),
            )
            .first()
        )
        if campanha is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Campanha informada não pertence a este restaurante.",
            )
        if not cupom_id and campanha.cupom_id:
            cupom_id = campanha.cupom_id
        if objetivo == "CUSTOM" and campanha.objetivo:
            objetivo = campanha.objetivo
        if abordagem_tipo == "SEM_DESCONTO" and campanha.abordagem_tipo:
            abordagem_tipo = campanha.abordagem_tipo

    # Verificar opt-out de marketing
    pref = (
        db.query(CrmClientePreferencia)
        .filter(
            CrmClientePreferencia.restaurante_id == restaurante_id,
            CrmClientePreferencia.cliente_id == cliente.id,
        )
        .first()
    )
    if pref and pref.opt_out_marketing and acao_executada != "IGNORADO":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este cliente está marcado para não receber campanhas (opt-out ativo).",
        )

    # Validar telefone se a ação tentar abrir WhatsApp
    if canal == "WHATSAPP_MANUAL" and acao_executada == "WHATSAPP_ABERTO":
        if not is_valid_whatsapp_phone(cliente.telefone):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Telefone do cliente inválido para abrir conversa no WhatsApp (informe DDD + número).",
            )

    # Validar cupom se vinculado
    cupom = validate_campaign_coupon(
        db, restaurante_id=restaurante_id, cupom_id=cupom_id, now=utc_now
    )

    # Verificar cooldown de contato recente (últimos 7 dias)
    if (
        acao_executada in ("CONTATO_MANUAL_CONFIRMADO", "WHATSAPP_ABERTO")
        and not forcar_contato_recente
    ):
        cutoff_recent = utc_now - datetime.timedelta(days=RECENT_CONTACT_COOLDOWN_DAYS)
        recent = (
            db.query(CrmContatoCliente)
            .filter(
                CrmContatoCliente.restaurante_id == restaurante_id,
                CrmContatoCliente.cliente_id == cliente.id,
                CrmContatoCliente.acao_executada.in_(
                    ["CONTATO_MANUAL_CONFIRMADO"]
                ),
            )
            .order_by(CrmContatoCliente.criado_em.desc())
            .first()
        )
        if recent is not None:
            recent_dt = to_utc(recent.criado_em)
            if recent_dt is not None and recent_dt > cutoff_recent:
                dias = max(0, (utc_now - recent_dt).days)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Cliente já foi abordado há {dias} dia(s) (janela de proteção de "
                        f"{RECENT_CONTACT_COOLDOWN_DAYS} dias para evitar insistência)."
                    ),
                )

    contato = CrmContatoCliente(
        id=str(uuid.uuid4()),
        restaurante_id=restaurante_id,
        campanha_id=campanha_id,
        cliente_id=cliente.id,
        objetivo=objetivo,
        abordagem_tipo=abordagem_tipo,
        cupom_id=cupom.id if cupom else None,
        canal=canal,
        acao_executada=acao_executada,
        mensagem_personalizada=(mensagem_personalizada or "").strip() or None,
        observacao=(observacao or "").strip()[:500] or None,
        registrado_por_id=usuario_id,
        criado_em=utc_now,
    )
    db.add(contato)
    db.commit()
    db.refresh(contato)

    return {
        "id": str(contato.id),
        "cliente_id": str(contato.cliente_id),
        "campanha_id": contato.campanha_id,
        "objetivo": contato.objetivo,
        "abordagem_tipo": contato.abordagem_tipo,
        "cupom_id": contato.cupom_id,
        "canal": contato.canal,
        "acao_executada": contato.acao_executada,
        "comprovacao_envio": (
            "REGISTRO_MANUAL_OPERADOR"
            if acao_executada == "CONTATO_MANUAL_CONFIRMADO"
            else "ABERTURA_WHATSAPP_NAO_COMPROVA_ENVIO"
            if acao_executada == "WHATSAPP_ABERTO"
            else "APENAS_COPIA_PREPARACAO"
        ),
        "criado_em": to_utc(contato.criado_em).isoformat() if contato.criado_em else None,
    }


def get_crm_overview_and_results(
    db: Session,
    *,
    restaurante_id: int,
    loyalty_enabled: bool,
    coupons_enabled: bool,
    periodo_dias: int = 30,
    janela_atribuicao_dias: int = DEFAULT_ATTRIBUTION_WINDOW_DAYS,
    now: Optional[datetime.datetime] = None,
) -> dict[str, Any]:
    """Calcula Oportunidades, Campanhas e Resultados com atribuição sem dupla contagem."""
    ensure_crm_tables(db)
    utc_now = to_utc(now) if now is not None else get_utc_now()
    periodo_dias = max(1, min(365, int(periodo_dias or 30)))
    janela_atribuicao_dias = max(1, min(90, int(janela_atribuicao_dias or DEFAULT_ATTRIBUTION_WINDOW_DAYS)))
    inicio_periodo = utc_now - datetime.timedelta(days=periodo_dias)

    cliente_rows = (
        db.query(
            Cliente.id,
            Cliente.saldo_pontos,
            Cliente.saldo_cashback,
            Cliente._telefone,
        )
        .filter(Cliente.restaurante_id == restaurante_id)
        .order_by(Cliente.criado_em.desc(), Cliente.id.asc())
        .all()
    )
    metrics = load_customer_relationship_metrics(
        db,
        restaurante_id=restaurante_id,
        cliente_ids=[str(c[0]) for c in cliente_rows],
        now=utc_now,
        include_products=False,
    )
    base_payloads = []
    for cid_val, raw_pontos, raw_cashback, enc_telefone in cliente_rows:
        cid = str(cid_val)
        metric = metrics.get(cid)
        pontos = int(raw_pontos or 0)
        cashback = round(float(raw_cashback or 0.0), 2)
        base_payloads.append(
            {
                "id": cid,
                "_encrypted_telefone": enc_telefone,
                "pontos": pontos,
                "saldo_pontos": pontos,
                "saldoCashback": cashback,
                "saldo_cashback": cashback,
                "pedidos_concluidos": metric.pedidos_concluidos if metric else 0,
                "ultima_compra_em": metric.ultima_compra_em if metric else None,
                "dias_sem_comprar": metric.dias_sem_comprar if metric else None,
                "intervalo_medio_dias": metric.intervalo_medio_dias if metric else None,
            }
        )
    enriched_customers = enrich_customer_crm_payloads(
        db,
        restaurante_id=restaurante_id,
        payloads=base_payloads,
        loyalty_enabled=loyalty_enabled,
        now=utc_now,
    )

    oportunidades = build_opportunities_catalog(
        enriched_customers,
        loyalty_enabled=loyalty_enabled,
        coupons_enabled=coupons_enabled,
    )

    # 1. Conversão de 2ª compra na base identificada
    clientes_com_pelo_menos_1_compra = sum(
        1 for c in enriched_customers if int(c.get("pedidos_concluidos") or 0) >= 1
    )
    clientes_com_segunda_compra = sum(
        1 for c in enriched_customers if int(c.get("pedidos_concluidos") or 0) >= 2
    )
    taxa_segunda_compra = (
        round((clientes_com_segunda_compra / clientes_com_pelo_menos_1_compra) * 100.0, 1)
        if clientes_com_pelo_menos_1_compra > 0
        else None
    )

    # 2. Carregar campanhas e contatos do restaurante
    campanhas_rows = (
        db.query(CrmCampanha)
        .filter(CrmCampanha.restaurante_id == restaurante_id)
        .order_by(CrmCampanha.criado_em.desc())
        .all()
    )
    campanhas_by_id = {str(cp.id): cp for cp in campanhas_rows}

    contatos_rows = (
        db.query(CrmContatoCliente)
        .filter(
            CrmContatoCliente.restaurante_id == restaurante_id,
            CrmContatoCliente.acao_executada.in_(
                ["CONTATO_MANUAL_CONFIRMADO"]
            ),
        )
        .order_by(CrmContatoCliente.criado_em.asc(), CrmContatoCliente.id.asc())
        .all()
    )

    contatos_no_periodo = [
        ct
        for ct in contatos_rows
        if to_utc(ct.criado_em) is not None and to_utc(ct.criado_em) >= inicio_periodo
    ]

    # 3. Carregar comandas do restaurante no período para atribuição honesta
    sql_cutoff = (inicio_periodo - datetime.timedelta(days=1)).replace(tzinfo=None)
    comandas_all = (
        db.query(
            Comanda.id,
            Comanda.cliente_id,
            Comanda.fechado_em,
            Comanda.criado_em,
            Comanda.valor_pago,
            Comanda.fechada,
            Comanda.delivery_status,
            Comanda.online_payment_status,
            Comanda.cupom_id,
            Comanda.valor_desconto_cupom,
            Comanda.valor_desconto_cashback,
        )
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.cliente_id.isnot(None),
            func.coalesce(Comanda.fechado_em, Comanda.criado_em) >= sql_cutoff,
        )
        .order_by(
            func.coalesce(Comanda.fechado_em, Comanda.criado_em).asc(),
            Comanda.id.asc(),
        )
        .all()
    )
    all_comanda_ids = [str(c.id) for c in comandas_all]

    # Estornos e lançamentos para filtrar pedidos cancelados/estornados
    estornos_map: dict[str, Decimal] = {}
    lanc_status_map: dict[str, list[str]] = {}
    if all_comanda_ids:
        for cid_val, sum_est in (
            db.query(Pagamento.comanda_id, func.sum(PagamentoEstorno.valor))
            .join(
                PagamentoEstorno,
                (PagamentoEstorno.pagamento_id == Pagamento.id)
                & (PagamentoEstorno.restaurante_id == Pagamento.restaurante_id),
            )
            .filter(
                Pagamento.restaurante_id == restaurante_id,
                Pagamento.comanda_id.in_(all_comanda_ids),
            )
            .group_by(Pagamento.comanda_id)
            .all()
        ):
            estornos_map[str(cid_val)] = Decimal(str(sum_est or 0)).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )

        for l_cid, l_st in (
            db.query(Lancamento.comanda_id, Lancamento.status)
            .filter(
                Lancamento.restaurante_id == restaurante_id,
                Lancamento.comanda_id.in_(all_comanda_ids),
            )
            .all()
        ):
            lanc_status_map.setdefault(str(l_cid), []).append(str(l_st or ""))

    # Multiple campaigns may share a coupon: only campaigns already created
    # when the order closed may claim a coupon use, newest eligible first.
    campaign_by_cupom_id: dict[str, list[CrmCampanha]] = {}
    for cp in campanhas_rows:  # sorted by creation, newest first
        if cp.cupom_id:
            campaign_by_cupom_id.setdefault(str(cp.cupom_id), []).append(cp)

    # Contatos agrupados por cliente
    contacts_by_customer: dict[str, list[CrmContatoCliente]] = {}
    for ct in contatos_no_periodo:
        contacts_by_customer.setdefault(str(ct.cliente_id), []).append(ct)

    # Atribuição sem dupla contagem (cada pedido associado no máximo a 1 campanha/contato)
    claimed_order_ids: set[str] = set()
    pedidos_comprovados_cupom = 0
    pedidos_estimados_janela = 0
    pedidos_cancelados_excluidos = 0
    valor_comprovado_cupom = Decimal("0.00")
    valor_estimado_janela = Decimal("0.00")
    desconto_cupom_periodo = Decimal("0.00")
    desconto_fidelidade_periodo = Decimal("0.00")
    usos_cupons_campanha = 0
    cupons_sem_contato_confirmado = 0

    # Actual event dates only; daily counts, not synthetic allocation.
    contacts_by_day: dict[str, set[str]] = {}
    returns_by_day: dict[str, set[str]] = {}
    for contact in contatos_no_periodo:
        contact_time = to_utc(contact.criado_em)
        if contact_time is not None and contact_time <= utc_now:
            contacts_by_day.setdefault(contact_time.date().isoformat(), set()).add(str(contact.cliente_id))

    clientes_retorno_cupom: set[str] = set()
    clientes_retorno_temporal: set[str] = set()

    # Métricas por campanha e por tipo de abordagem
    campaign_stats: dict[str, dict[str, Any]] = {
        str(cp.id): {
            "abordados_ids": set(),
            "voltaram_ids": set(),
            "pedidos_cupom": 0,
            "pedidos_temporal": 0,
            "cupons_sem_contato": 0,
            "valor_pago_liquido": Decimal("0.00"),
            "desconto_utilizado": Decimal("0.00"),
        }
        for cp in campanhas_rows
    }
    approach_stats: dict[str, dict[str, Any]] = {}

    for ct in contatos_no_periodo:
        if ct.campanha_id and str(ct.campanha_id) in campaign_stats:
            campaign_stats[str(ct.campanha_id)]["abordados_ids"].add(str(ct.cliente_id))
        key_ap = f"{ct.objetivo}:{ct.abordagem_tipo}"
        st_ap = approach_stats.setdefault(
            key_ap,
            {
                "objetivo": ct.objetivo,
                "abordagem_tipo": ct.abordagem_tipo,
                "abordados_ids": set(),
                "voltaram_ids": set(),
                "pedidos_associados": 0,
                "valor_pago_liquido": Decimal("0.00"),
                "desconto_utilizado": Decimal("0.00"),
            },
        )
        st_ap["abordados_ids"].add(str(ct.cliente_id))

    for com in comandas_all:
        cid_str = str(com.id)
        client_id_str = str(com.cliente_id)
        order_dt = to_utc(com.fechado_em or com.criado_em)
        if order_dt is None or order_dt < inicio_periodo:
            continue

        bruto = Decimal(str(com.valor_pago or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        estornado = estornos_map.get(cid_str, Decimal("0.00"))
        liquido = max(Decimal("0.00"), bruto - estornado)
        l_sts = lanc_status_map.get(cid_str, [])
        all_cancelled = bool(l_sts) and all(st in ("cancelado", "recusado") for st in l_sts)

        is_valid_order = (
            bool(com.fechada)
            and com.delivery_status != "recusado"
            and com.online_payment_status in (None, "approved")
            and not all_cancelled
            and not (estornado > 0 and liquido <= 0)
        )

        # Verificar se pedido inválido era de cliente abordado ou tinha cupom de campanha
        customer_contacts = contacts_by_customer.get(client_id_str, [])
        had_prior_contact = any(
            to_utc(ct.criado_em) is not None and to_utc(ct.criado_em) <= order_dt
            for ct in customer_contacts
        )
        matched_campaign_coupon = next(
            (cp for cp in campaign_by_cupom_id.get(str(com.cupom_id), [])
             if to_utc(cp.criado_em) is not None and to_utc(cp.criado_em) <= order_dt),
            None,
        ) if com.cupom_id else None
        has_campaign_coupon = matched_campaign_coupon is not None

        if not is_valid_order:
            if had_prior_contact or has_campaign_coupon:
                pedidos_cancelados_excluidos += 1
            continue

        # Somar descontos efetivamente utilizados em pedidos válidos no período
        desc_cupom = Decimal(str(com.valor_desconto_cupom or 0)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        desc_cashback = Decimal(str(com.valor_desconto_cashback or 0)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        desconto_cupom_periodo += desc_cupom
        desconto_fidelidade_periodo += desc_cashback

        if cid_str in claimed_order_ids:
            continue

        # A confirmed, period-scoped contact must precede the purchase and
        # respect its campaign's immutable original attribution window.
        eligible_contacts: list[CrmContatoCliente] = []
        for ct in customer_contacts:
            ct_dt = to_utc(ct.criado_em)
            if ct_dt is None or ct_dt > order_dt:
                continue
            camp = campanhas_by_id.get(str(ct.campanha_id)) if ct.campanha_id else None
            if camp is not None:
                camp_created = to_utc(camp.criado_em)
                if camp_created is None or camp_created > order_dt:
                    continue
                effective_window = camp.janela_atribuicao_dias
            else:
                effective_window = janela_atribuicao_dias
            if order_dt <= ct_dt + datetime.timedelta(days=int(effective_window)):
                eligible_contacts.append(ct)
        matched_contact = eligible_contacts[-1] if eligible_contacts else None

        # Regra 1 (Prioridade máxima): uso explícito do cupom, com ou sem contato
        matched_contact_coupon = next(
            (
                ct
                for ct in reversed(eligible_contacts)
                if ct.cupom_id
                and com.cupom_id
                and str(ct.cupom_id) == str(com.cupom_id)
            ),
            None,
        )
        matched_contact = matched_contact_coupon or matched_contact

        if matched_contact_coupon is not None or matched_campaign_coupon is not None:
            claimed_order_ids.add(cid_str)
            pedidos_comprovados_cupom += 1
            usos_cupons_campanha += 1
            valor_comprovado_cupom += liquido
            if matched_contact is not None:
                clientes_retorno_cupom.add(client_id_str)
                returns_by_day.setdefault(order_dt.date().isoformat(), set()).add(client_id_str)
            else:
                cupons_sem_contato_confirmado += 1

            target_camp_id = (
                str(matched_contact_coupon.campanha_id)
                if matched_contact_coupon and matched_contact_coupon.campanha_id
                else str(matched_campaign_coupon.id)
                if matched_campaign_coupon
                else None
            )
            if target_camp_id and target_camp_id in campaign_stats:
                campaign_contact = next((ct for ct in reversed(eligible_contacts)
                    if str(ct.campanha_id) == target_camp_id), None)
                if campaign_contact is not None:
                    campaign_stats[target_camp_id]["voltaram_ids"].add(client_id_str)
                else:
                    campaign_stats[target_camp_id]["cupons_sem_contato"] += 1
                campaign_stats[target_camp_id]["pedidos_cupom"] += 1
                campaign_stats[target_camp_id]["valor_pago_liquido"] += liquido
                campaign_stats[target_camp_id]["desconto_utilizado"] += desc_cupom + desc_cashback

            if matched_contact is not None:
                key_ap = f"{matched_contact.objetivo}:{matched_contact.abordagem_tipo}"
                st_ap = approach_stats.get(key_ap)
                if st_ap is not None:
                    st_ap["voltaram_ids"].add(client_id_str)
                    st_ap["pedidos_associados"] += 1
                    st_ap["valor_pago_liquido"] += liquido
                    st_ap["desconto_utilizado"] += desc_cupom + desc_cashback
            continue

        # Regra 2: associação temporal após contato manual confirmado
        if eligible_contacts:
            latest_ct = eligible_contacts[-1]
            claimed_order_ids.add(cid_str)
            pedidos_estimados_janela += 1
            valor_estimado_janela += liquido
            clientes_retorno_temporal.add(client_id_str)
            returns_by_day.setdefault(order_dt.date().isoformat(), set()).add(client_id_str)

            if latest_ct.campanha_id and str(latest_ct.campanha_id) in campaign_stats:
                c_stat = campaign_stats[str(latest_ct.campanha_id)]
                c_stat["voltaram_ids"].add(client_id_str)
                c_stat["pedidos_temporal"] += 1
                c_stat["valor_pago_liquido"] += liquido
                c_stat["desconto_utilizado"] += desc_cupom + desc_cashback

            key_ap = f"{latest_ct.objetivo}:{latest_ct.abordagem_tipo}"
            st_ap = approach_stats.get(key_ap)
            if st_ap is not None:
                st_ap["voltaram_ids"].add(client_id_str)
                st_ap["pedidos_associados"] += 1
                st_ap["valor_pago_liquido"] += liquido
                st_ap["desconto_utilizado"] += desc_cupom + desc_cashback

    clientes_abordados_ids = {str(ct.cliente_id) for ct in contatos_no_periodo}
    clientes_voltaram_ids = (clientes_retorno_cupom | clientes_retorno_temporal) & clientes_abordados_ids
    tem_rastreamento_abordagem = len(clientes_abordados_ids) > 0 or len(campanhas_rows) > 0

    taxa_retorno = (
        round((len(clientes_voltaram_ids) / len(clientes_abordados_ids)) * 100.0, 1)
        if len(clientes_abordados_ids) > 0
        else None
    )

    total_pedidos_associados = pedidos_comprovados_cupom + pedidos_estimados_janela
    total_valor_associado = valor_comprovado_cupom + valor_estimado_janela
    campaign_orders = sum(st["pedidos_cupom"] + st["pedidos_temporal"] for st in campaign_stats.values())
    campaign_value = sum((st["valor_pago_liquido"] for st in campaign_stats.values()), Decimal("0.00"))

    campanhas_list: list[dict[str, Any]] = []
    for cp in campanhas_rows:
        st = campaign_stats[str(cp.id)]
        cp_dt = to_utc(cp.criado_em)
        campanhas_list.append(
            {
                "id": str(cp.id),
                "nome": cp.nome,
                "objetivo": cp.objetivo,
                "segmento_filtro": cp.segmento_filtro,
                "abordagem_tipo": cp.abordagem_tipo,
                "cupom_id": cp.cupom_id,
                "template_mensagem": cp.template_mensagem,
                "janela_atribuicao_dias": cp.janela_atribuicao_dias,
                "status": cp.status,
                "criado_em": cp_dt.isoformat() if cp_dt else None,
                "clientes_abordados": len(st["abordados_ids"]),
                "clientes_que_voltaram": len(st["voltaram_ids"]),
                "cupons_sem_contato_confirmado": st["cupons_sem_contato"],
                "pedidos_comprovados_cupom": st["pedidos_cupom"],
                "pedidos_estimados_janela": st["pedidos_temporal"],
                "valor_pago_liquido_brl": float(st["valor_pago_liquido"]),
                "desconto_utilizado_brl": float(st["desconto_utilizado"]),
            }
        )

    desempenho_abordagens = [
        {
            "objetivo": val["objetivo"],
            "abordagem_tipo": val["abordagem_tipo"],
            "clientes_abordados": len(val["abordados_ids"]),
            "clientes_que_voltaram": len(val["voltaram_ids"]),
            "pedidos_associados": val["pedidos_associados"],
            "valor_pago_liquido_brl": float(val["valor_pago_liquido"]),
            "desconto_utilizado_brl": float(val["desconto_utilizado"]),
        }
        for val in approach_stats.values()
    ]

    return {
        "oportunidades": oportunidades,
        "campanhas": campanhas_list,
        "resultados": {
            "periodo_dias": periodo_dias,
            "janela_atribuicao_dias": janela_atribuicao_dias,
            "tem_rastreamento_suficiente": tem_rastreamento_abordagem,
            "conciliacao_campanhas": {
                "pedidos_com_campanha": campaign_orders,
                "pedidos_sem_campanha": total_pedidos_associados - campaign_orders,
                "valor_com_campanha_brl": float(campaign_value),
                "valor_sem_campanha_brl": float(total_valor_associado - campaign_value),
            },
            "regra_janelas": {
                "campanhas": "PERSISTIDA",
                "sem_campanha_dias": janela_atribuicao_dias,
                "explicacao": (
                    "O período limita contatos e compras analisados. A janela histórica de "
                    "cada campanha permanece vigente; a janela geral vale só para contatos sem campanha."
                ),
            },
            "serie_temporal": [
                {
                    "data": day,
                    "clientes_contatados": len(contacts_by_day.get(day, set())),
                    "clientes_que_voltaram": len(returns_by_day.get(day, set())),
                }
                for day in sorted(set(contacts_by_day) | set(returns_by_day))
            ],
            "regra_associacao": (
                "Cada pedido fechado e pago (líquido de estornos e sem cancelamento) é associado a no máximo "
                "uma campanha/abordagem: (1) uso explícito do cupom da campanha; ou (2) compra concluída pelo "
                "cliente com contato manual confirmado dentro da janela originalmente gravada na campanha, "
                f"ou {janela_atribuicao_dias} dias para contato sem campanha. "
                "Uso de cupom sem contato confirmado é evidência de uso, não de abordagem."

            ),
            "aviso_metodologico": (
                "Receita associada não comprova receita incremental nem causalidade isolada. "
                "Compras por janela temporal são estimativas observadas, separadas dos usos explícitos de cupom."
            ),
            "conversao_segunda_compra": {
                "clientes_com_1_compra_base": clientes_com_pelo_menos_1_compra,
                "clientes_que_fizeram_segunda_compra": clientes_com_segunda_compra,
                "taxa_conversao_pct": taxa_segunda_compra,
                "escopo": "HISTORICO_TOTAL",
                "explicacao": "Indicador histórico da base identificada, não conversão no período nem retorno de campanha.",
                "status_mensuracao": (
                    "MENSURADO" if clientes_com_pelo_menos_1_compra > 0 else "NAO_MENSURADO"
                ),
            },
            "retorno_apos_abordagem": {
                "clientes_abordados_no_periodo": len(clientes_abordados_ids),
                "clientes_que_voltaram": len(clientes_voltaram_ids) if tem_rastreamento_abordagem else None,
                "clientes_retorno_comprovado_cupom": len(clientes_retorno_cupom & clientes_abordados_ids),
                "clientes_retorno_estimado_temporal": len(
                    (clientes_retorno_temporal - clientes_retorno_cupom) & clientes_abordados_ids
                ),
                "taxa_retorno_pct": taxa_retorno,
                "status_mensuracao": "MENSURADO" if len(clientes_abordados_ids) > 0 else "NAO_MENSURADO",
            },
            "pedidos_associados": {
                "total": total_pedidos_associados if tem_rastreamento_abordagem else None,
                "comprovados_por_cupom": pedidos_comprovados_cupom,
                "cupons_sem_contato_confirmado": cupons_sem_contato_confirmado,
                "estimados_por_janela_temporal": pedidos_estimados_janela,
                "pedidos_cancelados_excluidos": pedidos_cancelados_excluidos,
                "status_mensuracao": "MENSURADO" if tem_rastreamento_abordagem else "NAO_MENSURADO",
            },
            "valor_pago_pedidos_associados": {
                "total_liquido_brl": float(total_valor_associado) if tem_rastreamento_abordagem else None,
                "comprovado_cupom_brl": float(valor_comprovado_cupom),
                "estimado_temporal_brl": float(valor_estimado_janela),
                "status_mensuracao": "MENSURADO" if tem_rastreamento_abordagem else "NAO_MENSURADO",
            },
            "descontos_efetivamente_utilizados": {
                "total_brl": float(desconto_cupom_periodo + desconto_fidelidade_periodo),
                "cupom_brl": float(desconto_cupom_periodo),
                "fidelidade_cashback_brl": float(desconto_fidelidade_periodo),
                "usos_cupons_campanha": usos_cupons_campanha,
                "escopo": "PEDIDOS_VALIDOS_IDENTIFICADOS_NO_PERIODO",
            },
            "desempenho_por_abordagem": desempenho_abordagens,
        },
    }
