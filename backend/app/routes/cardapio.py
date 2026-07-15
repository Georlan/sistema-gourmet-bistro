import uuid
import datetime
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from ..database import get_db, current_restaurante_id
from ..models import Comanda, Lancamento, Item, Produto, Usuario
from ..schemas import CardapioPedidoCreate
from ..websocket_manager import manager
from .orders import gerar_novo_numero_pedido

router = APIRouter(
    prefix="/cardapio",
    tags=["Cardápio Digital Client"]
)

@router.post("/pedidos", status_code=status.HTTP_201_CREATED)
def criar_pedido_online(
    payload: CardapioPedidoCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Recebe um novo pedido do cardápio digital do cliente final.
    Cria a comanda do tipo 'delivery' e seus respectivos itens de rascunho,
    notificando o caixa em tempo real.
    """
    # 1. Verificar se o restaurante existe
    # (Usaremos o restaurante_id do payload para definir o tenant correto)
    rest_id = payload.restaurante_id
    
    # 2. Obter um garçom padrão (usuário ativo) do restaurante para satisfazer a constraint FK
    garcom = db.query(Usuario).filter(Usuario.restaurante_id == rest_id).first()
    garcom_id = garcom.id if garcom else "admin"
    
    # 3. Definir status de delivery inicial
    # Se Pix, aguarda pagamento (pendente_pagamento). Se Dinheiro/Cartão na entrega, já entra como recebido (RECEBIDO)
    status_inicial = "PENDENTE_PAGAMENTO" if payload.forma_pagamento == "Pix" else "RECEBIDO"
    auto_delivery_status = "pendente"  # Fica na gaveta de aceite do caixa
    
    # Temporariamente setar o restaurante_id no contextvar para a geração do numero_pedido
    token_context = current_restaurante_id.set(rest_id)
    
    try:
        numero_pedido = gerar_novo_numero_pedido(db)
        
        # 4. Criar a Comanda (comanda pai)
        comanda_id = f"c-{uuid.uuid4().hex[:8]}"
        nova_comanda = Comanda(
            id=comanda_id,
            restaurante_id=rest_id,
            mesa_id=None,
            garcom_id=garcom_id,
            tipo="Delivery",
            identificador=payload.cliente_nome,
            numero_pedido=numero_pedido,
            fechada=False,
            criado_em=datetime.datetime.now(datetime.timezone.utc),
            delivery_status=auto_delivery_status,
            delivery_telefone=payload.cliente_telefone,
            delivery_endereco=payload.endereco_entrega,
            delivery_taxa=payload.taxa_entrega,
            status_comanda=status_inicial
        )
        db.add(nova_comanda)
        db.flush()
        
        # 5. Criar o lote de Lançamento
        lancamento_id = f"l-{uuid.uuid4().hex[:8]}"
        novo_lancamento = Lancamento(
            id=lancamento_id,
            comanda_id=comanda_id,
            garcom_id=garcom_id,
            timestamp=datetime.datetime.now(datetime.timezone.utc)
        )
        db.add(novo_lancamento)
        db.flush()
        
        # 6. Criar os Itens do Pedido
        for item_in in payload.itens:
            produto = db.query(Produto).filter(
                Produto.id == item_in.produto_id, 
                Produto.restaurante_id == rest_id
            ).first()
            
            if not produto:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Produto '{item_in.produto_id}' não encontrado ou inativo para este estabelecimento."
                )
                
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
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Falha ao processar pedido no servidor: {str(e)}"
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
        "numero_pedido": numero_pedido
    }
