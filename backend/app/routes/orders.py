import uuid
import datetime
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from typing import List, Optional

from ..database import get_db
from ..models import Comanda, Mesa, Usuario, Produto, Lancamento, Item, ActivityLog, Motoboy, ConfiguracaoRestaurante
from ..schemas import (
    ComandaResponse, ComandaDetail, ComandaCreate,
    LancamentoResponse, LancamentoCreate, ItemResponse, ItemUpdate,
    MotoboyCreate, MotoboyResponse
)
from ..security import get_current_garcom_optional
from ..websocket_manager import manager

router = APIRouter(
    prefix="/comandas",
    tags=["Comandas e Pedidos"]
)

def gerar_novo_numero_pedido(db: Session) -> int:
    """
    Gera o próximo número sequencial global de pedido.
    Reinicia no início de cada mês (começando de 1).
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    start_of_month = datetime.datetime(now.year, now.month, 1)
    
    if now.month == 12:
        start_of_next_month = datetime.datetime(now.year + 1, 1, 1)
    else:
        start_of_next_month = datetime.datetime(now.year, now.month + 1, 1)
        
    max_pedido = db.query(Comanda.numero_pedido).filter(
        Comanda.criado_em >= start_of_month,
        Comanda.criado_em < start_of_next_month
    ).order_by(Comanda.numero_pedido.desc()).limit(1).with_for_update().scalar()
    return (max_pedido or 0) + 1

def print_in_background(printer_name: str, ticket_text: str):
    try:
        from ..printer_service import printer_service
        # Chamada direta e segura, já rodando sob a thread pool do AnyIO
        printer_service.send_to_printer(printer_name, ticket_text)
    except Exception as e:
        print(f"[PRINT ERROR] Falha no disparo em background para {printer_name}: {e}")

# ----------------- READ ENDPOINTS -----------------

@router.get("/", response_model=List[ComandaResponse])
def get_comandas(
    mesa_id: Optional[int] = None,
    fechada: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """
    Retorna a lista de comandas, com filtros opcionais por mesa e status (aberta/fechada).
    """
    query = db.query(Comanda)
    if mesa_id is not None:
        query = query.filter(Comanda.mesa_id == mesa_id)
    if fechada is not None:
        query = query.filter(Comanda.fechada == fechada)
    return query.all()

@router.get("/detalhes/todos", response_model=List[ComandaDetail])
def get_comandas_detalhes(
    mesa_id: Optional[int] = None,
    fechada: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """
    Retorna a lista de comandas completas (com itens e lançamentos), com filtros opcionais.
    """
    query = db.query(Comanda).options(
        joinedload(Comanda.itens).joinedload(Item.produto),
        joinedload(Comanda.criada_por)
    )
    if mesa_id is not None:
        query = query.filter(Comanda.mesa_id == mesa_id)
    if fechada is not None:
        query = query.filter(Comanda.fechada == fechada)
    return query.all()

@router.get("/{comanda_id}", response_model=ComandaDetail)
def get_comanda(comanda_id: str, db: Session = Depends(get_db)):
    """
    Retorna os detalhes completos de uma comanda específica (incluindo lançamentos e itens).
    """
    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda não encontrada"
        )
    return comanda

# ----------------- WRITE/ACTION ENDPOINTS -----------------

@router.post("/", response_model=ComandaResponse, status_code=status.HTTP_201_CREATED)
def abrir_comanda(comanda_in: ComandaCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Abre uma nova comanda para uma mesa (ou sem mesa para retirada).
    """
    # 1. Validar se a mesa existe (se mesa_id for informado)
    if comanda_in.mesa_id is not None:
        mesa = db.query(Mesa).filter(Mesa.id == comanda_in.mesa_id).first()
        if not mesa:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Mesa {comanda_in.mesa_id} não encontrada"
            )
            
        # 2. Se a mesa já possuir uma comanda aberta, reutilizar o mesmo numero_pedido
        comanda_aberta = db.query(Comanda).filter(
            Comanda.mesa_id == comanda_in.mesa_id,
            Comanda.fechada == False
        ).first()
        if comanda_aberta:
            numero_pedido = comanda_aberta.numero_pedido
        else:
            numero_pedido = gerar_novo_numero_pedido(db)
    else:
        numero_pedido = gerar_novo_numero_pedido(db)

    # 3. Validar se o garçom existe
    garcom = db.query(Usuario).filter(Usuario.id == comanda_in.garcom_id).first()
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

    nova_comanda = Comanda(
        id=f"c-{uuid.uuid4().hex[:8]}",
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
    db.commit()
    db.refresh(nova_comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return nova_comanda


@router.put("/{comanda_id}/pedir-conta", response_model=ComandaResponse)
def pedir_conta(
    comanda_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom=Depends(get_current_garcom_optional)
):
    """
    Garçom solicita a conta para a mesa. Altera status_comanda para 'aguardando_pagamento',
    movendo a mesa para a coluna 3 do Kanban (Fechar Conta) sem passar pela coluna 2.
    """
    if current_garcom is None:
        raise HTTPException(status_code=401, detail="Token obrigatório")
    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    if comanda.fechada:
        raise HTTPException(status_code=400, detail="Comanda já está fechada")
    comanda.status_comanda = "aguardando_pagamento"
    db.commit()
    db.refresh(comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return comanda

@router.post("/{comanda_id}/lancamentos", response_model=LancamentoResponse, status_code=status.HTTP_201_CREATED)
def lancar_itens(comanda_id: str, lancamento_in: LancamentoCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Lança novos itens na comanda (gerando um novo lote de pedido) e aciona a impressão de cozinha.
    """
    # 1. Verificar se a comanda existe
    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda não encontrada"
        )
        
    # 2. Regras de comanda fechada (Se estiver fechada, cria nova comanda automaticamente para a mesa)
    if comanda.fechada:
        if comanda.mesa_id:
            nova_comanda = Comanda(
                id=f"c-{uuid.uuid4().hex[:8]}",
                mesa_id=comanda.mesa_id,
                garcom_id=lancamento_in.garcom_id,
                tipo="Consumo no Local",
                numero_pedido=gerar_novo_numero_pedido(db),
                fechada=False
            )
            db.add(nova_comanda)
            db.flush()
            comanda_id = nova_comanda.id
            comanda = nova_comanda
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Comanda já fechada. Reabra antes de lançar novos itens."
            )

    # 3. Validar se o garçom existe
    garcom = db.query(Usuario).filter(Usuario.id == lancamento_in.garcom_id).first()
    if not garcom:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Garçom '{lancamento_in.garcom_id}' não encontrado"
        )

    # 4. Criar o lançamento
    novo_lancamento = Lancamento(
        id=f"l-{uuid.uuid4().hex[:8]}",
        comanda_id=comanda_id,
        garcom_id=lancamento_in.garcom_id,
        timestamp=datetime.datetime.now(datetime.timezone.utc)
    )
    db.add(novo_lancamento)

    # 5. Criar os itens
    # Otimizado: Busca unificada de todos os produtos envolvidos no lote para evitar queries N+1
    prod_ids = list(set(item_in.produto_id for item_in in lancamento_in.itens))
    produtos = {}
    if prod_ids:
        # Usamos joinedload para trazer a categoria associada, resolvendo N+1 na verificação de impressão logo depois
        from sqlalchemy.orm import joinedload
        produtos = {p.id: p for p in db.query(Produto).options(joinedload(Produto.categoria)).filter(Produto.id.in_(prod_ids)).all()}

    itens_criados = []
    for item_in in lancamento_in.itens:
        produto = produtos.get(item_in.produto_id)
        if not produto:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Produto '{item_in.produto_id}' não encontrado"
            )
        if not produto.ativo:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Produto '{produto.nome}' está desativado no cardápio"
            )

        novo_item = Item(
            id=f"i-{uuid.uuid4().hex[:8]}",
            comanda_id=comanda_id,
            lancamento_id=novo_lancamento.id,
            produto_id=item_in.produto_id,
            preco_unit=produto.preco,
            observacao=item_in.observacao,
            cliente_nome=item_in.cliente_nome or "Consumo Geral",
            status="preparando",
            cancelado_por=None,
            impresso_em=None
        )
        db.add(novo_item)
        
        # Linkar o produto na memória para o SQLAlchemy evitar lazy load na impressão
        novo_item.produto = produto
        
        itens_criados.append(novo_item)

    db.commit()
    db.refresh(novo_lancamento)
    novo_lancamento.itens = itens_criados

    # Auto-print cocina delta (novos itens)
    novo_lancamento.dispensado_impressao = False
    try:
        from ..printer_service import printer_service
        
        # Check if we should print based on categories
        should_print = False
        items_payload = []
        for it in itens_criados:
            dest = it.produto.categoria.destino_impressao if (it.produto and it.produto.categoria) else "COZINHA"
            if dest != "NENHUM":
                should_print = True
            items_payload.append({
                "quantidade": 1, # Quantidade unitária
                "nome": it.produto.nome,
                "observacao": it.observacao,
                "cliente_nome": it.cliente_nome
            })
            
        if should_print:
            ticket_text = printer_service.generate_kitchen_ticket(
                num_pedido=comanda.numero_pedido,
                tipo=comanda.tipo,
                mesa_id=comanda.mesa_id,
                garcom_nome=garcom.nome,
                items=items_payload,
                is_reprint=False
            )
            background_tasks.add_task(print_in_background, "cozinha", ticket_text)
            
            # Mark items as printed
            print_time = datetime.datetime.now(datetime.timezone.utc)
            for it in itens_criados:
                it.impresso_em = print_time
            db.commit()
        else:
            novo_lancamento.dispensado_impressao = True
    except Exception as print_err:
        print(f"Error printing kitchen ticket: {print_err}")

    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return novo_lancamento

@router.post("/{comanda_id}/dividir", response_model=List[ComandaResponse])
def dividir_comanda(comanda_id: str, itens_ids: List[str], novo_identificador: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Divide itens de uma comanda aberta criando uma comanda separada (com mesmo número de pedido).
    """
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

    # 3. Criar a nova comanda compartilhando o mesmo numero_pedido e mesa
    nova_comanda = Comanda(
        id=f"c-{uuid.uuid4().hex[:8]}",
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

    # 4. Mover os itens
    for item in itens:
        item.comanda_id = nova_comanda.id

    db.commit()
    db.refresh(comanda_origem)
    db.refresh(nova_comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return [comanda_origem, nova_comanda]

@router.post("/{comanda_id}/transferir/{nova_mesa_id}", response_model=ComandaResponse)
def transferir_comanda(comanda_id: str, nova_mesa_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Transfere uma comanda inteira para outra mesa.
    """
    # 1. Validar comanda
    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda não encontrada"
        )
    if comanda.fechada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não é possível transferir uma comanda fechada"
        )

    # 2. Validar mesa de destino
    nova_mesa = db.query(Mesa).filter(Mesa.id == nova_mesa_id).first()
    if not nova_mesa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Mesa de destino {nova_mesa_id} não encontrada"
        )

    # 3. Atualizar mesa_id e salvar mesa_origem_id para auditoria se ainda não preenchido
    if not comanda.mesa_origem_id:
        comanda.mesa_origem_id = comanda.mesa_id
    comanda.mesa_id = nova_mesa_id
    db.commit()
    db.refresh(comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return comanda

@router.put("/{comanda_id}/fechar", response_model=ComandaResponse)
def fechar_comanda(
    comanda_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Optional[Usuario] = Depends(get_current_garcom_optional)
):
    """
    Fecha a comanda. Aceita qualquer operador autenticado (garçom ou caixa).
    """

    if current_garcom is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token obrigatório"
        )

    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
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
    if valor_pago < subtotal and valor_pago < total_com_taxa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail=f"Não é possível fechar uma comanda com saldo em aberto. Valor devido: R${subtotal:.2f} (ou R${total_com_taxa:.2f} com taxa). Valor pago: R${valor_pago:.2f}"
        )

    comanda.fechada = True
    comanda.fechado_em = datetime.datetime.now(datetime.timezone.utc)
    db.commit()
    db.refresh(comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
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
    return comanda

@router.put("/{comanda_id}/reabrir", response_model=ComandaResponse)
def reabrir_comanda(
    comanda_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Optional[Usuario] = Depends(get_current_garcom_optional)
):
    """
    Reabre uma comanda fechada (requer autenticação do garçom).
    """
    if current_garcom is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token obrigatório"
        )

    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda não encontrada"
        )

    if not comanda.fechada:
        return comanda

    comanda.fechada = False
    comanda.fechado_em = None
    
    # Audit log
    audit = ActivityLog(
        garcom_id=current_garcom.id,
        action="REOPEN_COMANDA",
        details=f"Comanda ID {comanda_id} reaberta."
    )
    db.add(audit)
    db.commit()
    db.refresh(comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return comanda

# ----------------- ITEM CANCELLATION ENDPOINT -----------------

@router.put("/itens/{item_id}/cancelar", response_model=ItemResponse)
def cancelar_item(
    item_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Optional[Usuario] = Depends(get_current_garcom_optional)
):
    """
    Cancela um item específico de uma comanda (requer autenticação do garçom).
    Se for o único item ativo da comanda, o garçom não pode cancelar.
    """
    if current_garcom is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token obrigatório"
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
    
    # Audit log
    audit = ActivityLog(
        garcom_id=current_garcom.id,
        action="CANCEL_ITEM",
        details=f"Item ID {item_id} (Produto {item.produto_id}) cancelado na comanda {item.comanda_id}."
    )
    db.add(audit)
    db.commit()
    db.refresh(item)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return item

@router.post("/itens/{item_id}/transferir/{nova_mesa_id}", response_model=ItemResponse)
def transferir_item(item_id: str, nova_mesa_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Transfere um item individual para outra mesa.
    Se a mesa de destino já possuir uma comanda aberta, associa o item a ela.
    Caso contrário, abre uma nova comanda na mesa de destino e associa o item a ela.
    """
    # 1. Buscar item
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item não encontrado"
        )
    if item.status == "cancelado":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não é possível transferir um item cancelado"
        )

    # 2. Validar mesa de destino
    nova_mesa = db.query(Mesa).filter(Mesa.id == nova_mesa_id).first()
    if not nova_mesa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Mesa de destino {nova_mesa_id} não encontrada"
        )

    # 3. Buscar ou criar comanda aberta na mesa de destino
    comanda_destino = db.query(Comanda).filter(
        Comanda.mesa_id == nova_mesa_id,
        Comanda.fechada == False
    ).first()

    if not comanda_destino:
        comanda_origem = db.query(Comanda).filter(Comanda.id == item.comanda_id).first()
        garcom_id = comanda_origem.garcom_id if comanda_origem else "g-01"
        
        numero_pedido = gerar_novo_numero_pedido(db)
        
        comanda_destino = Comanda(
            id=f"c-{uuid.uuid4().hex[:8]}",
            mesa_id=nova_mesa_id,
            garcom_id=garcom_id,
            tipo=comanda_origem.tipo if comanda_origem else "Consumo no Local",
            identificador=None,
            numero_pedido=numero_pedido,
            fechada=False,
            criado_em=datetime.datetime.now(datetime.timezone.utc)
        )
        db.add(comanda_destino)
        db.flush()

    # 4. Atualizar comanda_id
    item.comanda_id = comanda_destino.id
    db.commit()
    db.refresh(item)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return item

@router.put("/itens/{item_id}", response_model=ItemResponse)
def update_item_details(
    item_id: str,
    update_data: ItemUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Optional[Usuario] = Depends(get_current_garcom_optional)
):
    """
    Permite atualizar as observações ou o nome do cliente de um item na comanda ativa.
    Respeita a permissão 'perm_garcom_editar' configurada na retaguarda.
    """
    if current_garcom is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token obrigatório"
        )
        
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item não encontrado"
        )
        
    # Verificar se a comanda já está fechada
    comanda = db.query(Comanda).filter(Comanda.id == item.comanda_id).first()
    if comanda and comanda.fechada:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não é possível editar itens de uma comanda já fechada"
        )
        
    # Verificar permissão do garçom
    config = db.query(ConfiguracaoRestaurante).first()
    if config and not config.perm_garcom_editar and current_garcom.cargo == "garcom":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permissão negada para editar itens na comanda. Contate o Gerente."
        )

    if update_data.observacao is not None:
        item.observacao = update_data.observacao
    if update_data.cliente_nome is not None:
        item.cliente_nome = update_data.cliente_nome

    added_count = 0
    if update_data.quantidade_adicional and update_data.quantidade_adicional > 1:
        import uuid
        additional_qty = update_data.quantidade_adicional - 1
        for _ in range(additional_qty):
            new_item = Item(
                id=f"i-{uuid.uuid4().hex[:8]}",
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
            added_count += 1
        
    db.commit()
    db.refresh(item)

    # Imprimir via de comanda indicando edição/alteração
    try:
        from ..printer_service import printer_service
        dest = item.produto.categoria.destino_impressao if (item.produto and item.produto.categoria) else "COZINHA"
        if dest != "NENHUM":
            header = "=== ITEM ALTERADO/ADICIONADO ==="
            lines = [
                header.center(32),
                f"MESA: {comanda.mesa_id if comanda.mesa_id else 'BALCAO'}",
                f"PRODUTO: {item.produto.nome}",
                f"OBS (EDITADO): {item.observacao}",
                f"CLIENTE: {item.cliente_nome}",
            ]
            if added_count > 0:
                lines.append(f"QTD ADICIONADA: +{added_count}")
            lines.append("="*32)
            ticket_text = "\n".join(lines) + "\n\n\n"
            background_tasks.add_task(print_in_background, "cozinha", ticket_text)
    except Exception as e:
        print(f"Error printing edited item ticket: {e}")

    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return item

@router.put("/itens/{item_id}/status", response_model=ItemResponse)
def update_item_status(
    item_id: str,
    status: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Optional[Usuario] = Depends(get_current_garcom_optional)
):
    """
    Atualiza o status de um item (requer autenticação do garçom).
    """
    if current_garcom is None:
        raise HTTPException(
            status_code=401,
            detail="Token obrigatório"
        )
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
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return item


@router.post("/lancamentos/{lancamento_id}/reimprimir", status_code=status.HTTP_200_OK)
def reimprimir_lancamento_cozinha(
    lancamento_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_garcom: Optional[Usuario] = Depends(get_current_garcom_optional)
):
    """
    Reimprime a via de cozinha de um lote/lançamento específico ou comanda inteira.
    Aceita qualquer usuário autenticado (garçom ou caixa).
    """
        
    # Check if this is a comanda ID or a launch ID
    if lancamento_id.startswith("c-"):
        comanda = db.query(Comanda).filter(Comanda.id == lancamento_id).first()
        if not comanda:
            raise HTTPException(
                status_code=404,
                detail="Comanda não encontrada"
            )
            
        # If it's a Delivery or Retirada, trigger delivery/takeout print tickets!
        if comanda.tipo in ["Delivery", "Entrega", "Retirada"]:
            try:
                from ..printer_service import printer_service
                from ..models import ConfiguracaoRestaurante, Motoboy
                
                motoboy_nome = "Balcão"
                if comanda.motoboy_id:
                    mb = db.query(Motoboy).filter(Motoboy.id == comanda.motoboy_id).first()
                    if mb:
                        motoboy_nome = mb.nome
                        
                config = db.query(ConfiguracaoRestaurante).first()
                unificar = config.unificar_vias_delivery if config else False
                
                if unificar:
                    unified_text = printer_service.generate_delivery_unified_ticket(comanda, motoboy_nome)
                    background_tasks.add_task(print_in_background, "delivery_unico", unified_text)
                else:
                    kitchen_text = printer_service.generate_delivery_kitchen_ticket(comanda)
                    motoboy_text = printer_service.generate_delivery_motoboy_ticket(comanda, motoboy_nome)
                    background_tasks.add_task(print_in_background, "delivery_cozinha", kitchen_text)
                    background_tasks.add_task(print_in_background, "delivery_motoboy", motoboy_text)
                    
                return {"status": "success", "detail": "Reimpressão de Delivery enviada com sucesso"}
            except Exception as print_err:
                raise HTTPException(
                    status_code=500,
                    detail=f"Erro na impressora de delivery: {print_err}"
                )

        active_items = [i for i in comanda.itens if i.status != "cancelado"]
        garcom_nome = comanda.criada_por.nome if comanda.criada_por else "Garçom"
    else:
        lancamento = db.query(Lancamento).filter(Lancamento.id == lancamento_id).first()
        if not lancamento:
            raise HTTPException(
                status_code=404,
                detail="Lançamento não encontrado"
            )
        comanda = db.query(Comanda).filter(Comanda.id == lancamento.comanda_id).first()
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
        
    try:
        from ..printer_service import printer_service
        
        items_payload = []
        for it in active_items:
            items_payload.append({
                "quantidade": 1,
                "nome": it.produto.nome,
                "observacao": it.observacao,
                "cliente_nome": it.cliente_nome,
                "preco_unit": float(it.preco_unit) if it.preco_unit else 0.0
            })
            
        ticket_text = printer_service.generate_kitchen_ticket(
            num_pedido=comanda.numero_pedido,
            tipo=comanda.tipo,
            mesa_id=comanda.mesa_id,
            garcom_nome=garcom_nome,
            items=items_payload,
            is_reprint=True
        )
        background_tasks.add_task(print_in_background, "cozinha_reimpressao", ticket_text)
        
        # Mark items as printed and commit
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
def listar_delivery_ativos(db: Session = Depends(get_db)):
    """
    Retorna todas as comandas de delivery ou retirada que não estejam finalizadas/fechadas.
    Inclui as pendentes (na gaveta de aceite) e as em produção/trânsito.
    """
    return db.query(Comanda).filter(
        Comanda.tipo.in_(["Delivery", "Entrega", "Retirada"]),
        Comanda.fechada == False
    ).all()


@router.put("/{comanda_id}/delivery/status", response_model=ComandaResponse)
def atualizar_status_delivery(
    comanda_id: str,
    status_novo: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Atualiza o status de entrega do delivery.
    """
    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    
    comanda.delivery_status = status_novo
    db.commit()
    db.refresh(comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return comanda


@router.post("/{comanda_id}/delivery/despachar", response_model=ComandaResponse)
def despachar_delivery(
    comanda_id: str,
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Vincula um motoboy à comanda e altera o status para 'transito'.
    """
    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        raise HTTPException(status_code=404, detail="Comanda não encontrada")
    
    motoboy_id = payload.get("motoboy_id")
    if not motoboy_id:
        raise HTTPException(status_code=400, detail="motoboy_id obrigatório")
        
    motoboy = db.query(Motoboy).filter(Motoboy.id == motoboy_id).first()
    if not motoboy:
        raise HTTPException(status_code=404, detail="Motoboy não encontrado")
        
    comanda.motoboy_id = motoboy_id
    comanda.delivery_status = "transito"
    
    # Trigger printing based on configurations
    try:
        from ..printer_service import printer_service
        from ..models import ConfiguracaoRestaurante
        config = db.query(ConfiguracaoRestaurante).first()
        unificar = config.unificar_vias_delivery if config else False
        
        if unificar:
            unified_text = printer_service.generate_delivery_unified_ticket(comanda, motoboy.nome)
            background_tasks.add_task(print_in_background, "delivery_unico", unified_text)
        else:
            kitchen_text = printer_service.generate_delivery_kitchen_ticket(comanda)
            motoboy_text = printer_service.generate_delivery_motoboy_ticket(comanda, motoboy.nome)
            background_tasks.add_task(print_in_background, "delivery_cozinha", kitchen_text)
            background_tasks.add_task(print_in_background, "delivery_motoboy", motoboy_text)
    except Exception as print_err:
        print(f"Error printing delivery tickets: {print_err}")
        
    db.commit()
    db.refresh(comanda)
    background_tasks.add_task(manager.broadcast, {"event": "tables_updated"})
    return comanda


@router.get("/motoboys/lista", response_model=List[MotoboyResponse])
def listar_motoboys(db: Session = Depends(get_db)):
    """
    Lista todos os motoboys cadastrados.
    """
    return db.query(Motoboy).all()


@router.post("/motoboys/cadastro", response_model=MotoboyResponse, status_code=status.HTTP_201_CREATED)
def cadastrar_motoboy(
    motoboy_in: MotoboyCreate,
    db: Session = Depends(get_db)
):
    """
    Cadastra um novo motoboy.
    """
    max_id = db.query(func.max(Motoboy.id)).scalar() or 0
    novo_motoboy = Motoboy(
        id=max_id + 1,
        nome=motoboy_in.nome,
        telefone=motoboy_in.telefone,
        ativo=motoboy_in.ativo if motoboy_in.ativo is not None else True
    )
    db.add(novo_motoboy)
    db.commit()
    db.refresh(novo_motoboy)
    return novo_motoboy


@router.post("/teste-impressao")
def testar_impressao(db: Session = Depends(get_db)):
    from ..printer_service import PrinterService
    try:
        printer = PrinterService()
        test_text = (
            "========================================\n"
            "         KOMA GOURMET BISTRO\n"
            "========================================\n"
            "Teste de Impressao Direta (Hardware)\n"
            "Disparado via: Painel do Caixa\n"
            "Status: Conectado & Operando\n"
            "========================================\n"
            "\n\n\n\n"
        )
        printer.send_to_printer("teste", test_text)
        return {"status": "success", "detail": "Teste de impressão enviado com sucesso"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/impressoras/detectadas")
def buscar_impressoras_detectadas(db: Session = Depends(get_db)):
    import glob
    import subprocess
    import os
    
    impressoras = []
    
    # 1. Linux USB nodes
    usb_printers = glob.glob('/dev/usb/lp*') + glob.glob('/dev/usblp*')
    for p in usb_printers:
        name = "Impressora Termica USB"
        if "lp0" in p:
            try:
                out = subprocess.check_output("lsusb", shell=True).decode()
                if "1753:0b00" in out or "GERTEC" in out.upper():
                    name = "Gertec G250"
            except:
                pass
        impressoras.append(f"{name} (USB - {p}) • Ativa")
        
    # 2. Windows printers
    if os.name == 'nt':
        try:
            import win32print
            printers = win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS)
            for p in printers:
                impressoras.append(f"{p[2]} (Windows Spool - {p[1]}) • Ativa")
        except:
            pass
            
    # Fallback/Default if empty
    if not impressoras:
        impressoras.append("Gertec G250 (USB - /dev/usb/lp0) • Ativa")
        impressoras.append("Impressora Termica Cozinha (Rede - 192.168.1.150) • Simulador")
        
    return impressoras


@router.post("/mesclar", response_model=ComandaResponse)
def mesclar_comandas(
    mesa_origem_id: int,
    mesa_destino_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Mescla o consumo da mesa de origem na mesa de destino.
    """
    # 1. Localizar comanda ativa da mesa de origem
    comanda_origem = db.query(Comanda).filter(
        Comanda.mesa_id == mesa_origem_id,
        Comanda.fechada == False
    ).first()
    
    if not comanda_origem:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Nenhuma comanda ativa encontrada na mesa {mesa_origem_id}"
        )
        
    # 2. Atualizar a comanda para apontar para a mesa de destino e gravar a origem
    comanda_origem.mesa_id = mesa_destino_id
    comanda_origem.mesa_origem_id = mesa_origem_id
    
    db.commit()
    db.refresh(comanda_origem)
    
    # 3. Notificar via WebSocket
    background_tasks.add_task(manager.broadcast, {
        "event": "tables_updated",
        "detail": {
            "type": "mesclar_mesas",
            "mesa_origem": mesa_origem_id,
            "mesa_destino": mesa_destino_id
        }
    })
    
    return comanda_origem


@router.post("/desmesclar", response_model=ComandaResponse)
def desmesclar_comanda(
    comanda_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Desmembra uma comanda mesclada de volta para a sua mesa de origem.
    """
    comanda = db.query(Comanda).filter(Comanda.id == comanda_id).first()
    if not comanda:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comanda não encontrada"
        )
        
    if comanda.mesa_origem_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta comanda não está mesclada em outra mesa."
        )
        
    mesa_origem = comanda.mesa_origem_id
    comanda.mesa_id = comanda.mesa_origem_id
    comanda.mesa_origem_id = None
    
    db.commit()
    db.refresh(comanda)
    
    background_tasks.add_task(manager.broadcast, {
        "event": "tables_updated",
        "detail": {
            "type": "desmesclar_mesa",
            "comanda_id": comanda_id,
            "mesa_origem": mesa_origem
        }
    })
    
    return comanda



