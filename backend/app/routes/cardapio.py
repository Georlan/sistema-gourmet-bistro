import uuid
import datetime
import logging
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from ..database import get_db, current_restaurante_id
from ..models import Comanda, Lancamento, Item, Produto, Usuario, Cliente
from ..schemas import CardapioPedidoCreate
from ..websocket_manager import manager
from .cardapio_digital import resolve_restaurant_id
from .orders import gerar_novo_numero_pedido

logger = logging.getLogger("koma.cardapio")
router = APIRouter(
    prefix="/cardapio",
    tags=["Cardápio Digital Client"]
)

def limpar_telefone(tel: str) -> str:
    if not tel:
        return ""
    return "".join(c for c in tel if c.isdigit())

@router.post("/pedidos", status_code=status.HTTP_201_CREATED)
def criar_pedido_online(
    payload: CardapioPedidoCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
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
    # status_comanda pertence ao fluxo de solicitação da conta no salão
    # (null | aguardando_pagamento) e não deve representar pagamento online.
    auto_delivery_status = "pendente"  # Fica na gaveta de aceite do caixa

    # Normalizar telefone do cliente
    telefone_clean = limpar_telefone(payload.cliente_telefone)

    try:
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
        
        # Upsert do Cliente (CRM Multicanal)
        cliente = db.query(Cliente).filter(
            Cliente.restaurante_id == rest_id,
            Cliente.telefone == telefone_clean
        ).first()
        
        if cliente:
            cliente.nome = payload.cliente_nome
            if endereco_comanda:
                cliente.endereco = endereco_comanda
        else:
            cliente = Cliente(
                id=str(uuid.uuid4()),
                restaurante_id=rest_id,
                telefone=telefone_clean,
                nome=payload.cliente_nome,
                endereco=endereco_comanda,
                saldo_pontos=0,
                saldo_cashback=0.0
            )
            db.add(cliente)
        db.flush()
        
        # Criar a Comanda (comanda pai)
        comanda_id = f"c-{uuid.uuid4().hex[:8]}"
        nova_comanda = Comanda(
            id=comanda_id,
            restaurante_id=rest_id,
            mesa_id=None,
            garcom_id=garcom_id,
            tipo=tipo_comanda,
            identificador=payload.cliente_nome,
            numero_pedido=numero_pedido,
            fechada=False,
            criado_em=datetime.datetime.now(datetime.timezone.utc),
            delivery_status=auto_delivery_status,
            delivery_telefone=telefone_clean,
            delivery_endereco=endereco_comanda,
            delivery_taxa=taxa_entrega,
            status_comanda=None
        )
        db.add(nova_comanda)
        db.flush()
        
        # Criar o lote de Lançamento
        lancamento_id = f"l-{uuid.uuid4().hex[:8]}"
        novo_lancamento = Lancamento(
            id=lancamento_id,
            comanda_id=comanda_id,
            garcom_id=garcom_id,
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
                    cliente_nome=item_in.cliente_nome or payload.cliente_nome,
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
            "message": f"Novo pedido online de {payload.cliente_nome} recebido!"
        },
        rest_id
    )
    
    return {
        "status": "success",
        "message": "Pedido enviado e integrado ao caixa com sucesso!",
        "comanda_id": comanda_id,
        "numero_pedido": numero_pedido,
        "pagamento": {
            "status": "pendente_no_atendimento",
            "cobranca_online": False
        }
    }
