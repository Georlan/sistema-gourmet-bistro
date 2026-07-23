import re
import unicodedata
import xml.etree.ElementTree as ET
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from pydantic import BaseModel

from datetime import datetime, timezone
import uuid
from ..database import get_db, current_restaurante_id, require_tenant_id
from ..models import (
    Usuario, Insumo, Distribuidor, NotaEntrada, ItemNotaEntrada, ActivityLog,
    EntradaEstoque, ItemEntradaEstoque, MovimentacaoEstoque, SessaoContagemEstoque, ItemContagemEstoque
)
from ..schemas import (
    InsumoResponse, DistribuidorResponse, NotaEntradaResponse,
    EntradaEstoqueManualCreate, EntradaEstoqueResponse,
    MovimentacaoEstoqueCreate, MovimentacaoEstoqueResponse,
    SessaoContagemEstoqueCreate, SessaoContagemEstoqueResponse
)
from ..security import ensure_permission, get_current_garcom_optional

router = APIRouter(
    prefix="/estoque",
    tags=["Estoque e Insumos"]
)

def check_caixa_permission(user: Usuario):
    return ensure_permission(user, "estoque:administrar")

def slugify(value: str) -> str:
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s-]', '', value).strip().lower()
    return re.sub(r'[-\s]+', '-', value)

@router.post("/importar-xml")
async def importar_xml(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    try:
        xml_content = await file.read()
        root = ET.fromstring(xml_content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao ler arquivo XML: {str(e)}"
        )

    # XML namespaces dictionary for NF-e
    ns = {'ns': 'http://www.portalfiscal.inf.br/nfe'}

    # Helper functions for namespaced ElementTree searches
    def find_tag(element, tag_name):
        val = element.find(f".//ns:{tag_name}", ns)
        if val is None:
            val = element.find(f".//{tag_name}")
        return val

    def get_text(element, tag_name, default=""):
        tag = find_tag(element, tag_name)
        return tag.text.strip() if (tag is not None and tag.text is not None) else default

    # 1. Parse Fornecedor/Emitente (<emit>)
    emit = find_tag(root, "emit")
    if emit is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Estrutura de emitente (<emit>) não encontrada no XML."
        )

    cnpj = get_text(emit, "CNPJ")
    if not cnpj:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CNPJ do emitente não encontrado no XML."
        )

    nome_fantasia = get_text(emit, "xFant") or get_text(emit, "xNome")
    razao_social = get_text(emit, "xNome")

    # Clean CNPJ to form a clean unique ID
    cnpj_limpo = re.sub(r'\D', '', cnpj)
    dist_id = f"dist-{cnpj_limpo}"

    distribuidor = db.query(Distribuidor).filter(
        Distribuidor.id == dist_id,
        Distribuidor.restaurante_id == rest_id
    ).first()

    distribuidor_criado = False
    if not distribuidor:
        distribuidor = Distribuidor(
            id=dist_id,
            restaurante_id=rest_id,
            nome_fantasia=nome_fantasia,
            razao_social=razao_social,
            cnpj=cnpj,
            lead_time_dias=3
        )
        db.add(distribuidor)
        db.commit()
        db.refresh(distribuidor)
        distribuidor_criado = True

    # 2. Parse Nota Fiscal Info (<ide>, <total>)
    ide = find_tag(root, "ide")
    if ide is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Estrutura de identificação (<ide>) não encontrada no XML."
        )

    numero_nota = get_text(ide, "nNF")
    data_emissao = get_text(ide, "dhEmi") or get_text(ide, "dEmi")

    # Chave de Acesso from infNFe Id attribute (e.g. Id="NFe351907...")
    infNFe = find_tag(root, "infNFe")
    chave_acesso = ""
    if infNFe is not None:
        chave_attr = infNFe.get("Id", "")
        chave_acesso = re.sub(r'\D', '', chave_attr)

    if not chave_acesso:
        chave_acesso = f"{cnpj_limpo}{numero_nota}"

    # Check for duplicate imports
    nota_existente = db.query(NotaEntrada).filter(
        NotaEntrada.id == chave_acesso,
        NotaEntrada.restaurante_id == rest_id
    ).first()

    if nota_existente:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Esta Nota Fiscal (Chave: {chave_acesso}) já foi importada anteriormente."
        )

    # Get total value
    total = find_tag(root, "total")
    valor_total = 0.0
    if total is not None:
        try:
            v_nf_text = get_text(total, "vNF")
            valor_total = float(v_nf_text) if v_nf_text else 0.0
        except ValueError:
            pass

    # Save NotaEntrada
    nota = NotaEntrada(
        id=chave_acesso,
        restaurante_id=rest_id,
        chave_acesso=chave_acesso,
        numero_nota=numero_nota,
        data_emissao=data_emissao,
        distribuidor_id=dist_id,
        valor_total=valor_total
    )
    db.add(nota)
    db.commit()

    # 3. Parse Items (<det>)
    det_items = root.findall(".//ns:det", ns) or root.findall(".//det")
    insumos_criados = 0
    insumos_atualizados = 0

    for det in det_items:
        prod = find_tag(det, "prod")
        if prod is None:
            continue

        desc = get_text(prod, "xProd")
        if not desc:
            continue

        try:
            qtd = float(get_text(prod, "qCom") or "0.0")
            preco_unit = float(get_text(prod, "vUnCom") or "0.0")
        except ValueError:
            continue

        u_com = get_text(prod, "uCom") or "un"

        # Unique Insumo ID based on cleaned slug description
        insumo_id = f"ins-{slugify(desc)}"

        # Search existing Insumo
        insumo = db.query(Insumo).filter(
            Insumo.id == insumo_id,
            Insumo.restaurante_id == rest_id
        ).first()

        if not insumo:
            # Create new Insumo
            insumo = Insumo(
                id=insumo_id,
                restaurante_id=rest_id,
                nome=desc,
                estoque_atual=qtd,
                estoque_minimo=10.0,
                estoque_maximo=qtd * 2 if qtd > 0 else 50.0,
                unidade_medida=u_com.lower()[:10],
                preco_medio_custo=preco_unit
            )
            db.add(insumo)
            insumos_criados += 1
        else:
            # Update existing Insumo with Weighted Average Cost
            estoque_antigo = insumo.estoque_atual or 0.0
            custo_antigo = insumo.preco_medio_custo or 0.0

            total_qtd = estoque_antigo + qtd
            if total_qtd > 0:
                novo_custo = ((estoque_antigo * custo_antigo) + (qtd * preco_unit)) / total_qtd
            else:
                novo_custo = preco_unit

            insumo.estoque_atual = total_qtd
            insumo.preco_medio_custo = novo_custo
            insumos_atualizados += 1

        db.commit()

        # Create ItemNotaEntrada
        item_nota = ItemNotaEntrada(
            restaurante_id=rest_id,
            nota_id=chave_acesso,
            insumo_id=insumo_id,
            quantidade=qtd,
            preco_unitario=preco_unit
        )
        db.add(item_nota)
        db.commit()

    return {
        "success": True,
        "detail": f"Nota Fiscal nº {numero_nota} importada com sucesso!",
        "cnpj_fornecedor": cnpj,
        "fornecedor": nome_fantasia,
        "fornecedor_criado": distribuidor_criado,
        "insumos_criados": insumos_criados,
        "insumos_atualizados": insumos_atualizados,
        "valor_total": valor_total
    }

@router.get("/insumos", response_model=List[InsumoResponse])
def get_insumos(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    return db.query(Insumo).all()

@router.get("/distribuidores", response_model=List[DistribuidorResponse])
def get_distribuidores(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    return db.query(Distribuidor).all()

@router.get("/notas", response_model=List[NotaEntradaResponse])
def get_notas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    return db.query(NotaEntrada).options(
        joinedload(NotaEntrada.distribuidor),
        joinedload(NotaEntrada.itens).joinedload(ItemNotaEntrada.insumo)
    ).all()


# ─── SCHEMAS INTERNOS PARA INSUMOS E DISTRIBUIDORES ───────────────────────────
class InsumoCreate(BaseModel):
    id: str
    nome: str
    estoque_minimo: float = 10.0
    estoque_maximo: float = 50.0
    unidade_medida: str = "un"
    preco_medio_custo: float = 0.0

class InsumoUpdate(BaseModel):
    nome: Optional[str] = None
    estoque_minimo: Optional[float] = None
    estoque_maximo: Optional[float] = None
    unidade_medida: Optional[str] = None
    preco_medio_custo: Optional[float] = None

class InsumoAjuste(BaseModel):
    quantidade: float
    tipo: str  # "ENTRADA" | "SAIDA"
    justificativa: str = ""

class DistribuidorCreate(BaseModel):
    id: str
    nome_fantasia: str
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    lead_time_dias: Optional[int] = 3

class DistribuidorUpdate(BaseModel):
    nome_fantasia: Optional[str] = None
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    lead_time_dias: Optional[int] = None


# ─── ROTAS CRUD DE INSUMOS ────────────────────────────────────────────────────
@router.post("/insumos", response_model=InsumoResponse, status_code=status.HTTP_201_CREATED)
def create_insumo(
    data: InsumoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()
    
    existente = db.query(Insumo).filter_by(id=data.id, restaurante_id=rest_id).first()
    if existente:
        raise HTTPException(status_code=400, detail="ID de insumo já existe.")
        
    insumo = Insumo(
        id=data.id,
        restaurante_id=rest_id,
        nome=data.nome,
        estoque_atual=0.0,
        estoque_minimo=data.estoque_minimo,
        estoque_maximo=data.estoque_maximo,
        unidade_medida=data.unidade_medida,
        preco_medio_custo=data.preco_medio_custo
    )
    db.add(insumo)
    db.commit()
    db.refresh(insumo)
    return insumo

@router.put("/insumos/{insumo_id}", response_model=InsumoResponse)
def update_insumo(
    insumo_id: str,
    data: InsumoUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()
    insumo = db.query(Insumo).filter_by(id=insumo_id, restaurante_id=rest_id).first()
    if not insumo:
        raise HTTPException(status_code=404, detail="Insumo não encontrado.")
        
    for key, val in data.model_dump(exclude_unset=True).items():
        setattr(insumo, key, val)
        
    db.commit()
    db.refresh(insumo)
    return insumo

@router.delete("/insumos/{insumo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_insumo(
    insumo_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()
    insumo = db.query(Insumo).filter_by(id=insumo_id, restaurante_id=rest_id).first()
    if not insumo:
        raise HTTPException(status_code=404, detail="Insumo não encontrado.")
        
    db.delete(insumo)
    db.commit()
    return

@router.post("/insumos/{insumo_id}/ajustar", response_model=InsumoResponse)
def ajustar_insumo(
    insumo_id: str,
    data: InsumoAjuste,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()
    insumo = db.query(Insumo).filter_by(id=insumo_id, restaurante_id=rest_id).first()
    if not insumo:
        raise HTTPException(status_code=404, detail="Insumo não encontrado.")
        
    if data.tipo not in ["ENTRADA", "SAIDA"]:
        raise HTTPException(status_code=400, detail="Tipo de ajuste deve ser ENTRADA ou SAIDA.")
        
    old_qty = insumo.estoque_atual or 0.0
    if data.tipo == "ENTRADA":
        insumo.estoque_atual = old_qty + data.quantidade
    else:
        insumo.estoque_atual = old_qty - data.quantidade
        
    db.commit()
    db.refresh(insumo)
    
    details = f"Insumo {insumo.id} ({insumo.nome}) ajustado de {old_qty} {insumo.unidade_medida} para {insumo.estoque_atual} {insumo.unidade_medida}. Justificativa: {data.justificativa}"
    log = ActivityLog(
        restaurante_id=current_restaurante_id.get(),
        garcom_id=current_user.id if current_user else "sistema",
        action="MANUAL_STOCK_ADJUSTMENT",
        details=details
    )
    db.add(log)
    db.commit()
    return insumo


# ─── ROTAS CRUD DE DISTRIBUIDORES ─────────────────────────────────────────────
@router.post("/distribuidores", response_model=DistribuidorResponse, status_code=status.HTTP_201_CREATED)
def create_distribuidor(
    data: DistribuidorCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()
    
    existente = db.query(Distribuidor).filter_by(id=data.id, restaurante_id=rest_id).first()
    if existente:
        raise HTTPException(status_code=400, detail="ID de distribuidor já existe.")
        
    distribuidor = Distribuidor(
        id=data.id,
        restaurante_id=rest_id,
        nome_fantasia=data.nome_fantasia,
        razao_social=data.razao_social,
        cnpj=data.cnpj,
        lead_time_dias=data.lead_time_dias if data.lead_time_dias is not None else 3
    )
    db.add(distribuidor)
    db.commit()
    db.refresh(distribuidor)
    return distribuidor

@router.put("/distribuidores/{dist_id}", response_model=DistribuidorResponse)
def update_distribuidor(
    dist_id: str,
    data: DistribuidorUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()
    distribuidor = db.query(Distribuidor).filter_by(id=dist_id, restaurante_id=rest_id).first()
    if not distribuidor:
        raise HTTPException(status_code=404, detail="Distribuidor não encontrado.")
        
    for key, val in data.model_dump(exclude_unset=True).items():
        setattr(distribuidor, key, val)
        
    db.commit()
    db.refresh(distribuidor)
    return distribuidor

    db.delete(distribuidor)
    db.commit()
    return


# ─── ROTAS DE ENTRADAS DE ESTOQUE (MANUAIS E XML) ─────────────────────────────
@router.post("/entradas/manual", response_model=EntradaEstoqueResponse, status_code=status.HTTP_201_CREATED)
def create_entrada_manual(
    data: EntradaEstoqueManualCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    if not data.itens:
        raise HTTPException(status_code=400, detail="A entrada deve possuir ao menos um item.")

    try:
        # 1. Resolve Distribuidor / Fornecedor
        dist_id = data.distribuidor_id
        if not dist_id and data.distribuidor_nome_fantasia:
            dist_slug = f"dist-{slugify(data.distribuidor_nome_fantasia)}"
            distribuidor = db.query(Distribuidor).filter_by(id=dist_slug, restaurante_id=rest_id).first()
            if not distribuidor:
                distribuidor = Distribuidor(
                    id=dist_slug,
                    restaurante_id=rest_id,
                    nome_fantasia=data.distribuidor_nome_fantasia,
                    cnpj=data.distribuidor_cnpj
                )
                db.add(distribuidor)
                db.flush()
            dist_id = distribuidor.id

        # 2. Criar registro de EntradaEstoque
        entrada = EntradaEstoque(
            id=str(uuid.uuid4()),
            restaurante_id=rest_id,
            distribuidor_id=dist_id,
            numero_documento=data.numero_documento,
            data_emissao=data.data_emissao,
            observacao=data.observacao,
            tipo_entrada="MANUAL",
            usuario_id=current_user.id if current_user else None,
            valor_total=0.0
        )
        db.add(entrada)
        db.flush()

        total_entrada = 0.0

        for item_in in data.itens:
            if item_in.quantidade <= 0:
                raise HTTPException(status_code=400, detail=f"Quantidade inválida para o insumo {item_in.insumo_id}.")
            if item_in.custo_unitario < 0:
                raise HTTPException(status_code=400, detail=f"Custo unitário inválido para o insumo {item_in.insumo_id}.")

            # Busca insumo existente ou cria inline
            insumo = db.query(Insumo).filter_by(id=item_in.insumo_id, restaurante_id=rest_id).first()
            if not insumo and item_in.insumo_nome:
                ins_id = slugify(item_in.insumo_nome) if not item_in.insumo_id else item_in.insumo_id
                insumo = Insumo(
                    id=ins_id,
                    restaurante_id=rest_id,
                    nome=item_in.insumo_nome,
                    estoque_atual=0.0,
                    estoque_minimo=10.0,
                    estoque_maximo=50.0,
                    unidade_medida=item_in.unidade_medida or "un",
                    preco_medio_custo=item_in.custo_unitario
                )
                db.add(insumo)
                db.flush()

            if not insumo:
                raise HTTPException(status_code=404, detail=f"Insumo '{item_in.insumo_id}' não encontrado.")

            saldo_anterior = insumo.estoque_atual or 0.0
            custo_antigo = insumo.preco_medio_custo or 0.0
            qtd_entrada = item_in.quantidade
            custo_unit = item_in.custo_unitario
            subtotal = qtd_entrada * custo_unit

            # Recálculo do custo médio ponderado
            total_qtd = saldo_anterior + qtd_entrada
            if saldo_anterior > 0 and total_qtd > 0:
                novo_custo = ((saldo_anterior * custo_antigo) + (qtd_entrada * custo_unit)) / total_qtd
            else:
                novo_custo = custo_unit

            insumo.estoque_atual = total_qtd
            insumo.preco_medio_custo = novo_custo

            item_db = ItemEntradaEstoque(
                restaurante_id=rest_id,
                entrada_id=entrada.id,
                insumo_id=insumo.id,
                quantidade=qtd_entrada,
                unidade_medida=item_in.unidade_medida or insumo.unidade_medida,
                custo_unitario=custo_unit,
                subtotal=subtotal
            )
            db.add(item_db)

            # Criar movimentação atômica
            mov = MovimentacaoEstoque(
                restaurante_id=rest_id,
                insumo_id=insumo.id,
                tipo="entrada",
                quantidade=qtd_entrada,
                saldo_anterior=saldo_anterior,
                saldo_posterior=total_qtd,
                custo_unitario=custo_unit,
                motivo=f"Entrada manual doc #{data.numero_documento or 'S/N'}",
                observacao=data.observacao,
                origem="entrada_manual",
                referencia_id=entrada.id,
                usuario_id=current_user.id if current_user else None
            )
            db.add(mov)

            total_entrada += subtotal

        entrada.valor_total = total_entrada
        db.commit()
        db.refresh(entrada)
        return db.query(EntradaEstoque).options(
            joinedload(EntradaEstoque.distribuidor),
            joinedload(EntradaEstoque.itens).joinedload(ItemEntradaEstoque.insumo)
        ).filter_by(id=entrada.id).first()

    except Exception as e:
        db.rollback()
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Erro ao processar entrada manual: {str(e)}")


@router.get("/entradas", response_model=List[EntradaEstoqueResponse])
def get_entradas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()
    return db.query(EntradaEstoque).filter_by(restaurante_id=rest_id).options(
        joinedload(EntradaEstoque.distribuidor),
        joinedload(EntradaEstoque.itens).joinedload(ItemEntradaEstoque.insumo)
    ).order_by(EntradaEstoque.created_at.desc()).all()


# ─── ROTAS DE MOVIMENTAÇÕES DE ESTOQUE ────────────────────────────────────────
@router.get("/movimentacoes", response_model=List[MovimentacaoEstoqueResponse])
def get_movimentacoes(
    data_inicio: Optional[str] = None,
    data_fim: Optional[str] = None,
    insumo_id: Optional[str] = None,
    tipo: Optional[str] = None,
    usuario_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    query = db.query(MovimentacaoEstoque).filter_by(restaurante_id=rest_id).options(
        joinedload(MovimentacaoEstoque.insumo)
    )

    if insumo_id:
        query = query.filter(MovimentacaoEstoque.insumo_id == insumo_id)
    if tipo:
        query = query.filter(MovimentacaoEstoque.tipo == tipo)
    if usuario_id:
        query = query.filter(MovimentacaoEstoque.usuario_id == usuario_id)
    if data_inicio:
        try:
            dt_ini = datetime.fromisoformat(data_inicio)
            query = query.filter(MovimentacaoEstoque.created_at >= dt_ini)
        except ValueError:
            pass
    if data_fim:
        try:
            dt_fim = datetime.fromisoformat(data_fim)
            query = query.filter(MovimentacaoEstoque.created_at <= dt_fim)
        except ValueError:
            pass

    return query.order_by(MovimentacaoEstoque.created_at.desc()).all()


@router.post("/movimentacoes", response_model=MovimentacaoEstoqueResponse, status_code=status.HTTP_201_CREATED)
def create_movimentacao(
    data: MovimentacaoEstoqueCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    if data.tipo not in ["perda", "ajuste_positivo", "ajuste_negativo"]:
        raise HTTPException(status_code=400, detail="Tipo de movimentação deve ser perda, ajuste_positivo ou ajuste_negativo.")

    if data.quantidade <= 0:
        raise HTTPException(status_code=400, detail="A quantidade deve ser maior que zero.")

    if not data.motivo or not data.motivo.strip():
        raise HTTPException(status_code=400, detail="O motivo da movimentação é obrigatório.")

    insumo = db.query(Insumo).filter_by(id=data.insumo_id, restaurante_id=rest_id).first()
    if not insumo:
        raise HTTPException(status_code=404, detail="Insumo não encontrado.")

    saldo_anterior = insumo.estoque_atual or 0.0

    if data.tipo in ["perda", "ajuste_negativo"]:
        if saldo_anterior - data.quantidade < 0:
            raise HTTPException(status_code=400, detail="Saldo de estoque insuficiente para realizar esta saída/perda.")
        saldo_posterior = saldo_anterior - data.quantidade
    else:  # ajuste_positivo
        saldo_posterior = saldo_anterior + data.quantidade

    insumo.estoque_atual = saldo_posterior

    mov = MovimentacaoEstoque(
        restaurante_id=rest_id,
        insumo_id=insumo.id,
        tipo=data.tipo,
        quantidade=data.quantidade,
        saldo_anterior=saldo_anterior,
        saldo_posterior=saldo_posterior,
        custo_unitario=insumo.preco_medio_custo or 0.0,
        motivo=data.motivo.strip(),
        observacao=data.observacao,
        origem="movimentacao_manual",
        usuario_id=current_user.id if current_user else None
    )
    db.add(mov)
    db.commit()
    db.refresh(mov)
    return db.query(MovimentacaoEstoque).options(
        joinedload(MovimentacaoEstoque.insumo)
    ).filter_by(id=mov.id).first()


@router.delete("/distribuidores/{dist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_distribuidor(
    dist_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()
    dist = db.query(Distribuidor).filter(
        Distribuidor.id == dist_id,
        Distribuidor.restaurante_id == rest_id
    ).first()
    if dist:
        db.delete(dist)
        db.commit()
    return None


# ─── ROTAS DE CONTAGEM FÍSICA (INVENTÁRIO) ───────────────────────────────────
@router.post("/contagens", response_model=SessaoContagemEstoqueResponse, status_code=status.HTTP_201_CREATED)
def create_sessao_contagem(
    data: SessaoContagemEstoqueCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    if data.status not in ["rascunho", "confirmada"]:
        raise HTTPException(status_code=400, detail="Status deve ser 'rascunho' ou 'confirmada'.")

    sessao = SessaoContagemEstoque(
        id=str(uuid.uuid4()),
        restaurante_id=rest_id,
        status=data.status,
        observacao=data.observacao,
        usuario_id=current_user.id if current_user else None,
        confirmada_em=datetime.now(timezone.utc) if data.status == "confirmada" else None
    )
    db.add(sessao)
    db.flush()

    for item_in in data.itens:
        insumo = db.query(Insumo).filter_by(id=item_in.insumo_id, restaurante_id=rest_id).first()
        if not insumo:
            continue

        qtd_sistema = insumo.estoque_atual or 0.0
        qtd_contada = item_in.quantidade_contada
        diferenca = qtd_contada - qtd_sistema

        ajustado = False
        if data.status == "confirmada" and diferenca != 0:
            insumo.estoque_atual = qtd_contada
            ajustado = True

            mov = MovimentacaoEstoque(
                restaurante_id=rest_id,
                insumo_id=insumo.id,
                tipo="contagem",
                quantidade=abs(diferenca),
                saldo_anterior=qtd_sistema,
                saldo_posterior=qtd_contada,
                custo_unitario=insumo.preco_medio_custo or 0.0,
                motivo=f"Ajuste por inventário físico (Sessão {sessao.id[:8]})",
                observacao=data.observacao,
                origem="contagem",
                referencia_id=sessao.id,
                usuario_id=current_user.id if current_user else None
            )
            db.add(mov)

        item_db = ItemContagemEstoque(
            restaurante_id=rest_id,
            contagem_id=sessao.id,
            insumo_id=insumo.id,
            quantidade_sistema=qtd_sistema,
            quantidade_contada=qtd_contada,
            diferenca=diferenca,
            ajustado=ajustado
        )
        db.add(item_db)

    db.commit()
    return db.query(SessaoContagemEstoque).options(
        joinedload(SessaoContagemEstoque.itens).joinedload(ItemContagemEstoque.insumo)
    ).filter_by(id=sessao.id).first()


@router.get("/contagens", response_model=List[SessaoContagemEstoqueResponse])
def get_sessoes_contagem(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    return db.query(SessaoContagemEstoque).filter_by(restaurante_id=rest_id).options(
        joinedload(SessaoContagemEstoque.itens).joinedload(ItemContagemEstoque.insumo)
    ).order_by(SessaoContagemEstoque.created_at.desc()).all()


@router.get("/contagens/{contagem_id}", response_model=SessaoContagemEstoqueResponse)
def get_sessao_contagem(
    contagem_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    sessao = db.query(SessaoContagemEstoque).filter_by(id=contagem_id, restaurante_id=rest_id).options(
        joinedload(SessaoContagemEstoque.itens).joinedload(ItemContagemEstoque.insumo)
    ).first()

    if not sessao:
        raise HTTPException(status_code=404, detail="Sessão de contagem não encontrada.")
    return sessao


@router.put("/contagens/{contagem_id}", response_model=SessaoContagemEstoqueResponse)
def update_sessao_contagem(
    contagem_id: str,
    data: SessaoContagemEstoqueCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    sessao = db.query(SessaoContagemEstoque).filter_by(id=contagem_id, restaurante_id=rest_id).first()
    if not sessao:
        raise HTTPException(status_code=404, detail="Sessão de contagem não encontrada.")

    if sessao.status == "confirmada":
        raise HTTPException(status_code=400, detail="Sessões de contagem já confirmadas não podem ser alteradas.")

    sessao.observacao = data.observacao
    if data.status == "confirmada":
        sessao.status = "confirmada"
        sessao.confirmada_em = datetime.now(timezone.utc)

    # Re-criar/atualizar itens
    db.query(ItemContagemEstoque).filter_by(contagem_id=sessao.id).delete()

    for item_in in data.itens:
        insumo = db.query(Insumo).filter_by(id=item_in.insumo_id, restaurante_id=rest_id).first()
        if not insumo:
            continue

        qtd_sistema = insumo.estoque_atual or 0.0
        qtd_contada = item_in.quantidade_contada
        diferenca = qtd_contada - qtd_sistema

        ajustado = False
        if sessao.status == "confirmada" and diferenca != 0:
            insumo.estoque_atual = qtd_contada
            ajustado = True

            mov = MovimentacaoEstoque(
                restaurante_id=rest_id,
                insumo_id=insumo.id,
                tipo="contagem",
                quantidade=abs(diferenca),
                saldo_anterior=qtd_sistema,
                saldo_posterior=qtd_contada,
                custo_unitario=insumo.preco_medio_custo or 0.0,
                motivo=f"Ajuste por inventário físico (Sessão {sessao.id[:8]})",
                observacao=data.observacao,
                origem="contagem",
                referencia_id=sessao.id,
                usuario_id=current_user.id if current_user else None
            )
            db.add(mov)

        item_db = ItemContagemEstoque(
            restaurante_id=rest_id,
            contagem_id=sessao.id,
            insumo_id=insumo.id,
            quantidade_sistema=qtd_sistema,
            quantidade_contada=qtd_contada,
            diferenca=diferenca,
            ajustado=ajustado
        )
        db.add(item_db)

    db.commit()
    return db.query(SessaoContagemEstoque).options(
        joinedload(SessaoContagemEstoque.itens).joinedload(ItemContagemEstoque.insumo)
    ).filter_by(id=sessao.id).first()


@router.post("/contagens/{contagem_id}/confirmar", response_model=SessaoContagemEstoqueResponse)
def confirmar_sessao_contagem(
    contagem_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = require_tenant_id()

    sessao = db.query(SessaoContagemEstoque).filter_by(id=contagem_id, restaurante_id=rest_id).options(
        joinedload(SessaoContagemEstoque.itens)
    ).first()

    if not sessao:
        raise HTTPException(status_code=404, detail="Sessão de contagem não encontrada.")

    if sessao.status == "confirmada":
        raise HTTPException(status_code=400, detail="Esta sessão de contagem já foi confirmada anteriormente.")

    sessao.status = "confirmada"
    sessao.confirmada_em = datetime.now(timezone.utc)

    for item in sessao.itens:
        insumo = db.query(Insumo).filter_by(id=item.insumo_id, restaurante_id=rest_id).first()
        if not insumo:
            continue

        qtd_sistema = insumo.estoque_atual or 0.0
        qtd_contada = item.quantidade_contada
        diferenca = qtd_contada - qtd_sistema

        if diferenca != 0:
            insumo.estoque_atual = qtd_contada
            item.ajustado = True

            mov = MovimentacaoEstoque(
                restaurante_id=rest_id,
                insumo_id=insumo.id,
                tipo="contagem",
                quantidade=abs(diferenca),
                saldo_anterior=qtd_sistema,
                saldo_posterior=qtd_contada,
                custo_unitario=insumo.preco_medio_custo or 0.0,
                motivo=f"Ajuste por inventário físico (Sessão {sessao.id[:8]})",
                observacao=sessao.observacao or "",
                origem="contagem",
                referencia_id=sessao.id,
                usuario_id=current_user.id if current_user else None
            )
            db.add(mov)

    db.commit()
    return db.query(SessaoContagemEstoque).options(
        joinedload(SessaoContagemEstoque.itens).joinedload(ItemContagemEstoque.insumo)
    ).filter_by(id=sessao.id).first()
