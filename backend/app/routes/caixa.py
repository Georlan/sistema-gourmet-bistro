from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List, Optional, Union
import uuid
import datetime
import logging

import re
import os
import httpx

from ..config import settings
from ..database import get_db, current_restaurante_id, require_tenant_id
from ..models import Usuario, Comanda, Item, CaixaTurno, CaixaMovimentacao, Pagamento
from ..schemas import (
    CaixaTurnoCreate, CaixaTurnoResponse, CaixaTurnoFechar, CaixaTurnoDetalhe,
    CaixaMovimentacaoCreate, CaixaMovimentacaoResponse, PagamentoRequest, PagamentoResponse,
    UsuarioResponse, UsuarioCreate, SangriaCreate, SuprimentoCreate, CaixaTurnoResumoResponse,
    FechamentoCaixaRequest, FechamentoCaixaResponse
)
from ..security import (
    ensure_permission,
    get_current_garcom_optional,
    get_current_user,
    require_permission,
)
from .websocket import manager

logger = logging.getLogger("koma.caixa")

router = APIRouter(
    prefix="/caixa",
    tags=["Caixa / PDV"]
)

def check_caixa_permission(
    user: Usuario,
    permission: str = "caixa:operar"
):
    return ensure_permission(user, permission)

# ----------------- FUNCIONÁRIOS / EQUIPE ENDPOINTS -----------------

@router.get("/funcionarios", response_model=List[UsuarioResponse])
def obter_funcionarios(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Retorna a lista de usuários pertencentes ao restaurante_id do contexto ativo."""
    check_caixa_permission(current_user, "equipe:administrar")
    rest_id = require_tenant_id()
    return db.query(Usuario).filter(Usuario.restaurante_id == rest_id).all()


@router.post("/funcionarios", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
def cadastrar_funcionario(
    user_in: UsuarioCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Cadastra um novo funcionário por convite de telefone."""
    check_caixa_permission(current_user, "equipe:administrar")
    
    tel_raw = user_in.telefone or user_in.usuario or ""
    tel_clean = re.sub(r"\D", "", tel_raw)
    if not tel_clean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Telefone é obrigatório para cadastrar um funcionário."
        )

    # Verificar se o telefone já está cadastrado no sistema
    existente = db.query(Usuario).filter(Usuario.telefone == tel_clean).first()
    if existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este telefone já está cadastrado no sistema"
        )
        
    rest_id = require_tenant_id()
    token_convite = str(uuid.uuid4())
    token_expira_em = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
    cargo_val = user_in.cargo or user_in.role or "garcom"

    novo_usuario = Usuario(
        id=str(uuid.uuid4())[:8],
        nome=user_in.nome,
        telefone=tel_clean,
        cargo=cargo_val,
        restaurante_id=rest_id,
        senha_hash=None,
        token_convite=token_convite,
        token_expira_em=token_expira_em,
        status="pendente_ativacao",
        created_at=datetime.datetime.now(datetime.timezone.utc)
    )
    
    db.add(novo_usuario)
    db.commit()
    db.refresh(novo_usuario)
    
    # Tenta enviar convite real via Evolution API
    evolution_sent = False
    evolution_url = getattr(settings, "EVOLUTION_API_URL", None) or os.getenv("EVOLUTION_API_URL", "")
    evolution_key = getattr(settings, "EVOLUTION_API_KEY", None) or os.getenv("EVOLUTION_API_KEY", "")
    evolution_instance = getattr(settings, "EVOLUTION_INSTANCE_NAME", None) or os.getenv("EVOLUTION_INSTANCE_NAME", "")

    convite_link = f"https://sistema-gourmet-bistro.pages.dev/ativar?token={token_convite}"
    mensagem_texto = f"Olá {novo_usuario.nome}! Você foi convidado para trabalhar no Kôma. Clique no link para criar sua senha e ativar sua conta: {convite_link}"

    if evolution_url and evolution_key and evolution_instance:
        try:
            url_disparo = f"{evolution_url.rstrip('/')}/message/sendText/{evolution_instance}"
            headers = {
                "Content-Type": "application/json",
                "apikey": evolution_key
            }
            payload = {
                "number": tel_clean,
                "text": mensagem_texto
            }
            
            with httpx.Client(timeout=5.0) as client:
                res = client.post(url_disparo, headers=headers, json=payload)
                if res.status_code in [200, 201]:
                    evolution_sent = True
                    logger.info(f"[EVOLUTION API] Convite enviado via WhatsApp para {tel_clean}: {res.status_code}")
                else:
                    logger.warning(f"[EVOLUTION API] Falha HTTP {res.status_code} ao enviar convite: {res.text}")
        except Exception as err:
            logger.warning(f"[EVOLUTION API] Exceção de rede ao enviar convite via WhatsApp: {err}")

    if not evolution_sent:
        logger.info(f"[WHATSAPP SIMULADO] Enviar convite para {tel_clean}: {convite_link}")

    return novo_usuario


# ----------------- TURNO ENDPOINTS -----------------

@router.post("/turno/abrir", response_model=CaixaTurnoResponse, status_code=status.HTTP_201_CREATED)
def abrir_turno(
    turno_in: CaixaTurnoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """Abre um novo turno de caixa com um saldo de troco inicial."""
    check_caixa_permission(current_user)
    
    # Check if there is already an open shift FOR THIS TENANT
    turno_ativo = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == current_restaurante_id.get(),
        CaixaTurno.status == "aberto"
    ).first()
    if turno_ativo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Já existe um turno de caixa aberto. Feche o anterior antes de abrir um novo."
        )
        
    novo_turno = CaixaTurno(
        restaurante_id=current_restaurante_id.get(),
        aberto_por_id=current_user.id,
        aberto_em=datetime.datetime.now(datetime.timezone.utc),
        saldo_inicial=turno_in.saldo_inicial,
        status="aberto"
    )
    db.add(novo_turno)
    db.commit()
    db.refresh(novo_turno)
    return novo_turno


# ----------------- TURNO DE CAIXA / OPERACIONAL ENDPOINTS -----------------

@router.get("/turno-atual/resumo", response_model=CaixaTurnoResumoResponse)
@router.get("/turno/resumo", response_model=CaixaTurnoResumoResponse)
def obter_resumo_turno_atual(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Retorna dados consolidados e métricas em tempo real do turno de caixa aberto para o tenant."""
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    turno = db.query(CaixaTurno).filter_by(restaurante_id=rest_id, status="aberto").first()
    if not turno:
        return CaixaTurnoResumoResponse(
            turno_id=None,
            status="sem_turno",
            operador_id=None,
            operador_nome=None,
            aberto_em=None,
            tempo_aberto_minutos=0,
            saldo_inicial=0.0,
            total_vendas=0.0,
            total_dinheiro=0.0,
            total_pix=0.0,
            total_cartao=0.0,
            total_sangrias=0.0,
            total_suprimentos=0.0,
            saldo_esperado_dinheiro=0.0,
            total_pedidos_pagos=0,
            ultima_movimentacao=None,
            resumo_dia=None
        )

    operador = db.query(Usuario).filter_by(id=turno.aberto_por_id, restaurante_id=rest_id).first()
    operador_nome = operador.nome if operador else "Operador"

    pags = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.turno_id == turno.id,
        Pagamento.status == "aprovado"
    ).all()

    total_vendas = sum(p.valor for p in pags)
    total_dinheiro = sum(p.valor for p in pags if p.metodo == "dinheiro")
    total_pix = sum(p.valor for p in pags if p.metodo == "pix")
    total_cartao = sum(p.valor for p in pags if p.metodo in ["cartao", "cartao_debito", "cartao_credito"])
    pedidos_pagos_set = {p.comanda_id for p in pags if p.comanda_id}

    movs = db.query(CaixaMovimentacao).filter_by(turno_id=turno.id).order_by(CaixaMovimentacao.criado_em.desc()).all()
    total_sangrias = sum(m.valor for m in movs if m.tipo == "sangria")
    total_suprimentos = sum(m.valor for m in movs if m.tipo == "suprimento")

    saldo_esperado = turno.saldo_inicial + total_dinheiro + total_suprimentos - total_sangrias

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    aberto_dt = turno.aberto_em
    if aberto_dt.tzinfo is None:
        aberto_dt = aberto_dt.replace(tzinfo=datetime.timezone.utc)
    tempo_minutos = int((now_utc - aberto_dt).total_seconds() / 60)

    ult_mov = None
    if movs:
        m_top = movs[0]
        u_mov = db.query(Usuario).filter_by(id=m_top.usuario_id).first() if m_top.usuario_id else None
        ult_mov = {
            "id": m_top.id,
            "tipo": m_top.tipo,
            "valor": m_top.valor,
            "descricao": m_top.descricao or m_top.observacao or "",
            "criado_em": m_top.criado_em.isoformat() if m_top.criado_em else None,
            "operador_nome": u_mov.nome if u_mov else operador_nome
        }

    return CaixaTurnoResumoResponse(
        turno_id=turno.id,
        status="aberto",
        operador_id=turno.aberto_por_id,
        operador_nome=operador_nome,
        aberto_em=turno.aberto_em,
        tempo_aberto_minutos=max(0, tempo_minutos),
        saldo_inicial=turno.saldo_inicial,
        total_vendas=total_vendas,
        total_dinheiro=total_dinheiro,
        total_pix=total_pix,
        total_cartao=total_cartao,
        total_sangrias=total_sangrias,
        total_suprimentos=total_suprimentos,
        saldo_esperado_dinheiro=saldo_esperado,
        total_pedidos_pagos=len(pedidos_pagos_set),
        ultima_movimentacao=ult_mov,
        resumo_dia={"total_vendas": total_vendas, "pedidos_pagos": len(pedidos_pagos_set)}
    )


@router.get("/turno/atual", response_model=Optional[CaixaTurnoDetalhe])
def obter_turno_atual(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Retorna os dados do turno de caixa atual aberto para o tenant."""
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    turno = db.query(CaixaTurno).filter_by(restaurante_id=rest_id, status="aberto").first()
    if not turno:
        return None

    movs = db.query(CaixaMovimentacao).filter_by(turno_id=turno.id).all()
    pags = db.query(Pagamento).filter_by(restaurante_id=rest_id, turno_id=turno.id, status="aprovado").all()

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
        elif p.metodo in ["cartao", "cartao_debito", "cartao_credito"]:
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


@router.get("/movimentacoes", response_model=List[CaixaMovimentacaoResponse])
def listar_movimentacoes_caixa(
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    tipo: Optional[str] = None,
    operador_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Lista histórico de movimentações de caixa para o tenant autenticado."""
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    query = db.query(CaixaMovimentacao).join(CaixaTurno, CaixaMovimentacao.turno_id == CaixaTurno.id).filter(
        CaixaTurno.restaurante_id == rest_id
    )

    if tipo:
        query = query.filter(CaixaMovimentacao.tipo == tipo)
    if operador_id:
        query = query.filter(CaixaMovimentacao.usuario_id == operador_id)
    if data_inicio:
        try:
            dt_ini = datetime.datetime.fromisoformat(data_inicio)
            query = query.filter(CaixaMovimentacao.criado_em >= dt_ini)
        except ValueError:
            pass
    if data_fim:
        try:
            dt_fim = datetime.datetime.fromisoformat(data_fim)
            query = query.filter(CaixaMovimentacao.criado_em <= dt_fim)
        except ValueError:
            pass

    movs = query.order_by(CaixaMovimentacao.criado_em.desc()).all()

    result = []
    for m in movs:
        op_nome = None
        if m.usuario_id:
            op_user = db.query(Usuario).filter_by(id=m.usuario_id).first()
            if op_user:
                op_nome = op_user.nome

        result.append(CaixaMovimentacaoResponse(
            id=m.id,
            turno_id=m.turno_id,
            usuario_id=m.usuario_id,
            usuario_nome=op_nome,
            tipo=m.tipo,
            valor=m.valor,
            saldo_anterior=m.saldo_anterior or 0.0,
            saldo_posterior=m.saldo_posterior or 0.0,
            descricao=m.descricao or "",
            observacao=m.observacao or "",
            criado_em=m.criado_em
        ))
    return result


@router.post("/turno/movimentar", response_model=CaixaMovimentacaoResponse, status_code=status.HTTP_201_CREATED)
def movimentar_turno(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    tipo = str(payload.get("tipo", "")).lower()
    valor = float(payload.get("valor", 0.0))
    desc = str(payload.get("descricao", payload.get("observacao", "")))
    if tipo == "sangria":
        return registrar_sangria(SangriaCreate(valor=valor, observacao=desc), db=db, current_user=current_user)
    else:
        return registrar_suprimento(SuprimentoCreate(valor=valor, observacao=desc), db=db, current_user=current_user)


@router.post("/sangria", response_model=CaixaMovimentacaoResponse, status_code=status.HTTP_201_CREATED)
def registrar_sangria(
    sangria_in: SangriaCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Registra uma sangria no turno aberto com validação de saldo disponível."""
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    if sangria_in.valor <= 0:
        raise HTTPException(status_code=400, detail="O valor da sangria deve ser maior que zero.")

    turno = db.query(CaixaTurno).filter_by(restaurante_id=rest_id, status="aberto").first()
    if not turno:
        raise HTTPException(status_code=400, detail="Não há nenhum turno de caixa aberto no momento.")

    pags_dinheiro = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.turno_id == turno.id,
        Pagamento.metodo == "dinheiro",
        Pagamento.status == "aprovado"
    ).all()
    total_dinheiro = sum(p.valor for p in pags_dinheiro)

    movs = db.query(CaixaMovimentacao).filter_by(turno_id=turno.id).all()
    total_suprimentos = sum(m.valor for m in movs if m.tipo == "suprimento")
    total_sangrias = sum(m.valor for m in movs if m.tipo == "sangria")

    saldo_disponivel = turno.saldo_inicial + total_dinheiro + total_suprimentos - total_sangrias

    if sangria_in.valor > saldo_disponivel:
        raise HTTPException(
            status_code=400,
            detail=f"Sangria de R$ {sangria_in.valor:.2f} excede o saldo em dinheiro disponível no caixa (R$ {saldo_disponivel:.2f})."
        )

    saldo_posterior = saldo_disponivel - sangria_in.valor
    motivo_txt = sangria_in.motivo or "Sangria de caixa"

    nova_mov = CaixaMovimentacao(
        restaurante_id=rest_id,
        turno_id=turno.id,
        usuario_id=current_user.id if current_user else None,
        tipo="sangria",
        valor=sangria_in.valor,
        saldo_anterior=saldo_disponivel,
        saldo_posterior=saldo_posterior,
        descricao=motivo_txt,
        observacao=sangria_in.observacao or "",
        criado_em=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(nova_mov)
    db.commit()
    db.refresh(nova_mov)

    return CaixaMovimentacaoResponse(
        id=nova_mov.id,
        turno_id=nova_mov.turno_id,
        usuario_id=nova_mov.usuario_id,
        usuario_nome=current_user.nome if current_user else None,
        tipo=nova_mov.tipo,
        valor=nova_mov.valor,
        saldo_anterior=nova_mov.saldo_anterior,
        saldo_posterior=nova_mov.saldo_posterior,
        descricao=nova_mov.descricao,
        observacao=nova_mov.observacao,
        criado_em=nova_mov.criado_em
    )


@router.post("/suprimento", response_model=CaixaMovimentacaoResponse, status_code=status.HTTP_201_CREATED)
def registrar_suprimento(
    suprimento_in: SuprimentoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Registra um suprimento no turno aberto do tenant."""
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    if suprimento_in.valor <= 0:
        raise HTTPException(status_code=400, detail="O valor do suprimento deve ser maior que zero.")

    turno = db.query(CaixaTurno).filter_by(restaurante_id=rest_id, status="aberto").first()
    if not turno:
        raise HTTPException(status_code=400, detail="Não há nenhum turno de caixa aberto no momento.")

    pags_dinheiro = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.turno_id == turno.id,
        Pagamento.metodo == "dinheiro",
        Pagamento.status == "aprovado"
    ).all()
    total_dinheiro = sum(p.valor for p in pags_dinheiro)

    movs = db.query(CaixaMovimentacao).filter_by(turno_id=turno.id).all()
    total_suprimentos = sum(m.valor for m in movs if m.tipo == "suprimento")
    total_sangrias = sum(m.valor for m in movs if m.tipo == "sangria")

    saldo_anterior = turno.saldo_inicial + total_dinheiro + total_suprimentos - total_sangrias
    saldo_posterior = saldo_anterior + suprimento_in.valor
    motivo_txt = suprimento_in.motivo or "Suprimento de troco"

    nova_mov = CaixaMovimentacao(
        restaurante_id=rest_id,
        turno_id=turno.id,
        usuario_id=current_user.id if current_user else None,
        tipo="suprimento",
        valor=suprimento_in.valor,
        saldo_anterior=saldo_anterior,
        saldo_posterior=saldo_posterior,
        descricao=motivo_txt,
        observacao=suprimento_in.observacao or "",
        criado_em=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(nova_mov)
    db.commit()
    db.refresh(nova_mov)

    return CaixaMovimentacaoResponse(
        id=nova_mov.id,
        turno_id=nova_mov.turno_id,
        usuario_id=nova_mov.usuario_id,
        usuario_nome=current_user.nome if current_user else None,
        tipo=nova_mov.tipo,
        valor=nova_mov.valor,
        saldo_anterior=nova_mov.saldo_anterior,
        saldo_posterior=nova_mov.saldo_posterior,
        descricao=nova_mov.descricao,
        observacao=nova_mov.observacao,
        criado_em=nova_mov.criado_em
    )


@router.post("/fechamento", response_model=FechamentoCaixaResponse)
@router.post("/turno/fechar", response_model=FechamentoCaixaResponse)
def fechar_turno_caixa(
    req: FechamentoCaixaRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Encerra o turno de caixa ativo via conferência cega e calcula sobra ou falta."""
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    turno = db.query(CaixaTurno).filter_by(restaurante_id=rest_id, status="aberto").first()
    if not turno:
        raise HTTPException(status_code=400, detail="Não há nenhum turno de caixa aberto para ser fechado.")

    if req.declarado_dinheiro < 0 or req.declarado_cartao < 0 or req.declarado_pix < 0:
        raise HTTPException(status_code=400, detail="Os valores declarados não podem ser negativos.")

    pags = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.turno_id == turno.id,
        Pagamento.status == "aprovado"
    ).all()

    esperado_dinheiro_vendas = sum(p.valor for p in pags if p.metodo == "dinheiro")
    esperado_pix = sum(p.valor for p in pags if p.metodo == "pix")
    esperado_cartao = sum(p.valor for p in pags if p.metodo in ["cartao", "cartao_debito", "cartao_credito"])

    movs = db.query(CaixaMovimentacao).filter_by(turno_id=turno.id).all()
    total_suprimentos = sum(m.valor for m in movs if m.tipo == "suprimento")
    total_sangrias = sum(m.valor for m in movs if m.tipo == "sangria")

    esperado_dinheiro = turno.saldo_inicial + esperado_dinheiro_vendas + total_suprimentos - total_sangrias

    diferenca_dinheiro = req.declarado_dinheiro - esperado_dinheiro
    diferenca_cartao = req.declarado_cartao - esperado_cartao
    diferenca_pix = req.declarado_pix - esperado_pix

    total_declarado = req.declarado_dinheiro + req.declarado_cartao + req.declarado_pix
    total_esperado = esperado_dinheiro + esperado_cartao + esperado_pix
    diferenca_total = total_declarado - total_esperado

    fechado_em = datetime.datetime.now(datetime.timezone.utc)
    turno.fechado_em = fechado_em
    turno.fechado_por_id = current_user.id if current_user else None
    turno.declarado_dinheiro = req.declarado_dinheiro
    turno.declarado_cartao = req.declarado_cartao
    turno.declarado_pix = req.declarado_pix
    turno.observacao = req.observacao
    turno.status = "fechado"

    db.commit()

    return FechamentoCaixaResponse(
        turno_id=turno.id,
        status="fechado",
        fechado_em=fechado_em,
        fechado_por_nome=current_user.nome if current_user else "Operador",
        declarado_dinheiro=req.declarado_dinheiro,
        esperado_dinheiro=esperado_dinheiro,
        diferenca_dinheiro=diferenca_dinheiro,
        declarado_cartao=req.declarado_cartao,
        esperado_cartao=esperado_cartao,
        diferenca_cartao=diferenca_cartao,
        declarado_pix=req.declarado_pix,
        esperado_pix=esperado_pix,
        diferenca_pix=diferenca_pix,
        total_declarado=total_declarado,
        total_esperado=total_esperado,
        diferenca_total=diferenca_total
    )


# ----------------- COMPATIBLE/INTEGRATED PAYMENTS ENDPOINT -----------------

@router.post("/comandas/{comanda_id}/pagar", response_model=PagamentoResponse, status_code=status.HTTP_201_CREATED)
def registrar_pagamento_comanda(
    comanda_id: str,
    pag_in: PagamentoRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """Registra o recebimento financeiro parcial ou total de uma comanda."""
    # Idempotency Check
    if pag_in.idempotency_key:
        existing = db.query(Pagamento).filter(
            Pagamento.restaurante_id == require_tenant_id(),
            Pagamento.idempotency_key == pag_in.idempotency_key
        ).first()
        if existing:
            return existing

    # 1. Check if there is an active shift FOR THIS TENANT
    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == require_tenant_id(),
        CaixaTurno.status == "aberto"
    ).first()
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
    if pag_in.metodo not in ["dinheiro", "pix", "cartao", "cartao_debito", "cartao_credito"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Método de pagamento inválido. Use 'dinheiro', 'pix', 'cartao_debito' ou 'cartao_credito'."
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
                
            # Settle selected items only if the payment valor covers their subtotal
            subtotal_selecionado = sum(item.preco_unit for item in itens_selecionados)
            if pag_in.valor >= round(subtotal_selecionado, 2) - 0.01:
                for item in itens_selecionados:
                    item.pago = True

    # Create the Pagamento transaction
    novo_pagamento = Pagamento(
        id=f"p-{uuid.uuid4().hex[:8]}",
        restaurante_id=current_restaurante_id.get(),
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
        total_com_taxa = round(subtotal_total * 1.10, 2)
        
        if total_de_itens_pendentes == 0 or comanda.valor_pago >= subtotal_total or comanda.valor_pago >= total_com_taxa:
            # Mark all active items as paid just in case
            for i in comanda.itens:
                if i.status != 'cancelado':
                    i.pago = True
            # Close comanda
            comanda.fechada = True
            comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)
            if comanda.mesa_id:
                other_open = db.query(Comanda).filter(
                    Comanda.mesa_id == comanda.mesa_id,
                    Comanda.fechada == False,
                    Comanda.id != comanda.id
                ).first()
                if not other_open:
                    background_tasks.add_task(manager.broadcast, {
                        "event": "MESA_ATUALIZADA",
                        "data": {
                            "mesa_id": comanda.mesa_id,
                            "status": "livre",
                            "comanda_id": None
                        }
                    })
            
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
                fidel_config = db.query(ConfigFidelizacao).filter(
                    ConfigFidelizacao.restaurante_id == comanda.restaurante_id
                ).first()
                if fidel_config and fidel_config.ativo:
                    total_pago = comanda.valor_pago
                    if fidel_config.tipo_recompensa == "PONTOS":
                        delta_val = round(total_pago * fidel_config.taxa_conversao, 2)
                    else: # CASHBACK
                        delta_val = round(total_pago * (fidel_config.taxa_conversao / 100.0), 2)
                    
                    # Create loyalty log
                    try:
                        mov_fidel = HistoricoFidelidade(
                            cliente_telefone=client_cpf,
                            tipo_movimentacao="ACUMULO",
                            valor_delta=delta_val
                        )
                        db.add(mov_fidel)
                    except HTTPException:
                        raise
                    except Exception:
                        db.rollback()
                        logger.exception("Falha ao processar dado sensível criptografado")
                        raise HTTPException(
                            status_code=500,
                            detail="Erro ao processar dado sensível, contate o suporte."
                        )
                    
    try:
        db.commit()
    except HTTPException:
        raise
    except IntegrityError:
        db.rollback()
        if pag_in.idempotency_key:
            existing = db.query(Pagamento).filter(
                Pagamento.restaurante_id == require_tenant_id(),
                Pagamento.idempotency_key == pag_in.idempotency_key
            ).first()
            if existing:
                return existing
        logger.exception("Falha de integridade ao processar pagamento idempotente")
        raise HTTPException(
            status_code=500,
            detail="Erro interno ao processar pagamento."
        )
    except Exception:
        db.rollback()
        logger.exception("Falha ao processar dado sensível criptografado")
        raise HTTPException(
            status_code=500,
            detail="Erro ao processar dado sensível, contate o suporte."
        )
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
    return db.query(Pagamento).filter(
        Pagamento.restaurante_id == current_user.restaurante_id,
        Pagamento.status == "pendente"
    ).all()


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
    total_com_taxa = round(subtotal_total * 1.10, 2)
    
    if total_de_itens_pendentes == 0 or comanda.valor_pago >= subtotal_total or comanda.valor_pago >= total_com_taxa:
        for i in comanda.itens:
            if i.status != 'cancelado':
                i.pago = True
        comanda.fechada = True
        comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)
        if comanda.mesa_id:
            other_open = db.query(Comanda).filter(
                Comanda.mesa_id == comanda.mesa_id,
                Comanda.fechada == False,
                Comanda.id != comanda.id
            ).first()
            if not other_open:
                background_tasks.add_task(manager.broadcast, {
                    "event": "MESA_ATUALIZADA",
                    "data": {
                        "mesa_id": comanda.mesa_id,
                        "status": "livre",
                        "comanda_id": None
                    }
                })
        
    db.commit()
    db.refresh(pagamento)
    db.refresh(comanda)
    
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, require_tenant_id())
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
    
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, require_tenant_id())
    return pagamento


from ..models import ConfiguracaoRestaurante
from ..schemas import ConfiguracaoRestauranteResponse, ConfiguracaoRestauranteUpdate
from sqlalchemy.orm import joinedload

@router.get("/configuracoes", response_model=ConfiguracaoRestauranteResponse)
def obter_configuracoes(
    restaurante_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    # Rota pública de leitura: carregada pelo frontend antes do login.
    # Prioridade: (1) contexto autenticado, (2) query param, (3) 401.
    rest_id = current_restaurante_id.get()
    if rest_id is None:
        if restaurante_id is not None:
            rest_id = restaurante_id
        else:
            # Sem contexto e sem query param: usa 1 apenas como fallback
            # de desenvolvimento (sistema single-tenant atual).
            rest_id = 1

    token_var = current_restaurante_id.set(rest_id)
    try:
        config = db.query(ConfiguracaoRestaurante).options(joinedload(ConfiguracaoRestaurante.restaurante)).filter(ConfiguracaoRestaurante.restaurante_id == rest_id).first()
        if not config:
            config = ConfiguracaoRestaurante(
                restaurante_id=rest_id,
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
    finally:
        current_restaurante_id.reset(token_var)


@router.put("/configuracoes", response_model=ConfiguracaoRestauranteResponse)
def atualizar_configuracoes(
    config_in: ConfiguracaoRestauranteUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("configuracoes:administrar"))
):
    config = db.query(ConfiguracaoRestaurante).options(joinedload(ConfiguracaoRestaurante.restaurante)).filter(
        ConfiguracaoRestaurante.restaurante_id == current_user.restaurante_id
    ).first()
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
    if config_in.plano is not None:
        if config.restaurante:
            config.restaurante.plano = config_in.plano.lower()
        
    db.commit()
    db.refresh(config)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, require_tenant_id())
    return config


# ----------------- CONFIGURAÇÕES WHITELABEL DO RESTAURANTE -----------------
from ..database import current_restaurante_id
from ..models import Restaurante
from ..schemas import RestauranteConfigResponse, RestauranteConfigUpdate

@router.get("/restaurante/config", response_model=RestauranteConfigResponse)
@router.get("/config-cardapio", response_model=RestauranteConfigResponse)
@router.get("/config-cardapio/{tenant_id}", response_model=RestauranteConfigResponse)
def obter_configuracao_restaurante(
    tenant_id: Optional[Union[int, str]] = None,
    db: Session = Depends(get_db),
    current_user: Optional[Usuario] = Depends(get_current_garcom_optional)
):
    """Obtém as configurações whitelabel de personalização do restaurante ativo."""
    rest_id = None
    slug = None
    if tenant_id:
        if str(tenant_id).isdigit():
            rest_id = int(tenant_id)
        else:
            slug = str(tenant_id)

    if not rest_id and not slug:
        rest_id = current_restaurante_id.get() or (current_user.tenant_id if current_user else None) or 1
    
    restaurante = None
    if slug:
        restaurante = db.query(Restaurante).filter(Restaurante.slug == slug).first()
    if not restaurante and rest_id:
        restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        restaurante = db.query(Restaurante).filter(Restaurante.id == 1).first()

    if not restaurante:
        rest_id = rest_id or 1
        return RestauranteConfigResponse(
            id=rest_id,
            nome="Kôma Gourmet Bistrô",
            subtitulo="Sincronizado com o Sistema Kôma PDV",
            status_override="Automático",
            cor_primaria="#00b894",
            cor_fundo="#090a0f"
        )
        
    return restaurante


@router.put("/restaurante/config", response_model=RestauranteConfigResponse)
@router.post("/restaurante/config", response_model=RestauranteConfigResponse)
@router.put("/config-cardapio", response_model=RestauranteConfigResponse)
@router.post("/config-cardapio", response_model=RestauranteConfigResponse)
@router.put("/config-cardapio/{tenant_id}", response_model=RestauranteConfigResponse)
@router.post("/config-cardapio/{tenant_id}", response_model=RestauranteConfigResponse)
def atualizar_configuracao_restaurante(
    config_in: RestauranteConfigUpdate,
    background_tasks: BackgroundTasks,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("configuracoes:administrar"))
):
    """Atualiza e persiste as configurações whitelabel de personalização do restaurante ativo."""
    rest_id = tenant_id or require_tenant_id() or getattr(current_user, "tenant_id", None) or getattr(current_user, "restaurante_id", None) or 1
    
    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        restaurante = Restaurante(
            id=rest_id,
            nome="Kôma Gourmet Bistrô",
            plano="pocket",
            status_override="Automático",
            cor_primaria="#00b894",
            cor_fundo="#090a0f"
        )
        db.add(restaurante)
        
    if config_in.nome is not None:
        restaurante.nome = config_in.nome
    if config_in.slug is not None:
        restaurante.slug = config_in.slug
    if config_in.logo_url is not None:
        restaurante.logo_url = config_in.logo_url
    if config_in.banner_url is not None:
        restaurante.banner_url = config_in.banner_url
    if config_in.subtitulo is not None:
        restaurante.subtitulo = config_in.subtitulo
    if config_in.sobre_nos is not None:
        restaurante.sobre_nos = config_in.sobre_nos
    if config_in.endereco is not None:
        restaurante.endereco = config_in.endereco
    if config_in.google_maps_url is not None:
        restaurante.google_maps_url = config_in.google_maps_url
    if config_in.latitude is not None:
        restaurante.latitude = config_in.latitude
    if config_in.longitude is not None:
        restaurante.longitude = config_in.longitude
    if config_in.status_override is not None:
        restaurante.status_override = config_in.status_override
    if config_in.socials is not None:
        restaurante.socials = config_in.socials
    if config_in.horarios_funcionamento is not None:
        restaurante.horarios_funcionamento = config_in.horarios_funcionamento
    if config_in.formas_pagamento_aceitas is not None:
        restaurante.formas_pagamento_aceitas = config_in.formas_pagamento_aceitas
    if config_in.cor_primaria is not None:
        restaurante.cor_primaria = config_in.cor_primaria
    if config_in.cor_fundo is not None:
        restaurante.cor_fundo = config_in.cor_fundo
        
    db.commit()
    db.refresh(restaurante)
    
    restaurante_data = {
        "id": restaurante.id,
        "nome": restaurante.nome,
        "slug": restaurante.slug,
        "logo_url": restaurante.logo_url,
        "banner_url": restaurante.banner_url,
        "subtitulo": restaurante.subtitulo,
        "sobre_nos": restaurante.sobre_nos,
        "endereco": restaurante.endereco,
        "google_maps_url": restaurante.google_maps_url,
        "latitude": restaurante.latitude,
        "longitude": restaurante.longitude,
        "status_override": restaurante.status_override,
        "socials": restaurante.socials,
        "horarios_funcionamento": restaurante.horarios_funcionamento,
        "formas_pagamento_aceitas": restaurante.formas_pagamento_aceitas,
        "cor_primaria": restaurante.cor_primaria,
        "cor_fundo": restaurante.cor_fundo
    }
    
    background_tasks.add_task(
        manager.broadcast,
        {"event": "CONFIG_UPDATE", "data": restaurante_data},
        rest_id
    )
    background_tasks.add_task(
        manager.broadcast,
        {"type": "catalog_updated", "message": "Configurações visuais atualizadas"},
        rest_id
    )
    
    return restaurante


@router.put("/config-cardapio", response_model=RestauranteConfigResponse)
@router.post("/config-cardapio", response_model=RestauranteConfigResponse)
def atualizar_config_cardapio(
    config_in: RestauranteConfigUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("configuracoes:administrar"))
):
    """Atualiza as configurações whitelabel de personalização do restaurante ativo via config-cardapio."""
    return atualizar_configuracao_restaurante(config_in, background_tasks, None, db, current_user)


from pydantic import BaseModel

class UpdatePlanoRequest(BaseModel):
    plano: str

@router.put("/plano")
def atualizar_plano_restaurante(
    payload: UpdatePlanoRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("configuracoes:administrar"))
):
    """Atualiza o plano do restaurante ativo."""
    plano_val = payload.plano.lower()
    if plano_val not in ['pocket', 'bistro', 'delivery', 'premium']:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Plano inválido. Deve ser um de: pocket, bistro, delivery, premium"
        )
    rest_id = require_tenant_id()
    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado"
        )
    restaurante.plano = plano_val
    db.commit()
    db.refresh(restaurante)
    
    return {
        "success": True,
        "plano": restaurante.plano,
        "id": restaurante.id,
        "nome": restaurante.nome
    }
