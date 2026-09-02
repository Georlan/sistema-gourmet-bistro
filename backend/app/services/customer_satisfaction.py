"""
Serviço de Satisfação do Cliente (CSAT / NPS Derivado).

Identidade canônica: Cliente.id.
Tenant isolation: obrigatório em todas as leituras e mutações.
Zero N+1: agregações e consultas combinadas com JOIN.
Sem campos derivados persistidos no banco.
"""
from typing import Any, Dict, List, Optional
from fastapi import HTTPException, status
from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session

from ..models import AvaliacaoCliente, Cliente, Comanda
from ..timezone_utils import get_utc_now, to_utc


def classify_satisfaction_rating(nota: int) -> str:
    """
    Classificação puramente derivada:
    - 4 e 5 => positiva
    - 3 => neutra
    - 1 e 2 => insatisfeita
    """
    if nota in (4, 5):
        return "positiva"
    elif nota == 3:
        return "neutra"
    elif nota in (1, 2):
        return "insatisfeita"
    raise ValueError(f"Nota inválida: {nota}. A nota deve ser entre 1 e 5.")


def calculate_satisfaction_summary(db: Session, restaurante_id: int) -> Dict[str, Any]:
    """
    Calcula o resumo agregado de satisfação do restaurante em uma única query SQL.
    """
    row = db.query(
        func.count(AvaliacaoCliente.id).label("total"),
        func.avg(AvaliacaoCliente.nota).label("media"),
        func.sum(case((AvaliacaoCliente.nota >= 4, 1), else_=0)).label("positivas"),
        func.sum(case((AvaliacaoCliente.nota == 3, 1), else_=0)).label("neutras"),
        func.sum(case((AvaliacaoCliente.nota <= 2, 1), else_=0)).label("insatisfeitas"),
    ).filter(
        AvaliacaoCliente.restaurante_id == restaurante_id,
    ).first()

    total = int(row.total or 0) if row else 0
    media = round(float(row.media), 1) if row and row.media is not None else None
    positivas = int(row.positivas or 0) if row else 0
    neutras = int(row.neutras or 0) if row else 0
    insatisfeitas = int(row.insatisfeitas or 0) if row else 0

    return {
        "total_avaliacoes": total,
        "nota_media": media,
        "positivas": positivas,
        "neutras": neutras,
        "insatisfeitas": insatisfeitas,
    }


def get_recent_satisfaction_reviews(
    db: Session,
    restaurante_id: int,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    """
    Retorna as avaliações mais recentes com nome do cliente via JOIN único (zero N+1).
    Ordenadas por criado_em DESC.
    """
    results = db.query(
        AvaliacaoCliente,
        Cliente.nome.label("cliente_nome"),
    ).join(
        Cliente,
        and_(
            AvaliacaoCliente.cliente_id == Cliente.id,
            AvaliacaoCliente.restaurante_id == Cliente.restaurante_id,
        ),
    ).filter(
        AvaliacaoCliente.restaurante_id == restaurante_id,
    ).order_by(
        AvaliacaoCliente.criado_em.desc(),
        AvaliacaoCliente.id.desc(),
    ).limit(limit).all()

    recentes = []
    for av, cliente_nome in results:
        utc_dt = to_utc(av.criado_em)
        iso_str = utc_dt.isoformat() if utc_dt else str(av.criado_em)
        recentes.append({
            "id": str(av.id),
            "cliente_id": str(av.cliente_id),
            "cliente_nome": cliente_nome or "Cliente",
            "nota": av.nota,
            "classificacao": classify_satisfaction_rating(av.nota),
            "comentario": av.comentario,
            "criado_em": iso_str,
            "comanda_id": av.comanda_id,
        })
    return recentes


def get_customer_satisfaction_data(db: Session, restaurante_id: int) -> Dict[str, Any]:
    """
    Retorna o payload completo de satisfação (resumo + recentes).
    """
    return {
        "resumo": calculate_satisfaction_summary(db, restaurante_id),
        "recentes": get_recent_satisfaction_reviews(db, restaurante_id, limit=10),
    }


def record_customer_satisfaction(
    db: Session,
    restaurante_id: int,
    cliente_id: str,
    nota: int,
    comentario: Optional[str] = None,
    comanda_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Registra uma nova avaliação de satisfação validando tenant isolation e integridade referencial.
    """
    # 1. Validação da nota
    if not isinstance(nota, int) or nota < 1 or nota > 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A nota deve ser um número inteiro de 1 a 5.",
        )

    # 2. Validação do comentário
    if comentario is not None:
        comentario = comentario.strip()
        if len(comentario) > 1000:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="O comentário deve ter no máximo 1000 caracteres.",
            )
        if not comentario:
            comentario = None

    # 3. Validação do cliente (identidade canônica e tenant)
    cliente = db.query(Cliente).filter(
        Cliente.id == cliente_id,
        Cliente.restaurante_id == restaurante_id,
    ).first()
    if not cliente:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cliente não encontrado neste restaurante.",
        )

    # 4. Validação da comanda (se fornecida)
    clean_comanda_id: Optional[str] = None
    if comanda_id:
        clean_comanda_id = comanda_id.strip() if isinstance(comanda_id, str) else str(comanda_id)
        if clean_comanda_id:
            comanda = db.query(Comanda).filter(
                Comanda.id == clean_comanda_id,
                Comanda.restaurante_id == restaurante_id,
            ).first()
            if not comanda:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Comanda não encontrada neste restaurante.",
                )
            if comanda.cliente_id != cliente_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="A comanda informada pertence a outro cliente.",
                )
            if not comanda.fechada and comanda.delivery_status != "finalizado":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Apenas comandas concluídas podem receber avaliação.",
                )
            existing_comanda_review = db.query(AvaliacaoCliente).filter(
                AvaliacaoCliente.restaurante_id == restaurante_id,
                AvaliacaoCliente.comanda_id == clean_comanda_id,
            ).first()
            if existing_comanda_review:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Esta comanda já possui uma avaliação registrada.",
                )

    # 5. Criação e persistência
    avaliacao = AvaliacaoCliente(
        restaurante_id=restaurante_id,
        cliente_id=cliente_id,
        comanda_id=clean_comanda_id,
        nota=nota,
        comentario=comentario,
        criado_em=get_utc_now(),
    )
    db.add(avaliacao)
    db.commit()
    db.refresh(avaliacao)

    utc_dt = to_utc(avaliacao.criado_em)
    iso_str = utc_dt.isoformat() if utc_dt else str(avaliacao.criado_em)
    return {
        "id": str(avaliacao.id),
        "cliente_id": str(avaliacao.cliente_id),
        "cliente_nome": cliente.nome,
        "nota": avaliacao.nota,
        "classificacao": classify_satisfaction_rating(avaliacao.nota),
        "comentario": avaliacao.comentario,
        "criado_em": iso_str,
        "comanda_id": avaliacao.comanda_id,
    }
