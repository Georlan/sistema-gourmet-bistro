from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from pydantic import BaseModel

from ..database import get_db
from ..models import Comanda, Insumo, ConfigFidelizacao, HistoricoFidelidade, ActivityLog, Pagamento, Cliente
from ..schemas import InsumoResponse, ConfigFidelizacaoResponse, HistoricoFidelidadeResponse
from ..security import get_current_garcom_optional
from ..models import Usuario
from ..crypt import decrypt_field

router = APIRouter(
    tags=["Otimizações, Estoque e Fidelidade"]
)

# ----------------- INVENTÓRIO E ESTOQUE -----------------

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
    # 1. Obter todos os clientes cadastrados manualmente
    clientes_manuais = db.query(Cliente).all()
    pag_names = {c.telefone.strip(): c.nome.strip() for c in clientes_manuais if c.telefone}

    # 2. Busca histórico
    historico = db.query(
        HistoricoFidelidade._cliente_telefone,
        HistoricoFidelidade.tipo_movimentacao,
        HistoricoFidelidade.valor_delta
    ).all()

    saldos = {}
    
    # Inicializa saldos dos clientes cadastrados manualmente
    for c in clientes_manuais:
        if c.telefone:
            saldos[c.telefone.strip()] = {"pontos": 0.0, "cashback": 0.0}

    for encrypted_tel, tipo_mov, delta in historico:
        if not encrypted_tel:
            continue
        tel = decrypt_field(encrypted_tel).strip()
        if tel not in saldos:
            saldos[tel] = {"pontos": 0.0, "cashback": 0.0}
        if tipo_mov == "ACUMULO":
            saldos[tel]["pontos"] += delta
            saldos[tel]["cashback"] += delta
        else:
            saldos[tel]["pontos"] -= delta
            saldos[tel]["cashback"] -= delta
            
    # 3. Busca nomes de pagamentos (se não cadastrados na tabela Cliente)
    unique_tels = [t for t in saldos.keys() if t not in pag_names]
    if unique_tels:
        from ..models import Pagamento
        pags = db.query(
            Pagamento.cpf_cliente,
            Pagamento.nome_cliente
        ).filter(
            Pagamento.cpf_cliente.in_(unique_tels)
        ).all()
        
        for cpf, nome in pags:
            if cpf and nome and cpf.strip() not in pag_names:
                pag_names[cpf.strip()] = nome.strip()

    result = []
    for idx, (tel, balance) in enumerate(saldos.items()):
        p_name = pag_names.get(tel) or f"Cliente {tel[-4:] if len(tel) >= 4 else tel}"
            
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
    # Otimizado: Busca apenas colunas brutas do banco de dados (evita instanciar objetos ORM lentos)
    historico = db.query(
        HistoricoFidelidade._cliente_telefone,
        HistoricoFidelidade.tipo_movimentacao,
        HistoricoFidelidade.valor_delta
    ).all()
    
    saldo_atual = 0.0
    for encrypted_tel, tipo_mov, delta in historico:
        if not encrypted_tel:
            continue
        if decrypt_field(encrypted_tel).strip() == telefone:
            if tipo_mov == "ACUMULO":
                saldo_atual += delta
            else:
                saldo_atual -= delta
                
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


class ClientUpdate(BaseModel):
    cliente: str
    telefone: str
    saldo_pontos: Optional[int] = None
    saldo_cashback: Optional[float] = None

@router.put("/fidelidade/clientes/{old_phone}")
def update_loyalty_client(
    old_phone: str,
    data: ClientUpdate,
    db: Session = Depends(get_db)
):
    """
    Edita o nome, telefone, pontos e cashback de um cliente.
    Atualiza tabela Cliente, HistoricoFidelidade e Pagamentos correspondentes.
    """
    # 1. Fetch and filter HistoricoFidelidade in Python due to non-deterministic encryption
    all_movements = db.query(HistoricoFidelidade).all()
    movements = [m for m in all_movements if m.cliente_telefone.strip() == old_phone]
    
    # 2. Fetch Pagamento entries (which are unencrypted)
    pagamentos = db.query(Pagamento).filter(Pagamento.cpf_cliente == old_phone).all()
    
    # 3. Buscar ou criar o cliente na tabela dedicada 'clientes'
    cliente_db = db.query(Cliente).filter(Cliente.telefone == old_phone).first()
    
    if not movements and not pagamentos and not cliente_db:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
        
    if not cliente_db:
        # Se não existia, cria um novo
        cliente_db = Cliente(telefone=old_phone, nome=data.cliente.strip())
        db.add(cliente_db)
        db.commit()
        db.refresh(cliente_db)
        
    # Atualizar dados do cliente na tabela 'clientes'
    cliente_db.nome = data.cliente.strip()
    cliente_db.telefone = data.telefone.strip()
    
    # 4. Update HistoricoFidelidade entries
    for m in movements:
        m.cliente_telefone = data.telefone.strip()
        
    # 5. Update Pagamento entries
    for p in pagamentos:
        p.cpf_cliente = data.telefone.strip()
        p.nome_cliente = data.cliente.strip()
        
    # 6. Tratar ajuste manual de saldo se fornecido
    pontos_atual = 0.0
    for m in movements:
        if m.tipo_movimentacao == "ACUMULO":
            pontos_atual += m.valor_delta
        else:
            pontos_atual -= m.valor_delta

    novo_saldo = None
    if data.saldo_pontos is not None:
        novo_saldo = float(data.saldo_pontos)
    elif data.saldo_cashback is not None:
        novo_saldo = float(data.saldo_cashback)
        
    if novo_saldo is not None:
        diff = novo_saldo - pontos_atual
        if abs(diff) > 0.001:
            tipo = "ACUMULO" if diff > 0 else "RESGATE"
            ajuste = HistoricoFidelidade(
                cliente_telefone=data.telefone.strip(),
                tipo_movimentacao=tipo,
                valor_delta=abs(diff)
            )
            db.add(ajuste)
            
    db.commit()
    return {"success": True, "detail": "Cliente atualizado com sucesso."}


class ClientCreate(BaseModel):
    cliente: str
    telefone: str
    saldo_pontos: Optional[int] = 0
    saldo_cashback: Optional[float] = 0.0

@router.post("/fidelidade/clientes", status_code=201)
def create_loyalty_client(
    data: ClientCreate,
    db: Session = Depends(get_db)
):
    """
    Cadastra manualmente um novo cliente e lança o saldo inicial se fornecido.
    """
    tel_limpo = data.telefone.strip()
    cliente_existente = db.query(Cliente).filter(Cliente.telefone == tel_limpo).first()
    if cliente_existente:
        raise HTTPException(status_code=400, detail="Cliente com este telefone já cadastrado.")
        
    # Criar registro na tabela 'clientes'
    new_c = Cliente(telefone=tel_limpo, nome=data.cliente.strip())
    db.add(new_c)
    db.commit()
    db.refresh(new_c)
    
    # Lançar saldo inicial em HistoricoFidelidade se maior que zero
    saldo_inicial = 0.0
    if data.saldo_pontos and data.saldo_pontos > 0:
        saldo_inicial = float(data.saldo_pontos)
    elif data.saldo_cashback and data.saldo_cashback > 0:
        saldo_inicial = float(data.saldo_cashback)
        
    if saldo_inicial > 0:
        ajuste = HistoricoFidelidade(
            cliente_telefone=tel_limpo,
            tipo_movimentacao="ACUMULO",
            valor_delta=saldo_inicial
        )
        db.add(ajuste)
        db.commit()
        
    return {"success": True, "detail": "Cliente criado com sucesso."}
