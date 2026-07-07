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
def get_horarios_pico(db: Session = Depends(get_db)):
    """
    Query SQL pura otimizada no SQLite que agrupa o histórico de comandas fechadas 
    por dia da semana e hora de fechamento.
    """
    sql = """
        SELECT 
            strftime('%w', fechado_em) as dia_semana, 
            strftime('%H', fechado_em) as hora, 
            count(id) as total_pedidos
        FROM comandas
        WHERE fechada = 1 AND fechado_em IS NOT NULL
        GROUP BY dia_semana, hora
        ORDER BY total_pedidos DESC;
    """
    query = db.execute(text(sql)).fetchall()
    
    results = []
    dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"]
    for row in query:
        dia_idx = int(row[0]) if row[0] is not None else 0
        results.append({
            "dia_semana_label": dias[dia_idx],
            "dia_semana": dia_idx,
            "hora": f"{row[1]}h" if row[1] is not None else "00h",
            "total_pedidos": row[2]
        })
    return results


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

