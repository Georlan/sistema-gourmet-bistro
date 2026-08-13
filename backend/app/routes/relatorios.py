import datetime
import calendar
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db, require_tenant_id
from ..models import (
    Usuario, Comanda, Item as ComandaItem, Produto, Categoria,
    ConfiguracaoRestaurante, Pagamento, Restaurante
)
from ..security import require_permission
from ..timezone_utils import (
    get_operational_now,
    operational_day_bounds_utc,
    to_database_utc,
    to_operational_local_time,
)

router = APIRouter(prefix="/relatorios", tags=["relatorios"])


def _report_period(
    data_inicio: Optional[str],
    data_fim: Optional[str],
) -> tuple[datetime.datetime, datetime.datetime, datetime.date, datetime.date]:
    """Resolve um período de calendário local para o intervalo UTC [início, fim)."""
    local_today = get_operational_now().date()
    try:
        start_day = datetime.date.fromisoformat(data_inicio) if data_inicio else local_today - datetime.timedelta(days=30)
        end_day = datetime.date.fromisoformat(data_fim) if data_fim else local_today
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Período inválido. Use datas no formato AAAA-MM-DD.") from exc

    if start_day > end_day:
        raise HTTPException(status_code=400, detail="A data inicial não pode ser posterior à data final.")

    start_utc, _ = operational_day_bounds_utc(start_day)
    _, end_utc = operational_day_bounds_utc(end_day)
    return to_database_utc(start_utc), to_database_utc(end_utc), start_day, end_day


def _approved_payments(
    db: Session,
    restaurante_id: int,
    start_utc: datetime.datetime,
    end_utc: datetime.datetime,
) -> List[Pagamento]:
    return db.query(Pagamento).filter(
        Pagamento.restaurante_id == restaurante_id,
        Pagamento.status == "aprovado",
        Pagamento.criado_em >= start_utc,
        Pagamento.criado_em < end_utc,
    ).order_by(Pagamento.criado_em, Pagamento.id).all()


def _orders_from_payments(payments: List[Pagamento]) -> Dict[str, Dict[str, Any]]:
    """Consolida pagamentos no grão correto: uma venda por comanda paga."""
    orders: Dict[str, Dict[str, Any]] = {}
    for payment in payments:
        if not payment.comanda_id:
            continue
        key = str(payment.comanda_id)
        order = orders.setdefault(key, {
            "comanda_id": key,
            "total": 0.0,
            "paid_at": payment.criado_em,
            "methods": set(),
        })
        order["total"] += float(payment.valor or 0.0)
        if payment.criado_em and (not order["paid_at"] or payment.criado_em > order["paid_at"]):
            order["paid_at"] = payment.criado_em
        if payment.metodo:
            order["methods"].add(payment.metodo)
    return orders


@router.get("/visao-geral")
def get_relatorio_visao_geral(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar"))
):
    rest_id = require_tenant_id()

    db_inicio, db_fim, start_day, end_day = _report_period(data_inicio, data_fim)
    payments_curr = _approved_payments(db, rest_id, db_inicio, db_fim)
    orders_curr = _orders_from_payments(payments_curr)

    total_pedidos = len(orders_curr)
    faturamento_total = sum(order["total"] for order in orders_curr.values())
    ticket_medio = faturamento_total / total_pedidos if total_pedidos else 0.0

    period_days = (end_day - start_day).days + 1
    prev_start_day = start_day - datetime.timedelta(days=period_days)
    prev_end_day = start_day - datetime.timedelta(days=1)
    prev_inicio, _ = operational_day_bounds_utc(prev_start_day)
    _, prev_fim = operational_day_bounds_utc(prev_end_day)
    payments_prev = _approved_payments(
        db,
        rest_id,
        to_database_utc(prev_inicio),
        to_database_utc(prev_fim),
    )
    orders_prev = _orders_from_payments(payments_prev)
    pedidos_prev = len(orders_prev)
    fat_prev = sum(order["total"] for order in orders_prev.values())

    var_fat_pct = ((faturamento_total - fat_prev) / fat_prev * 100.0) if fat_prev > 0 else 0.0
    var_pedidos_pct = ((total_pedidos - pedidos_prev) / pedidos_prev * 100.0) if pedidos_prev > 0 else 0.0

    # 3. Monthly Goal (Meta Mensal)
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == rest_id
    ).first()
    meta_mensal = float(config.meta_mensal or 0.0) if config else 0.0

    today = get_operational_now().date()
    month_start_day = today.replace(day=1)
    month_days = calendar.monthrange(today.year, today.month)[1]
    month_end_day = today.replace(day=month_days)
    month_start_utc, _ = operational_day_bounds_utc(month_start_day)
    _, month_end_utc = operational_day_bounds_utc(month_end_day)
    payments_month = _approved_payments(
        db,
        rest_id,
        to_database_utc(month_start_utc),
        to_database_utc(month_end_utc),
    )
    meta_realizada = sum(float(payment.valor or 0.0) for payment in payments_month)
    day_of_month = today.day

    meta_restante = max(0.0, meta_mensal - meta_realizada)
    meta_percentual = round((meta_realizada / meta_mensal * 100.0), 1) if meta_mensal > 0 else 0.0
    meta_projecao = round((meta_realizada / max(1, day_of_month)) * month_days, 2)
    days_left = max(1, month_days - day_of_month)
    meta_media_diaria_necessaria = round(meta_restante / days_left, 2)

    # 4. Active Clients
    from ..models import Cliente
    clientes_ativos = db.query(func.count(Cliente.id)).filter(
        Cliente.restaurante_id == rest_id
    ).scalar() or 0

    # 5. Vendas por dia operacional. Antes da primeira venda real, zeros não
    # representam operação e só poluem gráficos e exportações.
    vendas_diarias_map: Dict[str, Dict[str, Any]] = {}
    local_paid_dates = [
        to_operational_local_time(order["paid_at"]).date()
        for order in orders_curr.values()
        if order["paid_at"]
    ]
    effective_start = max(start_day, min(local_paid_dates)) if local_paid_dates else None
    cur_date = effective_start
    while cur_date is not None and cur_date <= end_day:
        d_str = cur_date.strftime("%Y-%m-%d")
        vendas_diarias_map[d_str] = {"data": d_str, "total": 0.0, "quantidade_pedidos": 0}
        cur_date += datetime.timedelta(days=1)

    for order in orders_curr.values():
        if order["paid_at"]:
            d_str = to_operational_local_time(order["paid_at"]).strftime("%Y-%m-%d")
            if d_str in vendas_diarias_map:
                vendas_diarias_map[d_str]["quantidade_pedidos"] += 1
                vendas_diarias_map[d_str]["total"] += order["total"]

    vendas_por_dia = sorted(list(vendas_diarias_map.values()), key=lambda x: x["data"])

    # 6. Peak hours (Horários de pico: 00h to 23h)
    pico_map = {h: {"hora": f"{h:02d}h", "total_pedidos": 0, "faturamento": 0.0} for h in range(24)}
    for order in orders_curr.values():
        if order["paid_at"]:
            h = to_operational_local_time(order["paid_at"]).hour
            pico_map[h]["total_pedidos"] += 1
            pico_map[h]["faturamento"] += order["total"]

    horarios_pico = list(pico_map.values())

    return {
        "faturamento_total": round(faturamento_total, 2),
        "total_pedidos": total_pedidos,
        "ticket_medio": round(ticket_medio, 2),
        "clientes_ativos": clientes_ativos,
        "meta_mensal": meta_mensal,
        "meta_realizada": round(meta_realizada, 2),
        "meta_restante": round(meta_restante, 2),
        "meta_percentual": meta_percentual,
        "meta_projecao": meta_projecao,
        "meta_media_diaria_necessaria": meta_media_diaria_necessaria,
        "vendas_por_dia": vendas_por_dia,
        "horarios_pico": horarios_pico,
        "comparativo_anterior": {
            "faturamento_anterior": round(fat_prev, 2),
            "variacao_faturamento_pct": round(var_fat_pct, 1),
            "pedidos_anteriores": pedidos_prev,
            "variacao_pedidos_pct": round(var_pedidos_pct, 1)
        }
    }


@router.post("/meta-mensal")
def set_meta_mensal(
    payload: Dict[str, float],
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:administrar"))
):
    rest_id = require_tenant_id()
    meta_val = float(payload.get("meta_mensal", 0.0))
    if meta_val < 0:
        raise HTTPException(status_code=400, detail="A meta mensal deve ser maior ou igual a zero.")

    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == rest_id
    ).first()

    if not config:
        config = ConfiguracaoRestaurante(restaurante_id=rest_id, meta_mensal=meta_val)
        db.add(config)
    else:
        config.meta_mensal = meta_val

    db.commit()
    return {"status": "ok", "meta_mensal": meta_val}


@router.get("/vendas-detalhes")
def get_vendas_detalhes(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar"))
):
    rest_id = require_tenant_id()
    db_inicio, db_fim, _, _ = _report_period(data_inicio, data_fim)
    payments = _approved_payments(db, rest_id, db_inicio, db_fim)
    paid_orders = _orders_from_payments(payments)
    if not paid_orders:
        return []

    comandas = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.id.in_(paid_orders.keys()),
    ).all()

    # Pre-fetch garçons map
    users = db.query(Usuario).filter(Usuario.restaurante_id == rest_id).all()
    user_map = {u.id: u.nome for u in users}

    result = []
    for c in comandas:
        order = paid_orders[str(c.id)]
        operador = user_map.get(c.garcom_id, "Operador Caixa")
        methods = sorted(order["methods"])
        forma_pag = " + ".join(methods) if methods else "Não informado"
        result.append({
            "id": str(c.id),
            "data_hora": order["paid_at"].isoformat(),
            "numero_pedido": c.numero_pedido if hasattr(c, 'numero_pedido') and c.numero_pedido else (getattr(c, 'numero', str(c.id))),
            "valor_total": round(order["total"], 2),
            "forma_pagamento": forma_pag,
            "operador": operador,
            "status": "Concluído"
        })

    return sorted(result, key=lambda row: row["data_hora"], reverse=True)


@router.get("/produtos")
def get_relatorio_produtos(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    ordenacao: str = Query("mais_vendidos"),  # "mais_vendidos" | "menos_vendidos" | "todos"
    busca: Optional[str] = Query(None),
    categoria_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar"))
):
    rest_id = require_tenant_id()
    db_inicio, db_fim, _, _ = _report_period(data_inicio, data_fim)
    paid_orders = _orders_from_payments(_approved_payments(db, rest_id, db_inicio, db_fim))

    # All products of tenant
    prod_query = db.query(Produto).filter(Produto.restaurante_id == rest_id)
    if busca and busca.strip():
        prod_query = prod_query.filter(Produto.nome.ilike(f"%{busca.strip()}%"))
    if categoria_id:
        prod_query = prod_query.filter(Produto.categoria_id == str(categoria_id))

    produtos = prod_query.all()

    # Pre-fetch categories
    cats = db.query(Categoria).filter(Categoria.restaurante_id == rest_id).all()
    cat_map = {str(c.id): c.nome for c in cats}

    # Aggregate item sales from closed comandas in date range
    items = []
    if paid_orders:
        items = db.query(ComandaItem).filter(
            ComandaItem.restaurante_id == rest_id,
            ComandaItem.comanda_id.in_(paid_orders.keys()),
            ComandaItem.status != "cancelado",
        ).all()

    prod_sales: Dict[str, Dict[str, Any]] = {}
    for item in items:
        pid = str(item.produto_id) if item.produto_id else None
        if pid:
            if pid not in prod_sales:
                prod_sales[pid] = {"qtd": 0, "total": 0.0}
            p_unit = float(getattr(item, 'preco_unit', getattr(item, 'preco_unitario', 0.0)) or 0.0)
            prod_sales[pid]["qtd"] += int(getattr(item, "quantidade", 1) or 1)
            prod_sales[pid]["total"] += p_unit * int(getattr(item, "quantidade", 1) or 1)

    res_list = []
    for p in produtos:
        s_data = prod_sales.get(str(p.id), {"qtd": 0, "total": 0.0})
        qtd = s_data["qtd"]
        tot = s_data["total"]
        t_medio = tot / qtd if qtd > 0 else 0.0
        cat_nome = cat_map.get(str(p.categoria_id), "Sem Categoria")
        res_list.append({
            "produto_id": str(p.id),
            "produto_nome": p.nome,
            "categoria_nome": cat_nome,
            "quantidade_vendida": qtd,
            "faturamento_total": round(tot, 2),
            "ticket_medio_item": round(t_medio, 2)
        })

    # Sort
    if ordenacao == "menos_vendidos":
        res_list.sort(key=lambda x: (x["quantidade_vendida"], x["faturamento_total"]))
    else:  # "mais_vendidos" or "todos"
        res_list.sort(key=lambda x: (x["quantidade_vendida"], x["faturamento_total"]), reverse=True)

    # Assign ranking
    for idx, item in enumerate(res_list, start=1):
        item["ranking"] = idx

    return res_list


# Commercial/front-of-house roles for default performance ranking (Bistro plan — no delivery/motoboy)
COMMERCIAL_ROLES = {"garcom", "caixa", "atendente", "operador_caixa"}


@router.get("/equipe/desempenho")
def get_equipe_desempenho(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    cargo: Optional[str] = Query(None, description="Filter by role slug (garcom, caixa, atendente, gerente...). Empty = commercial roles only."),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar"))
):
    rest_id = require_tenant_id()
    db_inicio, db_fim, _, _ = _report_period(data_inicio, data_fim)
    paid_orders = _orders_from_payments(_approved_payments(db, rest_id, db_inicio, db_fim))
    paid_comandas = []
    if paid_orders:
        paid_comandas = db.query(Comanda).filter(
            Comanda.restaurante_id == rest_id,
            Comanda.id.in_(paid_orders.keys()),
        ).all()

    # Service tax config
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == rest_id
    ).first()
    taxa_ativa = config.taxa_servico_ativa if config else True
    taxa_pct = float(config.taxa_servico_padrao or 10.0) if config else 10.0

    # Get team members
    equipe_members = db.query(Usuario).filter(
        Usuario.restaurante_id == rest_id
    ).all()

    results = []
    for member in equipe_members:
        member_role = (member.role or "garcom").lower().strip()

        # Filter by cargo param if provided; otherwise restrict to commercial roles
        cargo_clean = (cargo or "").lower().strip()
        if cargo_clean == "todos":
            pass  # no filter — include all roles
        elif cargo_clean:
            # Specific role requested
            if member_role != cargo_clean:
                continue
        else:
            # Default (empty cargo): only show commercial / front-of-house roles
            if member_role not in COMMERCIAL_ROLES:
                continue

        comandas = [c for c in paid_comandas if c.garcom_id == str(member.id)]
        pedidos_atendidos = len(comandas)
        fat = sum(paid_orders[str(c.id)]["total"] for c in comandas)

        t_medio = fat / pedidos_atendidos if pedidos_atendidos > 0 else 0.0
        # Commission is PROPORTIONAL to the member's individual sales!
        comissao = (fat * (taxa_pct / 100.0)) if taxa_ativa else 0.0

        results.append({
            "id": str(member.id),
            "nome": member.nome,
            "email": member.email,
            "role": member_role,
            "pedidos_atendidos": pedidos_atendidos,
            "faturamento": round(fat, 2),
            "ticket_medio": round(t_medio, 2),
            "comissao": round(comissao, 2),
            "taxa_servico_usada": taxa_pct if taxa_ativa else 0.0
        })

    # Sort: primary by faturamento desc; employees with zero orders still show (sorted last)
    results.sort(key=lambda x: (x["faturamento"], x["pedidos_atendidos"]), reverse=True)

    return {
        "taxa_servico_ativa": taxa_ativa,
        "taxa_servico_padrao": taxa_pct,
        "membros": results
    }


# Static permission matrix for each cargo slug (Bistro plan: no motoboy)
CARGO_PERMISSIONS: Dict[str, Dict[str, Any]] = {
    "admin": {"label": "Administrador", "pedidos": True, "caixa": True, "relatorios": True, "equipe": True, "admin": True},
    "gerente": {"label": "Gerente", "pedidos": True, "caixa": True, "relatorios": True, "equipe": True, "admin": False},
    "caixa": {"label": "Operador Caixa", "pedidos": True, "caixa": True, "relatorios": True, "equipe": True, "admin": False},
    "operador_caixa": {"label": "Operador Caixa", "pedidos": True, "caixa": True, "relatorios": True, "equipe": True, "admin": False},
    "garcom": {"label": "Gar\u00e7om", "pedidos": True, "caixa": False, "relatorios": False, "equipe": False, "admin": False},
    "atendente": {"label": "Atendente", "pedidos": True, "caixa": False, "relatorios": False, "equipe": False, "admin": False},
    "cozinha": {"label": "Cozinha", "pedidos": False, "caixa": False, "relatorios": False, "equipe": False, "admin": False},
}


@router.get("/cargos-permissoes")
def get_cargos_permissoes(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar"))
):
    """Returns cargo permission matrix with real employee counts per role for this tenant."""
    rest_id = require_tenant_id()

    # Count employees per role (real DB data)
    membros = db.query(Usuario).filter(Usuario.restaurante_id == rest_id).all()
    counts_by_role: Dict[str, int] = {}
    for m in membros:
        role = (m.role or m.cargo or "garcom").lower().strip()
        counts_by_role[role] = counts_by_role.get(role, 0) + 1

    # Build result: only include roles that exist in this tenant OR are in the static matrix
    present_roles = set(counts_by_role.keys())
    all_roles = set(CARGO_PERMISSIONS.keys()) | present_roles

    cargos = []
    for role_key in ["admin", "gerente", "caixa", "operador_caixa", "garcom", "atendente", "cozinha"]:
        perm = CARGO_PERMISSIONS.get(role_key, {"label": role_key.capitalize(), "pedidos": False, "caixa": False, "relatorios": False, "equipe": False, "admin": False})
        total = counts_by_role.get(role_key, 0)
        if total > 0 or role_key in CARGO_PERMISSIONS:
            cargos.append({
                "slug": role_key,
                "label": perm["label"],
                "total_funcionarios": total,
                "permissoes": {
                    "pedidos": perm["pedidos"],
                    "caixa": perm["caixa"],
                    "relatorios": perm["relatorios"],
                    "equipe": perm["equipe"],
                    "admin": perm["admin"],
                }
            })

    # Also include any unknown roles actually present in the tenant
    for role_key, count in counts_by_role.items():
        if role_key not in CARGO_PERMISSIONS:
            cargos.append({
                "slug": role_key,
                "label": role_key.capitalize(),
                "total_funcionarios": count,
                "permissoes": {"pedidos": False, "caixa": False, "relatorios": False, "equipe": False, "admin": False}
            })

    return {"cargos": cargos}
