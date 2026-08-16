from __future__ import annotations

import datetime
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from ..models import (
    CaixaTurno,
    Comanda,
    ConfiguracaoRestaurante,
    Item,
    Lancamento,
    Mesa,
    PrintJob,
    Restaurante,
    Usuario,
)
from ..printer_service import printer_service
from ..subscription import subscription_has_printing
from ..timezone_utils import to_operational_local_time


class PrintingRequestError(ValueError):
    """Erro de domínio que pode ser traduzido diretamente para uma resposta HTTP."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class PrintPreferences:
    restaurant_name: str
    restaurant_name_position: str
    print_footer: Optional[str]
    taxa_servico_ativa: bool
    taxa_servico_padrao: float


@dataclass(frozen=True)
class TableReceiptSnapshot:
    mesa_id: int
    numero_pedido: int
    tipo: str
    garcom_nome: str
    opened_at: Optional[datetime.datetime]
    comandas_details: list[dict]


def get_print_preferences(db: Session, restaurante_id: int) -> PrintPreferences:
    config = (
        db.query(ConfiguracaoRestaurante)
        .options(joinedload(ConfiguracaoRestaurante.restaurante))
        .filter(ConfiguracaoRestaurante.restaurante_id == restaurante_id)
        .first()
    )

    restaurant_name = "Kôma Gourmet Bistrô"
    if config:
        restaurant_name = (
            config.impressao_nome_restaurante
            or (config.restaurante.nome if config.restaurante else None)
            or restaurant_name
        )

    return PrintPreferences(
        restaurant_name=restaurant_name,
        restaurant_name_position=(
            config.impressao_nome_posicao if config else "cabecalho"
        ),
        print_footer=(config.impressao_mensagem_rodape if config else None),
        taxa_servico_ativa=(config.taxa_servico_ativa if config else True),
        taxa_servico_padrao=float(
            config.taxa_servico_padrao if config and config.taxa_servico_padrao is not None else 10.0
        ),
    )


def _item_detail(item: Item) -> Optional[dict]:
    produto = item.produto
    if produto is None:
        return None
    return {
        "id": item.id,
        "preco_unit": float(item.preco_unit or 0.0),
        "status": item.status,
        "cliente_nome": item.cliente_nome,
        "codigo": produto.id,
        "descricao": produto.descricao,
        "observacao": item.observacao,
        "produto": {
            "id": produto.id,
            "nome": produto.nome,
            "descricao": produto.descricao,
        },
    }


def _item_is_printable(item: Item) -> bool:
    """Define se um item habilita a impressão automática do lançamento."""
    produto = item.produto
    if produto is None:
        return False
    categoria = produto.categoria
    destino = (
        categoria.destino_impressao
        if categoria is not None
        else "COZINHA"
    )
    return (destino or "COZINHA").strip().upper() not in {"NENHUM", "NONE", ""}


def load_open_table_snapshot(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
) -> TableReceiptSnapshot:
    """Carrega a mesa inteira para Extrato Completo/Fechamento.

    Esta função representa a fotografia financeira da mesa aberta. Ela nunca é
    usada para a impressão automática de um lançamento novo; lançamentos têm
    uma fronteira própria em ``load_table_source_snapshot``.
    """
    db.flush()

    mesa = db.query(Mesa).filter(
        Mesa.restaurante_id == restaurante_id,
        Mesa.id == mesa_id,
    ).first()
    if not mesa:
        raise PrintingRequestError("Mesa não encontrada", status_code=404)

    comandas = (
        db.query(Comanda)
        .options(
            joinedload(Comanda.itens).joinedload(Item.produto),
            joinedload(Comanda.criada_por),
        )
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.mesa_id == mesa_id,
            Comanda.fechada == False,
        )
        .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
        .all()
    )
    if not comandas:
        raise PrintingRequestError(
            "Não há comandas abertas nesta mesa",
            status_code=400,
        )

    has_active_items = False
    comandas_details: list[dict] = []
    for comanda in comandas:
        detail = {
            "id": comanda.id,
            "identificador": comanda.identificador,
            "itens": [],
        }
        for item in comanda.itens:
            item_detail = _item_detail(item)
            if item_detail is None:
                continue
            if item.status != "cancelado":
                has_active_items = True
            detail["itens"].append(item_detail)
        comandas_details.append(detail)

    if not has_active_items:
        raise PrintingRequestError(
            "Não há itens ativos para imprimir nesta mesa",
            status_code=400,
        )

    first = comandas[0]
    opened_at_raw = min(
        (c.criado_em for c in comandas if c.criado_em is not None),
        default=None,
    )
    return TableReceiptSnapshot(
        mesa_id=mesa_id,
        numero_pedido=first.numero_pedido,
        tipo=first.tipo,
        garcom_nome=(first.criada_por.nome if first.criada_por else "Garçom"),
        opened_at=to_operational_local_time(opened_at_raw),
        comandas_details=comandas_details,
    )


def load_table_source_snapshot(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
    *,
    source_type: str,
    source_id: str,
) -> TableReceiptSnapshot:
    """Carrega somente a instância que originou um pedido impresso.

    - ``lancamento``: exatamente o lote criado naquele clique em Confirmar.
    - ``pedido``: a comanda criada em uma venda direta do caixa.
    - ``reimpressao``: respeita o ID recebido (lote ``l-`` ou comanda ``c-``).

    A regra de impressão automática é decidida no nível do lote: se existir ao
    menos um item imprimível, a via contém TODOS os itens ativos daquele lote,
    inclusive bebidas/categorias com destino NENHUM. Um lote composto somente
    por itens não imprimíveis não gera via automática. Na impressão manual de
    um lote, o pedido explícito do operador prevalece e o lote ativo pode ser
    impresso mesmo que nenhum item habilite impressão automática.

    O Extrato Completo continua usando ``load_open_table_snapshot`` e inclui
    todo o consumo ativo da mesa.
    """
    db.flush()
    normalized_source = (source_type or "").strip().casefold()
    source_id = str(source_id or "").strip()

    use_launch = normalized_source == "lancamento" or (
        normalized_source == "reimpressao" and source_id.startswith("l-")
    )
    use_command = normalized_source == "pedido" or (
        normalized_source == "reimpressao" and source_id.startswith("c-")
    )

    lancamento = None
    if use_launch:
        lancamento = (
            db.query(Lancamento)
            .options(
                joinedload(Lancamento.comanda).joinedload(Comanda.criada_por),
                joinedload(Lancamento.garcom),
                joinedload(Lancamento.itens).joinedload(Item.produto),
            )
            .join(Comanda, Comanda.id == Lancamento.comanda_id)
            .filter(
                Lancamento.restaurante_id == restaurante_id,
                Lancamento.id == source_id,
                Comanda.restaurante_id == restaurante_id,
                Comanda.mesa_id == mesa_id,
                Comanda.fechada == False,
            )
            .first()
        )
        if lancamento is None:
            raise PrintingRequestError("Lançamento não encontrado", status_code=404)
        comanda = lancamento.comanda
        source_items = list(lancamento.itens)
        garcom_nome = (
            lancamento.garcom.nome
            if lancamento.garcom is not None
            else (comanda.criada_por.nome if comanda.criada_por else "Garçom")
        )
        source_opened_at = lancamento.timestamp
    elif use_command:
        comanda = (
            db.query(Comanda)
            .options(
                joinedload(Comanda.itens).joinedload(Item.produto),
                joinedload(Comanda.criada_por),
            )
            .filter(
                Comanda.restaurante_id == restaurante_id,
                Comanda.id == source_id,
                Comanda.mesa_id == mesa_id,
                Comanda.fechada == False,
            )
            .first()
        )
        if comanda is None:
            raise PrintingRequestError("Pedido não encontrado", status_code=404)
        source_items = list(comanda.itens)
        garcom_nome = comanda.criada_por.nome if comanda.criada_por else "Garçom"
        source_opened_at = comanda.criado_em
    else:
        raise PrintingRequestError("Origem de impressão parcial inválida", status_code=400)

    active_items = [
        item for item in source_items
        if item.status != "cancelado" and item.produto is not None
    ]
    if not active_items:
        raise PrintingRequestError(
            "Não há itens ativos neste lançamento",
            status_code=400,
        )

    is_manual_reprint = normalized_source == "reimpressao"
    if not is_manual_reprint and not any(_item_is_printable(item) for item in active_items):
        raise PrintingRequestError(
            "Não há itens imprimíveis neste lançamento",
            status_code=400,
        )

    source_details = []
    for item in active_items:
        item_detail = _item_detail(item)
        if item_detail is not None:
            source_details.append(item_detail)

    return TableReceiptSnapshot(
        mesa_id=mesa_id,
        numero_pedido=comanda.numero_pedido,
        tipo=comanda.tipo,
        garcom_nome=garcom_nome,
        opened_at=to_operational_local_time(source_opened_at),
        comandas_details=[
            {
                "id": comanda.id,
                "identificador": comanda.identificador,
                "itens": source_details,
            }
        ],
    )


def render_table_receipt(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
    *,
    apenas_valores: bool = False,
    print_header: Optional[str] = None,
    print_footer: Optional[str] = None,
) -> str:
    """Fonte canônica da mesa inteira: Extrato Completo e Apenas Valores."""
    snapshot = load_open_table_snapshot(db, restaurante_id, mesa_id)
    preferences = get_print_preferences(db, restaurante_id)

    return printer_service.generate_receipt(
        num_pedido=snapshot.numero_pedido,
        tipo=snapshot.tipo,
        mesa_id=snapshot.mesa_id,
        garcom_nome=snapshot.garcom_nome,
        comandas_details=snapshot.comandas_details,
        opened_at=snapshot.opened_at,
        print_header=print_header or preferences.restaurant_name,
        print_footer=(print_footer if print_footer is not None else preferences.print_footer),
        taxa_servico_ativa=preferences.taxa_servico_ativa,
        taxa_servico_padrao=preferences.taxa_servico_padrao,
        apenas_valores=apenas_valores,
        restaurant_name_position=preferences.restaurant_name_position,
    )


def render_table_source_receipt(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
    *,
    source_type: str,
    source_id: str,
    print_header: Optional[str] = None,
    print_footer: Optional[str] = None,
) -> str:
    """Renderiza somente o lote/pedido que originou a impressão automática.

    O layout visual continua vindo do mesmo ``generate_receipt`` do Extrato
    Completo, mas o escopo é a instância criada naquele momento. Taxa de serviço
    é cálculo da conta inteira e, por isso, não é repetida em cada lote parcial.
    """
    snapshot = load_table_source_snapshot(
        db,
        restaurante_id,
        mesa_id,
        source_type=source_type,
        source_id=source_id,
    )
    preferences = get_print_preferences(db, restaurante_id)
    receipt = printer_service.generate_receipt(
        num_pedido=snapshot.numero_pedido,
        tipo=snapshot.tipo,
        mesa_id=snapshot.mesa_id,
        garcom_nome=snapshot.garcom_nome,
        comandas_details=snapshot.comandas_details,
        opened_at=snapshot.opened_at,
        print_header=print_header or preferences.restaurant_name,
        print_footer=(print_footer if print_footer is not None else preferences.print_footer),
        taxa_servico_ativa=False,
        taxa_servico_padrao=preferences.taxa_servico_padrao,
        apenas_valores=False,
        restaurant_name_position=preferences.restaurant_name_position,
    )
    return receipt.replace("TOTAL GERAL DA MESA:", "TOTAL DESTE PEDIDO:")


def _printing_allowed(db: Session, restaurante_id: int) -> bool:
    restaurante = db.query(Restaurante).filter(
        Restaurante.id == restaurante_id
    ).first()
    if restaurante is None:
        raise PrintingRequestError("Restaurante não encontrado", status_code=404)
    return subscription_has_printing(restaurante_id, restaurante.plano)


def enqueue_print_job(
    db: Session,
    *,
    restaurante_id: int,
    document_type: str,
    destination: str,
    source_type: str,
    source_id: str,
    payload_text: str,
    idempotency_key: str,
) -> Optional[PrintJob]:
    """Único construtor transacional de PrintJob usado pela arquitetura nova."""
    if not _printing_allowed(db, restaurante_id):
        return None

    existing = db.query(PrintJob).filter(
        PrintJob.restaurante_id == restaurante_id,
        PrintJob.idempotency_key == idempotency_key,
    ).first()
    if existing:
        return existing

    job = PrintJob(
        restaurante_id=restaurante_id,
        document_type=document_type,
        destination=destination,
        source_type=source_type,
        source_id=str(source_id),
        payload_text=payload_text.replace("\x00", "\\x00"),
        status="pending",
        idempotency_key=idempotency_key,
    )
    db.add(job)
    return job


def enqueue_table_receipt(
    db: Session,
    restaurante_id: int,
    mesa_id: int,
    *,
    apenas_valores: bool = False,
    source_type: str = "mesa",
    source_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    print_header: Optional[str] = None,
    print_footer: Optional[str] = None,
) -> Optional[PrintJob]:
    normalized_source = (source_type or "").strip().casefold()
    source_id_value = str(source_id or "").strip()
    is_partial_source = bool(source_id_value) and (
        normalized_source in {"lancamento", "pedido"}
        or (
            normalized_source == "reimpressao"
            and source_id_value.startswith(("l-", "c-"))
        )
    )

    if is_partial_source and not apenas_valores:
        receipt = render_table_source_receipt(
            db,
            restaurante_id,
            mesa_id,
            source_type=source_type,
            source_id=source_id_value,
            print_header=print_header,
            print_footer=print_footer,
        )
        document_type = "producao"
        destination = "COZINHA"
    else:
        receipt = render_table_receipt(
            db,
            restaurante_id,
            mesa_id,
            apenas_valores=apenas_valores,
            print_header=print_header,
            print_footer=print_footer,
        )
        document_type = "fechamento" if apenas_valores else "mesa"
        destination = "FECHAMENTO"

    if idempotency_key is None:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S%f")
        idempotency_key = (
            f"mesa:{'parcial' if is_partial_source else ('valores' if apenas_valores else 'completo')}:{mesa_id}:{stamp}"
        )

    return enqueue_print_job(
        db,
        restaurante_id=restaurante_id,
        document_type=document_type,
        destination=destination,
        source_type=source_type,
        source_id=source_id or str(mesa_id),
        payload_text=receipt,
        idempotency_key=idempotency_key,
    )


def _format_brl(value: object) -> str:
    try:
        amount = Decimal(str(value or 0))
    except Exception:
        amount = Decimal("0")
    rendered = f"{amount:,.2f}"
    rendered = rendered.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {rendered}"


def _line(left: str, right: str, width: int = 48) -> str:
    left_clean = str(left).strip()
    right_clean = str(right).strip()
    available = max(width - len(right_clean) - 1, 1)
    left_clean = left_clean[:available]
    return left_clean + (" " * max(width - len(left_clean) - len(right_clean), 1)) + right_clean


def render_cash_closing_receipt(
    *,
    restaurant_name: str,
    turno_id: int,
    operador_nome: str,
    fechado_em: datetime.datetime,
    esperado_dinheiro: object,
    esperado_cartao: object,
    esperado_pix: object,
    declarado_dinheiro: object,
    declarado_cartao: object,
    declarado_pix: object,
    observacao: Optional[str] = None,
    width: int = 48,
) -> str:
    """Comprovante térmico do fechamento do turno; não é o FECHAMENTO da mesa."""
    esperado_dinheiro_d = Decimal(str(esperado_dinheiro or 0))
    esperado_cartao_d = Decimal(str(esperado_cartao or 0))
    esperado_pix_d = Decimal(str(esperado_pix or 0))
    declarado_dinheiro_d = Decimal(str(declarado_dinheiro or 0))
    declarado_cartao_d = Decimal(str(declarado_cartao or 0))
    declarado_pix_d = Decimal(str(declarado_pix or 0))

    esperado_total = esperado_dinheiro_d + esperado_cartao_d + esperado_pix_d
    declarado_total = declarado_dinheiro_d + declarado_cartao_d + declarado_pix_d
    diff_dinheiro = declarado_dinheiro_d - esperado_dinheiro_d
    diff_cartao = declarado_cartao_d - esperado_cartao_d
    diff_pix = declarado_pix_d - esperado_pix_d
    diff_total = declarado_total - esperado_total

    if abs(diff_total) < Decimal("0.01"):
        resultado = "CAIXA EXATO"
    elif diff_total > 0:
        resultado = "SOBRA DE CAIXA"
    else:
        resultado = "FALTA DE CAIXA"

    local_closed = to_operational_local_time(fechado_em) or fechado_em
    lines = [
        "=" * width,
        restaurant_name.upper().center(width),
        "COMPROVANTE DE FECHAMENTO DE CAIXA".center(width),
        "=" * width,
        _line(f"TURNO: #{turno_id}", f"{local_closed.strftime('%d/%m/%Y %H:%M')}", width),
        f"OPERADOR: {operador_nome}",
        "-" * width,
        "VALORES ESPERADOS",
        _line("DINHEIRO", _format_brl(esperado_dinheiro_d), width),
        _line("CARTÕES", _format_brl(esperado_cartao_d), width),
        _line("PIX", _format_brl(esperado_pix_d), width),
        _line("TOTAL ESPERADO", _format_brl(esperado_total), width),
        "-" * width,
        "VALORES DECLARADOS",
        _line("DINHEIRO", _format_brl(declarado_dinheiro_d), width),
        _line("CARTÕES", _format_brl(declarado_cartao_d), width),
        _line("PIX", _format_brl(declarado_pix_d), width),
        _line("TOTAL DECLARADO", _format_brl(declarado_total), width),
        "-" * width,
        "DIFERENÇAS",
        _line("DINHEIRO", _format_brl(diff_dinheiro), width),
        _line("CARTÕES", _format_brl(diff_cartao), width),
        _line("PIX", _format_brl(diff_pix), width),
        _line("DIFERENÇA TOTAL", _format_brl(diff_total), width),
        "=" * width,
        resultado.center(width),
    ]
    if observacao:
        lines.extend(["-" * width, f"OBS: {observacao.strip()}"])
    lines.extend(
        [
            "-" * width,
            "CONFERIDO POR:",
            "",
            "_" * min(width, 32),
            "Assinatura do responsável",
            "=" * width,
            "Gerenciado por Kôma".center(width),
            "Documento não fiscal".center(width),
        ]
    )
    return "\n".join(lines)


def enqueue_cash_closing_receipt(
    db: Session,
    restaurante_id: int,
    turno_id: int,
) -> Optional[PrintJob]:
    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == restaurante_id,
        CaixaTurno.id == turno_id,
        CaixaTurno.status == "fechado",
    ).first()
    if not turno:
        raise PrintingRequestError(
            "Fechamento de caixa não encontrado ou turno ainda está aberto",
            status_code=404,
        )

    # Reutiliza a mesma regra financeira do resumo/fechamento do caixa em vez de
    # recalcular vendas com outra semântica.
    from ..routes.caixa import _totais_financeiros_turno

    totals = _totais_financeiros_turno(db, restaurante_id, turno)
    preferences = get_print_preferences(db, restaurante_id)
    operador = None
    if turno.fechado_por_id:
        operador = db.query(Usuario).filter(
            Usuario.restaurante_id == restaurante_id,
            Usuario.id == turno.fechado_por_id,
        ).first()

    payload = render_cash_closing_receipt(
        restaurant_name=preferences.restaurant_name,
        turno_id=turno.id,
        operador_nome=(operador.nome if operador else "Operador"),
        fechado_em=turno.fechado_em or datetime.datetime.now(datetime.timezone.utc),
        esperado_dinheiro=totals["saldo_esperado_dinheiro"],
        esperado_cartao=totals["total_cartao"],
        esperado_pix=totals["total_pix"],
        declarado_dinheiro=turno.declarado_dinheiro,
        declarado_cartao=turno.declarado_cartao,
        declarado_pix=turno.declarado_pix,
        observacao=turno.observacao,
    )
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S%f")
    return enqueue_print_job(
        db,
        restaurante_id=restaurante_id,
        document_type="fechamento_caixa",
        destination="FECHAMENTO",
        source_type="caixa_turno",
        source_id=str(turno.id),
        payload_text=payload,
        idempotency_key=f"fechamento_caixa:{turno.id}:{stamp}",
    )
