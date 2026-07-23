import uuid
import datetime
import random
import time
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from ..database import get_db, current_restaurante_id
from ..models import Comanda, Lancamento, Item, Produto, Usuario, Cliente
from ..schemas import CardapioPedidoCreate, CardapioIdentificarRequest, CardapioVerificarOtpRequest
from ..websocket_manager import manager
from .orders import gerar_novo_numero_pedido

router = APIRouter(
    prefix="/cardapio",
    tags=["Cardápio Digital Client"]
)

# Cache de OTPs temporários em memória: { (restaurante_id, telefone_limpo): (otp_code, expira_em) }
otp_store = {}

def limpar_telefone(tel: str) -> str:
    if not tel:
        return ""
    return "".join(c for c in tel if c.isdigit())

def mascarar_nome(nome: str) -> str:
    if not nome:
        return ""
    parts = nome.split(" ")
    mascarado = []
    for part in parts:
        if len(part) <= 2:
            mascarado.append(part)
        else:
            mascarado.append(part[:2] + "*" * (len(part) - 2))
    return " ".join(mascarado)

def mascarar_endereco(endereco: str) -> str:
    if not endereco:
        return ""
    if len(endereco) <= 8:
        return "********"
    return endereco[:6] + "*" * (len(endereco) - 12) + endereco[-6:]

def formatar_e_mascarar_telefone(tel: str) -> str:
    if len(tel) >= 10:
        ddd = tel[-11:-9]
        digitos = tel[-9:]
        return f"({ddd}) {digitos[:2]}***-{digitos[-4:]}"
    return tel[:3] + "***" + tel[-2:]

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
    # (Usaremos o restaurante_id do payload ou do contexto ativo para definir o tenant correto)
    rest_id = payload.restaurante_id or current_restaurante_id.get()
    
    # 2. Obter um garçom padrão (usuário ativo) do restaurante para satisfazer a constraint FK
    garcom = db.query(Usuario).filter(Usuario.restaurante_id == rest_id).first()
    garcom_id = garcom.id if garcom else "admin"
    
    # 3. Definir status de delivery inicial
    # Se Pix, aguarda pagamento (pendente_pagamento). Se Dinheiro/Cartão na entrega, já entra como recebido (RECEBIDO)
    status_inicial = "PENDENTE_PAGAMENTO" if payload.forma_pagamento == "Pix" else "RECEBIDO"
    auto_delivery_status = "pendente"  # Fica na gaveta de aceite do caixa
    
    # Temporariamente setar o restaurante_id no contextvar para a geração do numero_pedido
    token_context = current_restaurante_id.set(rest_id)
    
    # Normalizar telefone do cliente
    telefone_clean = limpar_telefone(payload.cliente_telefone)

    try:
        numero_pedido = gerar_novo_numero_pedido(db)
        
        # Upsert do Cliente (CRM Multicanal)
        cliente = db.query(Cliente).filter(
            Cliente.restaurante_id == rest_id,
            Cliente.telefone == telefone_clean
        ).first()
        
        if cliente:
            cliente.nome = payload.cliente_nome
            cliente.endereco = payload.endereco_entrega
        else:
            cliente = Cliente(
                id=str(uuid.uuid4()),
                restaurante_id=rest_id,
                telefone=telefone_clean,
                nome=payload.cliente_nome,
                endereco=payload.endereco_entrega,
                saldo_pontos=0,
                saldo_cashback=0.0
            )
            db.add(cliente)
        db.flush()
        
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
            delivery_telefone=telefone_clean,
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


@router.post("/identificar")
def identificar_cliente(payload: CardapioIdentificarRequest, db: Session = Depends(get_db)):
    telefone_clean = limpar_telefone(payload.telefone)
    
    token_context = current_restaurante_id.set(payload.restaurante_id)
    try:
        cliente = db.query(Cliente).filter(
            Cliente.restaurante_id == payload.restaurante_id,
            Cliente.telefone == telefone_clean
        ).first()
        
        if cliente:
            # LGPD: Retorna dados mascarados e omite saldos reais antes da validação OTP
            nome_mascarado = mascarar_nome(cliente.nome)
            endereco_mascarado = mascarar_endereco(cliente.endereco)
            telefone_mascarado = formatar_e_mascarar_telefone(cliente.telefone)
            return {
                "exists": True,
                "nome_mascarado": nome_mascarado,
                "endereco_mascarado": endereco_mascarado,
                "telefone_mascarado": telefone_mascarado
            }
        else:
            return {
                "exists": False
            }
    finally:
        current_restaurante_id.reset(token_context)


import secrets

@router.post("/enviar-otp")
def enviar_otp(payload: CardapioIdentificarRequest):
    telefone_clean = limpar_telefone(payload.telefone)
    if not telefone_clean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Número de telefone inválido."
        )
    
    key = (payload.restaurante_id, telefone_clean)
    now = time.time()

    # Rate Limit: proíbe novas solicitações com menos de 30 segundos de intervalo
    if key in otp_store:
        entry = otp_store[key]
        if isinstance(entry, dict) and (now - entry.get("last_sent", 0)) < 30:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Aguarde 30 segundos antes de solicitar um novo código."
            )

    # Gerar código OTP criptograficamente seguro de 4 dígitos
    otp = f"{secrets.randbelow(9000) + 1000}"
    
    # Salvar OTP em memória com expiração de 5 minutos, timestamp de envio e contagem de tentativas
    expira_em = now + 300
    otp_store[key] = {
        "otp": otp,
        "expira_em": expira_em,
        "attempts": 0,
        "last_sent": now
    }
    
    # Log seguro sem expor dígitos brutos
    print(f"[OTP WhatsApp] Código gerado para telefone ***{telefone_clean[-4:] if len(telefone_clean) >= 4 else ''} no restaurante {payload.restaurante_id}")
    
    return {
        "success": True,
        "message": "Código de verificação enviado com sucesso para o WhatsApp."
    }


@router.post("/verificar-otp")
def verificar_otp(payload: CardapioVerificarOtpRequest, db: Session = Depends(get_db)):
    telefone_clean = limpar_telefone(payload.telefone)
    key = (payload.restaurante_id, telefone_clean)
    
    # Validar OTP no cache de memória
    stored = otp_store.get(key)
    if not stored:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código de verificação não gerado ou expirado."
        )

    # Normalização de compatibilidade de dicionário/tupla
    if isinstance(stored, tuple):
        otp_code, expira_em = stored
        attempts = 0
    else:
        otp_code = stored["otp"]
        expira_em = stored["expira_em"]
        attempts = stored.get("attempts", 0)
        
    if time.time() > expira_em:
        otp_store.pop(key, None)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código de verificação expirado. Por favor, solicite um novo."
        )

    # Incrementar e bloquear após 5 tentativas incorretas
    attempts += 1
    if isinstance(stored, dict):
        stored["attempts"] = attempts

    if attempts > 5:
        otp_store.pop(key, None)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Número máximo de tentativas excedido. Solicite um novo código."
        )

    if otp_code != payload.otp:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código de verificação incorreto."
        )
        
    # OTP validado com sucesso! Remove do cache para segurança (uso único)
    otp_store.pop(key, None)
    
    token_context = current_restaurante_id.set(payload.restaurante_id)
    try:
        # Buscar cliente no banco e retornar os dados reais sem máscara (LGPD)
        cliente = db.query(Cliente).filter(
            Cliente.restaurante_id == payload.restaurante_id,
            Cliente.telefone == telefone_clean
        ).first()
        
        if cliente:
            return {
                "success": True,
                "nome": cliente.nome,
                "endereco": cliente.endereco,
                "telefone": cliente.telefone,
                "saldo_pontos": cliente.saldo_pontos,
                "saldo_cashback": cliente.saldo_cashback
            }
        else:
            return {
                "success": True,
                "is_new": True
            }
    finally:
        current_restaurante_id.reset(token_context)
