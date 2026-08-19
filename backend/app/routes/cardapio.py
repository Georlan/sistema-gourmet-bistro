import uuid
import datetime
import logging
from fastapi import APIRouter, Depends, Header, HTTPException, status, BackgroundTasks
from sqlalchemy import text
from sqlalchemy.orm import Session
from ..database import get_db, current_restaurante_id, tenant_session_scope
from ..models import Comanda, Lancamento, Item, Produto, Usuario
from ..schemas import CardapioPedidoCreate
from ..websocket_manager import manager
from .cardapio_digital import resolve_restaurant_id
from .orders import gerar_novo_numero_pedido
from ..services.clientes import (
    cadastrar_ou_atualizar_cliente,
    normalizar_telefone_cliente,
)
from .cardapio_clientes import authenticated_customer

logger = logging.getLogger("koma.cardapio")
router = APIRouter(
    prefix="/cardapio",
    tags=["Cardápio Digital Client"]
)

@router.post("/pedidos", status_code=status.HTTP_201_CREATED)
def criar_pedido_online(
    payload: CardapioPedidoCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    customer_token: str | None = Header(
        default=None,
        alias="X-Koma-Customer-Token",
    ),
):
    """
    Recebe um novo pedido do cardápio digital do cliente final.
    Cria uma comanda de Delivery ou Retirada e seus respectivos itens,
    notificando o caixa em tempo real para aceite.
    """
    modalidade = payload.tipo_pedido.strip().lower()
    if modalidade not in {"delivery", "retirada"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="tipo_pedido deve ser 'delivery' ou 'retirada'."
        )

    endereco_entrega = payload.endereco_entrega.strip()
    if modalidade == "delivery" and not endereco_entrega:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="O endereço de entrega é obrigatório para pedidos de delivery."
        )

    tipo_comanda = "Retirada" if modalidade == "retirada" else "Delivery"
    endereco_comanda = None if modalidade == "retirada" else endereco_entrega
    taxa_entrega = 0.0 if modalidade == "retirada" else payload.taxa_entrega

    # Resolve o tenant por uma função controlada e vincula a sessão antes de
    # consultar qualquer tabela multi-tenant.
    rest_id = resolve_restaurant_id(str(payload.restaurante_id), None, db)
    token_context = current_restaurante_id.set(rest_id)

    # Definir status operacional do delivery.
    auto_delivery_status = "pendente"  # Fica na gaveta de aceite do caixa

    # Um telefone digitado serve para contato, mas só uma sessão OTP comprova
    # que o pedido pertence à ficha de fidelidade daquele número.
    cliente = None
    if customer_token:
        _claims, cliente = authenticated_customer(
            db,
            raw_token=customer_token,
            expected_restaurante_id=rest_id,
        )

    telefone_clean = (
        cliente.telefone
        if cliente is not None
        else normalizar_telefone_cliente(payload.cliente_telefone)
    )
    cliente_nome = cliente.nome if cliente is not None else payload.cliente_nome
    idempotency_key = (payload.idempotency_key or "").strip()

    try:
        # 1. Idempotency Key check: if idempotency_key is provided, return existing order
        if idempotency_key:
            existing_comanda = db.query(Comanda).filter(
                Comanda.restaurante_id == rest_id,
                Comanda.idempotency_key == idempotency_key
            ).first()
            if existing_comanda:
                logger.info("Pedido retornado via idempotency_key existente: %s", idempotency_key)
                return {
                    "status": "success",
                    "comanda_id": existing_comanda.id,
                    "numero_pedido": existing_comanda.numero_pedido,
                    "delivery_status": existing_comanda.delivery_status or "pendente",
                    "tipo": existing_comanda.tipo,
                    "mensagem": "Pedido já cadastrado com sucesso!"
                }

        # 2. Time-window fallback check (5 minutes, same tenant, phone, delivery type):
        cinco_minutos_atras = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=5)
        recentes = []
        if cliente is not None:
            recentes = db.query(Comanda).filter(
                Comanda.restaurante_id == rest_id,
                Comanda.cliente_id == cliente.id,
                Comanda.tipo == tipo_comanda,
                Comanda.criado_em >= cinco_minutos_atras,
            ).order_by(Comanda.criado_em.desc()).all()

        payload_items_sig = sorted([f"{i.produto_id}:{i.observacao}" for i in payload.itens for _ in range(i.quantidade)])
        for rec in recentes:
            rec_items_sig = sorted([f"{i.produto_id}:{i.observacao}" for i in rec.itens])
            if payload_items_sig == rec_items_sig:
                logger.info("Pedido duplicado evitado por janela temporal. Retornando pedido id %s", rec.id)
                return {
                    "status": "success",
                    "comanda_id": rec.id,
                    "numero_pedido": rec.numero_pedido,
                    "delivery_status": rec.delivery_status or "pendente",
                    "tipo": rec.tipo,
                    "mensagem": "Pedido já cadastrado com sucesso!"
                }

        # Usuário ativo obrigatório para satisfazer a FK sem criar uma
        # identidade fictícia que poderia corromper a autoria do pedido.
        garcom = db.query(Usuario).filter(
            Usuario.restaurante_id == rest_id,
            Usuario.status == "ativo",
        ).first()
        if not garcom:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Restaurante ainda não está pronto para receber "
                    "pedidos online."
                ),
            )
        garcom_id = garcom.id

        numero_pedido = gerar_novo_numero_pedido(db)
        
        if cliente is not None:
            cliente = cadastrar_ou_atualizar_cliente(
                db,
                restaurante_id=rest_id,
                telefone=cliente.telefone,
                nome=cliente.nome,
                endereco=endereco_comanda,
            )
        
        # Criar a Comanda (comanda pai)
        comanda_id = f"c-{uuid.uuid4().hex[:8]}"
        nova_comanda = Comanda(
            id=comanda_id,
            restaurante_id=rest_id,
            cliente_id=cliente.id if cliente is not None else None,
            mesa_id=None,
            garcom_id=garcom_id,
            tipo=tipo_comanda,
            identificador=cliente_nome,
            numero_pedido=numero_pedido,
            fechada=False,
            criado_em=datetime.datetime.now(datetime.timezone.utc),
            delivery_status=auto_delivery_status,
            delivery_telefone=telefone_clean,
            delivery_endereco=endereco_comanda,
            delivery_taxa=taxa_entrega,
            status_comanda=None,
            idempotency_key=idempotency_key or None
        )
        db.add(nova_comanda)
        db.flush()
        
        # Criar o lote de Lançamento
        lancamento_id = f"l-{uuid.uuid4().hex[:8]}"
        novo_lancamento = Lancamento(
            id=lancamento_id,
            comanda_id=comanda_id,
            garcom_id=garcom_id,
            origem="cardapio",
            timestamp=datetime.datetime.now(datetime.timezone.utc)
        )
        db.add(novo_lancamento)
        db.flush()
        
        # Criar os Itens do Pedido
        for item_in in payload.itens:
            produto = db.query(Produto).filter(
                Produto.id == item_in.produto_id,
                Produto.ativo == True,
                Produto.restaurante_id == rest_id
            ).first()
            
            if not produto:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Produto '{item_in.produto_id}' não encontrado ou inativo para este estabelecimento."
                )
                
            for _ in range(item_in.quantidade):
                novo_item = Item(
                    id=f"i-{uuid.uuid4().hex[:8]}",
                    restaurante_id=rest_id,
                    comanda_id=comanda_id,
                    lancamento_id=lancamento_id,
                    produto_id=item_in.produto_id,
                    preco_unit=produto.preco,
                    observacao=item_in.observacao or "",
                    cliente_nome=item_in.cliente_nome or cliente_nome,
                    status="preparando",
                    pago=False
                )
                db.add(novo_item)
            
        db.commit()
        
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception(
            "Falha inesperada ao processar pedido público do restaurante %s.",
            rest_id,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Não foi possível processar o pedido. Tente novamente.",
        )
    finally:
        current_restaurante_id.reset(token_context)
        
    # 7. Disparar notificação de novos pedidos via WebSocket para o Caixa do restaurante
    background_tasks.add_task(
        manager.broadcast,
        {"event": "tables_updated"},
        rest_id
    )
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "new_delivery_order",
            "message": f"Novo pedido online de {cliente_nome} recebido!"
        },
        rest_id
    )
    if cliente is not None:
        background_tasks.add_task(
            manager.broadcast,
            {
                "event": "customers_updated",
                "detail": {
                    "action": "order_linked",
                    "cliente_id": cliente.id,
                },
            },
            rest_id,
            target_audience="internal",
        )
    
    return {
        "status": "success",
        "message": "Pedido enviado e integrado ao caixa com sucesso!",
        "comanda_id": comanda_id,
        "numero_pedido": numero_pedido,
        "cliente_id": cliente.id if cliente is not None else None,
        "pagamento": {
            "status": "pendente_no_atendimento",
            "cobranca_online": False
        }
    }


def _resolve_public_order_tenant(db: Session, comanda_id: str, key: str) -> int | None:
    """Descobre o tenant somente quando ID + chave secreta do pedido conferem."""
    if not comanda_id or not key:
        return None

    if db.get_bind().dialect.name == "postgresql":
        return db.execute(
            text(
                "SELECT koma_internal.resolve_public_order_tenant("
                ":comanda_id, :key)"
            ),
            {"comanda_id": comanda_id, "key": key},
        ).scalar_one_or_none()

    # SQLite de desenvolvimento/teste não possui SECURITY DEFINER. SQL textual
    # faz o mesmo lookup mínimo sem depender do filtro ORM/tenant atual.
    return db.execute(
        text(
            """
            SELECT restaurante_id
            FROM comandas
            WHERE id = :comanda_id
              AND idempotency_key = :key
            LIMIT 1
            """
        ),
        {"comanda_id": comanda_id, "key": key},
    ).scalar_one_or_none()


@router.get("/pedidos/{comanda_id}/status")
def consultar_status_pedido_publico(
    comanda_id: str,
    key: str = "",
    db: Session = Depends(get_db)
):
    """
    Retorna o status atual de um pedido público em andamento para o cliente.
    Requer a idempotency_key como query param ?key=... para provar posse.
    Retorna 404 (nunca 403) quando a chave está errada ou ausente, para não
    revelar que o comanda_id existe.
    """
    key = (key or "").strip()
    rest_id = _resolve_public_order_tenant(db, comanda_id.strip(), key)
    if rest_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pedido não encontrado."
        )

    with tenant_session_scope(db, int(rest_id)):
        # O lookup mínimo acima apenas descobre o tenant. A leitura financeira
        # continua passando pelo ORM + RLS e inclui restaurante_id explicitamente.
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == int(rest_id),
            Comanda.id == comanda_id,
            Comanda.idempotency_key == key,
        ).first()
        if not comanda:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido não encontrado."
            )

        itens_payload = [
            {
                "id": item.id,
                "nome": item.produto.nome if item.produto else "Item",
                "quantidade": 1,
            }
            for item in comanda.itens
        ]

        total_val = sum(i.preco_unit for i in comanda.itens) + (comanda.delivery_taxa or 0.0)

        return {
            "id": comanda.id,
            "numero_pedido": comanda.numero_pedido,
            "status": comanda.delivery_status or "pendente",
            "tipo": comanda.tipo,
            "total": total_val,
            "fechada": comanda.fechada,
            "criado_em": comanda.criado_em.isoformat() if comanda.criado_em else None,
            "itens": itens_payload
        }
