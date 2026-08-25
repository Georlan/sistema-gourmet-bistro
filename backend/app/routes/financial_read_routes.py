from __future__ import annotations

import calendar
import datetime
from collections import defaultdict
from decimal import Decimal
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..database import get_db, require_tenant_id
from ..models import (
    Cliente,
    Comanda,
    ConfiguracaoRestaurante,
    Item as ComandaItem,
    Produto,
    Usuario,
)
from ..operational_models import AtendimentoMesa
from ..security import require_permission
from ..services.financeiro import money
from ..services.financial_read import (
    current_operational_day,
    daily_financial_rows,
    load_financial_snapshot,
    peak_hour_rows,
)
from ..timezone_utils import to_operational_local_time
from . import optimization as legacy_optimization
from . import relatorios as legacy_reports


def _remove_route(router, full_path: str, method: str = "GET") -> None:
    method = method.upper()
    router.routes[:] = [
        route
        for route in router.routes
        if not (
            getattr(route, "path", None) == full_path
            and method in (getattr(route, "methods", set()) or set())
        )
    ]


def _snapshot_or_400(
    db: Session,
    restaurante_id: int,
    data_inicio: str | None,
    data_fim: str | None,
):
    try:
        return load_financial_snapshot(
            db,
            restaurante_id,
            data_inicio,
            data_fim,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _float(value: Decimal | float | int | None) -> float:
    return float(money(value))


def _pct(current: Decimal, previous: Decimal) -> float:
    if previous == Decimal("0.00"):
        return 0.0
    return round(float((current - previous) / previous * Decimal("100")), 1)


def _method_dict(values: dict[str, Decimal]) -> dict[str, float]:
    return {
        "dinheiro": _float(values.get("dinheiro", Decimal("0.00"))),
        "pix": _float(values.get("pix", Decimal("0.00"))),
        "cartao": _float(values.get("cartao", Decimal("0.00"))),
    }


def _command_context(db: Session, restaurante_id: int, command_ids: set[str]):
    if not command_ids:
        return {}, {}
    commands = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.id.in_(command_ids),
        )
        .all()
    )
    command_map = {str(command.id): command for command in commands}
    user_ids = {command.garcom_id for command in commands if command.garcom_id}
    users = (
        db.query(Usuario)
        .filter(
            Usuario.restaurante_id == restaurante_id,
            Usuario.id.in_(user_ids),
        )
        .all()
        if user_ids
        else []
    )
    return command_map, {str(user.id): user.nome for user in users}


def _attendance_numbers(db: Session, restaurante_id: int, attendance_ids: set[str]) -> dict[str, int]:
    if not attendance_ids:
        return {}
    rows = (
        db.query(AtendimentoMesa.id, AtendimentoMesa.numero_conta)
        .filter(
            AtendimentoMesa.restaurante_id == restaurante_id,
            AtendimentoMesa.id.in_(attendance_ids),
        )
        .all()
    )
    return {str(atendimento_id): int(numero_conta) for atendimento_id, numero_conta in rows}


def _sale_mode(command_types: set[str]) -> str:
    normalized = {str(value or "").strip().lower() for value in command_types}
    if any(value in {"delivery", "entrega"} or "delivery" in value for value in normalized):
        return "delivery"
    if any(value in {"balcão", "balcao", "retirada"} or "retirada" in value for value in normalized):
        return "balcao"
    return "local"


def get_relatorio_visao_geral_financeiro(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar")),
):
    rest_id = require_tenant_id()
    snapshot = _snapshot_or_400(db, rest_id, data_inicio, data_fim)

    net = snapshot.totals.vendas_liquidas
    gross = snapshot.totals.vendas_brutas
    refunds = snapshot.totals.estornos
    total_sales = len(snapshot.sales)
    avg_ticket = money(net / total_sales) if total_sales else Decimal("0.00")
    avg_ticket_gross = money(gross / total_sales) if total_sales else Decimal("0.00")

    period_days = (snapshot.period.end_day - snapshot.period.start_day).days + 1
    prev_end = snapshot.period.start_day - datetime.timedelta(days=1)
    prev_start = prev_end - datetime.timedelta(days=period_days - 1)
    previous = _snapshot_or_400(db, rest_id, prev_start.isoformat(), prev_end.isoformat())

    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == rest_id)
        .first()
    )
    monthly_goal = _float(config.meta_mensal if config else 0)

    op_today = current_operational_day(db, rest_id)
    month_start = op_today.replace(day=1)
    month_days = calendar.monthrange(op_today.year, op_today.month)[1]
    month_snapshot = _snapshot_or_400(db, rest_id, month_start.isoformat(), op_today.isoformat())
    month_net = month_snapshot.totals.vendas_liquidas
    month_goal = money(monthly_goal)
    remaining = max(Decimal("0.00"), money(month_goal - month_net))
    goal_pct = round(float(month_net / month_goal * Decimal("100")), 1) if month_goal > 0 else 0.0
    projection = money(month_net / max(1, op_today.day) * month_days)
    days_left = max(1, month_days - op_today.day)
    daily_needed = money(remaining / days_left)

    active_clients = (
        db.query(Cliente).filter(Cliente.restaurante_id == rest_id).count()
    )

    return {
        # Compatibilidade: faturamento_total agora representa receita líquida reconhecida.
        "faturamento_total": _float(net),
        "vendas_brutas": _float(gross),
        "estornos": _float(refunds),
        "vendas_liquidas": _float(net),
        "total_pedidos": total_sales,
        "ticket_medio": _float(avg_ticket),
        "ticket_medio_bruto": _float(avg_ticket_gross),
        "clientes_ativos": active_clients,
        "meta_mensal": monthly_goal,
        "meta_realizada": _float(month_net),
        "meta_restante": _float(remaining),
        "meta_percentual": goal_pct,
        "meta_projecao": _float(projection),
        "meta_media_diaria_necessaria": _float(daily_needed),
        "vendas_por_dia": daily_financial_rows(snapshot),
        "horarios_pico": peak_hour_rows(snapshot),
        "breakdown_pagamentos": _method_dict(snapshot.totals.liquido_por_metodo),
        "breakdown_bruto": _method_dict(snapshot.totals.bruto_por_metodo),
        "breakdown_estornos": _method_dict(snapshot.totals.estornos_por_metodo),
        "dia_operacional_inicio": snapshot.period.start_day.isoformat(),
        "dia_operacional_fim": snapshot.period.end_day.isoformat(),
        "fonte_financeira": "pagamentos_aprovados_menos_estornos_por_turno",
        "comparativo_anterior": {
            "tem_base_anterior": bool(previous.sales),
            "faturamento_anterior": _float(previous.totals.vendas_liquidas),
            "vendas_brutas_anteriores": _float(previous.totals.vendas_brutas),
            "estornos_anteriores": _float(previous.totals.estornos),
            "variacao_faturamento_pct": _pct(net, previous.totals.vendas_liquidas),
            "pedidos_anteriores": len(previous.sales),
            "variacao_pedidos_pct": (
                round((total_sales - len(previous.sales)) / len(previous.sales) * 100.0, 1)
                if previous.sales
                else 0.0
            ),
        },
    }


def get_vendas_detalhes_financeiro(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar")),
):
    rest_id = require_tenant_id()
    snapshot = _snapshot_or_400(db, rest_id, data_inicio, data_fim)
    if not snapshot.sales:
        return []

    command_ids = {command_id for sale in snapshot.sales.values() for command_id in sale.command_ids}
    command_map, user_map = _command_context(db, rest_id, command_ids)
    attendance_ids = {
        str(sale.atendimento_id)
        for sale in snapshot.sales.values()
        if sale.atendimento_id
    }
    attendance_numbers = _attendance_numbers(db, rest_id, attendance_ids)

    result = []
    for sale in snapshot.sales.values():
        commands = [command_map[cid] for cid in sale.command_ids if cid in command_map]
        operator_names = sorted({
            user_map.get(str(command.garcom_id), "Operador Caixa")
            for command in commands
        })
        methods = sorted(sale.methods)
        if sale.atendimento_id:
            number = attendance_numbers.get(str(sale.atendimento_id))
            identity_type = "Conta"
        else:
            number = next(
                (
                    int(command.numero_pedido)
                    for command in commands
                    if getattr(command, "numero_pedido", None) is not None
                ),
                0,
            )
            identity_type = "Comanda"

        operational_day = max(sale.operational_days).isoformat() if sale.operational_days else None
        result.append({
            "id": sale.key,
            "data_hora": sale.last_paid_at.isoformat() if sale.last_paid_at else "",
            "dia_operacional": operational_day,
            "numero_pedido": number or 0,
            "identidade_financeira": identity_type,
            "valor_total": _float(sale.gross),
            "valor_bruto": _float(sale.gross),
            # Estorno não é atribuído artificialmente a uma Conta quando um
            # pagamento foi alocado entre várias famílias financeiras.
            "valor_liquido_atribuido": None,
            "forma_pagamento": " + ".join(methods) if methods else "Não informado",
            "operador": " + ".join(operator_names) if operator_names else "Operador Caixa",
            "status": "Recebido",
        })
    return sorted(result, key=lambda row: row["data_hora"], reverse=True)


def get_dashboard_financeiro(
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar")),
):
    rest_id = require_tenant_id()
    snapshot = _snapshot_or_400(db, rest_id, data_inicio, data_fim)
    total_sales = len(snapshot.sales)
    net = snapshot.totals.vendas_liquidas
    gross = snapshot.totals.vendas_brutas
    refunds = snapshot.totals.estornos

    period_days = (snapshot.period.end_day - snapshot.period.start_day).days + 1
    prev_end = snapshot.period.start_day - datetime.timedelta(days=1)
    prev_start = prev_end - datetime.timedelta(days=period_days - 1)
    previous = _snapshot_or_400(db, rest_id, prev_start.isoformat(), prev_end.isoformat())

    op_today = current_operational_day(db, rest_id)
    today_snapshot = _snapshot_or_400(db, rest_id, op_today.isoformat(), op_today.isoformat())

    command_ids = {command_id for sale in snapshot.sales.values() for command_id in sale.command_ids}
    commands = (
        db.query(Comanda)
        .options(joinedload(Comanda.itens).joinedload(ComandaItem.produto))
        .filter(
            Comanda.restaurante_id == rest_id,
            Comanda.id.in_(command_ids),
        )
        .all()
        if command_ids
        else []
    )
    command_map = {str(command.id): command for command in commands}

    days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"]
    weekly = {day: {"delivery": 0, "local": 0, "balcao": 0} for day in days}
    modes = {"local": 0, "delivery": 0, "balcao": 0}
    for sale in snapshot.sales.values():
        sale_commands = [command_map[cid] for cid in sale.command_ids if cid in command_map]
        mode = _sale_mode({getattr(command, "tipo", "") for command in sale_commands})
        modes[mode] += 1
        if sale.operational_days:
            op_day = max(sale.operational_days)
            # Python segunda=0; API histórica usa domingo=0.
            day_label = days[(op_day.weekday() + 1) % 7]
            weekly[day_label][mode] += 1

    total_products = db.query(Produto).filter(Produto.restaurante_id == rest_id).count()
    if total_products:
        optimized_products = (
            db.query(Produto)
            .filter(
                Produto.restaurante_id == rest_id,
                Produto.descricao != "",
                Produto.descricao.isnot(None),
                Produto.imagem != "",
                Produto.imagem.isnot(None),
            )
            .count()
        )
        menu_quality = int(optimized_products / total_products * 100)
    else:
        menu_quality = 100

    # Top itens é deliberadamente métrica operacional de consumo, não fonte de
    # receita. A soma abaixo nunca participa de faturamento/ticket/fechamento.
    item_counts: dict[str, dict[str, float | int]] = {}
    for command in commands:
        for item in command.itens:
            if item.status == "cancelado":
                continue
            product_name = item.produto.nome if item.produto else f"Item {item.produto_id}"
            row = item_counts.setdefault(product_name, {"count": 0, "price": float(item.preco_unit or 0)})
            row["count"] = int(row["count"]) + int(getattr(item, "quantidade", 1) or 1)

    top_items = []
    for index, (name, row) in enumerate(
        sorted(item_counts.items(), key=lambda pair: int(pair[1]["count"]), reverse=True)[:5]
    ):
        top_items.append({
            "rank": f"{index + 1}º",
            "name": name,
            "count": int(row["count"]),
            "price": round(float(row["price"]), 2),
        })

    client_ids = {payment.cliente_id for payment in snapshot.payments if payment.cliente_id}
    cpfs = {payment.cpf_cliente for payment in snapshot.payments if payment.cpf_cliente}
    active_clients = len(client_ids or cpfs) if (client_ids or cpfs) else total_sales

    return {
        # Compatibilidade: `faturamento` e `faturamento_hoje` são líquidos.
        "faturamento": _float(net),
        "vendas_brutas": _float(gross),
        "estornos": _float(refunds),
        "vendas_liquidas": _float(net),
        "faturamento_hoje": _float(today_snapshot.totals.vendas_liquidas),
        "vendas_brutas_hoje": _float(today_snapshot.totals.vendas_brutas),
        "estornos_hoje": _float(today_snapshot.totals.estornos),
        "ticket_medio": _float(money(net / total_sales) if total_sales else 0),
        "ticket_medio_bruto": _float(money(gross / total_sales) if total_sales else 0),
        "total_pedidos": total_sales,
        "clientes_ativos": active_clients,
        "weekly_chart": [
            {
                "label": day,
                "delivery": weekly[day]["delivery"],
                "local": weekly[day]["local"],
                "balcao": weekly[day]["balcao"],
            }
            for day in days
        ],
        "qualidade_cardapio": menu_quality,
        "pedidos_modalidade": modes,
        "top_itens": top_items,
        "top_itens_natureza": "consumo_operacional_nao_faturamento",
        "breakdown_pagamentos": _method_dict(snapshot.totals.liquido_por_metodo),
        "breakdown_bruto": _method_dict(snapshot.totals.bruto_por_metodo),
        "breakdown_estornos": _method_dict(snapshot.totals.estornos_por_metodo),
        "dia_operacional_inicio": snapshot.period.start_day.isoformat(),
        "dia_operacional_fim": snapshot.period.end_day.isoformat(),
        "fonte_financeira": "pagamentos_aprovados_menos_estornos_por_turno",
        "comparativo_anterior": {
            "tem_base_anterior": bool(previous.sales),
            "recebido_anterior": _float(previous.totals.vendas_liquidas),
            "variacao_recebido_pct": _pct(net, previous.totals.vendas_liquidas),
            "contas_anteriores": len(previous.sales),
            "variacao_contas_pct": (
                round((total_sales - len(previous.sales)) / len(previous.sales) * 100.0, 1)
                if previous.sales
                else 0.0
            ),
        },
    }


def get_equipe_desempenho_financeiro(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    cargo: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar")),
):
    """Atribui o valor recebido pela equipe a partir do mesmo ledger dos demais relatórios."""
    rest_id = require_tenant_id()
    snapshot = _snapshot_or_400(db, rest_id, data_inicio, data_fim)

    command_ids = {allocation.command_id for allocation in snapshot.allocations}
    commands = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == rest_id,
            Comanda.id.in_(command_ids),
        )
        .all()
        if command_ids
        else []
    )
    command_owner = {
        str(command.id): str(command.garcom_id)
        for command in commands
        if command.garcom_id
    }

    sales_by_member: dict[str, set[str]] = defaultdict(set)
    gross_by_member: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for allocation in snapshot.allocations:
        member_id = command_owner.get(str(allocation.command_id))
        if not member_id:
            continue
        sales_by_member[member_id].add(allocation.sale_key)
        gross_by_member[member_id] += money(allocation.value)

    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == rest_id)
        .first()
    )
    service_active = config.taxa_servico_ativa if config else True
    service_rate = money(config.taxa_servico_padrao or 10.0) if config else Decimal("10.00")

    members = db.query(Usuario).filter(Usuario.restaurante_id == rest_id).all()
    role_filter = (cargo or "").lower().strip()
    result = []
    for member in members:
        member_role = (member.role or "garcom").lower().strip()
        if role_filter == "todos":
            pass
        elif role_filter == "atendimento":
            if member_role not in {"garcom", "atendente"}:
                continue
        elif role_filter:
            if member_role != role_filter:
                continue
        elif member_role not in legacy_reports.COMMERCIAL_ROLES:
            continue

        member_id = str(member.id)
        sale_count = len(sales_by_member.get(member_id, set()))
        gross = money(gross_by_member.get(member_id, Decimal("0.00")))
        average_ticket = money(gross / sale_count) if sale_count else Decimal("0.00")
        commission = money(gross * service_rate / Decimal("100")) if service_active else Decimal("0.00")

        result.append({
            "id": member_id,
            "nome": member.nome,
            "email": member.email,
            "role": member_role,
            "pedidos_atendidos": sale_count,
            "faturamento": _float(gross),
            "ticket_medio": _float(average_ticket),
            "comissao": _float(commission),
            "taxa_servico_usada": _float(service_rate) if service_active else 0.0,
        })

    result.sort(key=lambda row: (row["faturamento"], row["pedidos_atendidos"]), reverse=True)
    return {
        "taxa_servico_ativa": service_active,
        "taxa_servico_padrao": _float(service_rate),
        "fonte_financeira": "pagamentos_aprovados_alocados_por_turno",
        "membros": result,
    }


# Substitui somente as leituras financeiras problemáticas. As demais rotas
# legadas (produtos, metas etc.) continuam no mesmo router/API.
_remove_route(legacy_reports.router, "/relatorios/visao-geral")
_remove_route(legacy_reports.router, "/relatorios/vendas-detalhes")
_remove_route(legacy_reports.router, "/relatorios/equipe/desempenho")
_remove_route(legacy_optimization.router, "/comandas/estatisticas/geral")

legacy_reports.router.add_api_route(
    "/visao-geral",
    get_relatorio_visao_geral_financeiro,
    methods=["GET"],
    name="get_relatorio_visao_geral_financeiro",
)
legacy_reports.router.add_api_route(
    "/vendas-detalhes",
    get_vendas_detalhes_financeiro,
    methods=["GET"],
    name="get_vendas_detalhes_financeiro",
)
legacy_reports.router.add_api_route(
    "/equipe/desempenho",
    get_equipe_desempenho_financeiro,
    methods=["GET"],
    name="get_equipe_desempenho_financeiro",
)
legacy_optimization.router.add_api_route(
    "/comandas/estatisticas/geral",
    get_dashboard_financeiro,
    methods=["GET"],
    name="get_dashboard_financeiro",
)
