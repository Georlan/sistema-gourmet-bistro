import datetime
import hashlib
import hmac
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List

from ..config import settings
from ..database import bind_session_to_tenant, current_restaurante_id, get_db
from ..models import Produto, PublicRateLimit, Restaurante

router = APIRouter(
    tags=["AI Assistant"]
)

class ChatMessage(BaseModel):
    role: str  # "user" | "model"
    text: str = Field(min_length=1, max_length=500)

class ChatWaiterRequest(BaseModel):
    restaurante_id: int
    history: List[ChatMessage] = Field(default_factory=list, max_length=10)
    message: str = Field(min_length=1, max_length=500)


def _rate_key(value: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _consume_rate_limit(
    db: Session,
    restaurante_id: int,
    scope: str,
    key_hash: str,
    limit: int,
    window: datetime.timedelta,
) -> None:
    now = datetime.datetime.now(datetime.timezone.utc)
    entry = db.query(PublicRateLimit).filter(
        PublicRateLimit.scope == scope,
        PublicRateLimit.key_hash == key_hash,
    ).with_for_update().first()
    if not entry:
        db.add(PublicRateLimit(
            restaurante_id=restaurante_id,
            scope=scope,
            key_hash=key_hash,
            janela_iniciada_em=now,
            requisicoes=1,
        ))
        return

    started = entry.janela_iniciada_em
    if started.tzinfo is None:
        started = started.replace(tzinfo=datetime.timezone.utc)
    if now - started >= window:
        entry.janela_iniciada_em = now
        entry.requisicoes = 1
        return
    if entry.requisicoes >= limit:
        raise HTTPException(status_code=429, detail="Limite de mensagens atingido.")
    entry.requisicoes += 1

@router.post("/chat-waiter")
async def chat_waiter(
    payload: ChatWaiterRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    if (
        not isinstance(payload.restaurante_id, int)
        or isinstance(payload.restaurante_id, bool)
        or payload.restaurante_id <= 0
    ):
        raise HTTPException(status_code=400, detail="Restaurante inválido.")

    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    client_address = forwarded or (request.client.host if request.client else "unknown")
    tenant_context = current_restaurante_id.set(payload.restaurante_id)
    bind_session_to_tenant(db, payload.restaurante_id)
    try:
        restaurant = db.query(Restaurante).filter(
            Restaurante.id == payload.restaurante_id
        ).first()
        if not restaurant:
            raise HTTPException(status_code=404, detail="Restaurante não encontrado.")

        _consume_rate_limit(
            db,
            payload.restaurante_id,
            "ai_ip_minute",
            _rate_key(f"ai:ip:{client_address}"),
            limit=10,
            window=datetime.timedelta(minutes=1),
        )
        _consume_rate_limit(
            db,
            payload.restaurante_id,
            "ai_tenant_hour",
            _rate_key(f"ai:tenant:{payload.restaurante_id}"),
            limit=200,
            window=datetime.timedelta(hours=1),
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=429, detail="Tente novamente em instantes.")

        products = db.query(Produto).filter(
            Produto.ativo.is_(True)
        ).limit(200).all()
        brand_name = restaurant.nome
    finally:
        current_restaurante_id.reset(tenant_context)

    def get_local_reply(msg: str) -> str:
        lower = msg.lower()
        matching = [
            product for product in products
            if product.nome and product.nome.lower() in lower
        ]
        if matching:
            product = matching[0]
            description = f" — {product.descricao}" if product.descricao else ""
            return (
                f"{product.nome} está disponível por R$ {product.preco:.2f}"
                f"{description}. Deseja adicionar ao pedido?"
            )
        if "oi" in lower or "olá" in lower or "bom dia" in lower:
            return f"Olá! Sou o Chef & Garçom Virtual da {brand_name}. Como posso te ajudar a escolher a delícia de hoje?"
        available = products[:3]
        if available:
            suggestions = ", ".join(
                f"{product.nome} (R$ {product.preco:.2f})"
                for product in available
            )
            return f"Algumas sugestões da {brand_name}: {suggestions}. Qual delas você prefere?"
        return f"O cardápio da {brand_name} está sendo atualizado. Tente novamente em instantes."

    # O assistente público não transmite cardápio nem histórico do cliente para
    # provedores externos. As recomendações são calculadas localmente.
    return {"reply": get_local_reply(payload.message)}
