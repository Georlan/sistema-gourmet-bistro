from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
import datetime

from ..database import get_db
from ..models import Usuario, Comanda, Item, CaixaTurno, CaixaMovimentacao, Pagamento
from ..schemas import (
    CaixaTurnoCreate, CaixaTurnoResponse, CaixaTurnoFechar, CaixaTurnoDetalhe,
    CaixaMovimentacaoCreate, CaixaMovimentacaoResponse, PagamentoRequest, PagamentoResponse
)
from ..security import get_current_garcom_optional
from .websocket import manager

router = APIRouter(
    prefix="/caixa",
    tags=["Caixa / PDV"]
)

def check_caixa_permission(user: Usuario):
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token obrigatório"
        )
    if user.role not in ["caixa", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a operadores de caixa ou administradores"
        )

# ----------------- TURNO ENDPOINTS -----------------

@router.post("/turno/abrir", response_model=CaixaTurnoResponse, status_code=status.HTTP_201_CREATED)
def abrir_turno(
    turno_in: CaixaTurnoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Abre um novo turno de caixa com um saldo de troco inicial."""
    check_caixa_permission(current_user)
    
    # Check if there is already an open shift
    turno_ativo = db.query(CaixaTurno).filter(CaixaTurno.status == "aberto").first()
    if turno_ativo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Já existe um turno de caixa aberto. Feche o anterior antes de abrir um novo."
        )
        
    novo_turno = CaixaTurno(
        aberto_por_id=current_user.id,
        aberto_em=datetime.datetime.now(datetime.timezone.utc),
        saldo_inicial=turno_in.saldo_inicial,
        status="aberto"
    )
    db.add(novo_turno)
    db.commit()
    db.refresh(novo_turno)
    return novo_turno


@router.get("/turno/atual", response_model=Optional[CaixaTurnoDetalhe])
def obter_turno_atual(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Retorna os dados do turno de caixa atual aberto com o faturamento parcial esperado."""
    check_caixa_permission(current_user)
    
    turno = db.query(CaixaTurno).filter(CaixaTurno.status == "aberto").first()
    if not turno:
        return None
        
    # Get all movements (suprimentos and sangrias)
    movs = db.query(CaixaMovimentacao).filter(CaixaMovimentacao.turno_id == turno.id).all()
    
    # Get all payments processed in this shift
    pags = db.query(Pagamento).filter(Pagamento.turno_id == turno.id).all()
    
    # Calculate totals
    total_esperado_dinheiro = turno.saldo_inicial
    total_esperado_pix = 0.0
    total_esperado_cartao = 0.0
    
    for m in movs:
        if m.tipo == "suprimento":
            total_esperado_dinheiro += m.valor
        elif m.tipo == "sangria":
            total_esperado_dinheiro -= m.valor
            
    for p in pags:
        if p.metodo == "dinheiro":
            total_esperado_dinheiro += p.valor
        elif p.metodo == "pix":
            total_esperado_pix += p.valor
        elif p.metodo == "cartao":
            total_esperado_cartao += p.valor
            
    return {
        "id": turno.id,
        "aberto_por_id": turno.aberto_por_id,
        "aberto_em": turno.aberto_em,
        "fechado_em": turno.fechado_em,
        "fechado_por_id": turno.fechado_por_id,
        "saldo_inicial": turno.saldo_inicial,
        "declarado_dinheiro": turno.declarado_dinheiro,
        "declarado_pix": turno.declarado_pix,
        "declarado_cartao": turno.declarado_cartao,
        "status": turno.status,
        "movimentacoes": movs,
        "pagamentos": pags,
        "total_esperado_dinheiro": total_esperado_dinheiro,
        "total_esperado_pix": total_esperado_pix,
        "total_esperado_cartao": total_esperado_cartao
    }


@router.post("/turno/fechar", response_model=CaixaTurnoResponse)
def fechar_turno(
    fechamento_in: CaixaTurnoFechar,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Encerra o turno de caixa ativo e registra os valores contados fisicamente."""
    check_caixa_permission(current_user)
    
    turno = db.query(CaixaTurno).filter(CaixaTurno.status == "aberto").first()
    if not turno:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Não há nenhum turno de caixa aberto atualmente."
        )
        
    turno.fechado_por_id = current_user.id
    turno.fechado_em = datetime.datetime.now(datetime.timezone.utc)
    turno.declarado_dinheiro = fechamento_in.declarado_dinheiro
    turno.declarado_pix = fechamento_in.declarado_pix
    turno.declarado_cartao = fechamento_in.declarado_cartao
    turno.status = "fechado"
    
    db.commit()
    db.refresh(turno)
    return turno


@router.post("/turno/movimentar", response_model=CaixaMovimentacaoResponse, status_code=status.HTTP_201_CREATED)
def movimentar_caixa(
    mov_in: CaixaMovimentacaoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Registra uma entrada de troco extra (suprimento) ou retirada de dinheiro (sangria)."""
    check_caixa_permission(current_user)
    
    turno = db.query(CaixaTurno).filter(CaixaTurno.status == "aberto").first()
    if not turno:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O caixa precisa estar aberto para registrar movimentações de suprimento ou sangria."
        )
        
    if mov_in.tipo not in ["suprimento", "sangria"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tipo de movimentação inválido. Deve ser 'suprimento' ou 'sangria'."
        )
        
    nova_mov = CaixaMovimentacao(
        turno_id=turno.id,
        tipo=mov_in.tipo,
        valor=mov_in.valor,
        descricao=mov_in.descricao,
        criado_em=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(nova_mov)
    db.commit()
    db.refresh(nova_mov)
    return nova_mov


# ----------------- COMPATIBLE/INTEGRATED PAYMENTS ENDPOINT -----------------

@router.post("/comandas/{comanda_id}/pagar", response_model=PagamentoResponse, status_code=status.HTTP_201_CREATED)
def registrar_pagamento_comanda(
    comanda_id: str,
    pag_in: PagamentoRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Registra o recebimento financeiro parcial ou total de uma comanda no caixa."""
    check_caixa_permission(current_user)
    
    # 1. Check if there is an active shift
    turno = db.query(CaixaTurno).filter(CaixaTurno.status == "aberto").first()
    if not turno:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O caixa precisa estar aberto para processar pagamentos de comandas."
        )
        
    # 2. Check if comanda exists
    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda não encontrada"
        )
        
    if comanda.fechada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comanda já está fechada e liquidada."
        )
        
    # Validate payment method
    if pag_in.metodo not in ["dinheiro", "pix", "cartao"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Método de pagamento inválido. Use 'dinheiro', 'pix' ou 'cartao'."
        )

    # 3. Process payment
    if pag_in.item_ids:
        # Pay by item selection
        itens_selecionados = db.query(Item).filter(
            Item.comanda_id == comanda_id,
            Item.id.in_(pag_in.item_ids),
            Item.status != 'cancelado',
            Item.pago == False
        ).all()
        
        if not itens_selecionados:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nenhum item válido pendente de pagamento foi selecionado."
            )
            
        # Settle selected items
        for item in itens_selecionados:
            item.pago = True
            
        # The payment value is defined by the sum of these items (plus 10% optional tax, let's keep the value passed)
        # Note: If the front end calculates the value, we trust the value passed to register the payment
    
    # Create the Pagamento transaction
    novo_pagamento = Pagamento(
        id=f"p-{uuid.uuid4().hex[:8]}",
        comanda_id=comanda_id,
        turno_id=turno.id,
        valor=pag_in.valor,
        metodo=pag_in.metodo,
        criado_em=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(novo_pagamento)
    
    # Increment the comanda's general paid value
    comanda.valor_pago += pag_in.valor
    
    # 4. Check if comanda is fully settled
    # Calculate remaining total: sum of items not paid, not canceled (plus 10% tax)
    subtotal_restante = sum(i.preco_unit for i in comanda.itens if i.status != 'cancelado' and not i.pago)
    
    # A comanda is fully paid if either:
    # (a) No more active unpaid items remain (meaning all items were explicitly paid)
    # (b) The total general value paid covers the subtotal plus service tax (1.10)
    total_de_itens_pendentes = len([i for i in comanda.itens if i.status != 'cancelado' and not i.pago])
    
    subtotal_total = sum(i.preco_unit for i in comanda.itens if i.status != 'cancelado')
    total_com_taxa = subtotal_total * 1.10
    
    if total_de_itens_pendentes == 0 or comanda.valor_pago >= subtotal_total or comanda.valor_pago >= total_com_taxa:
        # Mark all active items as paid just in case
        for i in comanda.itens:
            if i.status != 'cancelado':
                i.pago = True
        # Close comanda
        comanda.fechada = True
        comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)
        
    db.commit()
    db.refresh(novo_pagamento)
    db.refresh(comanda)
    
    # Trigger WebSocket sync update
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return novo_pagamento


from ..models import ConfiguracaoRestaurante
from ..schemas import ConfiguracaoRestauranteResponse, ConfiguracaoRestauranteUpdate

@router.get("/configuracoes", response_model=ConfiguracaoRestauranteResponse)
def obter_configuracoes(db: Session = Depends(get_db)):
    config = db.query(ConfiguracaoRestaurante).first()
    if not config:
        config = ConfiguracaoRestaurante(
            nicho="hamburgueria",
            mapa_mesas_ativo=True,
            delivery_ativo=True,
            taxa_servico_ativa=True,
            taxa_servico_padrao=10.0,
            unificar_vias_delivery=False,
            modo_exclusivo_salao=True
        )
        db.add(config)
        db.commit()
        db.refresh(config)
    return config

@router.put("/configuracoes", response_model=ConfiguracaoRestauranteResponse)
def atualizar_configuracoes(
    config_in: ConfiguracaoRestauranteUpdate,
    db: Session = Depends(get_db)
):
    config = db.query(ConfiguracaoRestaurante).first()
    if not config:
        config = ConfiguracaoRestaurante()
        db.add(config)
        db.commit()
        db.refresh(config)
        
    if config_in.nicho is not None:
        config.nicho = config_in.nicho
    if config_in.mapa_mesas_ativo is not None:
        config.mapa_mesas_ativo = config_in.mapa_mesas_ativo
    if config_in.delivery_ativo is not None:
        config.delivery_ativo = config_in.delivery_ativo
    if config_in.taxa_servico_ativa is not None:
        config.taxa_servico_ativa = config_in.taxa_servico_ativa
    if config_in.taxa_servico_padrao is not None:
        config.taxa_servico_padrao = config_in.taxa_servico_padrao
    if config_in.unificar_vias_delivery is not None:
        config.unificar_vias_delivery = config_in.unificar_vias_delivery
    if config_in.modo_exclusivo_salao is not None:
        config.modo_exclusivo_salao = config_in.modo_exclusivo_salao
        
    db.commit()
    db.refresh(config)
    return config
