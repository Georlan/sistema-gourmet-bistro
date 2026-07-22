import datetime
import calendar
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, and_

from ..database import get_db, require_tenant_id
from ..models import (
    Usuario, Comanda, Item as ComandaItem, Produto, Categoria,
    ConfiguracaoRestaurante, Pagamento, Restaurante
)
from ..security import get_current_user

router = APIRouter(prefix="/relatorios", tags=["relatorios"])


def parse_date(date_str: Optional[str]):
    if not date_str:
        return None
    clean_str = date_str.replace('Z', '')
    if '.' in clean_str:
        clean_str = clean_str.split('.')[0]
    for fmt in ('%Y-%m-%d', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.datetime.strptime(clean_str, fmt)
        except ValueError:
            continue
    try:
        return datetime.datetime.fromisoformat(date_str.replace('Z', '+00:00'))
    except Exception:
        return None


@router.get("/visao-geral")
def get_relatorio_visao_geral(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    rest_id = require_tenant_id()

    # Parse date range or default to last 30 days
    dt_fim = parse_date(data_fim) or datetime.datetime.now()
    dt_inicio = parse_date(data_inicio) or (dt_fim - datetime.timedelta(days=30))

    # Duration of selected window in days
    period_days = max(1, (dt_fim - dt_inicio).days + 1)
    prev_inicio = dt_inicio - datetime.timedelta(days=period_days)
    prev_fim = dt_inicio - datetime.timedelta(seconds=1)

    # 1. Main period closed comandas
    comandas_curr = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.fechada == True,
        Comanda.fechado_em >= dt_inicio,
        Comanda.fechado_em <= dt_fim
    ).all()

    total_pedidos = len(comandas_curr)
    faturamento_total = 0.0
    for c in comandas_curr:
        for item in c.itens:
            if item.status != "cancelado":
                p_unit = float(getattr(item, 'preco_unit', getattr(item, 'preco_unitario', 0.0)) or 0.0)
                faturamento_total += p_unit * int(item.quantidade or 1)

    ticket_medio = faturamento_total / total_pedidos if total_pedidos > 0 else 0.0

    # 2. Previous period closed comandas for comparison
    comandas_prev = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.fechada == True,
        Comanda.fechado_em >= prev_inicio,
        Comanda.fechado_em <= prev_fim
    ).all()

    pedidos_prev = len(comandas_prev)
    fat_prev = 0.0
    for c in comandas_prev:
        for item in c.itens:
            if item.status != "cancelado":
                p_unit = float(getattr(item, 'preco_unit', getattr(item, 'preco_unitario', 0.0)) or 0.0)
                fat_prev += p_unit * int(item.quantidade or 1)

    var_fat_pct = ((faturamento_total - fat_prev) / fat_prev * 100.0) if fat_prev > 0 else 0.0
    var_pedidos_pct = ((total_pedidos - pedidos_prev) / pedidos_prev * 100.0) if pedidos_prev > 0 else 0.0

    # 3. Monthly Goal (Meta Mensal)
    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == rest_id
    ).first()
    meta_mensal = float(config.meta_mensal or 0.0) if config else 0.0

    now = datetime.datetime.now()
    month_start = datetime.datetime(now.year, now.month, 1, 0, 0, 0)
    month_days = calendar.monthrange(now.year, now.month)[1]
    day_of_month = now.day

    comandas_mes = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.fechada == True,
        Comanda.fechado_em >= month_start
    ).all()

    meta_realizada = 0.0
    for c in comandas_mes:
        for item in c.itens:
            if item.status != "cancelado":
                p_unit = float(getattr(item, 'preco_unit', getattr(item, 'preco_unitario', 0.0)) or 0.0)
                meta_realizada += p_unit * int(item.quantidade or 1)

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

    # 5. Sales by day (Plano Bistrô: "Pedidos por dia", strictly no delivery)
    vendas_diarias_map: Dict[str, Dict[str, Any]] = {}
    cur_date = dt_inicio.date()
    end_date = dt_fim.date()

    while cur_date <= end_date:
        d_str = cur_date.strftime("%Y-%m-%d")
        vendas_diarias_map[d_str] = {"data": d_str, "total": 0.0, "quantidade_pedidos": 0}
        cur_date += datetime.timedelta(days=1)

    for c in comandas_curr:
        if c.fechado_em:
            d_str = c.fechado_em.strftime("%Y-%m-%d")
            if d_str in vendas_diarias_map:
                vendas_diarias_map[d_str]["quantidade_pedidos"] += 1
                c_fat = sum(float(getattr(i, 'preco_unit', getattr(i, 'preco_unitario', 0.0)) or 0.0) * int(i.quantidade or 1) for i in c.itens if i.status != "cancelado")
                vendas_diarias_map[d_str]["total"] += c_fat

    vendas_por_dia = sorted(list(vendas_diarias_map.values()), key=lambda x: x["data"])

    # 6. Peak hours (Horários de pico: 00h to 23h)
    pico_map = {h: {"hora": f"{h:02d}h", "total_pedidos": 0, "faturamento": 0.0} for h in range(24)}
    for c in comandas_curr:
        if c.fechado_em:
            h = c.fechado_em.hour
            pico_map[h]["total_pedidos"] += 1
            c_fat = sum(float(getattr(i, 'preco_unit', getattr(i, 'preco_unitario', 0.0)) or 0.0) * int(i.quantidade or 1) for i in c.itens if i.status != "cancelado")
            pico_map[h]["faturamento"] += c_fat

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
    current_user: Usuario = Depends(get_current_user)
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
    current_user: Usuario = Depends(get_current_user)
):
    rest_id = require_tenant_id()
    dt_fim = parse_date(data_fim) or datetime.datetime.now()
    dt_inicio = parse_date(data_inicio) or (dt_fim - datetime.timedelta(days=30))

    comandas = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.fechada == True,
        Comanda.fechado_em >= dt_inicio,
        Comanda.fechado_em <= dt_fim
    ).order_by(Comanda.fechado_em.desc()).all()

    # Pre-fetch garçons map
    users = db.query(Usuario).filter(Usuario.restaurante_id == rest_id).all()
    user_map = {u.id: u.nome for u in users}

    # Pre-fetch payments map
    payments = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.status == "aprovado"
    ).all()
    comanda_payment_map: Dict[str, str] = {}
    for p in payments:
        if p.comanda_id and p.metodo:
            comanda_payment_map[str(p.comanda_id)] = p.metodo

    result = []
    for c in comandas:
        c_fat = sum(float(getattr(i, 'preco_unit', getattr(i, 'preco_unitario', 0.0)) or 0.0) * int(i.quantidade or 1) for i in c.itens if i.status != "cancelado")
        operador = user_map.get(c.garcom_id, "Operador Caixa")
        forma_pag = comanda_payment_map.get(str(c.id), "Dinheiro / Cartão")
        result.append({
            "id": str(c.id),
            "data_hora": c.fechado_em.isoformat() if c.fechado_em else c.criado_em.isoformat(),
            "numero_pedido": c.numero_pedido if hasattr(c, 'numero_pedido') and c.numero_pedido else (getattr(c, 'numero', str(c.id))),
            "valor_total": round(c_fat, 2),
            "forma_pagamento": forma_pag,
            "operador": operador,
            "status": "Concluído"
        })

    return result


@router.get("/produtos")
def get_relatorio_produtos(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    ordenacao: str = Query("mais_vendidos"),  # "mais_vendidos" | "menos_vendidos" | "todos"
    busca: Optional[str] = Query(None),
    categoria_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    rest_id = require_tenant_id()
    dt_fim = parse_date(data_fim) or datetime.datetime.now()
    dt_inicio = parse_date(data_inicio) or (dt_fim - datetime.timedelta(days=30))

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
    items = db.query(ComandaItem).join(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.fechada == True,
        Comanda.fechado_em >= dt_inicio,
        Comanda.fechado_em <= dt_fim,
        ComandaItem.status != "cancelado"
    ).all()

    prod_sales: Dict[str, Dict[str, Any]] = {}
    for item in items:
        pid = str(item.produto_id) if item.produto_id else None
        if pid:
            if pid not in prod_sales:
                prod_sales[pid] = {"qtd": 0, "total": 0.0}
            p_unit = float(getattr(item, 'preco_unit', getattr(item, 'preco_unitario', 0.0)) or 0.0)
            prod_sales[pid]["qtd"] += int(item.quantidade or 1)
            prod_sales[pid]["total"] += p_unit * int(item.quantidade or 1)

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


@router.get("/equipe/desempenho")
def get_equipe_desempenho(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    rest_id = require_tenant_id()
    dt_fim = parse_date(data_fim) or datetime.datetime.now()
    dt_inicio = parse_date(data_inicio) or (dt_fim - datetime.timedelta(days=30))

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
        # Closed comandas for this member as garçom
        comandas = db.query(Comanda).filter(
            Comanda.restaurante_id == rest_id,
            Comanda.garcom_id == str(member.id),
            Comanda.fechada == True,
            Comanda.fechado_em >= dt_inicio,
            Comanda.fechado_em <= dt_fim
        ).all()

        pedidos_atendidos = len(comandas)
        fat = 0.0
        for c in comandas:
            for item in c.itens:
                if item.status != "cancelado":
                    p_unit = float(getattr(item, 'preco_unit', getattr(item, 'preco_unitario', 0.0)) or 0.0)
                    fat += p_unit * int(item.quantidade or 1)

        t_medio = fat / pedidos_atendidos if pedidos_atendidos > 0 else 0.0
        # Commission is PROPORTIONAL to the waiter's individual sales!
        comissao = (fat * (taxa_pct / 100.0)) if taxa_ativa else 0.0

        results.append({
            "id": str(member.id),
            "nome": member.nome,
            "email": member.email,
            "role": member.role or "garcom",
            "pedidos_atendidos": pedidos_atendidos,
            "faturamento": round(fat, 2),
            "ticket_medio": round(t_medio, 2),
            "comissao": round(comissao, 2),
            "taxa_servico_usada": taxa_pct if taxa_ativa else 0.0
        })

    # Sort team members by sales descending
    results.sort(key=lambda x: x["faturamento"], reverse=True)

    return {
        "taxa_servico_ativa": taxa_ativa,
        "taxa_servico_padrao": taxa_pct,
        "membros": results
    }
