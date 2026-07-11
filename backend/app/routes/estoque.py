import re
import unicodedata
import xml.etree.ElementTree as ET
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from pydantic import BaseModel

from ..database import get_db, current_restaurante_id
from ..models import Usuario, Insumo, Distribuidor, NotaEntrada, ItemNotaEntrada, ActivityLog
from ..schemas import InsumoResponse, DistribuidorResponse, NotaEntradaResponse
from ..security import get_current_garcom_optional

router = APIRouter(
    prefix="/estoque",
    tags=["Estoque e Insumos"]
)

def check_caixa_permission(user: Usuario):
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticação necessária"
        )
    if user.role not in ["caixa", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito ao operador de caixa ou administrador"
        )

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
    rest_id = current_restaurante_id.get() or 1

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
    rest_id = current_restaurante_id.get() or 1
    
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
    rest_id = current_restaurante_id.get() or 1
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
    rest_id = current_restaurante_id.get() or 1
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
    rest_id = current_restaurante_id.get() or 1
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
    rest_id = current_restaurante_id.get() or 1
    
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
    rest_id = current_restaurante_id.get() or 1
    distribuidor = db.query(Distribuidor).filter_by(id=dist_id, restaurante_id=rest_id).first()
    if not distribuidor:
        raise HTTPException(status_code=404, detail="Distribuidor não encontrado.")
        
    for key, val in data.model_dump(exclude_unset=True).items():
        setattr(distribuidor, key, val)
        
    db.commit()
    db.refresh(distribuidor)
    return distribuidor

@router.delete("/distribuidores/{dist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_distribuidor(
    dist_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_garcom_optional)
):
    check_caixa_permission(current_user)
    rest_id = current_restaurante_id.get() or 1
    distribuidor = db.query(Distribuidor).filter_by(id=dist_id, restaurante_id=rest_id).first()
    if not distribuidor:
        raise HTTPException(status_code=404, detail="Distribuidor não encontrado.")
        
    db.delete(distribuidor)
    db.commit()
    return

