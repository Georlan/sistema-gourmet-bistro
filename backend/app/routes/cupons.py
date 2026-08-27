import datetime
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db, require_tenant_id
from ..models import Cupom, Cliente, Comanda, Usuario
from ..schemas import CupomCreate, CupomResponse, CupomValidateRequest, CupomValidateResponse
from ..security import get_current_user

router = APIRouter(
    prefix="/caixa/cupons",
    tags=["Cupons & Campanhas Promocionais"]
)

public_router = APIRouter(
    prefix="/cardapio/cupons",
    tags=["Cupons Cardápio Público"]
)


def _validar_regras_cupom(cupom: Cupom, subtotal: float, telefone: Optional[str], db: Session) -> tuple[bool, str, float]:
    if not cupom.ativo:
        return False, "Este cupom está desativado.", 0.0

    agora = datetime.datetime.now(datetime.timezone.utc)
    if cupom.valido_ate:
        valido_ate = cupom.valido_ate
        if valido_ate.tzinfo is None:
            valido_ate = valido_ate.replace(tzinfo=datetime.timezone.utc)
        if agora > valido_ate:
            return False, "Este cupom expirou.", 0.0

    if cupom.limite_usos is not None and cupom.usos_atuais >= cupom.limite_usos:
        return False, "Este cupom atingiu o limite de utilizações.", 0.0

    minimo = float(cupom.valor_minimo_pedido or 0.0)
    if subtotal < minimo:
        return False, f"O valor mínimo para usar este cupom é de R$ {minimo:.2f}.", 0.0

    if cupom.apenas_primeira_compra and telefone:
        tel_digits = "".join(filter(str.isdigit, telefone))
        pedidos_anteriores = db.query(Comanda).filter(
            Comanda.restaurante_id == cupom.restaurante_id,
            Comanda.delivery_telefone == tel_digits,
            Comanda.delivery_status != "recusado",
        ).count()
        if pedidos_anteriores > 0:
            return False, "Este cupom é válido apenas para o primeiro pedido.", 0.0

    if cupom.tipo_desconto == "porcentagem":
        desconto = round((subtotal * float(cupom.valor_desconto)) / 100.0, 2)
        desconto = min(desconto, subtotal)
    else:
        desconto = min(float(cupom.valor_desconto), subtotal)

    return True, "Cupom aplicado com sucesso!", desconto


@router.get("", response_model=List[CupomResponse])
def listar_cupons(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rest_id = require_tenant_id()
    return db.query(Cupom).filter(Cupom.restaurante_id == rest_id).order_by(Cupom.criado_em.desc()).all()


@router.post("", response_model=CupomResponse, status_code=status.HTTP_201_CREATED)
def criar_cupom(
    payload: CupomCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rest_id = require_tenant_id()
    codigo_clean = payload.codigo.strip().upper()

    existente = db.query(Cupom).filter(
        Cupom.restaurante_id == rest_id,
        Cupom.codigo == codigo_clean,
    ).first()
    if existente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Já existe um cupom com o código '{codigo_clean}'.",
        )

    novo_cupom = Cupom(
        id=f"cup-{uuid.uuid4().hex[:8]}",
        restaurante_id=rest_id,
        codigo=codigo_clean,
        tipo_desconto=payload.tipo_desconto,
        valor_desconto=payload.valor_desconto,
        valor_minimo_pedido=payload.valor_minimo_pedido or 0.0,
        limite_usos=payload.limite_usos,
        usos_atuais=0,
        valido_ate=payload.valido_ate,
        apenas_primeira_compra=payload.apenas_primeira_compra,
        ativo=payload.ativo,
        cliente_id=payload.cliente_id,
        criado_em=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(novo_cupom)
    db.commit()
    db.refresh(novo_cupom)
    return novo_cupom


@router.put("/{cupom_id}", response_model=CupomResponse)
def atualizar_cupom(
    cupom_id: str,
    payload: CupomCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rest_id = require_tenant_id()
    cupom = db.query(Cupom).filter(
        Cupom.restaurante_id == rest_id,
        Cupom.id == cupom_id,
    ).first()
    if not cupom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cupom não encontrado.")

    codigo_clean = payload.codigo.strip().upper()
    conflito = db.query(Cupom).filter(
        Cupom.restaurante_id == rest_id,
        Cupom.codigo == codigo_clean,
        Cupom.id != cupom_id,
    ).first()
    if conflito:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Já existe outro cupom com o código '{codigo_clean}'.",
        )

    cupom.codigo = codigo_clean
    cupom.tipo_desconto = payload.tipo_desconto
    cupom.valor_desconto = payload.valor_desconto
    cupom.valor_minimo_pedido = payload.valor_minimo_pedido or 0.0
    cupom.limite_usos = payload.limite_usos
    cupom.valido_ate = payload.valido_ate
    cupom.apenas_primeira_compra = payload.apenas_primeira_compra
    cupom.ativo = payload.ativo
    cupom.cliente_id = payload.cliente_id

    db.commit()
    db.refresh(cupom)
    return cupom


@router.delete("/{cupom_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_cupom(
    cupom_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rest_id = require_tenant_id()
    cupom = db.query(Cupom).filter(
        Cupom.restaurante_id == rest_id,
        Cupom.id == cupom_id,
    ).first()
    if not cupom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cupom não encontrado.")

    db.delete(cupom)
    db.commit()
    return None


@public_router.post("/validar", response_model=CupomValidateResponse)
def validar_cupom_publico(
    payload: CupomValidateRequest,
    db: Session = Depends(get_db),
):
    codigo_clean = payload.codigo.strip().upper()
    cupom = db.query(Cupom).filter(
        Cupom.restaurante_id == payload.restaurante_id,
        Cupom.codigo == codigo_clean,
    ).first()

    if not cupom:
        return CupomValidateResponse(
            valido=False,
            mensagem="Cupom inválido ou não encontrado.",
        )

    valido, msg, desconto = _validar_regras_cupom(
        cupom,
        subtotal=payload.subtotal,
        telefone=payload.telefone,
        db=db,
    )

    return CupomValidateResponse(
        valido=valido,
        mensagem=msg,
        codigo=cupom.codigo,
        tipo_desconto=cupom.tipo_desconto,
        valor_desconto=float(cupom.valor_desconto),
        desconto_calculado=desconto,
    )
