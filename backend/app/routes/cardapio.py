import uuid
import datetime
import logging
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, status
from sqlalchemy import or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ..database import get_db, current_restaurante_id, tenant_session_scope
from ..models import (
    Comanda,
    ConfiguracaoRestaurante,
    Item,
    Lancamento,
    Produto,
    Restaurante,
    Usuario,
)
from ..schemas import CardapioPedidoCreate
from ..websocket_manager import manager
from .cardapio_digital import resolve_restaurant_id
from .orders import gerar_novo_numero_pedido
from ..services.clientes import (
    cadastrar_ou_atualizar_cliente,
    normalizar_telefone_cliente,
)
from ..services.inventory import consumir_estoque_dos_itens
from ..services.online_order_policy import evaluate_online_order_policy
from .cardapio_clientes import authenticated_customer, _client_ip, _consume_rate_limit

logger = logging.getLogger("koma.cardapio")
router = APIRouter(
    prefix="/cardapio",
    tags=["Cardápio Digital Client"]
)

MAX_PUBLIC_ORDER_UNITS = 200
PUBLIC_ORDER_RATE_WINDOW_SECONDS = 15 * 60
MAX_PUBLIC_ORDERS_PER_PHONE = 8
MAX_PUBLIC_ORDERS_PER_IP = 120
ELIGIBLE_ONLINE_ORDER_ROLES = ["admin", "gerente", "caixa", "garcom", "atendente"]


def _order_total(comanda: Comanda) -> float:
    return float(sum(float(item.preco_unit or 0) for item in comanda.itens) + float(comanda.delivery_taxa or 0))


def _existing_order_response(comanda: Comanda) -> dict:
    return {
        "status": "success",
        "comanda_id": comanda.id,
        "numero_pedido": comanda.numero_pedido,
        "delivery_status": comanda.delivery_status or "pendente",
        "tipo": comanda.tipo,
        "cliente_id": comanda.cliente_id,
        "total": _order_total(comanda),
        "mensagem": "Pedido já cadastrado com sucesso!",
        "pagamento": {
            "status": "pendente_no_atendimento",
            "cobranca_online": False,
        },
    }


def _load_existing_idempotent_order(db: Session, rest_id: int, key: str) -> Comanda | None:
    if not key:
        return None
    return db.query(Comanda).filter(
        Comanda.restaurante_id == rest_id,
        Comanda.idempotency_key == key,
    ).first()


def _enforce_public_order_rate_limits(
    db: Session,
    *,
    request: Request,
    restaurante_id: int,
    telefone: str,
) -> None:
    """Persiste limites antes da transação do pedido para resistir a payloads inválidos."""
    _consume_rate_limit(
        db,
        restaurante_id=restaurante_id,
        scope="public_order_phone",
        raw_key=telefone,
        max_requests=MAX_PUBLIC_ORDERS_PER_PHONE,
        window_seconds=PUBLIC_ORDER_RATE_WINDOW_SECONDS,
    )
    db.commit()

    _consume_rate_limit(
        db,
        restaurante_id=restaurante_id,
        scope="public_order_ip",
        raw_key=_client_ip(request),
        max_requests=MAX_PUBLIC_ORDERS_PER_IP,
        window_seconds=PUBLIC_ORDER_RATE_WINDOW_SECONDS,
    )
    db.commit()


@router.post("/pedidos", status_code=status.HTTP_201_CREATED)
def criar_pedido_online(
    payload: CardapioPedidoCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    customer_token: str | None = Header(
        default=None,
        alias="X-Koma-Customer-Token",
    ),
    request_idempotency_key: str | None = Header(
        default=None,
        alias="X-Idempotency-Key",
    ),
):
    """Cria um pedido público de forma tenant-aware, atômica e idempotente."""
    modalidade = payload.tipo_pedido.strip().lower()
    if modalidade not in {"delivery", "retirada"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="tipo_pedido deve ser 'delivery' ou 'retirada'."
        )

    endereco_entrega = payload.endereco_entrega.strip()
    if modalidade == "delivery" and not endereco_entrega:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="O endereço de entrega é obrigatório para pedidos de delivery."
        )

    total_units = sum(item.quantidade for item in payload.itens)
    if total_units > MAX_PUBLIC_ORDER_UNITS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Um pedido online pode conter no máximo {MAX_PUBLIC_ORDER_UNITS} unidades.",
        )

    payload_key = (payload.idempotency_key or "").strip()
    header_key = (request_idempotency_key or "").strip()
    if payload_key and header_key and payload_key != header_key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A chave idempotente do pedido é inconsistente.",
        )
    idempotency_key = header_key or payload_key
    if idempotency_key and (len(idempotency_key) < 8 or len(idempotency_key) > 128):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A chave idempotente deve possuir entre 8 e 128 caracteres.",
        )

    tipo_comanda = "Retirada" if modalidade == "retirada" else "Delivery"
    endereco_comanda = None if modalidade == "retirada" else endereco_entrega

    rest_id = resolve_restaurant_id(str(payload.restaurante_id), None, db)
    token_context = current_restaurante_id.set(rest_id)
    auto_delivery_status = "pendente"
    cliente = None
    cliente_nome = payload.cliente_nome
    telefone_clean = normalizar_telefone_cliente(payload.cliente_telefone)

    try:
        restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
        if restaurante is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Restaurante não encontrado.",
            )

        # A mesma chave representa a mesma operação. O replay deve continuar
        # estável mesmo se o restaurante pausar pedidos depois da primeira resposta.
        existing_comanda = _load_existing_idempotent_order(db, rest_id, idempotency_key)
        if existing_comanda:
            logger.info("Pedido retornado via idempotency_key existente: %s", idempotency_key)
            return _existing_order_response(existing_comanda)

        if customer_token:
            _claims, cliente = authenticated_customer(
                db,
                raw_token=customer_token,
                expected_restaurante_id=rest_id,
            )
            telefone_clean = cliente.telefone
            cliente_nome = cliente.nome

        configuracao = db.query(ConfiguracaoRestaurante).filter(
            ConfiguracaoRestaurante.restaurante_id == rest_id,
        ).first()
        policy = evaluate_online_order_policy(
            restaurante,
            configuracao,
            modalidade=modalidade,
        )
        if not policy.accepting_orders:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=policy.reason or "O restaurante não está aceitando pedidos online no momento.",
            )

        # A taxa nunca é confiada ao navegador. O campo legado do payload é
        # aceito por compatibilidade, mas o valor persistido é definido no servidor.
        taxa_entrega = 0.0 if modalidade == "retirada" else policy.delivery_fee

        _enforce_public_order_rate_limits(
            db,
            request=request,
            restaurante_id=rest_id,
            telefone=telefone_clean,
        )

        cinco_minutos_atras = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=5)
        recentes = []
        if cliente is not None:
            recentes = db.query(Comanda).filter(
                Comanda.restaurante_id == rest_id,
                Comanda.cliente_id == cliente.id,
                Comanda.tipo == tipo_comanda,
                Comanda.criado_em >= cinco_minutos_atras,
            ).order_by(Comanda.criado_em.desc()).all()

        payload_items_sig = sorted([
            f"{item.produto_id}:{item.observacao}"
            for item in payload.itens
            for _ in range(item.quantidade)
        ])
        for rec in recentes:
            rec_items_sig = sorted([f"{item.produto_id}:{item.observacao}" for item in rec.itens])
            if payload_items_sig == rec_items_sig:
                logger.info("Pedido duplicado evitado por janela temporal. Retornando pedido id %s", rec.id)
                return _existing_order_response(rec)

        # A prontidão operacional do restaurante tem precedência sobre a
        # validação do carrinho: nunca inventamos um usuário para satisfazer FK.
        # Considera `cargo` também por compatibilidade com registros legados.
        garcom = db.query(Usuario).filter(
            Usuario.restaurante_id == rest_id,
            Usuario.status == "ativo",
            or_(
                Usuario.role.in_(ELIGIBLE_ONLINE_ORDER_ROLES),
                Usuario.cargo.in_(ELIGIBLE_ONLINE_ORDER_ROLES),
            ),
        ).first()
        if not garcom:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Restaurante ainda não está pronto para receber pedidos online.",
            )
        garcom_id = garcom.id

        # Valida todo o carrinho antes da primeira escrita para manter o pedido
        # atômico mesmo quando um produto foi desativado entre catálogo e checkout.
        product_ids = {item.produto_id for item in payload.itens}
        products = db.query(Produto).filter(
            Produto.restaurante_id == rest_id,
            Produto.ativo.is_(True),
            Produto.id.in_(product_ids),
        ).all()
        products_by_id = {str(product.id): product for product in products}
        missing_product = next(
            (product_id for product_id in product_ids if str(product_id) not in products_by_id),
            None,
        )
        if missing_product is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Produto '{missing_product}' não encontrado ou inativo para este estabelecimento.",
            )

        numero_pedido = gerar_novo_numero_pedido(db)
        if cliente is not None:
            cliente = cadastrar_ou_atualizar_cliente(
                db,
                restaurante_id=rest_id,
                telefone=cliente.telefone,
                nome=cliente.nome,
                endereco=endereco_comanda,
            )

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
            idempotency_key=idempotency_key or None,
        )
        db.add(nova_comanda)
        db.flush()

        lancamento_id = f"l-{uuid.uuid4().hex[:8]}"
        novo_lancamento = Lancamento(
            id=lancamento_id,
            comanda_id=comanda_id,
            garcom_id=garcom_id,
            origem="cardapio",
            timestamp=datetime.datetime.now(datetime.timezone.utc),
        )
        db.add(novo_lancamento)
        db.flush()

        itens_criados = []
        for item_in in payload.itens:
            produto = products_by_id[str(item_in.produto_id)]
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
                    pago=False,
                )
                db.add(novo_item)
                itens_criados.append(novo_item)

        db.flush()
        consumir_estoque_dos_itens(db, itens_criados, usuario_id=garcom_id)
        db.commit()
        db.refresh(nova_comanda)

    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        concurrent_order = _load_existing_idempotent_order(db, rest_id, idempotency_key)
        if concurrent_order is not None:
            logger.info(
                "Corrida idempotente resolvida para pedido público: %s",
                idempotency_key,
            )
            return _existing_order_response(concurrent_order)
        logger.exception(
            "Conflito de integridade ao processar pedido público do restaurante %s.",
            rest_id,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O pedido entrou em conflito com outra operação. Tente novamente.",
        )
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

    background_tasks.add_task(
        manager.broadcast,
        {"event": "tables_updated"},
        rest_id,
    )
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "new_delivery_order",
            "message": f"Novo pedido online de {cliente_nome} recebido!",
        },
        rest_id,
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

    total = _order_total(nova_comanda)
    return {
        "status": "success",
        "message": "Pedido enviado e integrado ao caixa com sucesso!",
        "comanda_id": comanda_id,
        "numero_pedido": numero_pedido,
        "cliente_id": cliente.id if cliente is not None else None,
        "total": total,
        "pagamento": {
            "status": "pendente_no_atendimento",
            "cobranca_online": False,
        },
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
    db: Session = Depends(get_db),
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
            detail="Pedido não encontrado.",
        )

    with tenant_session_scope(db, int(rest_id)):
        comanda = db.query(Comanda).filter(
            Comanda.restaurante_id == int(rest_id),
            Comanda.id == comanda_id,
            Comanda.idempotency_key == key,
        ).first()
        if not comanda:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pedido não encontrado.",
            )

        itens_payload = [
            {
                "id": item.id,
                "nome": item.produto.nome if item.produto else "Item",
                "quantidade": 1,
            }
            for item in comanda.itens
        ]

        status_retorno = comanda.delivery_status or "pendente"
        if comanda.fechada and status_retorno != "recusado":
            status_retorno = "finalizado"

        return {
            "id": comanda.id,
            "numero_pedido": comanda.numero_pedido,
            "status": status_retorno,
            "tipo": comanda.tipo,
            "total": _order_total(comanda),
            "fechada": comanda.fechada,
            "criado_em": comanda.criado_em.isoformat() if comanda.criado_em else None,
            "itens": itens_payload,
        }
