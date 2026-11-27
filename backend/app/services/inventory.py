"""Integração transacional entre itens vendidos e estoque de ingredientes."""

from collections.abc import Iterable
import datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from ..b8_supply_models import FichaTecnicaComponente, ItemCustoSnapshot, SubReceita
from ..models import Comanda, Insumo, Item, ItemModificador, MovimentacaoEstoque, Produto, ProdutoInsumo
from .b8_supply import consumir_lotes_fefo
from .financeiro import money


SALE_ORIGIN = "venda_automatica"
SALE_REVERSAL_ORIGIN = "cancelamento_venda"
_PENDING_ACCEPTANCE_STATUSES = {"analise", "pendente"}
_PENDING_ACCEPTANCE_TYPES = {"delivery", "entrega", "retirada"}


def _aguarda_aceite_operacional(
    db: Session,
    item: Item,
    *,
    cache: dict[tuple[int, str], bool] | None = None,
) -> bool:
    """Retorna True quando o item pertence a um pedido ainda não aceito.

    A regra vale para qualquer origem que use a gaveta de aceite. Vendas diretas
    do caixa nascem em ``producao`` e continuam baixando estoque imediatamente.
    """
    cache_key = (int(item.restaurante_id), str(item.comanda_id))
    if cache is not None and cache_key in cache:
        return cache[cache_key]

    comanda = None
    get_fn = getattr(db, "get", None)
    if callable(get_fn):
        candidate = get_fn(Comanda, item.comanda_id)
        if candidate is not None and int(candidate.restaurante_id) == int(item.restaurante_id):
            comanda = candidate
    if comanda is None:
        comanda = (
            db.query(Comanda)
            .filter(
                Comanda.restaurante_id == int(item.restaurante_id),
                Comanda.id == item.comanda_id,
            )
            .first()
        )
    if comanda is None:
        if cache is not None:
            cache[cache_key] = False
        return False

    status = (comanda.delivery_status or "").strip().casefold()
    tipo = (comanda.tipo or "").strip().casefold()
    pending = (
        status in _PENDING_ACCEPTANCE_STATUSES
        and tipo in _PENDING_ACCEPTANCE_TYPES
    )
    if cache is not None:
        cache[cache_key] = pending
    return pending


def consumir_estoque_dos_itens(
    db: Session,
    itens: Iterable[Item],
    *,
    usuario_id: str | None = None,
    liberar_pendente: bool = False,
) -> None:
    """Baixa a ficha técnica de cada item uma única vez.

    Pedidos que ainda aguardam aceite não consomem estoque. O primeiro aceite
    chama esta função com ``liberar_pendente=True`` dentro da mesma transação da
    mudança para produção. A checagem por movimentação torna retries seguros e
    também impede dupla baixa de pedidos pendentes criados antes desta regra.

    A venda não é bloqueada por saldo insuficiente: restaurantes podem operar
    durante uma divergência física, enquanto o saldo negativo permanece visível
    como alerta para correção no inventário.
    """

    aguarda_cache: dict[tuple[int, str], bool] = {}
    eligible_items = [
        item for item in itens
        if liberar_pendente or not _aguarda_aceite_operacional(db, item, cache=aguarda_cache)
    ]
    if not eligible_items:
        return

    by_rest_prods: dict[int, set[str]] = {}
    for item in eligible_items:
        by_rest_prods.setdefault(int(item.restaurante_id), set()).add(str(item.produto_id))

    receitas_by_key: dict[tuple[int, str], list[ProdutoInsumo]] = {}
    for rest_id, prod_ids in by_rest_prods.items():
        fallback_pid = next(iter(prod_ids)) if len(prod_ids) == 1 else None
        for rec in (
            db.query(ProdutoInsumo)
            .filter(
                ProdutoInsumo.restaurante_id == rest_id,
                ProdutoInsumo.produto_id.in_(prod_ids),
            )
            .all()
        ):
            rec_pid = getattr(rec, "produto_id", None) or fallback_pid
            if rec_pid is not None:
                receitas_by_key.setdefault((rest_id, str(rec_pid)), []).append(rec)

    if not receitas_by_key:
        # Verifica se há componentes universais (sub-receitas/embalagens) ou modificadores antes do retorno rápido.
        has_universal = False
        for rest_id, prod_ids in by_rest_prods.items():
            if (
                db.query(FichaTecnicaComponente.id)
                .filter(
                    FichaTecnicaComponente.restaurante_id == rest_id,
                    FichaTecnicaComponente.entidade_tipo == "produto",
                    FichaTecnicaComponente.entidade_id.in_(prod_ids),
                )
                .first()
                is not None
            ):
                has_universal = True
                break
        if not has_universal:
            item_ids = [str(it.id) for it in eligible_items]
            if item_ids:
                first_rid = int(eligible_items[0].restaurante_id)
                has_mods = (
                    db.query(ItemModificador.id)
                    .filter(
                        ItemModificador.restaurante_id == first_rid,
                        ItemModificador.item_id.in_(item_ids),
                    )
                    .first()
                    is not None
                )
                if not has_mods:
                    return

    # Carrega componentes extras de sub-receitas/embalagens e opções de modificadores.
    extra_comps_by_prod: dict[tuple[int, str], list[FichaTecnicaComponente]] = {}
    for rest_id, prod_ids in by_rest_prods.items():
        for comp in (
            db.query(FichaTecnicaComponente)
            .filter(
                FichaTecnicaComponente.restaurante_id == rest_id,
                FichaTecnicaComponente.entidade_tipo == "produto",
                FichaTecnicaComponente.entidade_id.in_(prod_ids),
                FichaTecnicaComponente.sub_receita_id.isnot(None),
            )
            .all()
        ):
            extra_comps_by_prod.setdefault((rest_id, str(comp.entidade_id)), []).append(comp)

    mods_by_item: dict[tuple[int, str], list[str]] = {}
    all_opt_ids_by_rest: dict[int, set[str]] = {}
    item_ids_by_rest: dict[int, set[str]] = {}
    for it in eligible_items:
        item_ids_by_rest.setdefault(int(it.restaurante_id), set()).add(str(it.id))
    for rest_id, iids in item_ids_by_rest.items():
        for im in (
            db.query(ItemModificador)
            .filter(ItemModificador.restaurante_id == rest_id, ItemModificador.item_id.in_(iids))
            .all()
        ):
            mods_by_item.setdefault((rest_id, str(im.item_id)), []).append(str(im.opcao_modificador_id))
            all_opt_ids_by_rest.setdefault(rest_id, set()).add(str(im.opcao_modificador_id))

    mod_comps_by_opt: dict[tuple[int, str], list[FichaTecnicaComponente]] = {}
    for rest_id, opt_ids in all_opt_ids_by_rest.items():
        for comp in (
            db.query(FichaTecnicaComponente)
            .filter(
                FichaTecnicaComponente.restaurante_id == rest_id,
                FichaTecnicaComponente.entidade_tipo == "opcao_modificador",
                FichaTecnicaComponente.entidade_id.in_(opt_ids),
            )
            .all()
        ):
            mod_comps_by_opt.setdefault((rest_id, str(comp.entidade_id)), []).append(comp)

    produtos_by_key: dict[tuple[int, str], Produto] = {}
    for rest_id, prod_ids in by_rest_prods.items():
        for prod in (
            db.query(Produto)
            .filter(
                Produto.restaurante_id == rest_id,
                Produto.id.in_(prod_ids),
            )
            .all()
        ):
            produtos_by_key[(rest_id, str(prod.id))] = prod

    for item in eligible_items:
        restaurante_id = int(item.restaurante_id)
        receitas = receitas_by_key.get((restaurante_id, str(item.produto_id)), [])
        extra_subs = extra_comps_by_prod.get((restaurante_id, str(item.produto_id)), [])
        opt_ids_item = mods_by_item.get((restaurante_id, str(item.id)), [])

        # Lista consolidada de (insumo_id, quantidade) incluindo modificadores e sub-receitas.
        consumo_lines: list[tuple[str, float, str]] = []
        for rec in receitas:
            consumo_lines.append((str(rec.insumo_id), float(rec.quantidade or 0), "produto"))

        for comp in extra_subs:
            if comp.sub_receita_id:
                sub = (
                    db.query(SubReceita)
                    .filter(SubReceita.restaurante_id == restaurante_id, SubReceita.id == comp.sub_receita_id)
                    .first()
                )
                if sub and sub.insumo_saida_id:
                    consumo_lines.append((str(sub.insumo_saida_id), float(comp.quantidade or 0), "sub_receita"))

        mod_missing_recipe = False
        for opt_id in opt_ids_item:
            opt_comps = mod_comps_by_opt.get((restaurante_id, opt_id), [])
            if not opt_comps:
                mod_missing_recipe = True
                continue
            for comp in opt_comps:
                if comp.insumo_id:
                    consumo_lines.append((str(comp.insumo_id), float(comp.quantidade or 0), "modificador"))
                elif comp.sub_receita_id:
                    sub = (
                        db.query(SubReceita)
                        .filter(SubReceita.restaurante_id == restaurante_id, SubReceita.id == comp.sub_receita_id)
                        .first()
                    )
                    if sub and sub.insumo_saida_id:
                        consumo_lines.append((str(sub.insumo_saida_id), float(comp.quantidade or 0), "modificador_sub"))

        if not consumo_lines:
            continue

        produto = produtos_by_key.get((restaurante_id, str(item.produto_id)))
        produto_nome = produto.nome if produto else item.produto_id

        custo_total_item = Decimal("0.0000")
        custo_completo = not mod_missing_recipe
        motivos_incompletos: list[str] = ["Modificador sem ficha técnica"] if mod_missing_recipe else []
        detalhes_snapshot: list[dict] = []

        for insumo_id_target, quantidade, origem_comp in consumo_lines:
            insumo = (
                db.query(Insumo)
                .filter(
                    Insumo.restaurante_id == restaurante_id,
                    Insumo.id == insumo_id_target,
                )
                .with_for_update()
                .first()
            )
            if not insumo:
                custo_completo = False
                motivos_incompletos.append(f"Insumo {insumo_id_target} ausente")
                continue

            existente = (
                db.query(MovimentacaoEstoque.id)
                .filter(
                    MovimentacaoEstoque.restaurante_id == restaurante_id,
                    MovimentacaoEstoque.origem == SALE_ORIGIN,
                    MovimentacaoEstoque.referencia_id == item.id,
                    MovimentacaoEstoque.insumo_id == insumo_id_target,
                )
                .first()
            )
            if existente:
                continue

            if quantidade <= 0:
                continue

            lotes_usados = consumir_lotes_fefo(
                db, restaurante_id=restaurante_id, insumo=insumo, quantidade=quantidade
            )
            saldo_anterior = float(insumo.estoque_atual or 0)
            saldo_posterior = saldo_anterior - quantidade
            insumo.estoque_atual = saldo_posterior

            custo_linha = Decimal("0.0000")
            for _lote_id, qtd_lote, custo_lote in lotes_usados:
                if custo_lote <= Decimal("0.0000"):
                    custo_completo = False
                    motivos_incompletos.append(f"Insumo '{insumo.nome}' sem custo histórico")
                custo_linha += Decimal(str(qtd_lote)) * custo_lote
            custo_unit_efetivo = (
                (custo_linha / Decimal(str(quantidade))).quantize(Decimal("0.0001"))
                if quantidade > 0
                else Decimal("0.0000")
            )
            custo_total_item += custo_linha
            detalhes_snapshot.append({
                "insumo_id": insumo.id,
                "origem": origem_comp,
                "quantidade": quantidade,
                "custo_unitario": float(custo_unit_efetivo),
                "custo_total": float(money(custo_linha)),
            })

            db.add(
                MovimentacaoEstoque(
                    restaurante_id=restaurante_id,
                    insumo_id=insumo.id,
                    tipo="saida",
                    quantidade=quantidade,
                    saldo_anterior=saldo_anterior,
                    saldo_posterior=saldo_posterior,
                    custo_unitario=float(custo_unit_efetivo),
                    motivo=f"Venda de {produto_nome}",
                    observacao="Baixa automática pela ficha técnica",
                    origem=SALE_ORIGIN,
                    referencia_id=item.id,
                    usuario_id=usuario_id,
                )
            )

        if detalhes_snapshot:
            existing_snap = (
                db.query(ItemCustoSnapshot.id)
                .filter(
                    ItemCustoSnapshot.restaurante_id == restaurante_id,
                    ItemCustoSnapshot.item_id == item.id,
                )
                .first()
            )
            if existing_snap is None:
                custo_tot_arred = money(custo_total_item) if custo_completo else None
                db.add(
                    ItemCustoSnapshot(
                        restaurante_id=restaurante_id,
                        comanda_id=str(item.comanda_id),
                        item_id=str(item.id),
                        produto_id=str(item.produto_id),
                        quantidade=1.0,
                        custo_unitario=float(custo_total_item.quantize(Decimal("0.0001"))) if custo_completo else None,
                        custo_total=float(custo_tot_arred) if custo_tot_arred is not None else None,
                        custo_completo=custo_completo,
                        motivo_incompleto="; ".join(motivos_incompletos)[:160] if motivos_incompletos else None,
                        detalhes_json=detalhes_snapshot,
                    )
                )


def alertas_estoque_dos_itens(
    db: Session,
    itens: Iterable[Item],
) -> list[dict[str, object]]:
    """Retorna alertas informativos para ingredientes zerados ou negativos.

    Esta função nunca bloqueia venda, aceite ou produção. O estoque do KÔMA
    permanece uma referência operacional: divergência física deve ser corrigida
    por contagem/entrada, enquanto o operador recebe contexto para decidir se
    precisa confirmar o item disponível fisicamente ou cancelar o pedido.
    """

    produtos_por_tenant: dict[int, set[str]] = {}
    for item in itens:
        if getattr(item, "status", None) == "cancelado":
            continue
        restaurante_id = int(item.restaurante_id)
        produtos_por_tenant.setdefault(restaurante_id, set()).add(str(item.produto_id))

    alertas: list[dict[str, object]] = []
    for restaurante_id, produto_ids in produtos_por_tenant.items():
        if not produto_ids:
            continue

        receitas = (
            db.query(ProdutoInsumo)
            .filter(
                ProdutoInsumo.restaurante_id == restaurante_id,
                ProdutoInsumo.produto_id.in_(produto_ids),
            )
            .all()
        )
        insumo_ids = sorted({str(receita.insumo_id) for receita in receitas})
        if not insumo_ids:
            continue

        insumos = (
            db.query(Insumo)
            .filter(
                Insumo.restaurante_id == restaurante_id,
                Insumo.id.in_(insumo_ids),
            )
            .all()
        )
        for insumo in insumos:
            saldo = float(insumo.estoque_atual or 0)
            if saldo > 0:
                continue
            alertas.append(
                {
                    "insumo_id": str(insumo.id),
                    "nome": str(insumo.nome),
                    "saldo_atual": saldo,
                    "unidade_medida": str(insumo.unidade_medida or "un"),
                }
            )

    return sorted(alertas, key=lambda item: (str(item["nome"]).casefold(), str(item["insumo_id"])))


def estornar_estoque_dos_itens(
    db: Session,
    itens: Iterable[Item],
    *,
    usuario_id: str | None = None,
) -> None:
    """Devolve somente baixas automáticas realmente registradas para os itens."""

    for item in itens:
        restaurante_id = int(item.restaurante_id)
        snap = (
            db.query(ItemCustoSnapshot)
            .filter(
                ItemCustoSnapshot.restaurante_id == restaurante_id,
                ItemCustoSnapshot.item_id == item.id,
                ItemCustoSnapshot.estornado.is_(False),
            )
            .first()
        )
        if snap is not None:
            snap.estornado = True
            snap.estornado_em = datetime.datetime.now(datetime.timezone.utc)
        baixas = (
            db.query(MovimentacaoEstoque)
            .filter(
                MovimentacaoEstoque.restaurante_id == restaurante_id,
                MovimentacaoEstoque.origem == SALE_ORIGIN,
                MovimentacaoEstoque.referencia_id == item.id,
            )
            .all()
        )
        for baixa in baixas:
            insumo = (
                db.query(Insumo)
                .filter(
                    Insumo.restaurante_id == restaurante_id,
                    Insumo.id == baixa.insumo_id,
                )
                .with_for_update()
                .first()
            )
            if not insumo:
                continue

            # Mesma garantia da baixa: o row lock serializa cancelamentos
            # concorrentes antes de decidir se o estorno já existe.
            estorno_existente = (
                db.query(MovimentacaoEstoque.id)
                .filter(
                    MovimentacaoEstoque.restaurante_id == restaurante_id,
                    MovimentacaoEstoque.origem == SALE_REVERSAL_ORIGIN,
                    MovimentacaoEstoque.referencia_id == item.id,
                    MovimentacaoEstoque.insumo_id == baixa.insumo_id,
                )
                .first()
            )
            if estorno_existente:
                continue

            quantidade = float(baixa.quantidade or 0)
            saldo_anterior = float(insumo.estoque_atual or 0)
            saldo_posterior = saldo_anterior + quantidade
            insumo.estoque_atual = saldo_posterior
            db.add(
                MovimentacaoEstoque(
                    restaurante_id=restaurante_id,
                    insumo_id=insumo.id,
                    tipo="ajuste_positivo",
                    quantidade=quantidade,
                    saldo_anterior=saldo_anterior,
                    saldo_posterior=saldo_posterior,
                    custo_unitario=float(baixa.custo_unitario or 0),
                    motivo="Cancelamento de venda",
                    observacao="Estorno automático da baixa da ficha técnica",
                    origem=SALE_REVERSAL_ORIGIN,
                    referencia_id=item.id,
                    usuario_id=usuario_id,
                )
            )
