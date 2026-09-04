import uuid
import datetime
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Request
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import func, or_
from typing import List, Optional, Any
import logging

from ..database import get_db, current_restaurante_id, require_tenant_id
from ..config import settings
from ..timezone_utils import get_operational_now
from ..models import (
    Comanda,
    Mesa,
    Usuario,
    Lancamento,
    Item,
    ActivityLog,
    Motoboy,
    MotoboyTokenAtivo,
    ConfiguracaoRestaurante,
    Restaurante,
)
from ..schemas import (
    ComandaResponse, ComandaDetail, ComandaCreate,
    LancamentoCreate, ItemResponse, ItemUpdate,
    MotoboyCreate, MotoboyResponse, VendaDiretaCreate
)
from ..security import (
    ensure_permission,
    get_current_user,
    require_permission,
    create_motoboy_token,
    verify_motoboy_token,
    motoboy_rate_limiter,
)
from ..websocket_manager import manager
from ..services.order_read_projection import project_check_details
from ..services.printing import PrintingRequestError, enqueue_table_receipt
from ..services.inventory import consumir_estoque_dos_itens, estornar_estoque_dos_itens
from ..services.atendimentos import (
    ensure_atendimento_for_comanda,
)
from ..subscription import subscription_has_printing
from ..waiter_permissions import (
    require_waiter_permission,
)
from ..adapters.orders.pos_adapter import PosAdapter
from ..application.printing import (
    PrintAction,
    PrintIntent,
    PrintSourceType,
    PrintingApplicationService,
    UniversalPrintingError,
)

logger = logging.getLogger("koma.orders")

router = APIRouter(
    prefix="/comandas",
    tags=["Comandas e Pedidos"]
)


MENSAGEM_WHATSAPP_PRONTO_RETIRADA = (
    "Olá, {nome}! 👋 Seu pedido #{numero} no {restaurante} já está PRONTO PARA "
    "RETIRADA! 🍔 Pode vir buscar no nosso balcão. Te esperamos!"
)
MENSAGEM_WHATSAPP_SAIU_ENTREGA = (
    "Olá, {nome}! 🛵 Seu pedido #{numero} no {restaurante} acabou de SAIR PARA "
    "ENTREGA! 🚀 Nosso entregador já está a caminho do seu endereço. Bom apetite!"
)
MENSAGEM_WHATSAPP_RECUSADO = (
    "Olá, {nome}. Infelizmente seu pedido #{numero} no {restaurante} não pôde "
    "ser aceito no momento. Entre em contato conosco para mais detalhes."
)

from ..services.shifts import require_open_cash_shift
from ..services.order_numbers import gerar_novo_numero_pedido_atomico as gerar_novo_numero_pedido


def _agendar_notificacao_whatsapp_status(
    background_tasks: BackgroundTasks,
    db: Session,
    comanda: Comanda,
    status_anterior: Optional[str],
    novo_status: str,
) -> None:
    if status_anterior == novo_status:
        return

    telefone = (comanda.delivery_telefone or "").strip()
    if not telefone:
        logger.warning(
            "[NOTIFICAÇÃO WA] Notificação de status ignorada para comanda_id=%s: telefone ausente.",
            comanda.id,
        )
        return

    restaurante = db.query(Restaurante).filter(
        Restaurante.id == comanda.restaurante_id
    ).first()

    nome_restaurante = restaurante.nome if restaurante else "restaurante"
    tel_restaurante = getattr(restaurante, "telefone", None) if restaurante else None

    status_map = {
        "pendente": "recebido",
        "recebido": "recebido",
        "producao": "em_preparo",
        "preparando": "em_preparo",
        "em_preparo": "em_preparo",
        "pronto": "pronto",
        "transito": "saiu_entrega",
        "saiu_entrega": "saiu_entrega",
        "entregue": "entregue",
        "finalizado": "entregue",
        "recusado": "recusado",
        "cancelado": "recusado",
    }
    key_status = status_map.get((novo_status or "").lower(), novo_status)

    from ..services.notificacoes import agendar_notificacao_status_task

    agendar_notificacao_status_task(
        background_tasks=background_tasks,
        comanda_id=comanda.id,
        novo_status=key_status,
        telefone_cliente=telefone,
        nome_restaurante=nome_restaurante,
        link_rastreamento=None,
        telefone_restaurante=tel_restaurante,
        restaurante_id=comanda.restaurante_id,
        numero_pedido=comanda.numero_pedido,
        modalidade=comanda.tipo,
    )


def _get_print_preferences(db: Session, restaurante_id: int) -> dict:
    config = (
        db.query(ConfiguracaoRestaurante)
        .options(joinedload(ConfiguracaoRestaurante.restaurante))
        .filter(
            ConfiguracaoRestaurante.restaurante_id == restaurante_id
        )
        .first()
    )
    restaurant_name = "Kôma Gourmet Bistrô"
    if config:
        restaurant_name = (
            config.impressao_nome_restaurante
            or (config.restaurante.nome if config.restaurante else None)
            or restaurant_name
        )
    return {
        "restaurant_name": restaurant_name,
        "restaurant_name_position": (
            config.impressao_nome_posicao if config else "cabecalho"
        ),
        "print_footer": (
            config.impressao_mensagem_rodape if config else None
        ),
    }


def enqueue_print_job_in_session(
    db: Session,
    restaurante_id: int,
    printer_name: str,
    ticket_text: str,
    document_type: str = "producao",
    source_type: str = "pedido",
    source_id: str = "",
    idempotency_key: Optional[str] = None,
) -> Optional[Any]:
    """
    Enfileira um PrintJob na mesma sessão do banco de dados para garantir atomicidade transacional com a criação do pedido.
    """
    try:
        import datetime
        from ..models import PrintJob, Restaurante
        restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).first()
        if restaurante and not subscription_has_printing(
            restaurante_id,
            restaurante.plano,
        ):
            logger.info("Impressão ignorada para restaurante %s: recurso não incluído no Kôma Pocket.", restaurante_id)
            return None

        dest_clean = "COZINHA"
        p_upper = (printer_name or "").upper()
        if "FECHAMENTO" in p_upper or "RECIBO" in p_upper or "VALORES" in p_upper:
            dest_clean = "FECHAMENTO"
        elif "DELIVERY" in p_upper or "MOTOBOY" in p_upper or "ENTREGA" in p_upper:
            dest_clean = "ENTREGA"
        elif "BAR" in p_upper:
            dest_clean = "BAR"

        doc_type_clean = "entrega" if "delivery" in p_upper or "motoboy" in p_upper else document_type.lower()
        ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S%f")
        ikey = idempotency_key or f"{doc_type_clean}:{source_type}:{source_id}:{printer_name}:{ts}"

        existing_job = db.query(PrintJob).filter(
            PrintJob.restaurante_id == restaurante_id,
            PrintJob.idempotency_key == ikey,
        ).first()
        if existing_job:
            return existing_job

        job = PrintJob(
            restaurante_id=restaurante_id,
            document_type=doc_type_clean,
            destination=dest_clean,
            source_type=source_type.lower(),
            source_id=str(source_id),
            payload_text=ticket_text.replace("\x00", "\\x00"),
            status="pending",
            idempotency_key=ikey
        )
        try:
            with db.begin_nested():
                db.add(job)
                db.flush()
        except Exception:
            return db.query(PrintJob).filter(
                PrintJob.restaurante_id == restaurante_id,
                PrintJob.idempotency_key == ikey,
            ).first()
        return job
    except Exception as e:
        logger.error(f"[PRINT JOB TX ERROR] Falha ao adicionar PrintJob na sessão: {e}")
        return None


def enqueue_initial_production_for_order(
    db: Session,
    comanda: Comanda,
) -> list[Any]:
    """Enfileira a primeira via de produção de uma comanda aceita.

    A chave é estável por pedido e destino. Como a aceitação bloqueia a linha
    da comanda e o banco possui uma restrição única para a chave, repetir a
    mesma requisição nunca cria uma segunda impressão física.
    """
    from ..domain.printing import PrintDocumentService
    from ..domain.printing.models import OrderPrintData, PrintItem as DomainPrintItem

    active_items = [
        item for item in comanda.itens
        if item.status != "cancelado" and item.produto is not None
    ]
    if not active_items:
        return []

    print_preferences = _get_print_preferences(db, comanda.restaurante_id)
    print_items = [
        DomainPrintItem(
            codigo=str(getattr(item.produto, "codigo", None) or item.produto.id),
            nome=item.produto.nome,
            quantidade=1,
            preco_unit=float(item.preco_unit or 0),
            observacao=item.observacao or "",
            cliente_nome=item.cliente_nome or "Consumo Geral",
            destino_impressao=(
                item.produto.categoria.destino_impressao
                if item.produto.categoria
                else "COZINHA"
            ),
        )
        for item in active_items
    ]
    documents = PrintDocumentService.generate_production(OrderPrintData(
        restaurante_nome=print_preferences["restaurant_name"],
        numero_pedido=str(comanda.numero_pedido or ""),
        mesa=str(comanda.mesa_id) if comanda.mesa_id else "BALCAO",
        tipo_pedido=comanda.tipo,
        garcom_nome=(
            comanda.criada_por.nome if comanda.criada_por else "CAIXA"
        ),
        horario=get_operational_now().strftime("%H:%M"),
        itens=print_items,
    )) or {}

    jobs = []
    for destination, ticket_text in documents.items():
        destination_key = str(destination).strip().lower()
        job = enqueue_print_job_in_session(
            db,
            restaurante_id=comanda.restaurante_id,
            printer_name=str(destination),
            ticket_text=ticket_text,
            document_type="producao",
            source_type="pedido",
            source_id=comanda.id,
            idempotency_key=(
                f"aceite:pedido:{comanda.id}:producao:{destination_key}"
            ),
        )
        if job is not None:
            jobs.append(job)

    if jobs:
        printed_at = datetime.datetime.now(datetime.timezone.utc)
        for item in active_items:
            item.impresso_em = printed_at

    return jobs


def print_in_background(
    printer_name: str,
    ticket_text: str,
    document_type: str = "producao",
    source_type: str = "pedido",
    source_id: str = "",
    restaurante_id: int | None = None,
):
    try:
        import datetime
        from ..database import SessionLocal
        from ..models import PrintJob, Restaurante
        if not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool) or restaurante_id <= 0:
            raise ValueError("Background de impressão exige restaurante_id explícito")
        tenant_context = current_restaurante_id.set(restaurante_id)
        db = None
        try:
            db = SessionLocal(restaurante_id=restaurante_id)
            restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).first()
            if restaurante and not subscription_has_printing(
                restaurante_id,
                restaurante.plano,
            ):
                logger.info(
                    "Impressão ignorada para restaurante %s: recurso não incluído no Kôma Pocket.",
                    restaurante_id,
                )
                return

            dest_clean = "COZINHA"
            p_upper = (printer_name or "").upper()
            if "FECHAMENTO" in p_upper or "RECIBO" in p_upper or "VALORES" in p_upper:
                dest_clean = "FECHAMENTO"
            elif "DELIVERY" in p_upper or "MOTOBOY" in p_upper or "ENTREGA" in p_upper:
                dest_clean = "ENTREGA"
            elif "BAR" in p_upper:
                dest_clean = "BAR"
            
            doc_type_clean = "entrega" if "delivery" in p_upper or "motoboy" in p_upper else document_type.lower()
            ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S%f")
            ikey = f"{doc_type_clean}:{source_type}:{source_id}:{printer_name}:{ts}"
            
            job = PrintJob(
                restaurante_id=restaurante_id,
                document_type=doc_type_clean,
                destination=dest_clean,
                source_type=source_type.lower(),
                source_id=str(source_id),
                payload_text=ticket_text.replace("\x00", "\\x00"),
                status="pending",
                idempotency_key=ikey
            )
            db.add(job)
            db.commit()
            print(f"[PRINT JOB ENQUEUED] Job ID {job.id} enfileirado para o Kôma Print Agent!")
        finally:
            if db is not None:
                db.close()
            current_restaurante_id.reset(tenant_context)
    except Exception as e:
        print(f"[PRINT JOB ERROR] Falha ao enfileirar PrintJob: {e}")

# ----------------- READ ENDPOINTS -----------------

@router.get("/", response_model=List[ComandaResponse])
def get_comandas(
    mesa_id: Optional[int] = None,
    fechada: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Retorna a lista de comandas, com filtros opcionais por mesa e status (aberta/fechada).
    """
    rest_id = require_tenant_id()
    query = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        or_(Comanda.online_payment_status.is_(None), Comanda.online_payment_status == "approved"),
    )
    if mesa_id is not None:
        query = query.filter(Comanda.mesa_id == mesa_id)
    if fechada is not None:
        query = query.filter(Comanda.fechada == fechada)
    return query.order_by(Comanda.criado_em.asc(), Comanda.id.asc()).all()

@router.get("/detalhes/todos", response_model=List[ComandaDetail])
def get_comandas_detalhes(
    mesa_id: Optional[int] = None,
    fechada: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Retorna a lista de comandas completas (com itens e lançamentos), com filtros opcionais.
    """
    query = db.query(Comanda).options(
        joinedload(Comanda.itens).joinedload(Item.produto),
        joinedload(Comanda.criada_por),
        selectinload(Comanda.lancamentos).selectinload(Lancamento.itens).joinedload(Item.produto),
    ).filter(
        Comanda.restaurante_id == require_tenant_id(),
        or_(Comanda.online_payment_status.is_(None), Comanda.online_payment_status == "approved"),
    )
    if mesa_id is not None:
        query = query.filter(Comanda.mesa_id == mesa_id)
    if fechada is not None:
        query = query.filter(Comanda.fechada == fechada)
    checks = query.order_by(Comanda.criado_em.asc(), Comanda.id.asc()).all()
    return project_check_details(db, checks, require_tenant_id())

@router.get("/{comanda_id}", response_model=ComandaDetail)
def get_comanda(comanda_id: str, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """
    Retorna os detalhes completos de uma comanda específica (incluindo lançamentos e itens).
    """
    comanda = (
        db.query(Comanda)
        .options(
            joinedload(Comanda.itens).joinedload(Item.produto),
            joinedload(Comanda.criada_por),
            selectinload(Comanda.lancamentos).selectinload(Lancamento.itens).joinedload(Item.produto),
        )
        .filter(
            Comanda.restaurante_id == require_tenant_id(),
            Comanda.id == comanda_id,
            or_(Comanda.online_payment_status.is_(None), Comanda.online_payment_status == "approved"),
        )
        .first()
    )
    if not comanda:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda não encontrada"
        )
    return project_check_details(db, [comanda], require_tenant_id())[0]

# ----------------- WRITE/ACTION ENDPOINTS -----------------

@router.post("/", response_model=ComandaResponse, status_code=status.HTTP_201_CREATED)
def abrir_comanda(comanda_in: ComandaCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """
    Abre uma nova comanda para uma mesa (ou sem mesa para retirada).
    """
    if comanda_in.tipo.strip().lower() in {
        "delivery", "entrega", "retirada", "viagem"
    }:
        require_waiter_permission(
            db,
            current_user,
            "perm_garcom_delivery",
        )

    rid = require_tenant_id()
    require_open_cash_shift(db, rid)

    # 1. Validar se a mesa existe (se mesa_id for informado)
    if comanda_in.mesa_id is not None:
        mesa = db.query(Mesa).filter(
            Mesa.restaurante_id == rid,
            Mesa.id == comanda_in.mesa_id,
        ).with_for_update().first()
        if not mesa:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Mesa {comanda_in.mesa_id} não encontrada"
            )
            
        # 2. A mesma mesa pode ter comandas separadas por cliente. Um clique
        # repetido sem identificador reutiliza a comanda geral; um nome novo
        # cria outra comanda compartilhando o mesmo número do pedido.
        comandas_abertas = db.query(Comanda).filter(
            Comanda.restaurante_id == rid,
            Comanda.mesa_id == comanda_in.mesa_id,
            Comanda.fechada == False
        ).order_by(Comanda.criado_em.asc()).all()
        identificador = (comanda_in.identificador or "").strip()
        if comandas_abertas:
            if not identificador:
                comanda_geral = next(
                    (
                        comanda
                        for comanda in comandas_abertas
                        if not (comanda.identificador or "").strip()
                    ),
                    None,
                )
                existing_command = comanda_geral or comandas_abertas[0]
                ensure_atendimento_for_comanda(db, existing_command, actor_id=current_user.id)
                db.commit()
                return existing_command

            identificador_normalizado = identificador.casefold()
            comanda_do_cliente = next(
                (
                    comanda
                    for comanda in comandas_abertas
                    if (
                        (comanda.identificador or "").strip().casefold()
                        == identificador_normalizado
                    )
                ),
                None,
            )
            if comanda_do_cliente:
                ensure_atendimento_for_comanda(db, comanda_do_cliente, actor_id=current_user.id)
                db.commit()
                return comanda_do_cliente
            numero_pedido = comandas_abertas[0].numero_pedido
        else:
            numero_pedido = gerar_novo_numero_pedido(db)
    else:
        numero_pedido = gerar_novo_numero_pedido(db)

    # 3. Validar se o garçom existe
    garcom = db.query(Usuario).filter(
        Usuario.restaurante_id == rid,
        Usuario.id == comanda_in.garcom_id,
    ).first()
    if not garcom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Garçom '{comanda_in.garcom_id}' não encontrado"
        )

    # 4. Criar comanda
    # Auto-define delivery_status: Entrega começa como 'pendente' (gaveta de aceite), Retirada já entra como 'producao'
    auto_delivery_status = comanda_in.delivery_status
    if comanda_in.tipo in ("Entrega", "Delivery") and auto_delivery_status is None:
        auto_delivery_status = "pendente"
    elif comanda_in.tipo == "Retirada" and auto_delivery_status is None:
        auto_delivery_status = "producao"

    try:
        nova_comanda = Comanda(
            id=f"c-{uuid.uuid4().hex[:8]}",
            restaurante_id=rid,
            mesa_id=comanda_in.mesa_id,
            garcom_id=comanda_in.garcom_id,
            tipo=comanda_in.tipo,
            identificador=comanda_in.identificador,
            numero_pedido=numero_pedido,
            fechada=False,
            criado_em=datetime.datetime.now(datetime.timezone.utc),
            delivery_status=auto_delivery_status,
            delivery_telefone=comanda_in.delivery_telefone,
            delivery_endereco=comanda_in.delivery_endereco,
            delivery_taxa=comanda_in.delivery_taxa,
            motoboy_id=comanda_in.motoboy_id
        )
        db.add(nova_comanda)
        db.flush()
        if nova_comanda.tipo == "Consumo no Local" and nova_comanda.mesa_id is not None:
            ensure_atendimento_for_comanda(db, nova_comanda, actor_id=current_user.id)
        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Falha ao processar dado sensível criptografado")
        raise HTTPException(
            status_code=500,
            detail="Erro ao processar dado sensível, contate o suporte."
        )
    db.refresh(nova_comanda)
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "tables_updated",
            "detail": {
                "type": "comanda_aberta",
                "mesa_id": nova_comanda.mesa_id,
                "comanda_id": nova_comanda.id,
            },
        },
        require_tenant_id(),
    )
    return nova_comanda


async def criar_venda_direta(
    venda_in: VendaDiretaCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Cria uma comanda e insere todos os itens via PosAdapter / OrderApplicationService.
    Elimina a necessidade de 2 chamadas HTTP separadas no PDV. Pedidos de
    delivery e retirada criados pelo caixa já entram aceitos em produção.
    """
    return await PosAdapter.handle_create_pos_order(
        venda_in=venda_in,
        background_tasks=background_tasks,
        db=db,
        current_user=current_user,
    )



@router.put("/{comanda_id}/pedir-conta", response_model=ComandaResponse)
def pedir_conta(
    comanda_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Usuario = Depends(get_current_user)
):
    """
    Garçom solicita a conta para a mesa. Altera status_comanda para 'aguardando_pagamento',
    movendo a mesa para a coluna 3 do Kanban (Fechar Conta) sem passar pela coluna 2.
    """
    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    if comanda.fechada:
        raise HTTPException(status_code=400, detail="Comanda já está fechada")
    comanda.status_comanda = "aguardando_pagamento"
    db.commit()
    db.refresh(comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, require_tenant_id())
    return comanda

async def lancar_itens(
    comanda_id: str,
    lancamento_in: LancamentoCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """
    Lança novos itens na comanda delegando ao WaiterAdapter e OrderApplicationService.
    """
    from ..adapters.orders.waiter_adapter import WaiterAdapter

    return await WaiterAdapter.handle_launch_items(
        comanda_id=comanda_id,
        lancamento_in=lancamento_in,
        background_tasks=background_tasks,
        db=db,
        current_user=current_user,
    )

@router.post("/{comanda_id}/dividir", response_model=List[ComandaResponse])
def dividir_comanda(comanda_id: str, itens_ids: List[str], novo_identificador: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """
    Divide itens de uma comanda aberta criando uma comanda separada (com mesmo número de pedido).
    """
    require_waiter_permission(
        db,
        current_user,
        "perm_garcom_transferir_item",
    )

    # 1. Validar comanda original
    comanda_origem = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda_origem:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda original não encontrada"
        )
    if comanda_origem.fechada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não é possível dividir uma comanda que já está fechada"
        )

    # 2. Validar se os itens pertencem à comanda
    itens = db.query(Item).filter(
        Item.id.in_(itens_ids),
        Item.comanda_id == comanda_id
    ).all()
    
    if len(itens) != len(itens_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alguns dos itens selecionados não pertencem a esta comanda ou são inválidos"
        )

    for item in itens:
        if item.status == "cancelado":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Não é possível mover o item '{item.id}' porque ele está cancelado"
            )

    try:
        # 3. Criar a nova comanda compartilhando o mesmo numero_pedido e mesa
        nova_comanda = Comanda(
            id=f"c-{uuid.uuid4().hex[:8]}",
            restaurante_id=current_restaurante_id.get(),
            mesa_id=comanda_origem.mesa_id,
            garcom_id=comanda_origem.garcom_id,
            tipo=comanda_origem.tipo,
            identificador=novo_identificador,
            numero_pedido=comanda_origem.numero_pedido,
            fechada=False,
            criado_em=datetime.datetime.now(datetime.timezone.utc)
        )
        db.add(nova_comanda)
        db.flush()
        if nova_comanda.tipo == "Consumo no Local" and nova_comanda.mesa_id is not None:
            ensure_atendimento_for_comanda(db, nova_comanda, actor_id=current_user.id)

        # 4. Mover os itens
        for item in itens:
            item.comanda_id = nova_comanda.id

        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Falha ao processar dado sensível criptografado")
        raise HTTPException(
            status_code=500,
            detail="Erro ao processar dado sensível, contate o suporte."
        )
    db.refresh(comanda_origem)
    db.refresh(nova_comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, require_tenant_id())
    return [comanda_origem, nova_comanda]

@router.put("/{comanda_id}/fechar", response_model=ComandaResponse)
def fechar_comanda(
    comanda_id: str,
    background_tasks: BackgroundTasks,
    force: bool = False,
    db: Session = Depends(get_db),
    current_garcom: Usuario = Depends(get_current_user)
):
    """
    Fecha a comanda. Aceita qualquer operador autenticado (garçom ou caixa).
    """

    require_waiter_permission(
        db,
        current_garcom,
        "perm_garcom_fechar",
    )
    rest_id = require_tenant_id()
    comanda = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.id == comanda_id,
    ).first()
    if not comanda:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda não encontrada"
        )

    if comanda.fechada:
        return comanda

    # Calcula o total devido
    subtotal = sum(i.preco_unit for i in comanda.itens if i.status != 'cancelado')
    total_com_taxa = round(subtotal * 1.10, 2)
    valor_pago = comanda.valor_pago or 0.0
    
    # Verifica se há saldo devedor
    if force:
        ensure_permission(current_garcom, "comandas:forcar_fechamento")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "O fechamento forçado de uma comanda isolada foi desativado. "
                "Use a ação 'Cancelar consumo e liberar mesa', que cancela todas "
                "as comandas abertas da mesa com auditoria."
            ),
        )
    if valor_pago < subtotal and valor_pago < total_com_taxa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Não é possível fechar uma comanda com saldo em aberto. Valor devido: R${subtotal:.2f} (ou R${total_com_taxa:.2f} com taxa). Valor pago: R${valor_pago:.2f}"
        )

    status_anterior = comanda.delivery_status
    comanda.fechada = True
    comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)
    if comanda.tipo in {"Delivery", "Entrega", "Retirada", "Viagem", "balcao", "balcão"}:
        if comanda.delivery_status != "recusado":
            comanda.delivery_status = "finalizado"
            for lanc in (comanda.lancamentos or []):
                lanc.status = "finalizado"
            if status_anterior != "finalizado":
                _agendar_notificacao_whatsapp_status(
                    background_tasks,
                    db,
                    comanda,
                    status_anterior,
                    "finalizado",
                )
    db.commit()
    db.refresh(comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, rest_id)
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
    return comanda

# ----------------- ITEM CANCELLATION ENDPOINT -----------------

@router.put("/itens/{item_id}/cancelar", response_model=ItemResponse)
def cancelar_item(
    item_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Usuario = Depends(get_current_user)
):
    """
    Cancela um item específico de uma comanda (requer autenticação do garçom).
    Se for o único item ativo da comanda, o garçom não pode cancelar.
    """

    require_waiter_permission(
        db,
        current_garcom,
        "perm_garcom_cancelar",
    )
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item não encontrado"
        )

    if item.status == "cancelado":
        return item

    comanda = db.query(Comanda).filter(Comanda.id == item.comanda_id).first()
    if not comanda:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda associada ao item não encontrada"
        )

    # Contar itens ativos restantes na comanda
    active_items_count = db.query(Item).filter(
        Item.comanda_id == item.comanda_id,
        Item.status != "cancelado"
    ).count()

    if active_items_count <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="O garçom não pode cancelar o único item ativo restante da comanda."
        )

    item.status = "cancelado"
    item.cancelado_por = current_garcom.id
    estornar_estoque_dos_itens(db, [item], usuario_id=current_garcom.id)
    
    # Audit log
    audit = ActivityLog(
        restaurante_id=current_restaurante_id.get(),
        garcom_id=current_garcom.id,
        action="CANCEL_ITEM",
        details=f"Item ID {item_id} (Produto {item.produto_id}) cancelado na comanda {item.comanda_id}."
    )
    db.add(audit)
    db.commit()
    db.refresh(item)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, require_tenant_id())
    return item

@router.put("/itens/{item_id}", response_model=ItemResponse)
def update_item_details(
    item_id: str,
    update_data: ItemUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Usuario = Depends(get_current_user)
):
    """
    Permite atualizar as observações ou o nome do cliente de um item na comanda ativa.
    Respeita a permissão 'perm_garcom_editar' configurada na retaguarda.
    """
    require_waiter_permission(
        db,
        current_garcom,
        "perm_garcom_editar",
    )
    restaurante_id = require_tenant_id()
    item = db.query(Item).filter(
        Item.restaurante_id == restaurante_id,
        Item.id == item_id,
    ).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item não encontrado"
        )
        
    # Verificar se a comanda já está fechada
    comanda = db.query(Comanda).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.id == item.comanda_id,
    ).first()
    if comanda and comanda.fechada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não é possível editar itens de uma comanda já fechada"
        )
        
    try:
        if update_data.observacao is not None:
            item.observacao = update_data.observacao
        if update_data.cliente_nome is not None:
            item.cliente_nome = update_data.cliente_nome

        added_count = 0
        novos_itens = []
        if update_data.quantidade_adicional and update_data.quantidade_adicional > 1:
            import uuid
            additional_qty = update_data.quantidade_adicional - 1
            for _ in range(additional_qty):
                new_item = Item(
                    id=f"i-{uuid.uuid4().hex[:8]}",
                    restaurante_id=restaurante_id,
                    comanda_id=item.comanda_id,
                    lancamento_id=item.lancamento_id,
                    produto_id=item.produto_id,
                    preco_unit=item.preco_unit,
                    observacao=item.observacao,
                    cliente_nome=item.cliente_nome,
                    status="preparando",
                    cancelado_por=None,
                    impresso_em=None
                )
                db.add(new_item)
                novos_itens.append(new_item)
                added_count += 1

        if novos_itens:
            db.flush()
            consumir_estoque_dos_itens(db, novos_itens, usuario_id=current_garcom.id)

        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Falha ao processar dado sensível criptografado")
        raise HTTPException(
            status_code=500,
            detail="Erro ao processar dado sensível, contate o suporte."
        )
    db.refresh(item)

    # A mutação já foi confirmada. A impressão continua best-effort, porém a
    # rota declara apenas a intenção; o Core escolhe documento e destino.
    try:
        PrintingApplicationService.request_print(
            db,
            PrintIntent(
                restaurant_id=restaurante_id,
                source_type=PrintSourceType.ITEM,
                source_id=item.id,
                action=PrintAction.ITEM_CHANGE,
                requested_by=current_garcom.nome,
                quantity_added=added_count,
            ),
        )
        db.commit()
    except UniversalPrintingError as exc:
        db.rollback()
        logger.warning(
            "Impressão de alteração do item %s ignorada após mutação confirmada: %s",
            item.id,
            exc,
        )
    except Exception:
        db.rollback()
        logger.exception(
            "Falha inesperada ao enfileirar impressão de alteração do item %s",
            item.id,
        )

    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, require_tenant_id())
    return item

@router.put("/itens/{item_id}/status", response_model=ItemResponse)
def update_item_status(
    item_id: str,
    status: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Usuario = Depends(require_permission("pedidos:alterar_status"))
):
    """
    Atualiza o status de um item (requer autenticação do garçom).
    """
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(
            status_code=404,
            detail="Item não encontrado"
        )
    if status not in ["preparando", "pronto", "entregue", "cancelado"]:
        raise HTTPException(
            status_code=400,
            detail="Status inválido"
        )
    item.status = status
    db.commit()
    db.refresh(item)

    if status == "pronto" and item.comanda_id:
        comanda = db.query(Comanda).filter(Comanda.id == item.comanda_id).first()
        if comanda:
            todos_prontos = all(it.status in ("pronto", "entregue", "cancelado") for it in comanda.itens)
            if todos_prontos:
                _agendar_notificacao_whatsapp_status(
                    background_tasks,
                    db,
                    comanda,
                    None,
                    "pronto"
                )

    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"}, require_tenant_id())
    return item



def reimprimir_lancamento_cozinha(
    lancamento_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Usuario = Depends(get_current_user)
):
    """Reimprime um documento já lançado.

    Para Consumo no Local, reimpressão significa emitir novamente o Extrato
    Completo canônico da mesa. Delivery/retirada mantêm as vias próprias.
    """
    del current_garcom
    rid = require_tenant_id()

    if lancamento_id.startswith("c-"):
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == rid,
            Comanda.id == lancamento_id,
        ).first()
        if not comanda:
            raise HTTPException(
                status_code=404,
                detail="Comanda não encontrada"
            )
            
        # If it's a Delivery or Retirada, trigger delivery/takeout print tickets!
        if comanda.tipo in ["Delivery", "Entrega", "Retirada"]:
            try:
                from ..printer_service import printer_service
                
                motoboy_nome = "Balcão"
                if comanda.motoboy_id:
                    mb = db.query(Motoboy).filter(
                        Motoboy.restaurante_id == rid,
                        Motoboy.id == comanda.motoboy_id,
                    ).first()
                    if mb:
                        motoboy_nome = mb.nome
                        
                config = db.query(ConfiguracaoRestaurante).filter(
                    ConfiguracaoRestaurante.restaurante_id == rid
                ).first()
                unificar = config.unificar_vias_delivery if config else False
                
                if unificar:
                    unified_text = printer_service.generate_delivery_unified_ticket(comanda, motoboy_nome)
                    background_tasks.add_task(
                        print_in_background,
                        "delivery_unico",
                        unified_text,
                        restaurante_id=rid,
                    )
                else:
                    kitchen_text = printer_service.generate_delivery_kitchen_ticket(comanda)
                    motoboy_text = printer_service.generate_delivery_motoboy_ticket(comanda, motoboy_nome)
                    background_tasks.add_task(
                        print_in_background,
                        "delivery_cozinha",
                        kitchen_text,
                        restaurante_id=rid,
                    )
                    background_tasks.add_task(
                        print_in_background,
                        "delivery_motoboy",
                        motoboy_text,
                        restaurante_id=rid,
                    )
                    
                return {"status": "success", "detail": "Reimpressão de Delivery enviada com sucesso"}
            except Exception as print_err:
                raise HTTPException(
                    status_code=500,
                    detail=f"Erro na impressora de delivery: {print_err}"
                )

        active_items = [i for i in comanda.itens if i.status != "cancelado"]
        garcom_nome = comanda.criada_por.nome if comanda.criada_por else "Garçom"
    else:
        lancamento = (
            db.query(Lancamento)
            .join(Comanda, Comanda.id == Lancamento.comanda_id)
            .filter(
                Comanda.restaurante_id == rid,
                Lancamento.id == lancamento_id,
            )
            .first()
        )
        if not lancamento:
            raise HTTPException(
                status_code=404,
                detail="Lançamento não encontrado"
            )
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == rid,
            Comanda.id == lancamento.comanda_id,
        ).first()
        if not comanda:
            raise HTTPException(
                status_code=404,
                detail="Comanda associada não encontrada"
            )
        active_items = [i for i in lancamento.itens if i.status != "cancelado"]
        garcom_nome = lancamento.garcom.nome if lancamento.garcom else "Garçom"
        
    if not active_items:
        raise HTTPException(
            status_code=400,
            detail="Não há itens ativos para imprimir"
        )

    is_local = (
        (comanda.tipo or "").strip().casefold()
        in {"consumo no local", "mesa", "local"}
        and comanda.mesa_id is not None
    )
    if is_local:
        try:
            job = enqueue_table_receipt(
                db,
                rid,
                comanda.mesa_id,
                apenas_valores=False,
                source_type="reimpressao",
                source_id=lancamento_id,
            )
            if job is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="A impressão física não está disponível no plano atual.",
                )
            db.commit()
            return {
                "status": "success",
                "detail": "Extrato Completo da mesa enviado novamente para impressão",
            }
        except PrintingRequestError as print_err:
            db.rollback()
            raise HTTPException(
                status_code=print_err.status_code,
                detail=str(print_err),
            ) from print_err
        except HTTPException:
            db.rollback()
            raise
        except Exception as print_err:
            db.rollback()
            raise HTTPException(
                status_code=500,
                detail=f"Erro na impressora: {print_err}"
            ) from print_err
        
    try:
        from ..printer_service import printer_service
        
        items_payload = []
        for it in active_items:
            items_payload.append({
                "quantidade": 1,
                "codigo": it.produto.id,
                "nome": it.produto.nome,
                "descricao": it.produto.descricao,
                "observacao": it.observacao,
                "cliente_nome": it.cliente_nome,
                "preco_unit": float(it.preco_unit) if it.preco_unit else 0.0
            })

        print_preferences = _get_print_preferences(
            db,
            comanda.restaurante_id,
        )
        ticket_text = printer_service.generate_kitchen_ticket(
            num_pedido=comanda.numero_pedido,
            tipo=comanda.tipo,
            mesa_id=comanda.mesa_id,
            garcom_nome=garcom_nome,
            items=items_payload,
            is_reprint=True,
            **print_preferences,
        )
        background_tasks.add_task(
            print_in_background,
            "cozinha_reimpressao",
            ticket_text,
            restaurante_id=rid,
        )
        
        print_time = datetime.datetime.now(datetime.timezone.utc)
        for it in active_items:
            it.impresso_em = print_time
        db.commit()
    except Exception as print_err:
        raise HTTPException(
            status_code=500,
            detail=f"Erro na impressora: {print_err}"
        )
        
    return {"status": "success", "detail": "Reimpressão enviada com sucesso"}


# ----------------- DELIVERY & MOTOBOYS ENDPOINTS -----------------

@router.get("/delivery/ativos", response_model=List[ComandaDetail])
def listar_delivery_ativos(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """
    Retorna todas as comandas de delivery ou retirada que não estejam finalizadas/fechadas.
    Inclui as pendentes (na gaveta de aceite) e as em produção/trânsito.
    """
    return db.query(Comanda).filter(
        Comanda.restaurante_id == require_tenant_id(),
        Comanda.tipo.in_(["Delivery", "Entrega", "Retirada"]),
        Comanda.fechada == False,
        or_(Comanda.online_payment_status.is_(None), Comanda.online_payment_status == "approved"),
    ).all()


@router.get("/motoboys/lista", response_model=List[MotoboyResponse])
def listar_motoboys(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """
    Lista todos os motoboys cadastrados.
    """
    return db.query(Motoboy).all()


@router.post("/motoboys/cadastro", response_model=MotoboyResponse, status_code=status.HTTP_201_CREATED)
def cadastrar_motoboy(
    motoboy_in: MotoboyCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Cadastra um novo motoboy.
    """
    max_id = db.query(func.max(Motoboy.id)).filter(
        Motoboy.restaurante_id == require_tenant_id()
    ).scalar() or 0
    novo_motoboy = Motoboy(
        id=max_id + 1,
        restaurante_id=require_tenant_id(),
        nome=motoboy_in.nome,
        telefone=motoboy_in.telefone,
        ativo=motoboy_in.ativo if motoboy_in.ativo is not None else True
    )
    db.add(novo_motoboy)
    db.commit()
    db.refresh(novo_motoboy)
    return novo_motoboy


def _criar_acesso_motoboy(db: Session, motoboy: Motoboy, rest_id: int) -> dict:
    """Cria o acesso temporário dentro da transação do chamador."""
    # 1. Revogar tokens ativos prévios deste motoboy
    db.query(MotoboyTokenAtivo).filter(
        MotoboyTokenAtivo.motoboy_id == motoboy.id,
        MotoboyTokenAtivo.restaurante_id == rest_id,
        MotoboyTokenAtivo.revogado == False
    ).update({MotoboyTokenAtivo.revogado: True})

    # 2. Criar novo JTI e token JWT
    new_jti = str(uuid.uuid4())
    novo_token_db = MotoboyTokenAtivo(
        jti=new_jti,
        motoboy_id=motoboy.id,
        restaurante_id=rest_id,
        revogado=False
    )
    db.add(novo_token_db)
    db.flush()

    token = create_motoboy_token(motoboy.id, rest_id, new_jti)
    exp = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=4)).isoformat()
    return {
        "token": token,
        "link": f"/entregador?token={token}",
        "link_publico": f"{settings.KOMA_PUBLIC_APP_URL}/entregador?token={token}",
        "expires_at": exp,
        "motoboy_nome": motoboy.nome
    }


@router.post("/motoboys/{motoboy_id}/gerar-link")
def gerar_link_motoboy(
    motoboy_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Gera um link/token de acesso temporário (TTL: 4h) para o PWA do entregador.
    Invalida/revoga automaticamente qualquer token ativo gerado anteriormente para este motoboy.
    """
    rest_id = require_tenant_id()
    motoboy = db.query(Motoboy).filter(
        Motoboy.id == motoboy_id,
        Motoboy.restaurante_id == rest_id
    ).first()
    if not motoboy:
        raise HTTPException(status_code=404, detail="Motoboy não encontrado")

    acesso = _criar_acesso_motoboy(db, motoboy, rest_id)
    db.commit()
    return acesso


@router.post("/motoboys/{motoboy_id}/revogar-link")
def revogar_link_motoboy(
    motoboy_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Revoga manualmente todos os links/tokens de acesso ativos para um motoboy.
    """
    rest_id = require_tenant_id()
    motoboy = db.query(Motoboy).filter(
        Motoboy.id == motoboy_id,
        Motoboy.restaurante_id == rest_id
    ).first()
    if not motoboy:
        raise HTTPException(status_code=404, detail="Motoboy não encontrado")

    db.query(MotoboyTokenAtivo).filter(
        MotoboyTokenAtivo.motoboy_id == motoboy_id,
        MotoboyTokenAtivo.restaurante_id == rest_id,
        MotoboyTokenAtivo.revogado == False
    ).update({MotoboyTokenAtivo.revogado: True})
    db.commit()

    return {"status": "sucesso", "mensagem": f"Acesso do entregador '{motoboy.nome}' revogado com sucesso."}


@router.get("/motoboys/painel-entregador")
def painel_entregador(
    token: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Endpoint público acessível via token do motoboy para carregar o painel do PWA Entregador.
    """
    motoboy_rate_limiter.check(request)
    token_data = verify_motoboy_token(token, db)
    motoboy_id = token_data["motoboy_id"]
    rest_id = token_data["restaurante_id"]
    
    current_restaurante_id.set(rest_id)
    
    motoboy = db.query(Motoboy).filter(
        Motoboy.id == motoboy_id,
        Motoboy.restaurante_id == rest_id
    ).first()
    if not motoboy:
        raise HTTPException(status_code=404, detail="Motoboy não encontrado")
    
    comandas = db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.fechada == False,
        Comanda.delivery_status.in_(["pronto", "transito"]),
        (Comanda.motoboy_id == motoboy_id) | (Comanda.motoboy_id == None)
    ).order_by(Comanda.criado_em.desc()).all()
    
    entregas = []
    for c in comandas:
        calc_total = sum(i.preco_unit for i in c.itens) if c.itens else 0.0
        total_entrega = calc_total + (c.delivery_taxa or 0.0)
        
        prod_counts = {}
        for i in c.itens:
            pname = i.produto.nome if i.produto else "Item"
            prod_counts[pname] = prod_counts.get(pname, 0) + 1
        
        itens_str = ", ".join([f"{qty}x {pname}" for pname, qty in prod_counts.items()])
        
        entregas.append({
            "id": c.id,
            "numero_pedido": c.numero_pedido,
            "cliente_nome": c.identificador or "Cliente",
            "delivery_telefone": c.delivery_telefone,
            "delivery_endereco": c.delivery_endereco,
            "delivery_taxa": round(c.delivery_taxa or 0.0, 2),
            "delivery_status": c.delivery_status,
            "total": round(total_entrega, 2),
            "valor_pago": round(c.valor_pago or 0.0, 2),
            "valor_a_cobrar": max(0.0, round(total_entrega - (c.valor_pago or 0.0), 2)),
            "itens_resumo": itens_str,
            "criado_em": c.criado_em.isoformat() if c.criado_em else None
        })
    
    return {
        "motoboy": {
            "id": motoboy.id,
            "nome": motoboy.nome,
            "telefone": motoboy.telefone
        },
        "entregas": entregas
    }
