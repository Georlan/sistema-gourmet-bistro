"""Integração transacional entre itens vendidos e estoque de ingredientes."""

from collections.abc import Iterable

from sqlalchemy.orm import Session

from ..models import Insumo, Item, MovimentacaoEstoque, Produto, ProdutoInsumo


SALE_ORIGIN = "venda_automatica"
SALE_REVERSAL_ORIGIN = "cancelamento_venda"


def consumir_estoque_dos_itens(
    db: Session,
    itens: Iterable[Item],
    *,
    usuario_id: str | None = None,
) -> None:
    """Baixa a ficha técnica de cada item uma única vez.

    A venda não é bloqueada por saldo insuficiente: restaurantes podem operar
    durante uma divergência física, enquanto o saldo negativo permanece visível
    como alerta para correção no inventário.
    """

    for item in itens:
        restaurante_id = int(item.restaurante_id)
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
