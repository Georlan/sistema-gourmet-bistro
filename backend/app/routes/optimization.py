from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from pydantic import BaseModel

from ..database import get_db
from ..models import Comanda, Insumo, ConfigFidelizacao, HistoricoFidelidade, ActivityLog
from ..schemas import InsumoResponse, ConfigFidelizacaoResponse, HistoricoFidelidadeResponse
from ..security import get_current_garcom_optional
from ..models import Usuario

router = APIRouter(
    tags=["Otimizações, Estoque e Fidelidade"]
)

# ----------------- INVENTÓRIO E ESTOQUE -----------------

class InsumoCreate(BaseModel):
    id: str
    nome: str
    estoque_atual: float
    estoque_minimo: float
    estoque_maximo: float
    unidade_medida: str
    preco_medio_custo: float

@router.get("/estoque/insumos", response_model=List[InsumoResponse])
def get_insumos(db: Session = Depends(get_db)):
    """Retorna todos os insumos cadastrados no estoque."""
    return db.query(Insumo).all()

@router.post("/estoque/insumos", response_model=InsumoResponse)
def save_insumo(insumo_in: InsumoCreate, db: Session = Depends(get_db)):
    """Cria ou atualiza um insumo no estoque."""
    insumo = db.query(Insumo).filter(Insumo.id == insumo_in.id).first()
    if not insumo:
        insumo = Insumo(id=insumo_in.id)
        db.add(insumo)
    
    insumo.nome = insumo_in.nome
    insumo.estoque_atual = insumo_in.estoque_atual
    insumo.estoque_minimo = insumo_in.estoque_minimo
    insumo.estoque_maximo = insumo_in.estoque_maximo
    insumo.unidade_medida = insumo_in.unidade_medida
    insumo.preco_medio_custo = insumo_in.preco_medio_custo
    
    db.commit()
    db.refresh(insumo)
    return insumo

@router.get("/estoque/sugestoes")
def get_sugestoes_compra(db: Session = Depends(get_db)):
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
def get_pico_horarios(db: Session = Depends(get_db)):
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
def get_estatisticas_geral(db: Session = Depends(get_db)):
    """
    Retorna estatísticas consolidadas de vendas para o painel de BI (dashboard financeiro).
    """
    # 1. Total faturamento
    from ..models import Pagamento
    pags = db.query(Pagamento).filter(Pagamento.status == "aprovado").all()
    faturamento = sum(p.valor for p in pags)
    
    # 2. Total de comandas fechadas
    total_pedidos = db.query(Comanda).filter(Comanda.fechada == True).count()
    
    # 3. Ticket médio
    ticket_medio = faturamento / total_pedidos if total_pedidos > 0 else 0.0
    
    # 4. Clientes únicos
    cpfs = db.query(Pagamento.cpf_cliente).filter(Pagamento.cpf_cliente.isnot(None), Pagamento.status == "aprovado").distinct().all()
    clientes_ativos = len(cpfs) if cpfs else total_pedidos
    
    # 5. Pedidos e entregas semanal
    import datetime
    dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"]
    chart_data = {dia: {"delivery": 0, "local": 0} for dia in dias}
    
    comandas_fechadas = db.query(Comanda).filter(Comanda.fechada == True, Comanda.fechado_em.isnot(None)).all()
    for c in comandas_fechadas:
        wday = c.fechado_em.strftime('%w')
        dia_label = dias[int(wday)]
        is_delivery = c.mesa_id is None or c.mesa_id <= 0
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
        
    return {
        "faturamento": round(faturamento, 2),
        "ticket_medio": round(ticket_medio, 2),
        "total_pedidos": total_pedidos,
        "clientes_ativos": clientes_ativos,
        "weekly_chart": weekly_chart
    }


# ----------------- PROGRAMA DE FIDELIDADE UNIFICADO -----------------

class ConfigFidelizacaoCreate(BaseModel):
    ativo: bool
    tipo_recompensa: str  # "PONTOS" | "CASHBACK"
    taxa_conversao: float
    valor_ponto_em_dinheiro: float

class CheckoutFidelidadeRequest(BaseModel):
    cliente_telefone: str
    valor_total: float
    resgatar: bool = False
    pontos_a_resgatar: Optional[float] = 0.0

@router.get("/fidelidade/config", response_model=ConfigFidelizacaoResponse)
def get_fidelidade_config(db: Session = Depends(get_db)):
    """Retorna as configurações do programa de fidelidade do restaurante."""
    config = db.query(ConfigFidelizacao).first()
    if not config:
        config = ConfigFidelizacao(ativo=True, tipo_recompensa="PONTOS", taxa_conversao=1.0, valor_ponto_em_dinheiro=0.05)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config

@router.get("/fidelidade/clientes")
def get_loyalty_clients(db: Session = Depends(get_db)):
    """
    Retorna a lista de saldos reais de fidelidade agregados por cliente a partir do histórico.
    """
    historico = db.query(HistoricoFidelidade).all()
    saldos = {}
    for h in historico:
        tel = h.cliente_telefone.strip()
        if tel not in saldos:
            saldos[tel] = {"pontos": 0.0, "cashback": 0.0}
        if h.tipo_movimentacao == "ACUMULO":
            saldos[tel]["pontos"] += h.valor_delta
            saldos[tel]["cashback"] += h.valor_delta
        else:
            saldos[tel]["pontos"] -= h.valor_delta
            saldos[tel]["cashback"] -= h.valor_delta
            
    result = []
    # Search for customer name from past Pagamentos
    from ..models import Pagamento
    for idx, (tel, balance) in enumerate(saldos.items()):
        p_name = None
        # Try finding a name associated with this CPF/phone in pagamentos
        pag = db.query(Pagamento).filter(Pagamento.cpf_cliente == tel).first()
        if pag and pag.nome_cliente:
            p_name = pag.nome_cliente
        else:
            # Fallback to general name format
            p_name = f"Cliente {tel[-4:] if len(tel) >= 4 else tel}"
            
        result.append({
            "id": idx + 1,
            "cliente": p_name,
            "telefone": tel,
            "pontos": max(0, int(balance["pontos"])),
            "saldoCashback": max(0.0, balance["cashback"])
        })
    return result

@router.post("/fidelidade/config", response_model=ConfigFidelizacaoResponse)
def update_fidelidade_config(config_in: ConfigFidelizacaoCreate, db: Session = Depends(get_db)):
    """Atualiza as configurações do programa de fidelidade."""
    config = db.query(ConfigFidelizacao).first()
    if not config:
        config = ConfigFidelizacao()
        db.add(config)
    
    config.ativo = config_in.ativo
    config.tipo_recompensa = config_in.tipo_recompensa
    config.taxa_conversao = config_in.taxa_conversao
    config.valor_ponto_em_dinheiro = config_in.valor_ponto_em_dinheiro
    
    db.commit()
    db.refresh(config)
    return config

@router.post("/fidelidade/checkout")
def checkout_fidelidade(req: CheckoutFidelidadeRequest, db: Session = Depends(get_db)):
    """
    Unifica a aplicação de pontos e cashback no checkout.
    Se tipo_recompensa for PONTOS: calcula a pontuação (R$ 1 = X pontos) ou aplica resgate.
    Se for CASHBACK: acumula cashback (X% do total) ou deduz do saldo do cliente.
    """
    config = db.query(ConfigFidelizacao).first()
    if not config or not config.ativo:
        raise HTTPException(status_code=400, detail="Programa de fidelidade inativo.")
        
    telefone = req.cliente_telefone.strip()
    
    # Calcular saldo atual do cliente
    historico = db.query(HistoricoFidelidade).all()
    saldo_atual = 0.0
    for h in historico:
        if h.cliente_telefone == telefone:
            if h.tipo_movimentacao == "ACUMULO":
                saldo_atual += h.valor_delta
            else:
                saldo_atual -= h.valor_delta
                
    desconto_aplicado = 0.0
    valor_final = req.valor_total
    
    if req.resgatar:
        if config.tipo_recompensa == "PONTOS":
            pontos_necessarios = req.pontos_a_resgatar or 0.0
            if pontos_necessarios > saldo_atual:
                raise HTTPException(status_code=400, detail="Pontos insuficientes.")
            desconto_aplicado = pontos_necessarios * config.valor_ponto_em_dinheiro
            valor_final = max(0.0, req.valor_total - desconto_aplicado)
            
            # Registrar resgate
            mov = HistoricoFidelidade(
                cliente_telefone=telefone,
                tipo_movimentacao="RESGATE",
                valor_delta=pontos_necessarios
            )
            db.add(mov)
        else: # CASHBACK
            cashback_resgate = min(saldo_atual, req.valor_total)
            desconto_aplicado = cashback_resgate
            valor_final = max(0.0, req.valor_total - cashback_resgate)
            
            # Registrar resgate
            mov = HistoricoFidelidade(
                cliente_telefone=telefone,
                tipo_movimentacao="RESGATE",
                valor_delta=cashback_resgate
            )
            db.add(mov)
            
    # Registrar acúmulo da nova compra (calculado sobre o valor final pago)
    if valor_final > 0:
        if config.tipo_recompensa == "PONTOS":
            pontos_gerados = valor_final * config.taxa_conversao
            mov_acumulo = HistoricoFidelidade(
                cliente_telefone=telefone,
                tipo_movimentacao="ACUMULO",
                valor_delta=pontos_gerados
            )
            db.add(mov_acumulo)
            ret_delta = pontos_gerados
        else: # CASHBACK
            cashback_gerado = valor_final * (config.taxa_conversao / 100.0)
            mov_acumulo = HistoricoFidelidade(
                cliente_telefone=telefone,
                tipo_movimentacao="ACUMULO",
                valor_delta=cashback_gerado
            )
            db.add(mov_acumulo)
            ret_delta = cashback_gerado
    else:
        ret_delta = 0.0
        
    db.commit()
    
    return {
        "status": "success",
        "tipo_recompensa": config.tipo_recompensa,
        "desconto_aplicado": desconto_aplicado,
        "valor_final": valor_final,
        "acumulado_nesta_compra": ret_delta,
        "saldo_atual": max(0.0, saldo_atual - (req.pontos_a_resgatar if config.tipo_recompensa == "PONTOS" and req.resgatar else (desconto_aplicado if req.resgatar else 0.0)) + ret_delta)
    }


@router.get("/garcons/relatorio")
def get_garcons_relatorio(db: Session = Depends(get_db)):
    """
    Retorna o relatório simplificado de desempenho dos garçons.
    Calcula o total de pedidos atendidos e a comissão acumulada (10% de serviço).
    """
    garcons = db.query(Usuario).filter(Usuario.role == "garcom").all()
    
    results = []
    for g in garcons:
        # Get all closed comandas
        comandas = db.query(Comanda).filter(Comanda.garcom_id == g.id, Comanda.fechada == True).all()
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

