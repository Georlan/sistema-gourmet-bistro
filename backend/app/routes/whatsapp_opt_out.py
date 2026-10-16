"""Unsubscribe accepts a scoped capability in the POST body, never a URL log."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, tenant_session_scope
from ..services.whatsapp_opt_out import block_contact, resolve_opt_out_token

router = APIRouter(prefix="/api/cardapio/whatsapp", tags=["Cardapio - WhatsApp"])


class OptOutRequest(BaseModel):
    token: str = Field(min_length=32, max_length=2048)


@router.post("/opt-out")
def apply_opt_out(body: OptOutRequest, db: Session = Depends(get_db)):
    try:
        rid, digest = resolve_opt_out_token(body.token)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from None
    with tenant_session_scope(db, rid):
        block_contact(db, rid, digest)
        db.commit()
    return {"disabled": True}
