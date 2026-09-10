import datetime
import math
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..domain.growth_economics import calculate_growth_recommendations
from ..models import ActivityLog, Cupom, Cliente, Comanda, ConfigFidelizacao, Restaurante, Usuario
from ..schemas import CupomCreate, CupomResponse, CupomValidateRequest, CupomValidateResponse
from ..security import get_current_user, require_permission
from ..services.coupon_eligibility import customer_matches_targeted_coupon
from ..subscription import subscription_marketplace_rate

router = APIRouter(
    prefix="/caixa/cupons",
    tags=["Cupons & Campanhas Promocionais"]
)

public_router = APIRouter(
    prefix="/cardapio/cupons",
    tags=["Cupons Cardápio Público"]
)


class GrowthRecommendationRequest(BaseModel):
    """Entradas explícitas da calculadora; nenhum custo do restaurante é inventado."""

    average_ticket: float = Field(gt=0, le=1_000_000)
    variable_cost_percent: float = Field(ge=0, lt=100)
    minimum_margin_percent: float = Field(gt=0, lt=100)


def _validate_coupon_configuration(payload: CupomCreate) -> None:
    """Protege invariantes matemáticas sem limitar escolhas comerciais válidas."""
    numeric_values = [payload.valor_desconto, payload.valor_minimo_pedido]
    if any(value is not None and not math.isfinite(float(value)) for value in numeric_values):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Valores monetários do cupom devem ser números finitos.",
        )
    if payload.tipo_desconto == "porcentagem" and float(payload.valor_desconto) > 100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Desconto percentual não pode ultrapassar 100%.",
        )


def _validate_targeted_customer(db: Session, *, restaurante_id: int, cliente_id: str | None) -> None:
    if not cliente_id:
        return
    cliente = db.query(Cliente.id).filter(
        Cliente.restaurante_id == restaurante_id,
        Cliente.id == str(cliente_id),
    ).first()
    if cliente is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Cliente destinatário não pertence a este restaurante.",
        )


def _validar_regras_cupom(cupom: Cupom, subtotal: float, telefone: Optional[str], db: Session) -> tuple[bool, str, float]:
    if not cupom.ativo:
        return False, "Este cupom está desativado.", 0.0

    if cupom.cliente_id and not customer_matches_targeted_coupon(
        db,
        restaurante_id=cupom.restaurante_id,
        targeted_cliente_id=cupom.cliente_id,
        cliente_telefone=telefone,
    ):
        return False, "Este cupom é exclusivo para outro cliente.", 0.0

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
    current_user: Usuario = Depends(require_permission("fidelidade:operar")),
):
    rest_id = require_tenant_id()
    return db.query(Cupom).filter(Cupom.restaurante_id == rest_id).order_by(Cupom.criado_em.desc()).all()


@router.post("/economia/recomendacao")
def recomendar_incentivos(
    payload: GrowthRecommendationRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:administrar")),
):
    """Calcula opções seguras sem alterar a configuração do restaurante.

    O plano e o split vêm da fonte canônica do backend. CMV/custos e margem-alvo
    são fornecidos explicitamente pelo restaurante. O endpoint apenas calcula;
    salvar ou ajustar manualmente cupom/fidelidade continua sendo uma ação
    administrativa separada.
    """
    rest_id = require_tenant_id()
    restaurante = db.query(Restaurante).filter(Restaurante.id == rest_id).first()
    if not restaurante:
        raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

    return calculate_growth_recommendations(
        average_ticket=payload.average_ticket,
        variable_cost_percent=payload.variable_cost_percent,
        minimum_margin_percent=payload.minimum_margin_percent,
        koma_fee_fraction=subscription_marketplace_rate(restaurante.plano),
    )


@router.post("", response_model=CupomResponse, status_code=status.HTTP_201_CREATED)
def criar_cupom(
    payload: CupomCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:administrar")),
):
    _validate_coupon_configuration(payload)
    rest_id = require_tenant_id()
    _validate_targeted_customer(db, restaurante_id=rest_id, cliente_id=payload.cliente_id)
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
    current_user: Usuario = Depends(require_permission("fidelidade:administrar")),
):
    _validate_coupon_configuration(payload)
    rest_id = require_tenant_id()
    _validate_targeted_customer(db, restaurante_id=rest_id, cliente_id=payload.cliente_id)
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
    current_user: Usuario = Depends(require_permission("fidelidade:administrar")),
):
    """Desativa o cupom preservando seu histórico e referências de pedidos."""
    rest_id = require_tenant_id()
    cupom = db.query(Cupom).filter(
        Cupom.restaurante_id == rest_id,
        Cupom.id == cupom_id,
    ).first()
    if not cupom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cupom não encontrado.")

    if cupom.ativo:
        cupom.ativo = False
        db.add(ActivityLog(
            restaurante_id=rest_id,
            garcom_id=current_user.id,
            action="DEACTIVATE_COUPON",
            details=(
                f"Cupom {cupom.id} ({cupom.codigo}) desativado; "
                f"histórico preservado com {int(cupom.usos_atuais or 0)} uso(s)."
            ),
        ))
        db.commit()
    return None


@public_router.get("/beneficios")
def listar_beneficios_publicos(
    restaurante_id: int,
    response: Response,
    db: Session = Depends(get_db),
):
    """Entrega apenas regras promocionais seguras para exibição no cardápio público.

    A resposta é pequena, limitada por tenant e cacheável no navegador/CDN. Cupons
    direcionados a um cliente específico nunca são expostos neste catálogo público.
    """
    agora_utc_sem_tz = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    cupons = (
        db.query(Cupom)
        .filter(
            Cupom.restaurante_id == restaurante_id,
            Cupom.ativo.is_(True),
            Cupom.cliente_id.is_(None),
            or_(Cupom.valido_ate.is_(None), Cupom.valido_ate >= agora_utc_sem_tz),
            or_(Cupom.limite_usos.is_(None), Cupom.usos_atuais < Cupom.limite_usos),
        )
        .order_by(Cupom.criado_em.desc())
        .limit(12)
        .all()
    )
    programa = db.query(ConfigFidelizacao).filter(
        ConfigFidelizacao.restaurante_id == restaurante_id,
    ).first()

    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return {
        "cupons": [
            {
                "codigo": cupom.codigo,
                "tipo_desconto": cupom.tipo_desconto,
                "valor_desconto": float(cupom.valor_desconto or 0),
                "valor_minimo_pedido": float(cupom.valor_minimo_pedido or 0),
                "valido_ate": cupom.valido_ate.isoformat() if cupom.valido_ate else None,
                "apenas_primeira_compra": bool(cupom.apenas_primeira_compra),
            }
            for cupom in cupons
        ],
        "programa": {
            "ativo": bool(programa.ativo),
            "tipo_recompensa": str(programa.tipo_recompensa or "").upper(),
            "taxa_conversao": float(programa.taxa_conversao or 0),
            "valor_ponto_em_dinheiro": float(programa.valor_ponto_em_dinheiro or 0),
        } if programa else None,
    }


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
