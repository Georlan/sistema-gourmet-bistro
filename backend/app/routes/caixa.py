from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import and_, case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List, Optional, Union
from decimal import Decimal, ROUND_HALF_UP
import uuid
import datetime
import logging

import re
from ..database import get_db, current_restaurante_id, require_tenant_id
from ..models import (
    Usuario, Comanda, Item, CaixaTurno, CaixaMovimentacao, Pagamento,
    ConfiguracaoRestaurante, ConfigFidelizacao, HistoricoFidelidade, Cliente,
)
from ..schemas import (
    CaixaTurnoCreate, CaixaTurnoResponse, CaixaTurnoFechar, CaixaTurnoDetalhe,
    CaixaMovimentacaoCreate, CaixaMovimentacaoResponse, PagamentoRequest,
    PagamentoMesaRequest, PagamentoResponse,
    UsuarioResponse, UsuarioCreate, SangriaCreate, SuprimentoCreate, CaixaTurnoResumoResponse,
    FechamentoCaixaRequest, FechamentoCaixaResponse
)
from ..security import (
    ensure_permission,
    get_current_garcom_optional,
    get_current_user,
    require_permission,
)
from ..subscription import (
    get_effective_subscription_plan,
    is_test_premium_restaurant,
)
from .websocket import manager
from ..services.clientes import (
    buscar_cliente_por_id,
    buscar_cliente_por_telefone,
    cadastrar_ou_atualizar_cliente,
    registrar_movimento_fidelidade,
)
from ..services.whatsapp import enviar_texto_whatsapp

logger = logging.getLogger("koma.caixa")

router = APIRouter(
    prefix="/caixa",
    tags=["Caixa / PDV"]
)

_CENTAVO = Decimal("0.01")
_METODOS_PAGAMENTO = {
    "dinheiro",
    "pix",
    "cartao",
    "cartao_debito",
    "cartao_credito",
}


def _valor_monetario(valor: object) -> Decimal:
    return Decimal(str(valor or 0)).quantize(_CENTAVO, rounding=ROUND_HALF_UP)


def _totais_financeiros_turno(
    db: Session,
    restaurante_id: int,
    turno: CaixaTurno,
) -> dict[str, Union[Decimal, int]]:
    """Uma única regra para resumo, sangria, suprimento e fechamento."""
    pagamentos = db.query(
        func.coalesce(func.sum(Pagamento.valor), 0).label("total_vendas"),
        func.coalesce(func.sum(case(
            (Pagamento.metodo == "dinheiro", Pagamento.valor),
            else_=0,
        )), 0).label("total_dinheiro"),
        func.coalesce(func.sum(case(
            (Pagamento.metodo == "pix", Pagamento.valor),
            else_=0,
        )), 0).label("total_pix"),
        func.coalesce(func.sum(case(
            (Pagamento.metodo.in_(("cartao", "cartao_debito", "cartao_credito")), Pagamento.valor),
            else_=0,
        )), 0).label("total_cartao"),
        func.count(func.distinct(Pagamento.comanda_id)).label("total_pedidos_pagos"),
    ).filter(
        Pagamento.restaurante_id == restaurante_id,
        Pagamento.turno_id == turno.id,
        Pagamento.status == "aprovado",
    ).one()

    movimentacoes = db.query(
        func.coalesce(func.sum(case(
            (CaixaMovimentacao.tipo == "suprimento", CaixaMovimentacao.valor),
            else_=0,
        )), 0).label("total_suprimentos"),
        func.coalesce(func.sum(case(
            (CaixaMovimentacao.tipo == "sangria", CaixaMovimentacao.valor),
            else_=0,
        )), 0).label("total_sangrias"),
    ).filter(
        CaixaMovimentacao.restaurante_id == restaurante_id,
        CaixaMovimentacao.turno_id == turno.id,
    ).one()

    saldo_inicial = _valor_monetario(turno.saldo_inicial)
    total_dinheiro = _valor_monetario(pagamentos.total_dinheiro)
    total_suprimentos = _valor_monetario(movimentacoes.total_suprimentos)
    total_sangrias = _valor_monetario(movimentacoes.total_sangrias)

    return {
        "total_vendas": _valor_monetario(pagamentos.total_vendas),
        "total_dinheiro": total_dinheiro,
        "total_pix": _valor_monetario(pagamentos.total_pix),
        "total_cartao": _valor_monetario(pagamentos.total_cartao),
        "total_pedidos_pagos": int(pagamentos.total_pedidos_pagos or 0),
        "total_suprimentos": total_suprimentos,
        "total_sangrias": total_sangrias,
        "saldo_esperado_dinheiro": _valor_monetario(
            saldo_inicial + total_dinheiro + total_suprimentos - total_sangrias
        ),
    }


def _comandas_abertas_count(db: Session, restaurante_id: int) -> int:
    """Conta contas ainda operacionais usando a mesma fonte de verdade do PDV."""
    return int(db.query(func.count(Comanda.id)).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.fechada == False,
    ).scalar() or 0)


def _atividades_recentes_turno(
    db: Session,
    restaurante_id: int,
    turno: CaixaTurno,
    limite: int = 10,
) -> tuple[list[dict], Optional[dict]]:
    """Combina os últimos recebimentos e ajustes sem carregar o histórico inteiro."""
    limite_seguro = max(1, min(limite, 20))

    pagamentos = db.query(Pagamento, Comanda).join(
        Comanda,
        and_(
            Pagamento.restaurante_id == Comanda.restaurante_id,
            Pagamento.comanda_id == Comanda.id,
        ),
    ).filter(
        Pagamento.restaurante_id == restaurante_id,
        Pagamento.turno_id == turno.id,
        Pagamento.status == "aprovado",
    ).order_by(
        Pagamento.criado_em.desc(),
        Pagamento.id.desc(),
    ).limit(limite_seguro).all()

    movimentacoes = db.query(CaixaMovimentacao, Usuario).outerjoin(
        Usuario,
        and_(
            CaixaMovimentacao.usuario_id == Usuario.id,
            CaixaMovimentacao.restaurante_id == Usuario.restaurante_id,
        ),
    ).filter(
        CaixaMovimentacao.restaurante_id == restaurante_id,
        CaixaMovimentacao.turno_id == turno.id,
    ).order_by(
        CaixaMovimentacao.criado_em.desc(),
        CaixaMovimentacao.id.desc(),
    ).limit(limite_seguro).all()

    atividades: list[dict] = []
    for pagamento, comanda in pagamentos:
        tipo_comanda = (comanda.tipo or "").strip().lower()
        if comanda.mesa_id:
            origem = f"Mesa {comanda.mesa_id}"
        elif "retirada" in tipo_comanda:
            origem = f"Retirada #{comanda.numero_pedido}"
        elif tipo_comanda in {"entrega", "delivery"}:
            origem = f"Delivery #{comanda.numero_pedido}"
        else:
            origem = f"Pedido #{comanda.numero_pedido}"

        atividades.append({
            "id": f"pagamento:{pagamento.id}",
            "tipo": "recebimento",
            "valor": pagamento.valor,
            "metodo": pagamento.metodo,
            "origem": origem,
            "descricao": "Venda recebida",
            "operador_nome": None,
            "criado_em": pagamento.criado_em,
        })

    for movimentacao, usuario in movimentacoes:
        atividades.append({
            "id": f"movimentacao:{movimentacao.id}",
            "tipo": movimentacao.tipo,
            "valor": movimentacao.valor,
            "metodo": "dinheiro",
            "origem": "Caixa",
            "descricao": movimentacao.descricao or movimentacao.observacao or "Movimentação manual",
            "operador_nome": usuario.nome if usuario else None,
            "criado_em": movimentacao.criado_em,
        })

    def timestamp_utc(atividade: dict) -> float:
        criado_em = atividade.get("criado_em")
        if not criado_em:
            return 0.0
        if criado_em.tzinfo is None:
            criado_em = criado_em.replace(tzinfo=datetime.timezone.utc)
        return criado_em.timestamp()

    ultima_movimentacao = next(
        (
            atividade
            for atividade in atividades
            if atividade["tipo"] in {"suprimento", "sangria"}
        ),
        None,
    )
    atividades.sort(key=timestamp_utc, reverse=True)
    return atividades[:limite_seguro], ultima_movimentacao


def check_caixa_permission(
    user: Usuario,
    permission: str = "caixa:operar"
):
    return ensure_permission(user, permission)

# ----------------- FUNCIONÁRIOS / EQUIPE ENDPOINTS -----------------

@router.get("/funcionarios", response_model=List[UsuarioResponse])
def obter_funcionarios(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("equipe:administrar"))
):
    """Retorna a lista de usuários pertencentes ao restaurante_id do contexto ativo."""
    rest_id = require_tenant_id()
    return db.query(Usuario).filter(Usuario.restaurante_id == rest_id).all()


@router.post("/funcionarios", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
def cadastrar_funcionario(
    user_in: UsuarioCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("equipe:administrar"))
):
    """Cadastra um novo funcionário por convite de telefone."""
    tel_clean = re.sub(r"\D", "", user_in.telefone)
    if not 10 <= len(tel_clean) <= 15:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Informe um telefone válido com 10 a 15 dígitos."
        )

    rest_id = require_tenant_id()
    existente = db.query(Usuario).filter(
        Usuario.restaurante_id == rest_id,
        Usuario.telefone == tel_clean,
    ).first()
    if existente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este telefone já está cadastrado no sistema"
        )
        
    token_convite = str(uuid.uuid4())
    token_expira_em = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)

    novo_usuario = Usuario(
        id=str(uuid.uuid4())[:8],
        nome=user_in.nome,
        telefone=tel_clean,
        cargo=user_in.cargo,
        restaurante_id=rest_id,
        senha_hash=None,
        token_convite=token_convite,
        token_expira_em=token_expira_em,
        status="pendente_ativacao",
        created_at=datetime.datetime.now(datetime.timezone.utc)
    )
    
    db.add(novo_usuario)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Telefone indisponível para cadastro.",
        )
    db.refresh(novo_usuario)
    
    convite_link = f"https://sistema-gourmet-bistro.pages.dev/ativar?token={token_convite}"
    mensagem_texto = f"Olá {novo_usuario.nome}! Você foi convidado para trabalhar no Kôma. Clique no link para criar sua senha e ativar sua conta: {convite_link}"
    evolution_sent = enviar_texto_whatsapp(
        tel_clean,
        mensagem_texto,
        contexto="convite de funcionário",
    )

    if not evolution_sent:
        logger.info(
            "[WHATSAPP SIMULADO] Convite disponível para usuario_id=%s",
            novo_usuario.id,
        )

    return novo_usuario


# ----------------- TURNO ENDPOINTS -----------------

@router.post("/turno/abrir", response_model=CaixaTurnoResponse, status_code=status.HTTP_201_CREATED)
def abrir_turno(
    turno_in: CaixaTurnoCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """Abre um novo turno de caixa com um saldo de troco inicial."""
    check_caixa_permission(current_user)
    
    rest_id = require_tenant_id()

    # A restrição parcial no banco também protege contra duas aberturas simultâneas.
    turno_ativo = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == rest_id,
        CaixaTurno.status == "aberto"
    ).first()
    if turno_ativo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Já existe um turno de caixa aberto. Feche o anterior antes de abrir um novo."
        )
        
    novo_turno = CaixaTurno(
        restaurante_id=rest_id,
        aberto_por_id=current_user.id,
        aberto_em=datetime.datetime.now(datetime.timezone.utc),
        saldo_inicial=turno_in.saldo_inicial,
        status="aberto"
    )
    db.add(novo_turno)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        turno_concorrente = db.query(CaixaTurno).filter(
            CaixaTurno.restaurante_id == rest_id,
            CaixaTurno.status == "aberto",
        ).first()
        if turno_concorrente:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Outro turno de caixa já foi aberto para este restaurante.",
            )
        logger.exception("Falha de integridade ao abrir turno de caixa")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não foi possível abrir o turno com os valores informados.",
        )
    db.refresh(novo_turno)
    background_tasks.add_task(
        manager.broadcast,
        {"event": "cash_updated", "detail": {"type": "turno_aberto"}},
        rest_id,
    )
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
            comandas_abertas_count=_comandas_abertas_count(db, rest_id),
            atividades_recentes=[],
            ultima_movimentacao=None,
            resumo_dia=None
        )

    operador = db.query(Usuario).filter_by(id=turno.aberto_por_id, restaurante_id=rest_id).first()
    operador_nome = operador.nome if operador else "Operador"

    totals = _totais_financeiros_turno(db, rest_id, turno)
    atividades_recentes, ultima_atividade_caixa = _atividades_recentes_turno(
        db,
        rest_id,
        turno,
    )

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    aberto_dt = turno.aberto_em
    if aberto_dt.tzinfo is None:
        aberto_dt = aberto_dt.replace(tzinfo=datetime.timezone.utc)
    tempo_minutos = int((now_utc - aberto_dt).total_seconds() / 60)

    ult_mov = None
    if ultima_atividade_caixa:
        ult_mov = {
            "id": int(ultima_atividade_caixa["id"].split(":")[-1]),
            "tipo": ultima_atividade_caixa["tipo"],
            "valor": ultima_atividade_caixa["valor"],
            "descricao": ultima_atividade_caixa["descricao"],
            "criado_em": ultima_atividade_caixa["criado_em"],
            "operador_nome": ultima_atividade_caixa["operador_nome"] or operador_nome,
        }

    return CaixaTurnoResumoResponse(
        turno_id=turno.id,
        status="aberto",
        operador_id=turno.aberto_por_id,
        operador_nome=operador_nome,
        aberto_em=turno.aberto_em,
        tempo_aberto_minutos=max(0, tempo_minutos),
        turno_esquecido=(tempo_minutos > 1440),
        saldo_inicial=turno.saldo_inicial,
        total_vendas=totals["total_vendas"],
        total_dinheiro=totals["total_dinheiro"],
        total_pix=totals["total_pix"],
        total_cartao=totals["total_cartao"],
        total_sangrias=totals["total_sangrias"],
        total_suprimentos=totals["total_suprimentos"],
        saldo_esperado_dinheiro=totals["saldo_esperado_dinheiro"],
        total_pedidos_pagos=totals["total_pedidos_pagos"],
        comandas_abertas_count=_comandas_abertas_count(db, rest_id),
        atividades_recentes=atividades_recentes,
        ultima_movimentacao=ult_mov,
        resumo_dia={
            "total_vendas": totals["total_vendas"],
            "pedidos_pagos": totals["total_pedidos_pagos"],
        }
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

    movs = db.query(CaixaMovimentacao).filter_by(
        restaurante_id=rest_id,
        turno_id=turno.id,
    ).all()
    pags = db.query(Pagamento).filter_by(restaurante_id=rest_id, turno_id=turno.id, status="aprovado").all()
    totals = _totais_financeiros_turno(db, rest_id, turno)

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
        "total_esperado_dinheiro": totals["saldo_esperado_dinheiro"],
        "total_esperado_pix": totals["total_pix"],
        "total_esperado_cartao": totals["total_cartao"]
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
    """Lista até 100 ajustes recentes do tenant, com filtros e operador em uma consulta."""
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    query = db.query(CaixaMovimentacao, Usuario).join(
        CaixaTurno,
        and_(
            CaixaMovimentacao.turno_id == CaixaTurno.id,
            CaixaMovimentacao.restaurante_id == CaixaTurno.restaurante_id,
        ),
    ).outerjoin(
        Usuario,
        and_(
            CaixaMovimentacao.usuario_id == Usuario.id,
            CaixaMovimentacao.restaurante_id == Usuario.restaurante_id,
        ),
    ).filter(
        CaixaMovimentacao.restaurante_id == rest_id,
        CaixaTurno.restaurante_id == rest_id,
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

    rows = query.order_by(
        CaixaMovimentacao.criado_em.desc(),
        CaixaMovimentacao.id.desc(),
    ).limit(100).all()

    return [
        CaixaMovimentacaoResponse(
            id=movimentacao.id,
            turno_id=movimentacao.turno_id,
            usuario_id=movimentacao.usuario_id,
            usuario_nome=operador.nome if operador else None,
            tipo=movimentacao.tipo,
            valor=movimentacao.valor,
            saldo_anterior=movimentacao.saldo_anterior or 0.0,
            saldo_posterior=movimentacao.saldo_posterior or 0.0,
            descricao=movimentacao.descricao or "",
            observacao=movimentacao.observacao or "",
            criado_em=movimentacao.criado_em,
        )
        for movimentacao, operador in rows
    ]


@router.post("/turno/movimentar", response_model=CaixaMovimentacaoResponse, status_code=status.HTTP_201_CREATED)
def movimentar_turno(
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    tipo = str(payload.get("tipo", "")).lower()
    valor = float(payload.get("valor", 0.0))
    desc = str(payload.get("descricao", payload.get("observacao", "")))
    if tipo == "sangria":
        return registrar_sangria(
            SangriaCreate(valor=valor, observacao=desc),
            background_tasks=background_tasks,
            db=db,
            current_user=current_user,
        )
    else:
        return registrar_suprimento(
            SuprimentoCreate(valor=valor, observacao=desc),
            background_tasks=background_tasks,
            db=db,
            current_user=current_user,
        )


@router.post("/sangria", response_model=CaixaMovimentacaoResponse, status_code=status.HTTP_201_CREATED)
def registrar_sangria(
    sangria_in: SangriaCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Registra uma sangria no turno aberto com validação de saldo disponível."""
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    valor_sangria = _valor_monetario(sangria_in.valor)
    if valor_sangria <= 0:
        raise HTTPException(status_code=400, detail="O valor da sangria deve ser maior que zero.")

    turno = db.query(CaixaTurno).with_for_update().filter_by(
        restaurante_id=rest_id,
        status="aberto",
    ).first()
    if not turno:
        raise HTTPException(status_code=400, detail="Não há nenhum turno de caixa aberto no momento.")

    totals = _totais_financeiros_turno(db, rest_id, turno)
    saldo_disponivel = totals["saldo_esperado_dinheiro"]

    if valor_sangria > saldo_disponivel:
        raise HTTPException(
            status_code=400,
            detail=f"Sangria de R$ {valor_sangria:.2f} excede o saldo em dinheiro disponível no caixa (R$ {saldo_disponivel:.2f})."
        )

    saldo_posterior = _valor_monetario(saldo_disponivel - valor_sangria)
    motivo_txt = sangria_in.motivo or "Sangria de caixa"

    nova_mov = CaixaMovimentacao(
        restaurante_id=rest_id,
        turno_id=turno.id,
        usuario_id=current_user.id if current_user else None,
        tipo="sangria",
        valor=valor_sangria,
        saldo_anterior=saldo_disponivel,
        saldo_posterior=saldo_posterior,
        descricao=motivo_txt,
        observacao=sangria_in.observacao or "",
        criado_em=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(nova_mov)
    db.commit()
    db.refresh(nova_mov)
    background_tasks.add_task(
        manager.broadcast,
        {"event": "cash_updated", "detail": {"type": "sangria_registrada"}},
        rest_id,
    )

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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Registra um suprimento no turno aberto do tenant."""
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    valor_suprimento = _valor_monetario(suprimento_in.valor)
    if valor_suprimento <= 0:
        raise HTTPException(status_code=400, detail="O valor do suprimento deve ser maior que zero.")

    turno = db.query(CaixaTurno).with_for_update().filter_by(
        restaurante_id=rest_id,
        status="aberto",
    ).first()
    if not turno:
        raise HTTPException(status_code=400, detail="Não há nenhum turno de caixa aberto no momento.")

    totals = _totais_financeiros_turno(db, rest_id, turno)
    saldo_anterior = totals["saldo_esperado_dinheiro"]
    saldo_posterior = _valor_monetario(saldo_anterior + valor_suprimento)
    motivo_txt = suprimento_in.motivo or "Suprimento de troco"

    nova_mov = CaixaMovimentacao(
        restaurante_id=rest_id,
        turno_id=turno.id,
        usuario_id=current_user.id if current_user else None,
        tipo="suprimento",
        valor=valor_suprimento,
        saldo_anterior=saldo_anterior,
        saldo_posterior=saldo_posterior,
        descricao=motivo_txt,
        observacao=suprimento_in.observacao or "",
        criado_em=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(nova_mov)
    db.commit()
    db.refresh(nova_mov)
    background_tasks.add_task(
        manager.broadcast,
        {"event": "cash_updated", "detail": {"type": "suprimento_registrado"}},
        rest_id,
    )

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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    """Encerra o turno de caixa ativo via conferência cega e calcula sobra ou falta."""
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    turno = db.query(CaixaTurno).with_for_update().filter_by(
        restaurante_id=rest_id,
        status="aberto",
    ).first()
    if not turno:
        raise HTTPException(status_code=400, detail="Não há nenhum turno de caixa aberto para ser fechado.")

    if req.declarado_dinheiro < 0 or req.declarado_cartao < 0 or req.declarado_pix < 0:
        raise HTTPException(status_code=400, detail="Os valores declarados não podem ser negativos.")

    pagamentos_pendentes = int(db.query(func.count(Pagamento.id)).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.turno_id == turno.id,
        Pagamento.status == "pendente",
    ).scalar() or 0)
    comandas_abertas = _comandas_abertas_count(db, rest_id)
    if pagamentos_pendentes or comandas_abertas:
        pendencias = []
        if pagamentos_pendentes:
            pendencias.append(f"{pagamentos_pendentes} pagamento(s) aguardando confirmação")
        if comandas_abertas:
            pendencias.append(f"{comandas_abertas} comanda(s) ainda aberta(s)")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Resolva as pendências antes de fechar o caixa: "
                + " e ".join(pendencias)
                + "."
            ),
        )

    totals = _totais_financeiros_turno(db, rest_id, turno)
    esperado_dinheiro = totals["saldo_esperado_dinheiro"]
    esperado_pix = totals["total_pix"]
    esperado_cartao = totals["total_cartao"]

    declarado_dinheiro = _valor_monetario(req.declarado_dinheiro)
    declarado_cartao = _valor_monetario(req.declarado_cartao)
    declarado_pix = _valor_monetario(req.declarado_pix)
    diferenca_dinheiro = _valor_monetario(declarado_dinheiro - esperado_dinheiro)
    diferenca_cartao = _valor_monetario(declarado_cartao - esperado_cartao)
    diferenca_pix = _valor_monetario(declarado_pix - esperado_pix)

    total_declarado = _valor_monetario(declarado_dinheiro + declarado_cartao + declarado_pix)
    total_esperado = _valor_monetario(esperado_dinheiro + esperado_cartao + esperado_pix)
    diferenca_total = _valor_monetario(total_declarado - total_esperado)

    fechado_em = datetime.datetime.now(datetime.timezone.utc)
    turno.fechado_em = fechado_em
    turno.fechado_por_id = current_user.id if current_user else None
    turno.declarado_dinheiro = declarado_dinheiro
    turno.declarado_cartao = declarado_cartao
    turno.declarado_pix = declarado_pix
    turno.observacao = req.observacao
    turno.status = "fechado"

    db.commit()
    background_tasks.add_task(
        manager.broadcast,
        {"event": "cash_updated", "detail": {"type": "turno_fechado"}},
        rest_id,
    )

    return FechamentoCaixaResponse(
        turno_id=turno.id,
        status="fechado",
        fechado_em=fechado_em,
        fechado_por_nome=current_user.nome if current_user else "Operador",
        declarado_dinheiro=declarado_dinheiro,
        esperado_dinheiro=esperado_dinheiro,
        diferenca_dinheiro=diferenca_dinheiro,
        declarado_cartao=declarado_cartao,
        esperado_cartao=esperado_cartao,
        diferenca_cartao=diferenca_cartao,
        declarado_pix=declarado_pix,
        esperado_pix=esperado_pix,
        diferenca_pix=diferenca_pix,
        total_declarado=total_declarado,
        total_esperado=total_esperado,
        diferenca_total=diferenca_total
    )


# ----------------- COMPATIBLE/INTEGRATED PAYMENTS ENDPOINT -----------------

def _subtotal_ativo(comanda: Comanda) -> Decimal:
    return _valor_monetario(sum(
        Decimal(str(item.preco_unit or 0))
        for item in comanda.itens
        if item.status != "cancelado"
    ))


def _percentual_taxa_servico(
    incluir_taxa_servico: bool,
    config: Optional[ConfiguracaoRestaurante],
) -> Decimal:
    if not incluir_taxa_servico or not (
        config.taxa_servico_ativa if config else True
    ):
        return Decimal("0.00")

    taxa_configurada = (
        config.taxa_servico_padrao
        if config and config.taxa_servico_padrao is not None
        else 10.0
    )
    return Decimal(str(taxa_configurada))


def _debitos_da_mesa(
    comandas: List[Comanda],
    incluir_taxa_servico: bool,
    config: Optional[ConfiguracaoRestaurante],
):
    """Calcula o saldo de cada comanda sem usar o estado ``Item.pago``."""
    subtotais = [_subtotal_ativo(comanda) for comanda in comandas]
    subtotal_mesa = sum(subtotais, Decimal("0.00"))

    taxa_percentual = _percentual_taxa_servico(
        incluir_taxa_servico,
        config,
    )

    total_mesa = _valor_monetario(
        subtotal_mesa * (Decimal("1.00") + taxa_percentual / Decimal("100"))
    )

    # Arredonda por comanda, ajustando a última para que a soma seja exatamente
    # igual ao total monetário da mesa.
    totais_comanda: List[Decimal] = []
    acumulado = Decimal("0.00")
    for index, subtotal in enumerate(subtotais):
        if index == len(subtotais) - 1:
            total_comanda = total_mesa - acumulado
        else:
            total_comanda = _valor_monetario(
                subtotal * (Decimal("1.00") + taxa_percentual / Decimal("100"))
            )
            acumulado += total_comanda
        totais_comanda.append(max(Decimal("0.00"), total_comanda))

    debitos = []
    for comanda, total_comanda in zip(comandas, totais_comanda):
        valor_pago = _valor_monetario(comanda.valor_pago)
        saldo = max(Decimal("0.00"), total_comanda - valor_pago)
        debitos.append({
            "comanda": comanda,
            "total": total_comanda,
            "pago": valor_pago,
            "saldo": saldo,
        })
    return debitos


def _registrar_fidelidade_quitacao(
    db: Session,
    comanda: Comanda,
    cliente_fallback: Optional[Cliente] = None,
) -> bool:
    """Registra fidelidade uma única vez quando uma comanda é quitada."""
    cliente = None
    if comanda.cliente_id:
        cliente = buscar_cliente_por_id(
            db,
            restaurante_id=comanda.restaurante_id,
            cliente_id=comanda.cliente_id,
            bloquear=True,
        )
    if cliente is None and cliente_fallback is not None:
        if cliente_fallback.restaurante_id != comanda.restaurante_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cliente não pertence a este restaurante.",
            )
        cliente = cliente_fallback
        comanda.cliente_id = cliente.id
    if cliente is None:
        return False

    ja_registrado = db.query(HistoricoFidelidade).filter(
        HistoricoFidelidade.restaurante_id == comanda.restaurante_id,
        HistoricoFidelidade.comanda_id == comanda.id,
        HistoricoFidelidade.tipo_movimentacao == "ACUMULO",
    ).first()
    if ja_registrado:
        return False

    fidel_config = db.query(ConfigFidelizacao).filter(
        ConfigFidelizacao.restaurante_id == comanda.restaurante_id
    ).first()
    if not fidel_config or not fidel_config.ativo:
        return False

    total_pago = _valor_monetario(comanda.valor_pago)
    taxa = Decimal(str(fidel_config.taxa_conversao or 0))
    if fidel_config.tipo_recompensa == "PONTOS":
        delta_val = total_pago * taxa
        # Pontos são inteiros no saldo materializado. Compras cujo resultado
        # arredondaria para zero simplesmente não geram um lançamento vazio.
        if delta_val < Decimal("0.5"):
            return False
    else:
        delta_val = (total_pago * taxa / Decimal("100")).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
        if delta_val <= Decimal("0.00"):
            return False

    try:
        registrar_movimento_fidelidade(
            db,
            cliente=cliente,
            tipo_movimentacao="ACUMULO",
            valor_delta=delta_val,
            tipo_recompensa=fidel_config.tipo_recompensa,
            comanda_id=comanda.id,
        )
        return True
    except Exception:
        logger.exception("Falha ao processar dado sensível criptografado")
        raise HTTPException(
            status_code=500,
            detail="Erro ao processar dado sensível, contate o suporte.",
        )


def _resolver_cliente_pagamento(
    db: Session,
    *,
    restaurante_id: int,
    cliente_id: Optional[str],
    telefone: Optional[str],
    nome: Optional[str],
) -> Optional[Cliente]:
    """Resolve a mesma entidade de cliente usada no CRM e no cardápio."""
    cliente = None
    if cliente_id:
        cliente = buscar_cliente_por_id(
            db,
            restaurante_id=restaurante_id,
            cliente_id=cliente_id,
            bloquear=True,
        )
        if cliente is None:
            raise HTTPException(status_code=404, detail="Cliente não encontrado.")

    telefone_informado = (telefone or "").strip()
    if cliente is not None and telefone_informado:
        try:
            cliente_por_telefone = buscar_cliente_por_telefone(
                db,
                restaurante_id=restaurante_id,
                telefone=telefone_informado,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if cliente_por_telefone is None or cliente_por_telefone.id != cliente.id:
            raise HTTPException(
                status_code=409,
                detail="O telefone informado pertence a outro cliente.",
            )

    if cliente is None and telefone_informado:
        try:
            # Identificar alguém no pagamento não autoriza substituir sua
            # ficha. Nomes como "Mesa 4" ou snapshots antigos chegam neste
            # campo; se o telefone já existe, preserve o cadastro canônico.
            cliente = buscar_cliente_por_telefone(
                db,
                restaurante_id=restaurante_id,
                telefone=telefone_informado,
                bloquear=True,
            )
            if cliente is None and (nome or "").strip():
                cliente = cadastrar_ou_atualizar_cliente(
                    db,
                    restaurante_id=restaurante_id,
                    telefone=telefone_informado,
                    nome=nome or "",
                )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return cliente


@router.post(
    "/mesas/{mesa_id}/pagar",
    response_model=PagamentoResponse,
    status_code=status.HTTP_201_CREATED,
)
def registrar_pagamento_mesa(
    mesa_id: int,
    pag_in: PagamentoMesaRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """
    Abate um valor do saldo global da mesa em uma única transação.

    O pagamento pode ser parcial e é distribuído entre as comandas abertas.
    Opcionalmente, item_ids registra quais itens foram quitados, sem fazer o
    fechamento depender deles: a mesa só é liberada quando todo o saldo
    monetário chega a zero.
    """
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    existing = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.idempotency_key == pag_in.idempotency_key,
    ).first()
    if existing:
        return existing

    if pag_in.metodo not in _METODOS_PAGAMENTO:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Método de pagamento inválido. Use 'dinheiro', 'pix', "
                "'cartao_debito' ou 'cartao_credito'."
            ),
        )

    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == rest_id,
        CaixaTurno.status == "aberto",
    ).with_for_update().first()
    if not turno:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O caixa precisa estar aberto para processar pagamentos de mesas.",
        )

    comandas = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.mesa_id == mesa_id,
        Comanda.fechada == False,
    ).order_by(
        Comanda.criado_em.asc(),
        Comanda.id.asc(),
    ).with_for_update().all()
    if not comandas:
        # Uma repetição concorrente pode chegar depois que a primeira chamada
        # já fechou a mesa. A chave idempotente continua sendo a fonte de verdade.
        existing = db.query(Pagamento).filter(
            Pagamento.restaurante_id == rest_id,
            Pagamento.idempotency_key == pag_in.idempotency_key,
        ).first()
        if existing:
            return existing
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nenhuma comanda aberta foi encontrada para esta mesa.",
        )

    config = db.query(ConfiguracaoRestaurante).filter(
        ConfiguracaoRestaurante.restaurante_id == rest_id
    ).first()

    itens_selecionados: List[Item] = []
    if pag_in.item_ids:
        ids_solicitados = list(dict.fromkeys(pag_in.item_ids))
        itens_disponiveis = {
            item.id: item
            for comanda in comandas
            for item in comanda.itens
            if item.status != "cancelado" and not item.pago
        }
        itens_selecionados = [
            itens_disponiveis[item_id]
            for item_id in ids_solicitados
            if item_id in itens_disponiveis
        ]
        if len(itens_selecionados) != len(ids_solicitados):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Um ou mais itens selecionados não pertencem à mesa, "
                    "foram cancelados ou já estão pagos."
                ),
            )

    debitos = _debitos_da_mesa(
        comandas,
        pag_in.incluir_taxa_servico,
        config,
    )
    saldo_mesa = sum(
        (debito["saldo"] for debito in debitos),
        Decimal("0.00"),
    )
    if saldo_mesa <= Decimal("0.00"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A mesa já está integralmente liquidada.",
        )

    valor_solicitado = _valor_monetario(pag_in.valor)
    if itens_selecionados:
        subtotal_selecionado = _valor_monetario(sum(
            Decimal(str(item.preco_unit or 0))
            for item in itens_selecionados
        ))
        taxa_percentual = _percentual_taxa_servico(
            pag_in.incluir_taxa_servico,
            config,
        )
        total_selecionado = _valor_monetario(
            subtotal_selecionado
            * (Decimal("1.00") + taxa_percentual / Decimal("100"))
        )
        valor_necessario = min(total_selecionado, saldo_mesa)
        if valor_solicitado < valor_necessario:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Para dar baixa nos itens selecionados, receba o valor "
                    "total da seleção ou limpe a seleção para lançar um "
                    "pagamento livre."
                ),
            )

    valor_aplicado = min(valor_solicitado, saldo_mesa)
    restante_a_distribuir = valor_aplicado
    agora = datetime.datetime.now(datetime.timezone.utc)
    comandas_quitadas: List[Comanda] = []

    for debito in debitos:
        if restante_a_distribuir <= Decimal("0.00"):
            break
        if debito["saldo"] <= Decimal("0.00"):
            continue

        valor_na_comanda = min(restante_a_distribuir, debito["saldo"])
        novo_total_pago = min(
            debito["total"],
            debito["pago"] + valor_na_comanda,
        )
        comanda = debito["comanda"]
        comanda.valor_pago = float(_valor_monetario(novo_total_pago))
        restante_a_distribuir -= valor_na_comanda

        if novo_total_pago >= debito["total"]:
            for item in comanda.itens:
                if item.status != "cancelado":
                    item.pago = True
            comanda.fechada = True
            comanda.fechado_em = agora
            comanda.status_comanda = None
            comandas_quitadas.append(comanda)

    if itens_selecionados:
        for item in itens_selecionados:
            item.pago = True

    comanda_referencia = next(
        debito["comanda"]
        for debito in debitos
        if debito["saldo"] > Decimal("0.00")
    )

    cliente_pagamento = _resolver_cliente_pagamento(
        db,
        restaurante_id=rest_id,
        cliente_id=pag_in.cliente_id,
        telefone=pag_in.cpf_cliente,
        nome=pag_in.nome_cliente,
    )
    if cliente_pagamento is None:
        comanda_com_cliente = next(
            (comanda for comanda in comandas if comanda.cliente_id),
            None,
        )
        if comanda_com_cliente is not None:
            cliente_pagamento = buscar_cliente_por_id(
                db,
                restaurante_id=rest_id,
                cliente_id=comanda_com_cliente.cliente_id,
                bloquear=True,
            )
    if cliente_pagamento is None:
        pagamento_anterior = db.query(Pagamento).join(
            Comanda,
            Pagamento.comanda_id == Comanda.id,
        ).filter(
            Pagamento.restaurante_id == rest_id,
            Comanda.restaurante_id == rest_id,
            Comanda.mesa_id == mesa_id,
            Pagamento.cliente_id.isnot(None),
        ).order_by(Pagamento.criado_em.desc()).first()
        if pagamento_anterior and pagamento_anterior.cliente_id:
            cliente_pagamento = buscar_cliente_por_id(
                db,
                restaurante_id=rest_id,
                cliente_id=pagamento_anterior.cliente_id,
                bloquear=True,
            )

    if cliente_pagamento is not None:
        for comanda in comandas:
            if comanda.cliente_id is None:
                comanda.cliente_id = cliente_pagamento.id

    novo_pagamento = Pagamento(
        id=f"p-{uuid.uuid4().hex[:8]}",
        restaurante_id=rest_id,
        comanda_id=comanda_referencia.id,
        turno_id=turno.id,
        valor=float(valor_aplicado),
        metodo=pag_in.metodo,
        status="aprovado",
        idempotency_key=pag_in.idempotency_key,
        cliente_id=cliente_pagamento.id if cliente_pagamento else None,
        cpf_cliente=(
            cliente_pagamento.telefone if cliente_pagamento else pag_in.cpf_cliente
        ),
        nome_cliente=(
            cliente_pagamento.nome if cliente_pagamento else pag_in.nome_cliente
        ),
        criado_em=agora,
    )
    db.add(novo_pagamento)

    fidelidade_atualizada = False
    for comanda in comandas_quitadas:
        fidelidade_atualizada = (
            _registrar_fidelidade_quitacao(db, comanda, cliente_pagamento)
            or fidelidade_atualizada
        )

    try:
        db.flush()
        mesa_liberada = db.query(Comanda).filter(
            Comanda.restaurante_id == rest_id,
            Comanda.mesa_id == mesa_id,
            Comanda.fechada == False,
        ).first() is None
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(Pagamento).filter(
            Pagamento.restaurante_id == rest_id,
            Pagamento.idempotency_key == pag_in.idempotency_key,
        ).first()
        if existing:
            return existing
        logger.exception("Falha de integridade ao processar pagamento da mesa")
        raise HTTPException(
            status_code=500,
            detail="Erro interno ao processar pagamento.",
        )

    db.refresh(novo_pagamento)

    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "tables_updated",
            "detail": {
                "type": "pagamento_mesa_registrado",
                "mesa_id": mesa_id,
                "metodo": pag_in.metodo,
                "valor": float(valor_aplicado),
                "status": "aprovado",
                "operador_id": current_user.id,
                "operador_nome": current_user.nome,
            },
        },
        rest_id,
    )
    if mesa_liberada:
        background_tasks.add_task(
            manager.broadcast,
            {
                "event": "MESA_ATUALIZADA",
                "data": {
                    "mesa_id": mesa_id,
                    "status": "livre",
                    "comanda_id": None,
                },
            },
            rest_id,
        )
    if cliente_pagamento is not None or fidelidade_atualizada:
        background_tasks.add_task(
            manager.broadcast,
            {"event": "customers_updated"},
            rest_id,
        )
    return novo_pagamento


@router.post("/comandas/{comanda_id}/pagar", response_model=PagamentoResponse, status_code=status.HTTP_201_CREATED)
def registrar_pagamento_comanda(
    comanda_id: str,
    pag_in: PagamentoRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """Registra o recebimento financeiro parcial ou total de uma comanda."""
    rest_id = require_tenant_id()
    # Idempotency Check
    existing = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.idempotency_key == pag_in.idempotency_key
    ).first()
    if existing:
        return existing

    # 1. Check if there is an active shift FOR THIS TENANT
    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == rest_id,
        CaixaTurno.status == "aberto"
    ).with_for_update().first()
    if not turno:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O caixa precisa estar aberto para processar pagamentos de comandas."
        )
        
    # 2. Check if comanda exists
    comanda = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.id == comanda_id,
    ).with_for_update().first()
    if not comanda:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda não encontrada"
        )

    cliente_pagamento = _resolver_cliente_pagamento(
        db,
        restaurante_id=rest_id,
        cliente_id=pag_in.cliente_id,
        telefone=pag_in.cpf_cliente,
        nome=pag_in.nome_cliente,
    )
    if cliente_pagamento is None and comanda.cliente_id:
        cliente_pagamento = buscar_cliente_por_id(
            db,
            restaurante_id=rest_id,
            cliente_id=comanda.cliente_id,
            bloquear=True,
        )
    if (
        cliente_pagamento is not None
        and comanda.cliente_id is not None
        and comanda.cliente_id != cliente_pagamento.id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A comanda já está vinculada a outro cliente.",
        )
    if cliente_pagamento is not None:
        comanda.cliente_id = cliente_pagamento.id
        
    if comanda.fechada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comanda já está fechada e liquidada."
        )

    saldo_aberto = max(
        Decimal("0.00"),
        _subtotal_ativo(comanda) - _valor_monetario(comanda.valor_pago),
    )
    valor_solicitado = _valor_monetario(pag_in.valor)
    if valor_solicitado > saldo_aberto:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "O pagamento excede o saldo aberto da comanda. "
                f"Saldo atual: R$ {saldo_aberto:.2f}."
            ),
        )
        
    # Validate payment method
    if pag_in.metodo not in _METODOS_PAGAMENTO:
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
                Item.restaurante_id == rest_id,
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
        restaurante_id=rest_id,
        comanda_id=comanda_id,
        turno_id=turno.id,
        valor=pag_in.valor,
        metodo=pag_in.metodo,
        status=pag_status,
        idempotency_key=pag_in.idempotency_key,
        cliente_id=cliente_pagamento.id if cliente_pagamento else None,
        cpf_cliente=(
            cliente_pagamento.telefone if cliente_pagamento else pag_in.cpf_cliente
        ),
        nome_cliente=(
            cliente_pagamento.nome if cliente_pagamento else pag_in.nome_cliente
        ),
        criado_em=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(novo_pagamento)
    
    if not is_pending:
        # Increment the comanda's general paid value
        comanda.valor_pago = float(_valor_monetario(
            _valor_monetario(comanda.valor_pago) + _valor_monetario(pag_in.valor)
        ))
        
        # 4. A quitação é monetária; marcar itens individualmente nunca fecha
        # uma comanda se o valor total ainda não foi recebido.
        subtotal_total = float(_subtotal_ativo(comanda))
        
        if comanda.valor_pago >= subtotal_total:
            # Mark all active items as paid just in case
            for i in comanda.itens:
                if i.status != 'cancelado':
                    i.pago = True
            # Close comanda
            comanda.fechada = True
            comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)
            if comanda.mesa_id:
                other_open = db.query(Comanda).filter(
                    Comanda.restaurante_id == rest_id,
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
                    }, rest_id)
            
            _registrar_fidelidade_quitacao(db, comanda, cliente_pagamento)
                    
    try:
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        existing = db.query(Pagamento).filter(
            Pagamento.restaurante_id == rest_id,
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
    background_tasks.add_task(
        manager.broadcast,
        {
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
        },
        rest_id,
    )
    if cliente_pagamento is not None:
        background_tasks.add_task(
            manager.broadcast,
            {"event": "customers_updated"},
            rest_id,
        )
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
    rest_id = require_tenant_id()
    pagamento_ref = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.id == pagamento_id,
    ).first()
    if not pagamento_ref:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")

    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == rest_id,
        CaixaTurno.id == pagamento_ref.turno_id,
    ).with_for_update().first()
    if turno is None or turno.status != "aberto":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este pagamento pertence a um turno já encerrado e não pode mais ser aprovado.",
        )

    pagamento = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.id == pagamento_id,
    ).with_for_update().first()
    if not pagamento:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")
    if pagamento.status != "pendente":
        raise HTTPException(status_code=400, detail="Pagamento já processado")

    # Pagamentos pendentes diferentes da mesma comanda também precisam
    # disputar o mesmo lock. Assim somente um fluxo recalcula e baixa o saldo
    # por vez, mesmo quando aprovação e pagamento imediato chegam juntos.
    comanda = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.id == pagamento.comanda_id,
    ).with_for_update().first()
    if comanda is None:
        raise HTTPException(status_code=409, detail="Comanda do pagamento não encontrada.")
    saldo_aberto = max(
        Decimal("0.00"),
        _subtotal_ativo(comanda) - _valor_monetario(comanda.valor_pago),
    )
    if comanda.fechada or _valor_monetario(pagamento.valor) > saldo_aberto:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A comanda já foi liquidada ou não possui saldo suficiente "
                "para aprovar este pagamento pendente."
            ),
        )
        
    pagamento.status = "aprovado"
    comanda.valor_pago = float(_valor_monetario(
        _valor_monetario(comanda.valor_pago) + _valor_monetario(pagamento.valor)
    ))
    
    # Aprovar dinheiro também respeita o saldo monetário, sem depender de itens.
    subtotal_total = float(_subtotal_ativo(comanda))
    
    if comanda.valor_pago >= subtotal_total:
        for i in comanda.itens:
            if i.status != 'cancelado':
                i.pago = True
        comanda.fechada = True
        comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)
        if comanda.mesa_id:
            other_open = db.query(Comanda).filter(
                Comanda.restaurante_id == rest_id,
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
                }, rest_id)

        cliente_pagamento = None
        if pagamento.cliente_id:
            cliente_pagamento = buscar_cliente_por_id(
                db,
                restaurante_id=rest_id,
                cliente_id=pagamento.cliente_id,
                bloquear=True,
            )
        _registrar_fidelidade_quitacao(db, comanda, cliente_pagamento)

    db.commit()
    db.refresh(pagamento)
    db.refresh(comanda)
    
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rest_id)
    if pagamento.cliente_id:
        background_tasks.add_task(
            manager.broadcast,
            {"event": "customers_updated"},
            rest_id,
        )
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
    rest_id = require_tenant_id()
    pagamento = db.query(Pagamento).filter(
        Pagamento.restaurante_id == rest_id,
        Pagamento.id == pagamento_id,
    ).with_for_update().first()
    if not pagamento:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")
    if pagamento.status != "pendente":
        raise HTTPException(status_code=400, detail="Pagamento já processado")
        
    pagamento.status = "cancelado"
    db.commit()
    db.refresh(pagamento)
    
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rest_id)
    return pagamento


from ..models import ConfiguracaoRestaurante
from ..schemas import ConfiguracaoRestauranteResponse, ConfiguracaoRestauranteUpdate
from sqlalchemy.orm import joinedload


def _serializar_configuracoes(config: ConfiguracaoRestaurante) -> dict:
    payload = ConfiguracaoRestauranteResponse.model_validate(config).model_dump()
    payload["plano_efetivo"] = get_effective_subscription_plan(
        config.restaurante_id,
        config.plano,
    )
    payload["plano_modo_teste"] = is_test_premium_restaurant(
        config.restaurante_id
    )
    return payload

@router.get("/configuracoes", response_model=ConfiguracaoRestauranteResponse)
def obter_configuracoes(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """Retorna, sem efeitos colaterais, as configurações do tenant autenticado."""
    config = (
        db.query(ConfiguracaoRestaurante)
        .options(joinedload(ConfiguracaoRestaurante.restaurante))
        .filter(ConfiguracaoRestaurante.restaurante_id == current_user.restaurante_id)
        .first()
    )
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Configurações do restaurante ainda não foram provisionadas.",
        )
    return _serializar_configuracoes(config)


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
        config = ConfiguracaoRestaurante(
            restaurante_id=current_user.restaurante_id
        )
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
    if config_in.impressao_nome_restaurante is not None:
        config.impressao_nome_restaurante = (
            config_in.impressao_nome_restaurante.strip() or None
        )
    if config_in.impressao_nome_posicao is not None:
        config.impressao_nome_posicao = config_in.impressao_nome_posicao
    if config_in.impressao_mensagem_rodape is not None:
        config.impressao_mensagem_rodape = (
            config_in.impressao_mensagem_rodape.strip() or None
        )
    if config_in.impressao_mostrar_descricao is not None:
        config.impressao_mostrar_descricao = (
            config_in.impressao_mostrar_descricao
        )
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
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, require_tenant_id())
    return _serializar_configuracoes(config)


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
        rest_id = current_restaurante_id.get() or (current_user.tenant_id if current_user else None) or (current_user.restaurante_id if current_user else None)
    
    restaurante = None
    if slug:
        restaurante = db.query(Restaurante).filter(Restaurante.slug == slug).first()
    if not restaurante and rest_id:
        restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()

    if not restaurante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado."
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
    rest_id = tenant_id or getattr(current_user, "restaurante_id", None) or getattr(current_user, "tenant_id", None) or current_restaurante_id.get()
    if not rest_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Restaurante não identificado na sessão do usuário."
        )
    
    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado para atualização."
        )
        
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
        {"event": "config_updated", "data": restaurante_data},
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
