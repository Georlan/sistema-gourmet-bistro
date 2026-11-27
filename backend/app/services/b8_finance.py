"""Serviços do Núcleo Financeiro do Restaurante (B8 — Frente 1)."""

from __future__ import annotations

import datetime
from decimal import Decimal
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..b8_finance_models import (
    ContaPagar,
    ContaPagarBaixa,
    ContaPagarParcela,
    ContaReceber,
    ContaReceberBaixa,
    FinanceAuditoriaLog,
    FinanceCategoria,
    FinanceConta,
    FinanceMovimentacao,
    FinanceRecorrencia,
)
from .financeiro import money

DEFAULT_CATEGORIES: tuple[tuple[str, str, str], ...] = (
    ("fornecedores", "Fornecedores / Compras de Estoque", "custo_mercadoria"),
    ("aluguel", "Aluguel", "despesa_fixa"),
    ("energia", "Energia Elétrica", "despesa_fixa"),
    ("agua", "Água", "despesa_fixa"),
    ("gas", "Gás", "despesa_variavel"),
    ("salarios", "Salários e Encargos", "despesa_fixa"),
    ("embalagens", "Embalagens", "despesa_variavel"),
    ("marketing", "Marketing", "despesa_variavel"),
    ("manutencao", "Manutenção", "despesa_variavel"),
    ("taxas_pagamento", "Taxas de Pagamento / Adquirente", "taxa_pagamento"),
    ("comissoes_marketplace", "Comissões de Marketplaces", "comissao_marketplace"),
    ("tributos", "Tributos e Impostos", "tributo"),
    ("outras_despesas", "Outras Despesas", "outra"),
    ("receita_vendas", "Receitas / Outros Recebíveis", "receita"),
)


def _audit(
    db: Session,
    *,
    restaurante_id: int,
    entidade_tipo: str,
    entidade_id: str,
    acao: str,
    ator_id: str | None = None,
    detalhes: dict | None = None,
) -> None:
    db.add(
        FinanceAuditoriaLog(
            restaurante_id=restaurante_id,
            entidade_tipo=entidade_tipo,
            entidade_id=str(entidade_id),
            acao=acao,
            ator_id=ator_id,
            detalhes=detalhes or {},
        )
    )


def ensure_default_finance_setup(db: Session, restaurante_id: int) -> tuple[list[FinanceCategoria], list[FinanceConta]]:
    """Garante categorias padrão e conta financeira inicial de forma idempotente."""
    existing_cats = (
        db.query(FinanceCategoria)
        .filter(FinanceCategoria.restaurante_id == restaurante_id)
        .all()
    )
    by_code = {c.codigo: c for c in existing_cats}
    created = False
    for codigo, nome, tipo in DEFAULT_CATEGORIES:
        if codigo not in by_code:
            cat = FinanceCategoria(
                restaurante_id=restaurante_id,
                codigo=codigo,
                nome=nome,
                tipo=tipo,
                sistema=True,
                ativo=True,
            )
            db.add(cat)
            existing_cats.append(cat)
            created = True

    existing_accounts = (
        db.query(FinanceConta)
        .filter(FinanceConta.restaurante_id == restaurante_id)
        .all()
    )
    if not existing_accounts:
        caixa = FinanceConta(
            restaurante_id=restaurante_id,
            nome="Caixa Operacional",
            tipo="caixa_operacional",
            saldo_inicial=0.0,
            padrao=True,
            ativo=True,
        )
        banco = FinanceConta(
            restaurante_id=restaurante_id,
            nome="Conta Bancária Principal",
            tipo="conta_bancaria",
            saldo_inicial=0.0,
            padrao=False,
            ativo=True,
        )
        db.add_all([caixa, banco])
        existing_accounts.extend([caixa, banco])
        created = True

    if created:
        db.flush()
    return existing_cats, existing_accounts


def _add_months(base_date: datetime.date, months: int) -> datetime.date:
    month_index = base_date.month - 1 + months
    year = base_date.year + month_index // 12
    month = month_index % 12 + 1
    # Mantém último dia válido do mês (ex: 31 -> 28/30).
    import calendar
    last_day = calendar.monthrange(year, month)[1]
    return datetime.date(year, month, min(base_date.day, last_day))


def _derive_parcela_status(parcela: ContaPagarParcela, hoje: datetime.date) -> str:
    if parcela.status == "cancelado":
        return "cancelado"
    if money(parcela.valor_pago) <= Decimal("0.00"):
        return "vencido" if parcela.data_vencimento < hoje else "aberto"
    saldo = _parcela_saldo_aberto(parcela)
    if saldo <= Decimal("0.00"):
        return "pago"
    return "vencido" if parcela.data_vencimento < hoje else "parcial"


def _parcela_saldo_aberto(parcela: ContaPagarParcela) -> Decimal:
    total_devido = (
        money(parcela.valor_parcela)
        + money(parcela.juros)
        - money(parcela.desconto)
        + money(parcela.ajuste)
    )
    return max(Decimal("0.00"), money(total_devido - money(parcela.valor_pago)))


def create_conta_pagar(
    db: Session,
    *,
    restaurante_id: int,
    categoria_id: str,
    favorecido_nome: str,
    descricao: str,
    valor_original: Decimal | float,
    data_emissao: datetime.date,
    data_competencia: datetime.date,
    primeiro_vencimento: datetime.date,
    total_parcelas: int = 1,
    distribuidor_id: str | None = None,
    numero_documento: str | None = None,
    origem_tipo: str = "manual",
    origem_id: str | None = None,
    recorrencia_id: str | None = None,
    competencia_chave: str | None = None,
    observacao: str = "",
    criado_por_id: str | None = None,
) -> ContaPagar:
    valor = money(valor_original)
    if valor <= Decimal("0.00"):
        raise ValueError("O valor original da conta a pagar deve ser maior que zero.")
    if total_parcelas < 1 or total_parcelas > 60:
        raise ValueError("O número de parcelas deve estar entre 1 e 60.")

    cat = (
        db.query(FinanceCategoria)
        .filter(FinanceCategoria.restaurante_id == restaurante_id, FinanceCategoria.id == categoria_id)
        .first()
    )
    if cat is None:
        raise ValueError("Categoria financeira não encontrada.")

    if origem_id and origem_tipo != "manual":
        existing = (
            db.query(ContaPagar)
            .filter(
                ContaPagar.restaurante_id == restaurante_id,
                ContaPagar.origem_tipo == origem_tipo,
                ContaPagar.origem_id == origem_id,
            )
            .first()
        )
        if existing is not None:
            return existing

    conta = ContaPagar(
        restaurante_id=restaurante_id,
        categoria_id=categoria_id,
        distribuidor_id=distribuidor_id,
        recorrencia_id=recorrencia_id,
        competencia_chave=competencia_chave,
        favorecido_nome=favorecido_nome.strip(),
        descricao=descricao.strip(),
        numero_documento=(numero_documento or "").strip() or None,
        data_emissao=data_emissao,
        data_competencia=data_competencia,
        valor_original=float(valor),
        total_parcelas=total_parcelas,
        origem_tipo=origem_tipo,
        origem_id=origem_id,
        status="aberto",
        observacao=observacao.strip(),
        criado_por_id=criado_por_id,
    )
    db.add(conta)
    db.flush()

    base_parcela = (valor / Decimal(total_parcelas)).quantize(Decimal("0.01"))
    resto = money(valor - (base_parcela * Decimal(total_parcelas)))
    for idx in range(total_parcelas):
        val = money(base_parcela + resto) if idx == 0 else base_parcela
        parcela = ContaPagarParcela(
            restaurante_id=restaurante_id,
            conta_pagar_id=conta.id,
            numero_parcela=idx + 1,
            data_vencimento=_add_months(primeiro_vencimento, idx),
            valor_parcela=float(val),
            status="aberto",
        )
        db.add(parcela)

    _audit(
        db,
        restaurante_id=restaurante_id,
        entidade_tipo="conta_pagar",
        entidade_id=conta.id,
        acao="CRIADA",
        ator_id=criado_por_id,
        detalhes={"valor": float(valor), "parcelas": total_parcelas, "origem_tipo": origem_tipo},
    )
    db.flush()
    return conta


def baixar_parcela_conta_pagar(
    db: Session,
    *,
    restaurante_id: int,
    parcela_id: str,
    conta_financeira_id: str,
    valor_principal: Decimal | float,
    data_pagamento: datetime.date,
    idempotency_key: str,
    juros: Decimal | float = 0.0,
    desconto: Decimal | float = 0.0,
    ajuste: Decimal | float = 0.0,
    forma_pagamento: str = "pix",
    observacao: str = "",
    usuario_id: str | None = None,
) -> tuple[ContaPagarBaixa, bool]:
    """Registra baixa parcial ou total de parcela com lock e idempotência."""
    clean_key = (idempotency_key or "").strip()
    if not clean_key:
        raise ValueError("Chave de idempotência obrigatória para baixa financeira.")

    existing_baixa = (
        db.query(ContaPagarBaixa)
        .filter(
            ContaPagarBaixa.restaurante_id == restaurante_id,
            ContaPagarBaixa.idempotency_key == clean_key,
        )
        .first()
    )
    if existing_baixa is not None:
        if (
            existing_baixa.parcela_id != parcela_id
            or existing_baixa.conta_financeira_id != conta_financeira_id
            or money(existing_baixa.valor_principal) != money(valor_principal)
        ):
            raise ValueError("Chave de idempotência já utilizada para outra baixa de conta a pagar.")
        return existing_baixa, True

    parcela = (
        db.query(ContaPagarParcela)
        .filter(
            ContaPagarParcela.restaurante_id == restaurante_id,
            ContaPagarParcela.id == parcela_id,
        )
        .with_for_update()
        .first()
    )
    if parcela is None:
        raise ValueError("Parcela não encontrada.")
    if parcela.status in {"cancelado", "pago"}:
        raise ValueError(f"Parcela já está em situação '{parcela.status}'.")

    conta_fin = (
        db.query(FinanceConta)
        .filter(FinanceConta.restaurante_id == restaurante_id, FinanceConta.id == conta_financeira_id)
        .first()
    )
    if conta_fin is None:
        raise ValueError("Conta financeira não encontrada.")

    principal = money(valor_principal)
    juros_dec = money(juros)
    desconto_dec = money(desconto)
    ajuste_dec = money(ajuste)
    if principal <= Decimal("0.00"):
        raise ValueError("Valor principal da baixa deve ser maior que zero.")
    if juros_dec < Decimal("0.00") or desconto_dec < Decimal("0.00"):
        raise ValueError("Juros e desconto não podem ser negativos.")

    saldo_restante = _parcela_saldo_aberto(parcela)
    if principal > saldo_restante + Decimal("0.01"):
        raise ValueError(f"Valor principal ({principal}) excede o saldo em aberto ({saldo_restante}).")

    valor_efetivo_pago = money(principal + juros_dec - desconto_dec + ajuste_dec)
    if valor_efetivo_pago <= Decimal("0.00"):
        raise ValueError("Valor líquido pago deve ser maior que zero.")

    baixa = ContaPagarBaixa(
        restaurante_id=restaurante_id,
        parcela_id=parcela.id,
        conta_financeira_id=conta_fin.id,
        data_pagamento=data_pagamento,
        valor_principal=float(principal),
        juros=float(juros_dec),
        desconto=float(desconto_dec),
        ajuste=float(ajuste_dec),
        valor_pago=float(valor_efetivo_pago),
        forma_pagamento=forma_pagamento.strip() or "pix",
        idempotency_key=clean_key,
        observacao=observacao.strip(),
        usuario_id=usuario_id,
    )
    db.add(baixa)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        replay = (
            db.query(ContaPagarBaixa)
            .filter(
                ContaPagarBaixa.restaurante_id == restaurante_id,
                ContaPagarBaixa.idempotency_key == clean_key,
            )
            .first()
        )
        if replay is not None:
            return replay, True
        raise

    parcela.juros = float(money(parcela.juros) + juros_dec)
    parcela.desconto = float(money(parcela.desconto) + desconto_dec)
    parcela.ajuste = float(money(parcela.ajuste) + ajuste_dec)
    parcela.valor_pago = float(money(parcela.valor_pago) + valor_efetivo_pago)
    parcela.data_ultima_baixa = data_pagamento

    novo_saldo = _parcela_saldo_aberto(parcela)
    parcela.status = "pago" if novo_saldo <= Decimal("0.00") else "parcial"

    conta_pagar = (
        db.query(ContaPagar)
        .options(joinedload(ContaPagar.parcelas))
        .filter(ContaPagar.restaurante_id == restaurante_id, ContaPagar.id == parcela.conta_pagar_id)
        .first()
    )
    if conta_pagar is not None:
        statuses = {p.status for p in conta_pagar.parcelas}
        if statuses == {"pago"}:
            conta_pagar.status = "pago"
        elif "pago" in statuses or "parcial" in statuses:
            conta_pagar.status = "parcial"

    db.add(
        FinanceMovimentacao(
            restaurante_id=restaurante_id,
            conta_financeira_id=conta_fin.id,
            categoria_id=conta_pagar.categoria_id if conta_pagar else None,
            tipo="saida",
            valor=float(valor_efetivo_pago),
            data_movimento=data_pagamento,
            descricao=f"Pagamento: {conta_pagar.descricao if conta_pagar else parcela.id} ({parcela.numero_parcela}/{conta_pagar.total_parcelas if conta_pagar else 1})",
            origem_tipo="baixa_pagar",
            origem_id=baixa.id,
            usuario_id=usuario_id,
        )
    )
    _audit(
        db,
        restaurante_id=restaurante_id,
        entidade_tipo="conta_pagar_baixa",
        entidade_id=baixa.id,
        acao="BAIXA_REGISTRADA",
        ator_id=usuario_id,
        detalhes={"parcela_id": parcela.id, "valor_pago": float(valor_efetivo_pago)},
    )
    db.flush()
    return baixa, False


def cancelar_conta_pagar(
    db: Session,
    *,
    restaurante_id: int,
    conta_pagar_id: str,
    motivo: str,
    usuario_id: str | None = None,
) -> ContaPagar:
    conta = (
        db.query(ContaPagar)
        .options(joinedload(ContaPagar.parcelas))
        .filter(ContaPagar.restaurante_id == restaurante_id, ContaPagar.id == conta_pagar_id)
        .with_for_update()
        .first()
    )
    if conta is None:
        raise ValueError("Conta a pagar não encontrada.")
    if conta.status == "cancelado":
        return conta
    if any(money(p.valor_pago) > Decimal("0.00") for p in conta.parcelas):
        raise ValueError("Não é possível cancelar conta com pagamentos já realizados.")

    conta.status = "cancelado"
    conta.cancelado_motivo = (motivo or "Cancelado pelo operador").strip()[:240]
    conta.cancelado_por_id = usuario_id
    conta.cancelado_em = datetime.datetime.now(datetime.timezone.utc)
    for parcela in conta.parcelas:
        parcela.status = "cancelado"

    _audit(
        db,
        restaurante_id=restaurante_id,
        entidade_tipo="conta_pagar",
        entidade_id=conta.id,
        acao="CANCELADA",
        ator_id=usuario_id,
        detalhes={"motivo": conta.cancelado_motivo},
    )
    db.flush()
    return conta


def create_conta_receber(
    db: Session,
    *,
    restaurante_id: int,
    categoria_id: str,
    contraparte_nome: str,
    descricao: str,
    valor_previsto: Decimal | float,
    data_competencia: datetime.date,
    data_vencimento: datetime.date,
    origem_tipo: str = "manual",
    origem_id: str | None = None,
    tipo_confirmacao: str = "previsto",
    observacao: str = "",
    criado_por_id: str | None = None,
) -> ContaReceber:
    valor = money(valor_previsto)
    if valor <= Decimal("0.00"):
        raise ValueError("Valor previsto deve ser maior que zero.")
    if tipo_confirmacao not in {"previsto", "confirmado"}:
        raise ValueError("Tipo de confirmação inválido.")

    cat = (
        db.query(FinanceCategoria)
        .filter(FinanceCategoria.restaurante_id == restaurante_id, FinanceCategoria.id == categoria_id)
        .first()
    )
    if cat is None:
        raise ValueError("Categoria financeira não encontrada.")

    cr = ContaReceber(
        restaurante_id=restaurante_id,
        categoria_id=categoria_id,
        origem_tipo=origem_tipo,
        origem_id=origem_id,
        contraparte_nome=contraparte_nome.strip(),
        descricao=descricao.strip(),
        data_competencia=data_competencia,
        data_vencimento=data_vencimento,
        valor_previsto=float(valor),
        tipo_confirmacao=tipo_confirmacao,
        status="aberto",
        observacao=observacao.strip(),
        criado_por_id=criado_por_id,
    )
    db.add(cr)
    db.flush()
    _audit(
        db,
        restaurante_id=restaurante_id,
        entidade_tipo="conta_receber",
        entidade_id=cr.id,
        acao="CRIADA",
        ator_id=criado_por_id,
        detalhes={"valor_previsto": float(valor), "tipo_confirmacao": tipo_confirmacao},
    )
    return cr


def baixar_conta_receber(
    db: Session,
    *,
    restaurante_id: int,
    conta_receber_id: str,
    conta_financeira_id: str,
    valor_recebido: Decimal | float,
    data_recebimento: datetime.date,
    idempotency_key: str,
    taxa_descontada: Decimal | float = 0.0,
    forma_recebimento: str = "pix",
    observacao: str = "",
    usuario_id: str | None = None,
) -> tuple[ContaReceberBaixa, bool]:
    clean_key = (idempotency_key or "").strip()
    if not clean_key:
        raise ValueError("Chave de idempotência obrigatória para recebimento.")

    existing = (
        db.query(ContaReceberBaixa)
        .filter(
            ContaReceberBaixa.restaurante_id == restaurante_id,
            ContaReceberBaixa.idempotency_key == clean_key,
        )
        .first()
    )
    if existing is not None:
        if (
            existing.conta_receber_id != conta_receber_id
            or existing.conta_financeira_id != conta_financeira_id
            or money(existing.valor_recebido) != money(valor_recebido)
        ):
            raise ValueError("Chave de idempotência já utilizada para outro recebimento.")
        return existing, True

    cr = (
        db.query(ContaReceber)
        .filter(ContaReceber.restaurante_id == restaurante_id, ContaReceber.id == conta_receber_id)
        .with_for_update()
        .first()
    )
    if cr is None:
        raise ValueError("Conta a receber não encontrada.")
    if cr.status in {"cancelado", "estornado", "recebido"}:
        raise ValueError(f"Conta a receber já está em situação '{cr.status}'.")

    conta_fin = (
        db.query(FinanceConta)
        .filter(FinanceConta.restaurante_id == restaurante_id, FinanceConta.id == conta_financeira_id)
        .first()
    )
    if conta_fin is None:
        raise ValueError("Conta financeira não encontrada.")

    recebido = money(valor_recebido)
    taxa = money(taxa_descontada)
    if recebido <= Decimal("0.00"):
        raise ValueError("Valor recebido deve ser maior que zero.")
    if taxa < Decimal("0.00"):
        raise ValueError("Taxa descontada não pode ser negativa.")

    saldo = max(Decimal("0.00"), money(money(cr.valor_previsto) - money(cr.valor_recebido)))
    if recebido > saldo + Decimal("0.01"):
        raise ValueError(f"Valor recebido ({recebido}) excede o saldo a receber ({saldo}).")

    baixa = ContaReceberBaixa(
        restaurante_id=restaurante_id,
        conta_receber_id=cr.id,
        conta_financeira_id=conta_fin.id,
        data_recebimento=data_recebimento,
        valor_recebido=float(recebido),
        taxa_descontada=float(taxa),
        forma_recebimento=forma_recebimento.strip() or "pix",
        idempotency_key=clean_key,
        observacao=observacao.strip(),
        usuario_id=usuario_id,
    )
    db.add(baixa)
    db.flush()

    cr.valor_recebido = float(money(cr.valor_recebido) + recebido)
    novo_saldo = max(Decimal("0.00"), money(money(cr.valor_previsto) - money(cr.valor_recebido)))
    cr.status = "recebido" if novo_saldo <= Decimal("0.00") else "parcial"
    cr.tipo_confirmacao = "confirmado"

    liquido_entrada = money(recebido - taxa)
    if liquido_entrada > Decimal("0.00"):
        db.add(
            FinanceMovimentacao(
                restaurante_id=restaurante_id,
                conta_financeira_id=conta_fin.id,
                categoria_id=cr.categoria_id,
                tipo="entrada",
                valor=float(liquido_entrada),
                data_movimento=data_recebimento,
                descricao=f"Recebimento: {cr.descricao}",
                origem_tipo="baixa_receber",
                origem_id=baixa.id,
                usuario_id=usuario_id,
            )
        )
    _audit(
        db,
        restaurante_id=restaurante_id,
        entidade_tipo="conta_receber_baixa",
        entidade_id=baixa.id,
        acao="RECEBIMENTO_REGISTRADO",
        ator_id=usuario_id,
        detalhes={"conta_receber_id": cr.id, "valor_recebido": float(recebido), "taxa": float(taxa)},
    )
    db.flush()
    return baixa, False


def cancelar_conta_receber(
    db: Session,
    *,
    restaurante_id: int,
    conta_receber_id: str,
    motivo: str,
    usuario_id: str | None = None,
) -> ContaReceber:
    """Cancela conta a receber estornando movimentações anteriores de forma auditável."""
    cr = (
        db.query(ContaReceber)
        .filter(ContaReceber.restaurante_id == restaurante_id, ContaReceber.id == conta_receber_id)
        .with_for_update()
        .first()
    )
    if cr is None:
        raise ValueError("Conta a receber não encontrada.")
    if cr.status == "cancelado":
        return cr

    baixas = (
        db.query(ContaReceberBaixa)
        .filter(
            ContaReceberBaixa.restaurante_id == restaurante_id,
            ContaReceberBaixa.conta_receber_id == cr.id,
            ContaReceberBaixa.estornada.is_(False),
        )
        .all()
    )
    hoje = datetime.date.today()
    for b in baixas:
        b.estornada = True
        liquido = max(Decimal("0.00"), money(money(b.valor_recebido) - money(b.taxa_descontada)))
        if liquido > Decimal("0.00"):
            db.add(
                FinanceMovimentacao(
                    restaurante_id=restaurante_id,
                    conta_financeira_id=b.conta_financeira_id,
                    categoria_id=cr.categoria_id,
                    tipo="estorno",
                    origem_tipo="estorno_receber",
                    origem_id=b.id,
                    data_movimento=hoje,
                    valor=float(liquido),
                    descricao=f"Estorno CR ({cr.descricao}): {motivo}",
                    usuario_id=usuario_id,
                )
            )

    cr.status = "cancelado"
    cr.valor_recebido = 0.0
    _audit(
        db,
        restaurante_id=restaurante_id,
        entidade_tipo="conta_receber",
        entidade_id=cr.id,
        acao="CANCELADA",
        ator_id=usuario_id,
        detalhes={"motivo": motivo, "baixas_estornadas": len(baixas)},
    )
    db.flush()
    return cr


def gerar_competencia_recorrencias(
    db: Session,
    *,
    restaurante_id: int,
    competencia: str,  # YYYY-MM
    usuario_id: str | None = None,
) -> list[ContaPagar]:
    """Gera títulos em aberto para recorrências ativas na competência YYYY-MM sem duplicidade."""
    year_str, month_str = competencia.split("-")
    year, month = int(year_str), int(month_str)
    import calendar
    last_day = calendar.monthrange(year, month)[1]
    data_comp = datetime.date(year, month, 1)

    recs = (
        db.query(FinanceRecorrencia)
        .filter(FinanceRecorrencia.restaurante_id == restaurante_id, FinanceRecorrencia.ativa.is_(True))
        .all()
    )
    created: list[ContaPagar] = []
    for rec in recs:
        already = (
            db.query(ContaPagar.id)
            .filter(
                ContaPagar.restaurante_id == restaurante_id,
                ContaPagar.recorrencia_id == rec.id,
                ContaPagar.competencia_chave == competencia,
            )
            .first()
        )
        if already is not None:
            continue
        venc = datetime.date(year, month, min(max(1, int(rec.dia_vencimento)), last_day))
        conta = create_conta_pagar(
            db,
            restaurante_id=restaurante_id,
            categoria_id=rec.categoria_id,
            favorecido_nome=rec.favorecido_nome,
            descricao=f"{rec.descricao} ({competencia})",
            valor_original=rec.valor_previsto,
            data_emissao=data_comp,
            data_competencia=data_comp,
            primeiro_vencimento=venc,
            total_parcelas=1,
            distribuidor_id=rec.distribuidor_id,
            origem_tipo="recorrencia",
            origem_id=f"{rec.id}:{competencia}",
            recorrencia_id=rec.id,
            competencia_chave=competencia,
            criado_por_id=usuario_id,
        )
        rec.ultima_competencia_gerada = competencia
        created.append(conta)
    db.flush()
    return created


def registrar_movimentacao_manual(
    db: Session,
    *,
    restaurante_id: int,
    conta_financeira_id: str,
    tipo: str,
    valor: Decimal | float,
    data_movimento: datetime.date,
    descricao: str,
    categoria_id: str | None = None,
    conta_destino_id: str | None = None,
    usuario_id: str | None = None,
) -> list[FinanceMovimentacao]:
    val = money(valor)
    if val <= Decimal("0.00"):
        raise ValueError("Valor da movimentação deve ser maior que zero.")

    origem_conta = (
        db.query(FinanceConta)
        .filter(FinanceConta.restaurante_id == restaurante_id, FinanceConta.id == conta_financeira_id)
        .first()
    )
    if origem_conta is None:
        raise ValueError("Conta financeira de origem não encontrada.")

    if tipo == "transferencia":
        if not conta_destino_id or conta_destino_id == conta_financeira_id:
            raise ValueError("Informe uma conta de destino distinta para transferência.")
        destino_conta = (
            db.query(FinanceConta)
            .filter(FinanceConta.restaurante_id == restaurante_id, FinanceConta.id == conta_destino_id)
            .first()
        )
        if destino_conta is None:
            raise ValueError("Conta financeira de destino não encontrada.")
        tx_ref = f"tx-{uuid.uuid4().hex[:12]}"
        mov_out = FinanceMovimentacao(
            restaurante_id=restaurante_id,
            conta_financeira_id=origem_conta.id,
            categoria_id=categoria_id,
            tipo="transferencia_saida",
            valor=float(val),
            data_movimento=data_movimento,
            descricao=f"Transferência para {destino_conta.nome}: {descricao}",
            origem_tipo="transferencia",
            origem_id=tx_ref,
            usuario_id=usuario_id,
        )
        mov_in = FinanceMovimentacao(
            restaurante_id=restaurante_id,
            conta_financeira_id=destino_conta.id,
            categoria_id=categoria_id,
            tipo="transferencia_entrada",
            valor=float(val),
            data_movimento=data_movimento,
            descricao=f"Transferência de {origem_conta.nome}: {descricao}",
            origem_tipo="transferencia",
            origem_id=tx_ref,
            usuario_id=usuario_id,
        )
        db.add_all([mov_out, mov_in])
        db.flush()
        return [mov_out, mov_in]

    if tipo not in {"entrada", "saida", "aporte", "retirada"}:
        raise ValueError("Tipo de movimentação inválido.")

    mov = FinanceMovimentacao(
        restaurante_id=restaurante_id,
        conta_financeira_id=origem_conta.id,
        categoria_id=categoria_id,
        tipo=tipo,
        valor=float(val),
        data_movimento=data_movimento,
        descricao=descricao.strip(),
        origem_tipo="manual",
        usuario_id=usuario_id,
    )
    db.add(mov)
    db.flush()
    return [mov]


def serialize_conta_pagar(conta: ContaPagar, hoje: datetime.date | None = None) -> dict:
    ref_day = hoje or datetime.date.today()
    parcelas_out = []
    total_pago = Decimal("0.00")
    total_aberto = Decimal("0.00")
    has_overdue = False
    for p in sorted(conta.parcelas, key=lambda x: x.numero_parcela):
        st = _derive_parcela_status(p, ref_day)
        saldo = _parcela_saldo_aberto(p)
        total_pago += money(p.valor_pago)
        if st != "cancelado":
            total_aberto += saldo
        if st == "vencido":
            has_overdue = True
        parcelas_out.append({
            "id": p.id,
            "numero_parcela": p.numero_parcela,
            "data_vencimento": p.data_vencimento.isoformat(),
            "valor_parcela": float(money(p.valor_parcela)),
            "juros": float(money(p.juros)),
            "desconto": float(money(p.desconto)),
            "ajuste": float(money(p.ajuste)),
            "valor_pago": float(money(p.valor_pago)),
            "saldo_aberto": float(saldo),
            "status": st,
            "data_ultima_baixa": p.data_ultima_baixa.isoformat() if p.data_ultima_baixa else None,
        })

    derived_status = conta.status
    if conta.status != "cancelado" and has_overdue:
        derived_status = "vencido"

    return {
        "id": conta.id,
        "categoria_id": conta.categoria_id,
        "categoria_nome": conta.categoria.nome if conta.categoria else None,
        "categoria_tipo": conta.categoria.tipo if conta.categoria else None,
        "distribuidor_id": conta.distribuidor_id,
        "favorecido_nome": conta.favorecido_nome,
        "descricao": conta.descricao,
        "numero_documento": conta.numero_documento,
        "data_emissao": conta.data_emissao.isoformat(),
        "data_competencia": conta.data_competencia.isoformat(),
        "valor_original": float(money(conta.valor_original)),
        "valor_pago": float(money(total_pago)),
        "saldo_aberto": float(money(total_aberto)),
        "total_parcelas": conta.total_parcelas,
        "origem_tipo": conta.origem_tipo,
        "origem_id": conta.origem_id,
        "status": derived_status,
        "observacao": conta.observacao,
        "parcelas": parcelas_out,
    }


def serialize_conta_receber(cr: ContaReceber, hoje: datetime.date | None = None) -> dict:
    ref_day = hoje or datetime.date.today()
    saldo = max(Decimal("0.00"), money(money(cr.valor_previsto) - money(cr.valor_recebido)))
    status = cr.status
    if status in {"aberto", "parcial"} and saldo > Decimal("0.00") and cr.data_vencimento < ref_day:
        status = "vencido"
    return {
        "id": cr.id,
        "categoria_id": cr.categoria_id,
        "categoria_nome": cr.categoria.nome if cr.categoria else None,
        "origem_tipo": cr.origem_tipo,
        "origem_id": cr.origem_id,
        "contraparte_nome": cr.contraparte_nome,
        "descricao": cr.descricao,
        "data_competencia": cr.data_competencia.isoformat(),
        "data_vencimento": cr.data_vencimento.isoformat(),
        "valor_previsto": float(money(cr.valor_previsto)),
        "valor_recebido": float(money(cr.valor_recebido)),
        "saldo_aberto": float(saldo),
        "tipo_confirmacao": cr.tipo_confirmacao,
        "status": status,
        "observacao": cr.observacao,
    }
