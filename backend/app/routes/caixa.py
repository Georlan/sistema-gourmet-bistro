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
    """Registra o recebimento financeiro parcial ou total de uma comanda."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token obrigatório"
        )
        
    # Idempotency Check
    if pag_in.idempotency_key:
        existing = db.query(Pagamento).filter(Pagamento.idempotency_key == pag_in.idempotency_key).first()
        if existing:
            return existing

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

    # Determine if payment should be pending confirmation (Garçom + Dinheiro)
    is_pending = (current_user.role == "garcom" and pag_in.metodo == "dinheiro")
    pag_status = "pendente" if is_pending else "aprovado"

    # 3. Process payment if approved immediately
    if not is_pending:
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

    # Create the Pagamento transaction
    novo_pagamento = Pagamento(
        id=f"p-{uuid.uuid4().hex[:8]}",
        comanda_id=comanda_id,
        turno_id=turno.id,
        valor=pag_in.valor,
        metodo=pag_in.metodo,
        status=pag_status,
        idempotency_key=pag_in.idempotency_key,
        cpf_cliente=pag_in.cpf_cliente,
        nome_cliente=pag_in.nome_cliente,
        criado_em=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(novo_pagamento)
    
    if not is_pending:
        # Increment the comanda's general paid value
        comanda.valor_pago += pag_in.valor
        
        # 4. Check if comanda is fully settled
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
            
            # Process loyalty points/cashback if client CPF/phone is present
            from ..models import ConfigFidelizacao, HistoricoFidelidade
            client_cpf = None
            if pag_in.cpf_cliente:
                client_cpf = pag_in.cpf_cliente.strip()
            else:
                past_pags = db.query(Pagamento).filter(Pagamento.comanda_id == comanda_id).all()
                for p_pag in past_pags:
                    if p_pag.cpf_cliente:
                        client_cpf = p_pag.cpf_cliente.strip()
                        break
            
            if client_cpf:
                fidel_config = db.query(ConfigFidelizacao).first()
                if fidel_config and fidel_config.ativo:
                    total_pago = comanda.valor_pago
                    if fidel_config.tipo_recompensa == "PONTOS":
                        delta_val = total_pago * fidel_config.taxa_conversao
                    else: # CASHBACK
                        delta_val = total_pago * (fidel_config.taxa_conversao / 100.0)
                    
                    # Create loyalty log
                    mov_fidel = HistoricoFidelidade(
                        cliente_telefone=client_cpf,
                        tipo_movimentacao="ACUMULO",
                        valor_delta=delta_val
                    )
                    db.add(mov_fidel)
                    
    db.commit()
    db.refresh(novo_pagamento)
    db.refresh(comanda)
    
    # Trigger WebSocket sync update
    background_tasks.add_task(manager.broadcast, {
        "event": "tables_updated",
        "detail": {
            "type": "pagamento_registrado",
            "comanda_id": comanda_id,
            "metodo": pag_in.metodo,
            "valor": pag_in.valor,
            "status": pag_status,
            "garcom_nome": current_user.nome,
            "mesa_id": comanda.mesa_id
        }
    })
    return novo_pagamento


@router.get("/pagamentos/pendentes", response_model=List[PagamentoResponse])
def listar_pagamentos_pendentes(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Lista todos os pagamentos em dinheiro pendentes de aprovação pelo caixa."""
    check_caixa_permission(current_user)
    return db.query(Pagamento).filter(Pagamento.status == "pendente").all()


@router.post("/pagamentos/{pagamento_id}/aprovar", response_model=PagamentoResponse)
def aprovar_pagamento(
    pagamento_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Aprova um pagamento pendente em dinheiro, debitando os valores e liquidando a comanda."""
    check_caixa_permission(current_user)
    pagamento = db.query(Pagamento).filter(Pagamento.id == pagamento_id).first()
    if not pagamento:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")
    if pagamento.status != "pendente":
        raise HTTPException(status_code=400, detail="Pagamento já processado")
        
    pagamento.status = "aprovado"
    comanda = pagamento.comanda
    comanda.valor_pago += pagamento.valor
    
    # Check if comanda is fully settled
    total_de_itens_pendentes = len([i for i in comanda.itens if i.status != 'cancelado' and not i.pago])
    subtotal_total = sum(i.preco_unit for i in comanda.itens if i.status != 'cancelado')
    total_com_taxa = subtotal_total * 1.10
    
    if total_de_itens_pendentes == 0 or comanda.valor_pago >= subtotal_total or comanda.valor_pago >= total_com_taxa:
        for i in comanda.itens:
            if i.status != 'cancelado':
                i.pago = True
        comanda.fechada = True
        comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)
        
    db.commit()
    db.refresh(pagamento)
    db.refresh(comanda)
    
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return pagamento


@router.post("/pagamentos/{pagamento_id}/recusar", response_model=PagamentoResponse)
def recusar_pagamento(
    pagamento_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Rejeita e cancela um pagamento pendente em dinheiro."""
    check_caixa_permission(current_user)
    pagamento = db.query(Pagamento).filter(Pagamento.id == pagamento_id).first()
    if not pagamento:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")
    if pagamento.status != "pendente":
        raise HTTPException(status_code=400, detail="Pagamento já processado")
        
    pagamento.status = "cancelado"
    db.commit()
    db.refresh(pagamento)
    
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return pagamento


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
            modo_exclusivo_salao=True,
            perm_garcom_delivery=True,
            perm_garcom_editar=True,
            perm_garcom_taxas=False,
            perm_garcom_cancelar=False,
            perm_garcom_status=True,
            perm_garcom_abrir_vazia=False,
            perm_garcom_print=True,
            perm_garcom_fechar=False,
            perm_garcom_desconto=False,
            perm_garcom_acrescimo=False,
            perm_garcom_pessoas=True,
            perm_garcom_transferir_mesa=True,
            perm_garcom_transferir_item=True,
            perm_garcom_chamar=True,
            perm_garcom_ociosas=True
        )
        db.add(config)
        db.commit()
        db.refresh(config)
    return config

@router.put("/configuracoes", response_model=ConfiguracaoRestauranteResponse)
def atualizar_configuracoes(
    config_in: ConfiguracaoRestauranteUpdate,
    background_tasks: BackgroundTasks,
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
        
    if config_in.perm_garcom_delivery is not None:
        config.perm_garcom_delivery = config_in.perm_garcom_delivery
    if config_in.perm_garcom_editar is not None:
        config.perm_garcom_editar = config_in.perm_garcom_editar
    if config_in.perm_garcom_taxas is not None:
        config.perm_garcom_taxas = config_in.perm_garcom_taxas
    if config_in.perm_garcom_cancelar is not None:
        config.perm_garcom_cancelar = config_in.perm_garcom_cancelar
    if config_in.perm_garcom_status is not None:
        config.perm_garcom_status = config_in.perm_garcom_status
    if config_in.perm_garcom_abrir_vazia is not None:
        config.perm_garcom_abrir_vazia = config_in.perm_garcom_abrir_vazia
    if config_in.perm_garcom_print is not None:
        config.perm_garcom_print = config_in.perm_garcom_print
    if config_in.perm_garcom_fechar is not None:
        config.perm_garcom_fechar = config_in.perm_garcom_fechar
    if config_in.perm_garcom_desconto is not None:
        config.perm_garcom_desconto = config_in.perm_garcom_desconto
    if config_in.perm_garcom_acrescimo is not None:
        config.perm_garcom_acrescimo = config_in.perm_garcom_acrescimo
    if config_in.perm_garcom_pessoas is not None:
        config.perm_garcom_pessoas = config_in.perm_garcom_pessoas
    if config_in.perm_garcom_transferir_mesa is not None:
        config.perm_garcom_transferir_mesa = config_in.perm_garcom_transferir_mesa
    if config_in.perm_garcom_transferir_item is not None:
        config.perm_garcom_transferir_item = config_in.perm_garcom_transferir_item
    if config_in.perm_garcom_chamar is not None:
        config.perm_garcom_chamar = config_in.perm_garcom_chamar
    if config_in.perm_garcom_ociosas is not None:
        config.perm_garcom_ociosas = config_in.perm_garcom_ociosas
        
    db.commit()
    db.refresh(config)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return config
