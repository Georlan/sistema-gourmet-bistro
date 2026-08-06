from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from pydantic import BaseModel
from decimal import Decimal, ROUND_HALF_UP
import logging

from ..database import get_db, require_tenant_id
from ..models import Comanda, Insumo, ConfigFidelizacao, HistoricoFidelidade, ActivityLog, Pagamento, Cliente
from ..schemas import InsumoResponse, ConfigFidelizacaoResponse, HistoricoFidelidadeResponse
from ..security import require_permission
from ..models import Usuario
from ..services.clientes import (
    buscar_cliente_por_id,
    buscar_cliente_por_telefone,
    cadastrar_ou_atualizar_cliente,
    cliente_payload,
    normalizar_nome_cliente,
    normalizar_telefone_cliente,
    registrar_movimento_fidelidade,
)
from ..websocket_manager import manager

logger = logging.getLogger("koma.optimization")

router = APIRouter(
    tags=["Otimizações, Estoque e Fidelidade"]
)

# ----------------- INVENTÓRIO E ESTOQUE -----------------

@router.get("/estoque/sugestoes")
def get_sugestoes_compra(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("estoque:consultar"))
):
    """
    Ponto de Ressuprimento (Estoque Mínimo).
    Query que identifica insumos abaixo do mínimo e sugere compras baseadas no estoque máximo desejado.
    """
    insumos = db.query(Insumo).filter(Insumo.estoque_atual <= Insumo.estoque_minimo).all()
    sugestoes = []
    for item in insumos:
        sugestoes.append({
            "id": item.id,
            "nome": item.nome,
            "estoque_atual": item.estoque_atual,
            "estoque_minimo": item.estoque_minimo,
            "estoque_maximo": item.estoque_maximo,
            "unidade_medida": item.unidade_medida,
            "quantidade_sugerida": max(0.0, item.estoque_maximo - item.estoque_atual)
        })
    return sugestoes


# ----------------- GRÁFICO DE HORÁRIOS DE PICO (SQL) -----------------

@router.get("/comandas/estatisticas/pico")
def get_pico_horarios(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar"))
):
    """
    Retorna os horários de pico de comandas do restaurante.
    """
    # Use SQLAlchemy expression language to be database-agnostic (works on both SQLite and PostgreSQL)
    from sqlalchemy import func, extract
    from ..models import Comanda

    # Extract day of week (0=Sunday to 6=Saturday) and hour of day
    # Note: SQLite and PostgreSQL differ slightly in exact representation,
    # but SQLAlchemy's extract handles the translation.
    query_obj = db.query(
        extract('dow', Comanda.fechado_em).label('dia_semana'),
        extract('hour', Comanda.fechado_em).label('hora'),
        func.count(Comanda.id).label('total_pedidos')
    ).filter(
        Comanda.fechada == True,
        Comanda.fechado_em.isnot(None)
    ).group_by(
        'dia_semana', 'hora'
    ).order_by(
        func.count(Comanda.id).desc()
    ).all()

    results = []
    dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"]
    for row in query_obj:
        # PostgreSQL extract('dow') returns float/numeric, SQLite returns int/string.
        # Cast to integer safely.
        dia_idx = int(row[0]) if row[0] is not None else 0
        hora_val = int(row[1]) if row[1] is not None else 0
        results.append({
            "dia_semana_label": dias[dia_idx % 7],
            "dia_semana": dia_idx % 7,
            "hora": f"{hora_val:02d}h",
            "total_pedidos": row[2]
        })
    return results

@router.get("/comandas/estatisticas/geral")
def get_estatisticas_geral(
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar"))
):
    """
    Retorna estatísticas consolidadas de vendas para o painel de BI (dashboard financeiro).
    """
    import datetime
    from ..database import current_restaurante_id, require_tenant_id
    from ..models import Pagamento, Comanda, Produto
    
    rest_id = require_tenant_id()
    
    def parse_date(date_str: Optional[str]):
        if not date_str:
            return None
        for fmt in ('%Y-%m-%d', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%d %H:%M:%S'):
            try:
                clean_str = date_str.replace('Z', '')
                if '.' in clean_str:
                    clean_str = clean_str.split('.')[0]
                return datetime.datetime.strptime(clean_str, fmt)
            except ValueError:
                continue
        try:
            return datetime.datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        except Exception:
            return None

    dt_inicio = parse_date(data_inicio)
    dt_fim = parse_date(data_fim)

    # 1. Total faturamento
    pags_query = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.status == "aprovado"
    )
    if dt_inicio:
        pags_query = pags_query.filter(Pagamento.criado_em >= dt_inicio)
    if dt_fim:
        pags_query = pags_query.filter(Pagamento.criado_em <= dt_fim)
        
    pags = pags_query.all()
    faturamento = sum(p.valor for p in pags)
    faturamento_dinheiro = sum(p.valor for p in pags if p.metodo == "dinheiro")
    faturamento_pix = sum(p.valor for p in pags if p.metodo == "pix")
    faturamento_cartao = sum(p.valor for p in pags if p.metodo in ["cartao", "cartao_debito", "cartao_credito"])

    # 1b. Faturamento de hoje
    import sqlalchemy as sa
    today_start = datetime.datetime.combine(datetime.date.today(), datetime.time.min)
    today_end = datetime.datetime.combine(datetime.date.today(), datetime.time.max)
    faturamento_hoje = db.query(sa.func.sum(Pagamento.valor)).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.status == "aprovado",
        Pagamento.criado_em >= today_start,
        Pagamento.criado_em <= today_end
    ).scalar() or 0.0
    
    from sqlalchemy.orm import joinedload
    from ..models import Item as ComandaItem

    # 2. Total de comandas fechadas (com eager loading joinedload para evitar N+1 no Sentry)
    comandas_query = db.query(Comanda).options(
        joinedload(Comanda.itens).joinedload(ComandaItem.produto)
    ).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.fechada == True
    )
    if dt_inicio:
        comandas_query = comandas_query.filter(Comanda.fechado_em >= dt_inicio)
    if dt_fim:
        comandas_query = comandas_query.filter(Comanda.fechado_em <= dt_fim)
        
    comandas = comandas_query.all()
    total_pedidos = len(comandas)
    
    # 3. Ticket médio
    ticket_medio = faturamento / total_pedidos if total_pedidos > 0 else 0.0
    
    # 4. Clientes únicos
    cpfs = set(p.cpf_cliente for p in pags if p.cpf_cliente)
    clientes_ativos = len(cpfs) if cpfs else total_pedidos
    
    # 5. Pedidos e entregas semanal
    dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"]
    chart_data = {dia: {"delivery": 0, "local": 0} for dia in dias}
    
    for c in comandas:
        if c.fechado_em:
            wday = c.fechado_em.strftime('%w')
            dia_label = dias[int(wday)]
            is_delivery = c.tipo == "Delivery"
            if is_delivery:
                chart_data[dia_label]["delivery"] += 1
            else:
                chart_data[dia_label]["local"] += 1
                
    weekly_chart = []
    for dia in dias:
        weekly_chart.append({
            "label": dia,
            "delivery": chart_data[dia]["delivery"],
            "local": chart_data[dia]["local"]
        })
        
    # 6. Qualidade do cardápio
    total_produtos = db.query(Produto).filter(Produto.restaurante_id == rest_id).count()
    if total_produtos > 0:
        produtos_otimizados = db.query(Produto).filter(
            Produto.restaurante_id == rest_id,
            Produto.descricao != "",
            Produto.descricao.isnot(None),
            Produto.imagem != "",
            Produto.imagem.isnot(None)
        ).count()
        qualidade_cardapio = int((produtos_otimizados / total_produtos) * 100)
    else:
        qualidade_cardapio = 100
        
    # 7. Pedidos por modalidade
    pedidos_modalidade = {"local": 0, "delivery": 0, "balcao": 0}
    for c in comandas:
        tipo = c.tipo or "Consumo no Local"
        if tipo == "Delivery":
            pedidos_modalidade["delivery"] += 1
        elif tipo == "Balcão":
            pedidos_modalidade["balcao"] += 1
        else:
            pedidos_modalidade["local"] += 1
            
    # 8. Top 5 Itens Mais Pedidos
    item_counts = {}
    for c in comandas:
        for item in c.itens:
            if item.status != "cancelado":
                prod_name = item.produto.nome if item.produto else f"Item {item.produto_id}"
                preco = item.preco_unit
                if prod_name not in item_counts:
                    item_counts[prod_name] = {"count": 0, "price": preco}
                item_counts[prod_name]["count"] += 1
                
    top_itens = []
    sorted_items = sorted(item_counts.items(), key=lambda x: x[1]["count"], reverse=True)[:5]
    for idx, (name, data) in enumerate(sorted_items):
        top_itens.append({
            "rank": f"{idx+1}º",
            "name": name,
            "count": data["count"],
            "price": round(data["price"], 2)
        })
        
    return {
        "faturamento": round(faturamento, 2),
        "faturamento_hoje": round(faturamento_hoje, 2),
        "ticket_medio": round(ticket_medio, 2),
        "total_pedidos": total_pedidos,
        "clientes_ativos": clientes_ativos,
        "weekly_chart": weekly_chart,
        "qualidade_cardapio": qualidade_cardapio,
        "pedidos_modalidade": pedidos_modalidade,
        "top_itens": top_itens,
        "breakdown_pagamentos": {
            "dinheiro": round(faturamento_dinheiro, 2),
            "pix": round(faturamento_pix, 2),
            "cartao": round(faturamento_cartao, 2)
        }
    }


# ----------------- PROGRAMA DE FIDELIDADE UNIFICADO -----------------

class ConfigFidelizacaoCreate(BaseModel):
    ativo: bool
    tipo_recompensa: str  # "PONTOS" | "CASHBACK"
    taxa_conversao: float
    valor_ponto_em_dinheiro: float

class CheckoutFidelidadeRequest(BaseModel):
    cliente_id: Optional[str] = None
    cliente_telefone: Optional[str] = None
    valor_total: float
    resgatar: bool = False
    pontos_a_resgatar: Optional[float] = 0.0

@router.get("/fidelidade/config", response_model=ConfigFidelizacaoResponse)
def get_fidelidade_config(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:operar"))
):
    """Retorna as configurações do programa de fidelidade do restaurante."""
    restaurante_id = require_tenant_id()
    config = db.query(ConfigFidelizacao).filter(
        ConfigFidelizacao.restaurante_id == restaurante_id
    ).first()
    if not config:
        config = ConfigFidelizacao(
            restaurante_id=restaurante_id,
            ativo=True,
            tipo_recompensa="PONTOS",
            taxa_conversao=1.0,
            valor_ponto_em_dinheiro=0.05,
        )
        db.add(config)
        db.commit()
        db.refresh(config)
    return config

@router.get("/fidelidade/clientes")
def get_loyalty_clients(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:operar"))
):
    """Retorna a ficha canônica; o ID não muda quando nome/telefone mudam."""
    restaurante_id = require_tenant_id()
    clientes = db.query(Cliente).filter(
        Cliente.restaurante_id == restaurante_id,
    ).order_by(Cliente.criado_em.desc(), Cliente.id.asc()).all()
    return [cliente_payload(cliente) for cliente in clientes]


@router.get("/fidelidade/clientes/lookup")
def lookup_loyalty_client(
    telefone: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:operar")),
):
    restaurante_id = require_tenant_id()
    try:
        cliente = buscar_cliente_por_telefone(
            db,
            restaurante_id=restaurante_id,
            telefone=telefone,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if cliente is None:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    return cliente_payload(cliente)

@router.post("/fidelidade/config", response_model=ConfigFidelizacaoResponse)
def update_fidelidade_config(
    config_in: ConfigFidelizacaoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:administrar"))
):
    """Atualiza as configurações do programa de fidelidade."""
    restaurante_id = require_tenant_id()
    config = db.query(ConfigFidelizacao).filter(
        ConfigFidelizacao.restaurante_id == restaurante_id
    ).first()
    if not config:
        config = ConfigFidelizacao(restaurante_id=restaurante_id)
        db.add(config)
    
    config.ativo = config_in.ativo
    config.tipo_recompensa = config_in.tipo_recompensa
    config.taxa_conversao = config_in.taxa_conversao
    config.valor_ponto_em_dinheiro = config_in.valor_ponto_em_dinheiro
    
    db.commit()
    db.refresh(config)
    return config

@router.post("/fidelidade/checkout")
def checkout_fidelidade(
    req: CheckoutFidelidadeRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:operar"))
):
    """
    Unifica a aplicação de pontos e cashback no checkout.
    Se tipo_recompensa for PONTOS: calcula a pontuação (R$ 1 = X pontos) ou aplica resgate.
    Se for CASHBACK: acumula cashback (X% do total) ou deduz do saldo do cliente.
    """
    restaurante_id = require_tenant_id()
    config = db.query(ConfigFidelizacao).filter(
        ConfigFidelizacao.restaurante_id == restaurante_id
    ).first()
    if not config or not config.ativo:
        raise HTTPException(status_code=400, detail="Programa de fidelidade inativo.")

    cliente = None
    if req.cliente_id:
        cliente = buscar_cliente_por_id(
            db,
            restaurante_id=restaurante_id,
            cliente_id=req.cliente_id,
            bloquear=True,
        )
    elif req.cliente_telefone:
        try:
            cliente = buscar_cliente_por_telefone(
                db,
                restaurante_id=restaurante_id,
                telefone=req.cliente_telefone,
                bloquear=True,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    if cliente is None:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    recompensa = config.tipo_recompensa.upper()
    saldo_atual = (
        Decimal(int(cliente.saldo_pontos or 0))
        if recompensa == "PONTOS"
        else Decimal(str(cliente.saldo_cashback or 0))
    )
    valor_total = Decimal(str(req.valor_total)).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )
    if valor_total <= 0:
        raise HTTPException(status_code=422, detail="Valor total deve ser positivo.")

    desconto_aplicado = Decimal("0.00")
    valor_final = valor_total
    acumulado = Decimal("0")
    try:
        if req.resgatar:
            if recompensa == "PONTOS":
                pontos_necessarios = Decimal(str(req.pontos_a_resgatar or 0))
                if pontos_necessarios > saldo_atual:
                    raise HTTPException(status_code=400, detail="Pontos insuficientes.")
                desconto_aplicado = (
                    pontos_necessarios
                    * Decimal(str(config.valor_ponto_em_dinheiro))
                ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                valor_final = max(Decimal("0.00"), valor_total - desconto_aplicado)
                registrar_movimento_fidelidade(
                    db,
                    cliente=cliente,
                    tipo_movimentacao="RESGATE",
                    valor_delta=pontos_necessarios,
                    tipo_recompensa=recompensa,
                )
            else:
                cashback_resgate = min(saldo_atual, valor_total)
                desconto_aplicado = cashback_resgate
                valor_final = max(Decimal("0.00"), valor_total - cashback_resgate)
                if cashback_resgate > 0:
                    registrar_movimento_fidelidade(
                        db,
                        cliente=cliente,
                        tipo_movimentacao="RESGATE",
                        valor_delta=cashback_resgate,
                        tipo_recompensa=recompensa,
                    )

        if valor_final > 0:
            if recompensa == "PONTOS":
                acumulado = Decimal(str(config.taxa_conversao)) * valor_final
            else:
                acumulado = (
                    valor_final
                    * Decimal(str(config.taxa_conversao))
                    / Decimal("100")
                ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if acumulado > 0:
                registrar_movimento_fidelidade(
                    db,
                    cliente=cliente,
                    tipo_movimentacao="ACUMULO",
                    valor_delta=acumulado,
                    tipo_recompensa=recompensa,
                )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception("Falha ao processar dado sensível criptografado")
        raise HTTPException(
            status_code=500,
            detail="Erro ao processar dado sensível, contate o suporte."
        )
    
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "customers_updated",
            "detail": {"action": "loyalty", "cliente_id": cliente.id},
        },
        restaurante_id,
        target_audience="internal",
    )
    saldo_final = (
        int(cliente.saldo_pontos or 0)
        if recompensa == "PONTOS"
        else float(cliente.saldo_cashback or 0)
    )
    return {
        "status": "success",
        "cliente_id": cliente.id,
        "tipo_recompensa": recompensa,
        "desconto_aplicado": float(desconto_aplicado),
        "valor_final": float(valor_final),
        "acumulado_nesta_compra": float(acumulado),
        "saldo_atual": saldo_final,
    }


@router.get("/garcons/relatorio")
def get_garcons_relatorio(
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar"))
):
    """
    Retorna o relatório simplificado de desempenho dos garçons.
    Calcula o total de pedidos atendidos e a comissão acumulada (10% de serviço).
    """
    import datetime
    from ..database import current_restaurante_id, require_tenant_id
    from ..models import Comanda
    
    rest_id = require_tenant_id()
    
    def parse_date(date_str: Optional[str]):
        if not date_str:
            return None
        for fmt in ('%Y-%m-%d', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%d %H:%M:%S'):
            try:
                clean_str = date_str.replace('Z', '')
                if '.' in clean_str:
                    clean_str = clean_str.split('.')[0]
                return datetime.datetime.strptime(clean_str, fmt)
            except ValueError:
                continue
        try:
            return datetime.datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        except Exception:
            return None

    dt_inicio = parse_date(data_inicio)
    dt_fim = parse_date(data_fim)

    garcons = db.query(Usuario).filter(
        Usuario.restaurante_id == rest_id,
        Usuario.role == "garcom"
    ).all()
    
    results = []
    for g in garcons:
        # Get all closed comandas
        comandas_query = db.query(Comanda).filter(
            Comanda.restaurante_id == rest_id,
            Comanda.garcom_id == g.id,
            Comanda.fechada == True
        )
        if dt_inicio:
            comandas_query = comandas_query.filter(Comanda.fechado_em >= dt_inicio)
        if dt_fim:
            comandas_query = comandas_query.filter(Comanda.fechado_em <= dt_fim)
            
        comandas = comandas_query.all()
        pedidos_atendidos = len(comandas)
        comissao_acumulada = 0.0
        
        for c in comandas:
            comanda_total = 0.0
            for item in c.itens:
                if item.status != "cancelado":
                    item_total = item.preco_unit
                    # Sum modifiers
                    modifiers_sum = db.execute(text(
                        "SELECT SUM(preco_aplicado) FROM item_modificadores WHERE item_id = :item_id"
                    ), {"item_id": item.id}).scalar() or 0.0
                    item_total += modifiers_sum
                    comanda_total += item_total
            
            # Service charge is 10% of total
            comissao_acumulada += comanda_total * 0.10
            
        results.append({
            "nome_garcon": g.nome,
            "pedidos_atendidos": pedidos_atendidos,
            "comissao_acumulada": round(comissao_acumulada, 2)
        })
        
    return results


class ClientUpdate(BaseModel):
    cliente: str
    telefone: str
    saldo_pontos: Optional[int] = None
    saldo_cashback: Optional[float] = None

@router.put("/fidelidade/clientes/{cliente_id}")
def update_loyalty_client(
    cliente_id: str,
    data: ClientUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:operar"))
):
    """
    Edita a ficha pelo ID estável. Telefone é um identificador natural
    tenant-scoped, nunca a chave estrangeira de pedidos ou pontos.
    """
    restaurante_id = require_tenant_id()
    try:
        nome_novo = normalizar_nome_cliente(data.cliente)
        telefone_novo = normalizar_telefone_cliente(data.telefone)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    cliente_db = buscar_cliente_por_id(
        db,
        restaurante_id=restaurante_id,
        cliente_id=cliente_id,
        bloquear=True,
    )
    if cliente_db is None:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    conflito = buscar_cliente_por_telefone(
        db,
        restaurante_id=restaurante_id,
        telefone=telefone_novo,
    )
    if conflito and conflito.id != cliente_db.id:
        raise HTTPException(status_code=400, detail="Cliente com este telefone já cadastrado.")

    cliente_db.nome = nome_novo
    cliente_db.telefone = telefone_novo

    try:
        # Campos legados são snapshots; relações permanecem em cliente_id.
        pagamentos = db.query(Pagamento).filter(
            Pagamento.restaurante_id == restaurante_id,
            Pagamento.cliente_id == cliente_db.id,
        ).all()
        for p in pagamentos:
            p.cpf_cliente = telefone_novo
            p.nome_cliente = nome_novo

        config = db.query(ConfigFidelizacao).filter(
            ConfigFidelizacao.restaurante_id == restaurante_id,
        ).first()
        recompensa = (
            config.tipo_recompensa.upper()
            if config is not None
            else "PONTOS"
        )
        saldo_desejado = (
            Decimal(data.saldo_pontos)
            if recompensa == "PONTOS" and data.saldo_pontos is not None
            else Decimal(str(data.saldo_cashback))
            if recompensa == "CASHBACK" and data.saldo_cashback is not None
            else None
        )
        saldo_atual = (
            Decimal(int(cliente_db.saldo_pontos or 0))
            if recompensa == "PONTOS"
            else Decimal(str(cliente_db.saldo_cashback or 0))
        )
        if saldo_desejado is not None:
            if saldo_desejado < 0:
                raise HTTPException(status_code=422, detail="Saldo não pode ser negativo.")
            diferenca = saldo_desejado - saldo_atual
            if diferenca != 0:
                registrar_movimento_fidelidade(
                    db,
                    cliente=cliente_db,
                    tipo_movimentacao="ACUMULO" if diferenca > 0 else "RESGATE",
                    valor_delta=abs(diferenca),
                    tipo_recompensa=recompensa,
                )

        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Cliente com este telefone já cadastrado.",
        ) from exc
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception("Falha ao processar dado sensível criptografado")
        raise HTTPException(
            status_code=500,
            detail="Erro ao processar dado sensível, contate o suporte."
        )
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "customers_updated",
            "detail": {"action": "updated", "cliente_id": cliente_db.id},
        },
        restaurante_id,
        target_audience="internal",
    )
    return cliente_payload(cliente_db)


class ClientCreate(BaseModel):
    cliente: str
    telefone: str
    saldo_pontos: Optional[int] = 0
    saldo_cashback: Optional[float] = 0.0

@router.post("/fidelidade/clientes", status_code=201)
def create_loyalty_client(
    data: ClientCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:operar"))
):
    """
    Cadastra manualmente um novo cliente e lança o saldo inicial se fornecido.
    """
    restaurante_id = require_tenant_id()
    try:
        tel_limpo = normalizar_telefone_cliente(data.telefone)
        nome_limpo = normalizar_nome_cliente(data.cliente)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    cliente_existente = db.query(Cliente).filter(
        Cliente.restaurante_id == restaurante_id,
        Cliente.telefone == tel_limpo,
    ).first()
    if cliente_existente:
        raise HTTPException(status_code=400, detail="Cliente com este telefone já cadastrado.")
        
    try:
        new_c = cadastrar_ou_atualizar_cliente(
            db,
            restaurante_id=restaurante_id,
            telefone=tel_limpo,
            nome=nome_limpo,
        )
        config = db.query(ConfigFidelizacao).filter(
            ConfigFidelizacao.restaurante_id == restaurante_id,
        ).first()
        recompensa = (
            config.tipo_recompensa.upper()
            if config is not None
            else "PONTOS"
        )
        saldo_inicial = (
            Decimal(data.saldo_pontos or 0)
            if recompensa == "PONTOS"
            else Decimal(str(data.saldo_cashback or 0))
        )
        if saldo_inicial < 0:
            raise HTTPException(status_code=422, detail="Saldo inicial não pode ser negativo.")
        if saldo_inicial > 0:
            registrar_movimento_fidelidade(
                db,
                cliente=new_c,
                tipo_movimentacao="ACUMULO",
                valor_delta=saldo_inicial,
                tipo_recompensa=recompensa,
            )

        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Cliente com este telefone já cadastrado.",
        ) from exc
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        try:
            if 'new_c' in locals() and new_c and getattr(new_c, 'id', None):
                db.query(Cliente).filter(Cliente.id == new_c.id).delete()
                db.commit()
        except Exception:
            db.rollback()
        logger.exception("Falha ao processar dado sensível criptografado")
        raise HTTPException(
            status_code=500,
            detail="Erro ao processar dado sensível, contate o suporte."
        )

    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "customers_updated",
            "detail": {"action": "created", "cliente_id": new_c.id},
        },
        restaurante_id,
        target_audience="internal",
    )
    return cliente_payload(new_c)
