"""Serviços de Fichas Técnicas Universais, Custos Históricos, Compras, Lotes FEFO e Produção (B8 — Frentes 3, 4 e 5)."""

from __future__ import annotations

import datetime
from decimal import Decimal, ROUND_HALF_UP
import uuid
import xml.etree.ElementTree as ET

from sqlalchemy.orm import Session, joinedload

from ..b8_supply_models import (
    FichaTecnicaComponente,
    FornecedorInsumoDePara,
    ItemCustoSnapshot,
    LoteEstoque,
    OrdemProducao,
    OrdemProducaoConsumo,
    PedidoCompra,
    PedidoCompraItem,
    RegistroBuffetLote,
    SubReceita,
    SubReceitaIngrediente,
)
from ..models import (
    Distribuidor,
    EntradaEstoque,
    Insumo,
    ItemEntradaEstoque,
    ItemNotaEntrada,
    MovimentacaoEstoque,
    NotaEntrada,
    ProdutoInsumo,
)
from .b8_finance import create_conta_pagar, ensure_default_finance_setup
from .financeiro import money

LOSS_REASONS = frozenset({
    "vencimento",
    "deterioracao",
    "quebra",
    "erro_producao",
    "descarte",
    "sobra_buffet",
    "divergencia_inventario",
})


def _qty4(value: Decimal | float | int | None) -> Decimal:
    if value is None:
        return Decimal("0.0000")
    return Decimal(str(value)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _cost4(value: Decimal | float | int | None) -> Decimal:
    if value is None:
        return Decimal("0.0000")
    return Decimal(str(value)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Lotes & FEFO
# ---------------------------------------------------------------------------

def registrar_entrada_lote(
    db: Session,
    *,
    restaurante_id: int,
    insumo: Insumo,
    quantidade: float,
    custo_unitario: Decimal | float,
    origem_tipo: str,
    origem_id: str | None = None,
    codigo_lote: str | None = None,
    data_validade: datetime.date | None = None,
    motivo: str = "Entrada de estoque",
    usuario_id: str | None = None,
) -> LoteEstoque:
    """Registra lote, atualiza saldo do insumo, custo médio ponderado e movimentação."""
    qtd = float(quantidade)
    if qtd <= 0:
        raise ValueError("Quantidade de entrada deve ser maior que zero.")
    custo = _cost4(custo_unitario)
    if custo < Decimal("0.0000"):
        raise ValueError("Custo unitário não pode ser negativo.")

    saldo_ant = float(insumo.estoque_atual or 0.0)
    custo_ant = _cost4(insumo.preco_medio_custo or 0.0)
    novo_saldo = saldo_ant + qtd

    if novo_saldo > 0 and custo > Decimal("0.0000"):
        base_ant = max(0.0, saldo_ant)
        novo_custo_medio = (
            (Decimal(str(base_ant)) * custo_ant + Decimal(str(qtd)) * custo)
            / Decimal(str(base_ant + qtd))
        ).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        insumo.preco_medio_custo = float(novo_custo_medio)

    insumo.estoque_atual = novo_saldo

    lote = LoteEstoque(
        restaurante_id=restaurante_id,
        insumo_id=insumo.id,
        codigo_lote=(codigo_lote or f"L-{datetime.date.today().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}").strip(),
        data_validade=data_validade,
        quantidade_inicial=qtd,
        saldo_atual=qtd,
        custo_unitario=float(custo),
        origem_tipo=origem_tipo,
        origem_id=origem_id,
        ativo=True,
    )
    db.add(lote)
    db.add(
        MovimentacaoEstoque(
            restaurante_id=restaurante_id,
            insumo_id=insumo.id,
            tipo="entrada",
            quantidade=qtd,
            saldo_anterior=saldo_ant,
            saldo_posterior=novo_saldo,
            custo_unitario=float(custo),
            motivo=motivo,
            observacao=f"Lote {lote.codigo_lote}" + (f" (val. {data_validade.isoformat()})" if data_validade else ""),
            origem=origem_tipo,
            referencia_id=origem_id or lote.id,
            usuario_id=usuario_id,
        )
    )
    db.flush()
    return lote


def consumir_lotes_fefo(
    db: Session,
    *,
    restaurante_id: int,
    insumo: Insumo,
    quantidade: float,
) -> list[tuple[str | None, float, Decimal]]:
    """Consome lotes ativos por FEFO (validade mais próxima primeiro).

    Retorna lista de ``(lote_id, qtd_consumida, custo_unitario)``.
    Se não houver lotes suficientes, consome o residual do custo médio do insumo sem bloquear operação.
    """
    restante = float(quantidade)
    if restante <= 0:
        return []

    lotes = (
        db.query(LoteEstoque)
        .filter(
            LoteEstoque.restaurante_id == restaurante_id,
            LoteEstoque.insumo_id == insumo.id,
            LoteEstoque.ativo.is_(True),
            LoteEstoque.saldo_atual > 0,
        )
        .order_by(LoteEstoque.data_validade.asc().nullslast(), LoteEstoque.created_at.asc())
        .all()
    )

    consumos: list[tuple[str | None, float, Decimal]] = []
    for lote in lotes:
        if restante <= 1e-9:
            break
        disponivel = float(lote.saldo_atual or 0.0)
        usar = min(disponivel, restante)
        lote.saldo_atual = max(0.0, disponivel - usar)
        if lote.saldo_atual <= 1e-9:
            lote.saldo_atual = 0.0
            lote.ativo = False
        custo_lote = _cost4(lote.custo_unitario or insumo.preco_medio_custo or 0.0)
        consumos.append((lote.id, usar, custo_lote))
        restante -= usar

    if restante > 1e-9:
        consumos.append((None, restante, _cost4(insumo.preco_medio_custo or 0.0)))

    return consumos


# ---------------------------------------------------------------------------
# Sub-receitas e Fichas Técnicas Universais (Frente 3 & 5)
# ---------------------------------------------------------------------------

def _detect_sub_receita_cycle(
    db: Session,
    *,
    restaurante_id: int,
    root_id: str,
    child_ids: list[str],
) -> None:
    visited: set[str] = {root_id}
    stack = list(child_ids)
    while stack:
        current = stack.pop()
        if current in visited:
            raise ValueError("Dependência circular detectada entre sub-receitas.")
        visited.add(current)
        children = (
            db.query(SubReceitaIngrediente.sub_receita_filha_id)
            .filter(
                SubReceitaIngrediente.restaurante_id == restaurante_id,
                SubReceitaIngrediente.sub_receita_id == current,
                SubReceitaIngrediente.sub_receita_filha_id.isnot(None),
            )
            .all()
        )
        for (cid,) in children:
            if cid:
                stack.append(str(cid))


def create_or_update_sub_receita(
    db: Session,
    *,
    restaurante_id: int,
    nome: str,
    unidade_rendimento: str,
    rendimento_esperado: Decimal | float,
    ingredientes: list[dict],
    insumo_saida_id: str | None = None,
    modo_preparo: str = "",
    sub_receita_id: str | None = None,
) -> SubReceita:
    rend = _qty4(rendimento_esperado)
    if rend <= Decimal("0.0000"):
        raise ValueError("Rendimento esperado deve ser maior que zero.")
    if not ingredientes:
        raise ValueError("Sub-receita deve possuir pelo menos um ingrediente.")

    if sub_receita_id:
        sub = (
            db.query(SubReceita)
            .filter(SubReceita.restaurante_id == restaurante_id, SubReceita.id == sub_receita_id)
            .first()
        )
        if sub is None:
            raise ValueError("Sub-receita não encontrada.")
        sub.nome = nome.strip()
        sub.unidade_rendimento = unidade_rendimento.strip() or "kg"
        sub.rendimento_esperado = float(rend)
        sub.insumo_saida_id = insumo_saida_id
        sub.modo_preparo = modo_preparo.strip()
        db.query(SubReceitaIngrediente).filter(
            SubReceitaIngrediente.restaurante_id == restaurante_id,
            SubReceitaIngrediente.sub_receita_id == sub.id,
        ).delete()
    else:
        sub = SubReceita(
            restaurante_id=restaurante_id,
            nome=nome.strip(),
            unidade_rendimento=unidade_rendimento.strip() or "kg",
            rendimento_esperado=float(rend),
            insumo_saida_id=insumo_saida_id,
            modo_preparo=modo_preparo.strip(),
        )
        db.add(sub)
        db.flush()

    child_sub_ids = [str(i["sub_receita_filha_id"]) for i in ingredientes if i.get("sub_receita_filha_id")]
    if child_sub_ids:
        _detect_sub_receita_cycle(db, restaurante_id=restaurante_id, root_id=sub.id, child_ids=child_sub_ids)

    for item in ingredientes:
        qtd = _qty4(item.get("quantidade"))
        if qtd <= Decimal("0.0000"):
            raise ValueError("Quantidade do ingrediente deve ser maior que zero.")
        db.add(
            SubReceitaIngrediente(
                restaurante_id=restaurante_id,
                sub_receita_id=sub.id,
                insumo_id=item.get("insumo_id"),
                sub_receita_filha_id=item.get("sub_receita_filha_id"),
                quantidade=float(qtd),
                unidade_medida=str(item.get("unidade_medida") or "g"),
                perda_tecnica_pct=float(money(item.get("perda_tecnica_pct") or 0.0)),
            )
        )
    db.flush()
    return sub


def calcular_custo_sub_receita(
    db: Session,
    *,
    restaurante_id: int,
    sub_receita_id: str,
    _visited: set[str] | None = None,
) -> tuple[Decimal | None, bool, str | None]:
    """Calcula custo unitário teórico de uma sub-receita (nunca trata custo desconhecido como zero)."""
    visited = set(_visited or set())
    if sub_receita_id in visited:
        return None, False, "Ciclo detectado em sub-receita"
    visited.add(sub_receita_id)

    sub = (
        db.query(SubReceita)
        .options(joinedload(SubReceita.ingredientes).joinedload(SubReceitaIngrediente.insumo))
        .filter(SubReceita.restaurante_id == restaurante_id, SubReceita.id == sub_receita_id)
        .first()
    )
    if sub is None:
        return None, False, "Sub-receita não encontrada"

    # Se a sub-receita tem um insumo de saída com custo médio já apurado por ordem de produção, usa-o.
    if sub.insumo_saida_id and sub.insumo_saida is not None:
        custo_insumo = _cost4(sub.insumo_saida.preco_medio_custo or 0)
        if custo_insumo > Decimal("0.0000"):
            return custo_insumo, True, None

    if not sub.ingredientes:
        return None, False, "Sub-receita sem ingredientes"

    custo_lote = Decimal("0.0000")
    for ing in sub.ingredientes:
        qtd = _qty4(ing.quantidade)
        if ing.insumo_id:
            if ing.insumo is None or _cost4(ing.insumo.preco_medio_custo or 0) <= Decimal("0.0000"):
                return None, False, f"Insumo '{ing.insumo.nome if ing.insumo else ing.insumo_id}' sem custo médio"
            custo_lote += qtd * _cost4(ing.insumo.preco_medio_custo)
        elif ing.sub_receita_filha_id:
            c_sub, ok, reason = calcular_custo_sub_receita(
                db, restaurante_id=restaurante_id, sub_receita_id=ing.sub_receita_filha_id, _visited=visited
            )
            if not ok or c_sub is None:
                return None, False, reason
            custo_lote += qtd * c_sub

    rend = _qty4(sub.rendimento_esperado)
    if rend <= Decimal("0.0000"):
        return None, False, "Rendimento esperado inválido"
    custo_unit = (custo_lote / rend).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    return custo_unit, True, None


def upsert_ficha_tecnica_universal(
    db: Session,
    *,
    restaurante_id: int,
    entidade_tipo: str,
    entidade_id: str,
    componentes: list[dict],
) -> list[FichaTecnicaComponente]:
    if entidade_tipo not in {"produto", "opcao_modificador"}:
        raise ValueError("Tipo de entidade inválido para ficha técnica.")

    db.query(FichaTecnicaComponente).filter(
        FichaTecnicaComponente.restaurante_id == restaurante_id,
        FichaTecnicaComponente.entidade_tipo == entidade_tipo,
        FichaTecnicaComponente.entidade_id == entidade_id,
    ).delete()

    created: list[FichaTecnicaComponente] = []
    if entidade_tipo == "produto":
        db.query(ProdutoInsumo).filter(
            ProdutoInsumo.restaurante_id == restaurante_id,
            ProdutoInsumo.produto_id == entidade_id,
        ).delete()

    for comp in componentes:
        qtd = _qty4(comp.get("quantidade"))
        if qtd <= Decimal("0.0000"):
            raise ValueError("Quantidade do componente deve ser maior que zero.")
        insumo_id = comp.get("insumo_id")
        sub_id = comp.get("sub_receita_id")
        if bool(insumo_id) == bool(sub_id):
            raise ValueError("Informe exatamente um insumo_id ou um sub_receita_id por componente.")
        row = FichaTecnicaComponente(
            restaurante_id=restaurante_id,
            entidade_tipo=entidade_tipo,
            entidade_id=entidade_id,
            insumo_id=insumo_id,
            sub_receita_id=sub_id,
            quantidade=float(qtd),
            unidade_medida=str(comp.get("unidade_medida") or "un"),
            papel=str(comp.get("papel") or "ingrediente"),
        )
        db.add(row)
        created.append(row)

        if entidade_tipo == "produto" and insumo_id:
            db.add(
                ProdutoInsumo(
                    restaurante_id=restaurante_id,
                    produto_id=entidade_id,
                    insumo_id=insumo_id,
                    quantidade=float(qtd),
                )
            )
    db.flush()
    return created


# ---------------------------------------------------------------------------
# Produção Gastronômica & Rendimento (Frente 5)
# ---------------------------------------------------------------------------

def executar_ordem_producao(
    db: Session,
    *,
    restaurante_id: int,
    sub_receita_id: str,
    quantidade_planejada: Decimal | float,
    quantidade_produzida: Decimal | float,
    peso_inicial: Decimal | float | None = None,
    perda_producao: Decimal | float = 0.0,
    codigo_lote: str | None = None,
    data_validade: datetime.date | None = None,
    observacao: str = "",
    usuario_id: str | None = None,
) -> OrdemProducao:
    """Executa uma ordem de produção: consome insumos via FEFO e gera lote produzido sem duplicar CMV."""
    qtd_plan = _qty4(quantidade_planejada)
    qtd_prod = _qty4(quantidade_produzida)
    perda = _qty4(perda_producao)
    if qtd_plan <= Decimal("0.0000") or qtd_prod <= Decimal("0.0000"):
        raise ValueError("Quantidades planejada e produzida devem ser maiores que zero.")

    sub = (
        db.query(SubReceita)
        .options(joinedload(SubReceita.ingredientes).joinedload(SubReceitaIngrediente.insumo))
        .filter(SubReceita.restaurante_id == restaurante_id, SubReceita.id == sub_receita_id)
        .first()
    )
    if sub is None:
        raise ValueError("Sub-receita não encontrada.")

    # Garante insumo de destino para controlar saldo e entrada em estoque da preparação produzida.
    insumo_destino = sub.insumo_saida
    if insumo_destino is None:
        insumo_destino = Insumo(
            id=f"ins-prep-{uuid.uuid4().hex[:8]}",
            restaurante_id=restaurante_id,
            nome=f"{sub.nome} (Preparação)",
            estoque_atual=0.0,
            estoque_minimo=0.0,
            estoque_maximo=100.0,
            unidade_medida=sub.unidade_rendimento,
            preco_medio_custo=0.0,
        )
        db.add(insumo_destino)
        db.flush()
        sub.insumo_saida_id = insumo_destino.id

    fator_escala = qtd_plan / _qty4(sub.rendimento_esperado)
    ordem = OrdemProducao(
        restaurante_id=restaurante_id,
        sub_receita_id=sub.id,
        insumo_destino_id=insumo_destino.id,
        quantidade_planejada=float(qtd_plan),
        quantidade_produzida=float(qtd_prod),
        peso_inicial=float(_qty4(peso_inicial)) if peso_inicial is not None else None,
        perda_producao=float(perda),
        rendimento_pct=float(((qtd_prod / qtd_plan) * Decimal("100")).quantize(Decimal("0.01"))),
        status="concluida",
        observacao=observacao.strip(),
        usuario_id=usuario_id,
        concluida_em=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(ordem)
    db.flush()

    custo_total_insumos = Decimal("0.00")
    for ing in sub.ingredientes:
        target_insumo = ing.insumo
        if target_insumo is None and ing.sub_receita_filha_id:
            filha = (
                db.query(SubReceita)
                .options(joinedload(SubReceita.insumo_saida))
                .filter(SubReceita.restaurante_id == restaurante_id, SubReceita.id == ing.sub_receita_filha_id)
                .first()
            )
            target_insumo = filha.insumo_saida if filha else None
        if target_insumo is None:
            continue

        qtd_consumo = float((_qty4(ing.quantidade) * fator_escala).quantize(Decimal("0.0001")))
        lotes_usados = consumir_lotes_fefo(
            db, restaurante_id=restaurante_id, insumo=target_insumo, quantidade=qtd_consumo
        )
        saldo_ant = float(target_insumo.estoque_atual or 0.0)
        target_insumo.estoque_atual = saldo_ant - qtd_consumo

        for lote_id, qtd_lote, custo_lote in lotes_usados:
            custo_linha = money(Decimal(str(qtd_lote)) * custo_lote)
            custo_total_insumos += custo_linha
            db.add(
                OrdemProducaoConsumo(
                    restaurante_id=restaurante_id,
                    ordem_id=ordem.id,
                    insumo_id=target_insumo.id,
                    lote_id=lote_id,
                    quantidade_consumida=qtd_lote,
                    custo_unitario=float(custo_lote),
                    custo_total=float(custo_linha),
                )
            )
        db.add(
            MovimentacaoEstoque(
                restaurante_id=restaurante_id,
                insumo_id=target_insumo.id,
                tipo="saida",
                quantidade=qtd_consumo,
                saldo_anterior=saldo_ant,
                saldo_posterior=target_insumo.estoque_atual,
                custo_unitario=float(_cost4(target_insumo.preco_medio_custo or 0)),
                motivo=f"Produção: {sub.nome}",
                observacao=f"Ordem {ordem.id} (transformação, não é CMV)",
                origem="producao_consumo",
                referencia_id=ordem.id,
                usuario_id=usuario_id,
            )
        )

    custo_total_insumos = money(custo_total_insumos)
    custo_unit_produzido = (custo_total_insumos / qtd_prod).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    ordem.custo_total_insumos = float(custo_total_insumos)
    ordem.custo_unitario_produzido = float(custo_unit_produzido)

    lote_dest = registrar_entrada_lote(
        db,
        restaurante_id=restaurante_id,
        insumo=insumo_destino,
        quantidade=float(qtd_prod),
        custo_unitario=custo_unit_produzido,
        origem_tipo="producao",
        origem_id=ordem.id,
        codigo_lote=codigo_lote,
        data_validade=data_validade,
        motivo=f"Entrada produção: {sub.nome}",
        usuario_id=usuario_id,
    )
    ordem.lote_destino_id = lote_dest.id
    db.flush()
    return ordem


def registrar_buffet_lote(
    db: Session,
    *,
    restaurante_id: int,
    data_operacional: datetime.date,
    nome_preparacao: str,
    unidade_medida: str = "kg",
    quantidade_produzida: Decimal | float = 0.0,
    quantidade_reposicao: Decimal | float = 0.0,
    sobra: Decimal | float = 0.0,
    descarte: Decimal | float = 0.0,
    custo_lote: Decimal | float | None = None,
    sub_receita_id: str | None = None,
    ordem_producao_id: str | None = None,
    observacao: str = "",
    usuario_id: str | None = None,
) -> RegistroBuffetLote:
    prod = _qty4(quantidade_produzida)
    rep = _qty4(quantidade_reposicao)
    sob = _qty4(sobra)
    desc = _qty4(descarte)
    if prod < 0 or rep < 0 or sob < 0 or desc < 0:
        raise ValueError("Quantidades de buffet não podem ser negativas.")

    resolved_custo = money(custo_lote) if custo_lote is not None else None
    if resolved_custo is None and ordem_producao_id:
        op = (
            db.query(OrdemProducao)
            .filter(OrdemProducao.restaurante_id == restaurante_id, OrdemProducao.id == ordem_producao_id)
            .first()
        )
        if op is not None and op.custo_total_insumos:
            resolved_custo = money(op.custo_total_insumos)

    total_ofertado = prod + rep
    custo_unit = (
        (resolved_custo / total_ofertado).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        if resolved_custo is not None and total_ofertado > Decimal("0.0000")
        else None
    )

    reg = RegistroBuffetLote(
        restaurante_id=restaurante_id,
        data_operacional=data_operacional,
        nome_preparacao=nome_preparacao.strip(),
        sub_receita_id=sub_receita_id,
        ordem_producao_id=ordem_producao_id,
        unidade_medida=unidade_medida.strip() or "kg",
        quantidade_produzida=float(prod),
        quantidade_reposicao=float(rep),
        sobra=float(sob),
        descarte=float(desc),
        custo_lote=float(resolved_custo) if resolved_custo is not None else None,
        custo_por_unidade=float(custo_unit) if custo_unit is not None else None,
        observacao=observacao.strip(),
        usuario_id=usuario_id,
    )
    db.add(reg)
    db.flush()
    return reg


# ---------------------------------------------------------------------------
# Compras, Recebimento Parcial/Total e De-Para XML NF-e (Frente 4)
# ---------------------------------------------------------------------------

def criar_pedido_compra(
    db: Session,
    *,
    restaurante_id: int,
    distribuidor_id: str,
    data_emissao: datetime.date,
    itens: list[dict],
    data_entrega_prevista: datetime.date | None = None,
    numero_pedido: str | None = None,
    observacao: str = "",
    usuario_id: str | None = None,
) -> PedidoCompra:
    dist = (
        db.query(Distribuidor)
        .filter(Distribuidor.restaurante_id == restaurante_id, Distribuidor.id == distribuidor_id)
        .first()
    )
    if dist is None:
        raise ValueError("Fornecedor não encontrado.")
    if not itens:
        raise ValueError("Pedido de compra precisa de ao menos um item.")

    pc = PedidoCompra(
        restaurante_id=restaurante_id,
        distribuidor_id=distribuidor_id,
        numero_pedido=(numero_pedido or f"PC-{uuid.uuid4().hex[:6].upper()}").strip(),
        data_emissao=data_emissao,
        data_entrega_prevista=data_entrega_prevista,
        status="enviado",
        observacao=observacao.strip(),
        usuario_id=usuario_id,
    )
    db.add(pc)
    db.flush()

    total = Decimal("0.00")
    for item in itens:
        qtd = _qty4(item["quantidade_pedida"])
        preco = _cost4(item.get("preco_unitario_previsto") or 0)
        fator = _qty4(item.get("fator_conversao") or 1)
        if qtd <= Decimal("0.0000") or fator <= Decimal("0.0000"):
            raise ValueError("Quantidade e fator de conversão devem ser positivos.")
        db.add(
            PedidoCompraItem(
                restaurante_id=restaurante_id,
                pedido_compra_id=pc.id,
                insumo_id=item["insumo_id"],
                quantidade_pedida=float(qtd),
                fator_conversao=float(fator),
                preco_unitario_previsto=float(preco),
            )
        )
        total += money(qtd * preco)
    pc.valor_total_previsto = float(money(total))
    db.flush()
    return pc


def receber_pedido_compra(
    db: Session,
    *,
    restaurante_id: int,
    pedido_compra_id: str,
    recebimentos: list[dict],
    numero_documento: str | None = None,
    gerar_conta_pagar: bool = False,
    data_vencimento_financeiro: datetime.date | None = None,
    usuario_id: str | None = None,
) -> dict:
    pc = (
        db.query(PedidoCompra)
        .options(joinedload(PedidoCompra.itens).joinedload(PedidoCompraItem.insumo), joinedload(PedidoCompra.distribuidor))
        .filter(PedidoCompra.restaurante_id == restaurante_id, PedidoCompra.id == pedido_compra_id)
        .with_for_update()
        .first()
    )
    if pc is None:
        raise ValueError("Pedido de compra não encontrado.")
    if pc.status in {"cancelado", "recebido"}:
        raise ValueError(f"Pedido de compra já está '{pc.status}'.")

    item_by_id = {it.id: it for it in pc.itens}
    hoje = datetime.date.today()
    entrada = EntradaEstoque(
        restaurante_id=restaurante_id,
        distribuidor_id=pc.distribuidor_id,
        numero_documento=(numero_documento or pc.numero_pedido),
        data_emissao=hoje.isoformat(),
        observacao=f"Recebimento Pedido {pc.numero_pedido}",
        tipo_entrada="COMPRA",
        usuario_id=usuario_id,
    )
    db.add(entrada)
    db.flush()

    valor_recebido_total = Decimal("0.00")
    divergencias = []
    for rec in recebimentos:
        pc_item = item_by_id.get(int(rec["item_id"]))
        if pc_item is None:
            raise ValueError(f"Item de compra {rec['item_id']} não pertence ao pedido.")
        qtd_rec = _qty4(rec["quantidade_recebida"])
        if qtd_rec <= Decimal("0.0000"):
            continue
        saldo_pendente = _qty4(pc_item.quantidade_pedida) - _qty4(pc_item.quantidade_recebida)
        if qtd_rec > saldo_pendente + Decimal("0.0001"):
            raise ValueError("Quantidade recebida excede o saldo pendente do pedido.")

        custo_rec = _cost4(rec.get("preco_unitario_recebido") or pc_item.preco_unitario_previsto)
        if abs(custo_rec - _cost4(pc_item.preco_unitario_previsto)) > Decimal("0.01"):
            divergencias.append({
                "insumo_id": pc_item.insumo_id,
                "previsto": float(_cost4(pc_item.preco_unitario_previsto)),
                "recebido": float(custo_rec),
            })

        pc_item.quantidade_recebida = float(_qty4(pc_item.quantidade_recebida) + qtd_rec)
        pc_item.preco_unitario_recebido = float(custo_rec)

        qtd_estoque = float((qtd_rec * _qty4(pc_item.fator_conversao)).quantize(Decimal("0.0001")))
        custo_estoque = (custo_rec / _qty4(pc_item.fator_conversao)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        sub = money(qtd_rec * custo_rec)
        valor_recebido_total += sub

        db.add(
            ItemEntradaEstoque(
                restaurante_id=restaurante_id,
                entrada_id=entrada.id,
                insumo_id=pc_item.insumo_id,
                quantidade=qtd_estoque,
                unidade_medida=pc_item.insumo.unidade_medida if pc_item.insumo else "un",
                custo_unitario=float(custo_estoque),
                subtotal=float(sub),
            )
        )
        if pc_item.insumo is not None:
            validade = datetime.date.fromisoformat(rec["data_validade"]) if rec.get("data_validade") else None
            registrar_entrada_lote(
                db,
                restaurante_id=restaurante_id,
                insumo=pc_item.insumo,
                quantidade=qtd_estoque,
                custo_unitario=custo_estoque,
                origem_tipo="compra",
                origem_id=pc.id,
                codigo_lote=rec.get("codigo_lote"),
                data_validade=validade,
                motivo=f"Compra {pc.numero_pedido}",
                usuario_id=usuario_id,
            )

    entrada.valor_total = float(money(valor_recebido_total))
    all_received = all(_qty4(it.quantidade_recebida) >= _qty4(it.quantidade_pedida) for it in pc.itens)
    pc.status = "recebido" if all_received else "recebido_parcial"

    conta_pagar_id = pc.conta_pagar_id
    if gerar_conta_pagar and valor_recebido_total > Decimal("0.00") and conta_pagar_id is None:
        cats, _ = ensure_default_finance_setup(db, restaurante_id)
        cat_forn = next((c for c in cats if c.codigo == "fornecedores"), cats[0])
        cp = create_conta_pagar(
            db,
            restaurante_id=restaurante_id,
            categoria_id=cat_forn.id,
            distribuidor_id=pc.distribuidor_id,
            favorecido_nome=pc.distribuidor.nome_fantasia if pc.distribuidor else "Fornecedor",
            descricao=f"Compra {pc.numero_pedido}",
            valor_original=valor_recebido_total,
            data_emissao=hoje,
            data_competencia=hoje,
            primeiro_vencimento=data_vencimento_financeiro or (hoje + datetime.timedelta(days=30)),
            origem_tipo="compra",
            origem_id=pc.id,
            criado_por_id=usuario_id,
        )
        pc.conta_pagar_id = cp.id
        conta_pagar_id = cp.id

    db.flush()
    return {
        "pedido_compra_id": pc.id,
        "status": pc.status,
        "entrada_id": entrada.id,
        "valor_recebido": float(money(valor_recebido_total)),
        "divergencias_preco": divergencias,
        "conta_pagar_id": conta_pagar_id,
    }


def preview_xml_nfe(db: Session, *, restaurante_id: int, xml_content: bytes) -> dict:
    """Analisa XML NF-e, detecta duplicidade e aplica de-para cadastrado sem criar insumos cegamente."""
    root = ET.fromstring(xml_content)
    ns = {"nfe": "http://www.portalfiscal.inf.br/nfe"}

    def _find_text(node, path: str, default: str = "") -> str:
        el = node.find(path, ns)
        if el is None:
            plain = "/".join(p.split(":")[-1] for p in path.split("/"))
            el = node.find(plain)
        return (el.text or "").strip() if el is not None and el.text else default

    inf_nfe = root.find(".//nfe:infNFe", ns)
    if inf_nfe is None:
        inf_nfe = root.find(".//infNFe")
    if inf_nfe is None:
        raise ValueError("Estrutura infNFe não encontrada no XML.")

    chave = (inf_nfe.attrib.get("Id") or "").replace("NFe", "").strip()
    duplicada = False
    if chave:
        duplicada = (
            db.query(NotaEntrada.id)
            .filter(NotaEntrada.restaurante_id == restaurante_id, NotaEntrada.chave_acesso == chave)
            .first()
            is not None
        )

    numero_nota = _find_text(inf_nfe, "nfe:ide/nfe:nNF", "S/N")
    data_emissao = _find_text(inf_nfe, "nfe:ide/nfe:dhEmi") or _find_text(inf_nfe, "nfe:ide/nfe:dEmi")
    cnpj_forn = _find_text(inf_nfe, "nfe:emit/nfe:CNPJ")
    nome_forn = _find_text(inf_nfe, "nfe:emit/nfe:xNome", "Fornecedor XML")

    depara_rows = (
        db.query(FornecedorInsumoDePara)
        .options(joinedload(FornecedorInsumoDePara.insumo))
        .filter(
            FornecedorInsumoDePara.restaurante_id == restaurante_id,
            FornecedorInsumoDePara.cnpj_fornecedor == cnpj_forn,
        )
        .all()
    )
    depara_map = {row.codigo_fornecedor: row for row in depara_rows}

    dets = inf_nfe.findall("nfe:det", ns) or inf_nfe.findall("det")
    itens_out = []
    valor_total = Decimal("0.00")
    for det in dets:
        prod = det.find("nfe:prod", ns) if det.find("nfe:prod", ns) is not None else det.find("prod")
        if prod is None:
            continue
        cod = _find_text(prod, "nfe:cProd")
        xprod = _find_text(prod, "nfe:xProd", "Item XML")
        ucom = _find_text(prod, "nfe:uCom", "un")
        qcom = float(_find_text(prod, "nfe:qCom", "0") or 0)
        vuncom = _cost4(_find_text(prod, "nfe:vUnCom", "0") or 0)
        vprod = money(Decimal(str(qcom)) * vuncom)
        valor_total += vprod
        mapping = depara_map.get(cod)
        itens_out.append({
            "codigo_fornecedor": cod,
            "descricao_fornecedor": xprod,
            "unidade_compra": ucom,
            "quantidade_compra": qcom,
            "valor_unitario_compra": float(vuncom),
            "subtotal": float(vprod),
            "mapeado": mapping is not None,
            "insumo_id": mapping.insumo_id if mapping else None,
            "insumo_nome": mapping.insumo.nome if (mapping and mapping.insumo) else None,
            "fator_conversao": float(mapping.fator_conversao) if mapping else 1.0,
            "quantidade_estoque_prevista": round(qcom * (float(mapping.fator_conversao) if mapping else 1.0), 4),
        })

    return {
        "chave_acesso": chave,
        "duplicada": duplicada,
        "numero_nota": numero_nota,
        "data_emissao": data_emissao[:10] if data_emissao else None,
        "fornecedor": {"cnpj": cnpj_forn, "nome": nome_forn},
        "valor_total": float(money(valor_total)),
        "itens": itens_out,
    }


def confirmar_importacao_xml_revisada(
    db: Session,
    *,
    restaurante_id: int,
    chave_acesso: str,
    numero_nota: str,
    fornecedor_nome: str,
    fornecedor_cnpj: str,
    data_emissao: str | None,
    itens: list[dict],
    gerar_conta_pagar: bool = False,
    data_vencimento_financeiro: datetime.date | None = None,
    usuario_id: str | None = None,
) -> dict:
    """Confirma entrada de NF-e após conferência/de-para pelo operador, bloqueando duplicidade."""
    clean_chave = (chave_acesso or "").strip()
    if clean_chave:
        existing_nota = (
            db.query(NotaEntrada)
            .filter(NotaEntrada.restaurante_id == restaurante_id, NotaEntrada.chave_acesso == clean_chave)
            .first()
        )
        if existing_nota is not None:
            raise ValueError(f"NF-e com chave {clean_chave} já foi importada anteriormente.")

    dist = None
    if fornecedor_cnpj:
        dist = (
            db.query(Distribuidor)
            .filter(Distribuidor.restaurante_id == restaurante_id, Distribuidor.cnpj == fornecedor_cnpj)
            .first()
        )
    if dist is None:
        dist = Distribuidor(
            id=f"dist-{uuid.uuid4().hex[:8]}",
            restaurante_id=restaurante_id,
            nome_fantasia=fornecedor_nome[:120] or "Fornecedor XML",
            razao_social=fornecedor_nome[:180] or None,
            cnpj=fornecedor_cnpj or None,
        )
        db.add(dist)
        db.flush()

    nota = NotaEntrada(
        id=f"nf-{uuid.uuid4().hex[:10]}",
        restaurante_id=restaurante_id,
        chave_acesso=clean_chave or None,
        numero_nota=numero_nota or "S/N",
        data_emissao=data_emissao,
        distribuidor_id=dist.id,
        valor_total=0.0,
    )
    db.add(nota)
    entrada = EntradaEstoque(
        restaurante_id=restaurante_id,
        distribuidor_id=dist.id,
        numero_documento=numero_nota,
        data_emissao=data_emissao,
        observacao=f"Importação XML revisada NF {numero_nota}",
        tipo_entrada="XML",
        usuario_id=usuario_id,
    )
    db.add(entrada)
    db.flush()

    valor_total = Decimal("0.00")
    for item in itens:
        insumo_id = item.get("insumo_id")
        if not insumo_id:
            raise ValueError(f"Item '{item.get('descricao_fornecedor')}' sem insumo vinculado.")
        insumo = (
            db.query(Insumo)
            .filter(Insumo.restaurante_id == restaurante_id, Insumo.id == insumo_id)
            .first()
        )
        if insumo is None:
            raise ValueError(f"Insumo '{insumo_id}' não encontrado.")

        qtd_compra = _qty4(item["quantidade_compra"])
        fator = _qty4(item.get("fator_conversao") or 1)
        custo_compra = _cost4(item["valor_unitario_compra"])
        if qtd_compra <= 0 or fator <= 0:
            raise ValueError("Quantidade e fator de conversão devem ser positivos.")

        # Salva de-para para próximas notas do mesmo fornecedor
        cod_forn = str(item.get("codigo_fornecedor") or "").strip()
        if cod_forn:
            existing_dp = (
                db.query(FornecedorInsumoDePara)
                .filter(
                    FornecedorInsumoDePara.restaurante_id == restaurante_id,
                    FornecedorInsumoDePara.cnpj_fornecedor == fornecedor_cnpj,
                    FornecedorInsumoDePara.codigo_fornecedor == cod_forn,
                )
                .first()
            )
            if existing_dp is None:
                db.add(
                    FornecedorInsumoDePara(
                        restaurante_id=restaurante_id,
                        distribuidor_id=dist.id,
                        cnpj_fornecedor=fornecedor_cnpj,
                        codigo_fornecedor=cod_forn,
                        descricao_fornecedor=str(item.get("descricao_fornecedor") or "")[:240],
                        insumo_id=insumo.id,
                        unidade_compra=str(item.get("unidade_compra") or "un")[:16],
                        fator_conversao=float(fator),
                    )
                )
            else:
                existing_dp.insumo_id = insumo.id
                existing_dp.fator_conversao = float(fator)

        qtd_estoque = float((qtd_compra * fator).quantize(Decimal("0.0001")))
        custo_estoque = (custo_compra / fator).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        sub = money(qtd_compra * custo_compra)
        valor_total += sub

        db.add(
            ItemNotaEntrada(
                restaurante_id=restaurante_id,
                nota_id=nota.id,
                insumo_id=insumo.id,
                quantidade=qtd_estoque,
                preco_unitario=float(custo_estoque),
            )
        )
        db.add(
            ItemEntradaEstoque(
                restaurante_id=restaurante_id,
                entrada_id=entrada.id,
                insumo_id=insumo.id,
                quantidade=qtd_estoque,
                unidade_medida=insumo.unidade_medida,
                custo_unitario=float(custo_estoque),
                subtotal=float(sub),
            )
        )
        validade = datetime.date.fromisoformat(item["data_validade"]) if item.get("data_validade") else None
        registrar_entrada_lote(
            db,
            restaurante_id=restaurante_id,
            insumo=insumo,
            quantidade=qtd_estoque,
            custo_unitario=custo_estoque,
            origem_tipo="xml",
            origem_id=nota.id,
            codigo_lote=item.get("codigo_lote"),
            data_validade=validade,
            motivo=f"NF-e {numero_nota}",
            usuario_id=usuario_id,
        )

    nota.valor_total = float(money(valor_total))
    entrada.valor_total = float(money(valor_total))

    conta_pagar_id = None
    if gerar_conta_pagar and valor_total > Decimal("0.00"):
        cats, _ = ensure_default_finance_setup(db, restaurante_id)
        cat_forn = next((c for c in cats if c.codigo == "fornecedores"), cats[0])
        hoje = datetime.date.today()
        emissao_dt = datetime.date.fromisoformat(data_emissao[:10]) if data_emissao else hoje
        cp = create_conta_pagar(
            db,
            restaurante_id=restaurante_id,
            categoria_id=cat_forn.id,
            distribuidor_id=dist.id,
            favorecido_nome=dist.nome_fantasia,
            descricao=f"NF-e {numero_nota}",
            numero_documento=numero_nota,
            valor_original=valor_total,
            data_emissao=emissao_dt,
            data_competencia=emissao_dt,
            primeiro_vencimento=data_vencimento_financeiro or (emissao_dt + datetime.timedelta(days=30)),
            origem_tipo="xml_nfe",
            origem_id=nota.id,
            criado_por_id=usuario_id,
        )
        conta_pagar_id = cp.id

    db.flush()
    return {
        "nota_id": nota.id,
        "entrada_id": entrada.id,
        "valor_total": float(money(valor_total)),
        "conta_pagar_id": conta_pagar_id,
    }


def registrar_perda_detalhada(
    db: Session,
    *,
    restaurante_id: int,
    insumo_id: str,
    quantidade: float,
    categoria_perda: str,
    observacao: str = "",
    lote_id: str | None = None,
    usuario_id: str | None = None,
) -> dict:
    if categoria_perda not in LOSS_REASONS:
        raise ValueError(f"Categoria de perda inválida. Use uma de: {', '.join(sorted(LOSS_REASONS))}.")
    if quantidade <= 0:
        raise ValueError("Quantidade da perda deve ser maior que zero.")

    insumo = (
        db.query(Insumo)
        .filter(Insumo.restaurante_id == restaurante_id, Insumo.id == insumo_id)
        .first()
    )
    if insumo is None:
        raise ValueError("Insumo não encontrado.")

    custo_base = _cost4(insumo.preco_medio_custo or 0)
    if lote_id:
        lote = (
            db.query(LoteEstoque)
            .filter(
                LoteEstoque.restaurante_id == restaurante_id,
                LoteEstoque.id == lote_id,
                LoteEstoque.insumo_id == insumo.id,
            )
            .first()
        )
        if lote is None:
            raise ValueError("Lote não encontrado para este insumo.")
        disponivel = float(lote.saldo_atual or 0.0)
        usar = min(disponivel, float(quantidade))
        lote.saldo_atual = max(0.0, disponivel - usar)
        if lote.saldo_atual <= 1e-9:
            lote.saldo_atual = 0.0
            lote.ativo = False
        if _cost4(lote.custo_unitario or 0) > Decimal("0.0000"):
            custo_base = _cost4(lote.custo_unitario)
    else:
        consumos = consumir_lotes_fefo(db, restaurante_id=restaurante_id, insumo=insumo, quantidade=quantidade)
        if consumos and consumos[0][2] > Decimal("0.0000"):
            custo_base = consumos[0][2]

    saldo_ant = float(insumo.estoque_atual or 0.0)
    insumo.estoque_atual = saldo_ant - float(quantidade)
    custo_quantificado = money(Decimal(str(quantidade)) * custo_base) if custo_base > Decimal("0.0000") else None

    mov = MovimentacaoEstoque(
        restaurante_id=restaurante_id,
        insumo_id=insumo.id,
        tipo="perda",
        quantidade=float(quantidade),
        saldo_anterior=saldo_ant,
        saldo_posterior=insumo.estoque_atual,
        custo_unitario=float(custo_base),
        motivo=categoria_perda,
        observacao=observacao.strip(),
        origem="perda_operacional",
        referencia_id=lote_id,
        usuario_id=usuario_id,
    )
    db.add(mov)
    db.flush()
    return {
        "movimentacao_id": mov.id,
        "categoria_perda": categoria_perda,
        "quantidade": float(quantidade),
        "custo_estimado": float(custo_quantificado) if custo_quantificado is not None else None,
        "custo_desconhecido": custo_quantificado is None,
    }
