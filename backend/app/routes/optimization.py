from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from typing import Optional
from pydantic import BaseModel
from decimal import Decimal, ROUND_HALF_UP
import logging

from ..database import get_db, require_tenant_id
from ..models import Comanda, Insumo, ConfigFidelizacao, Pagamento, Cliente
from ..schemas import ConfigFidelizacaoResponse
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
from ..timezone_utils import (
    parse_operational_filter_datetime,
    to_database_utc,
    to_operational_local_time,
)

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
    from collections import Counter

    rest_id = require_tenant_id()
    timestamps = db.query(Comanda.fechado_em).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.fechada == True,
        Comanda.fechado_em.isnot(None),
    ).all()

    # Agrupar depois da conversão mantém o resultado igual em SQLite e
    # PostgreSQL e impede que 18h UTC apareça como pico às 18h no Ceará.
    counts: Counter[tuple[int, int]] = Counter()
    for (closed_at,) in timestamps:
        local_dt = to_operational_local_time(closed_at)
        if local_dt:
            # Python: segunda=0; a API histórica do Kôma usa domingo=0.
            day_index = (local_dt.weekday() + 1) % 7
            counts[(day_index, local_dt.hour)] += 1

    results = []
    dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"]
    for (dia_idx, hora_val), total in counts.most_common():
        results.append({
            "dia_semana_label": dias[dia_idx % 7],
            "dia_semana": dia_idx % 7,
            "hora": f"{hora_val:02d}h",
            "total_pedidos": total,
        })
    return results

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
    
    dt_inicio = parse_operational_filter_datetime(data_inicio)
    fim_eh_dia = bool(data_fim and len(data_fim.strip()) == 10)
    dt_fim = parse_operational_filter_datetime(data_fim, end_of_day=fim_eh_dia)
    db_inicio = to_database_utc(dt_inicio)
    db_fim = to_database_utc(dt_fim)

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
        if db_inicio:
            comandas_query = comandas_query.filter(Comanda.fechado_em >= db_inicio)
        if db_fim:
            comandas_query = comandas_query.filter(
                Comanda.fechado_em < db_fim
                if fim_eh_dia
                else Comanda.fechado_em <= db_fim
            )
            
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


from .financial_read_routes import get_dashboard_financeiro

router.add_api_route("/comandas/estatisticas/geral", get_dashboard_financeiro, methods=["GET"])
