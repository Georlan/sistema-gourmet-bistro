"""Integração transacional entre itens vendidos e estoque de ingredientes."""

from collections.abc import Iterable

from sqlalchemy.orm import Session

from ..models import Comanda, Insumo, Item, MovimentacaoEstoque, Produto, ProdutoInsumo


SALE_ORIGIN = "venda_automatica"
SALE_REVERSAL_ORIGIN = "cancelamento_venda"
_PENDING_ACCEPTANCE_STATUSES = {"analise", "pendente"}
_PENDING_ACCEPTANCE_TYPES = {"delivery", "entrega", "retirada"}


def _aguarda_aceite_operacional(db: Session, item: Item) -> bool:
    """Retorna True quando o item pertence a um pedido ainda não aceito.

    A regra vale para qualquer origem que use a gaveta de aceite. Vendas diretas
    do caixa nascem em ``producao`` e continuam baixando estoque imediatamente.
    """
    comanda = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == int(item.restaurante_id),
            Comanda.id == item.comanda_id,
        )
        .first()
    )
    if comanda is None:
        return False

    status = (comanda.delivery_status or "").strip().casefold()
    tipo = (comanda.tipo or "").strip().casefold()
    return (
        status in _PENDING_ACCEPTANCE_STATUSES
        and tipo in _PENDING_ACCEPTANCE_TYPES
    )


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

    for item in itens:
        restaurante_id = int(item.restaurante_id)
        if not liberar_pendente and _aguarda_aceite_operacional(db, item):
            continue

        receitas = (
            db.query(ProdutoInsumo)
            .filter(
                ProdutoInsumo.restaurante_id == restaurante_id,
                ProdutoInsumo.produto_id == item.produto_id,
            )
            .all()
        )
        if not receitas:
            continue

        produto = (
            db.query(Produto)
            .filter(
                Produto.restaurante_id == restaurante_id,
                Produto.id == item.produto_id,
            )
            .first()
        )
        produto_nome = produto.nome if produto else item.produto_id

        for receita in receitas:
            insumo = (
                db.query(Insumo)
                .filter(
                    Insumo.restaurante_id == restaurante_id,
                    Insumo.id == receita.insumo_id,
                )
                .with_for_update()
                .first()
            )
            if not insumo:
                continue

            # A checagem de idempotência precisa acontecer depois do lock do
            # insumo. Sob READ COMMITTED, uma segunda transação que aguardou o
            # mesmo row lock passa a enxergar a movimentação commitada pela
            # primeira e não aplica a baixa novamente.
            existente = (
                db.query(MovimentacaoEstoque.id)
                .filter(
                    MovimentacaoEstoque.restaurante_id == restaurante_id,
                    MovimentacaoEstoque.origem == SALE_ORIGIN,
                    MovimentacaoEstoque.referencia_id == item.id,
                    MovimentacaoEstoque.insumo_id == receita.insumo_id,
                )
                .first()
            )
            if existente:
                continue

            quantidade = float(receita.quantidade or 0)
            if quantidade <= 0:
                continue
            saldo_anterior = float(insumo.estoque_atual or 0)
            saldo_posterior = saldo_anterior - quantidade
            insumo.estoque_atual = saldo_posterior
            db.add(
                MovimentacaoEstoque(
                    restaurante_id=restaurante_id,
                    insumo_id=insumo.id,
                    tipo="saida",
                    quantidade=quantidade,
                    saldo_anterior=saldo_anterior,
                    saldo_posterior=saldo_posterior,
                    custo_unitario=float(insumo.preco_medio_custo or 0),
                    motivo=f"Venda de {produto_nome}",
                    observacao="Baixa automática pela ficha técnica",
                    origem=SALE_ORIGIN,
                    referencia_id=item.id,
                    usuario_id=usuario_id,
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
