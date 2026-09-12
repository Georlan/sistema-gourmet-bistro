"""Recoverable signup before legal acceptance or payment details are requested."""
import datetime as dt
import hashlib
import json
import secrets
import uuid
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from ..database import get_db, tenant_session_scope
from ..signup_models import RestaurantSignup
from ..contract_models import ContractAcceptance
from ..crypt import encrypt_field, decrypt_field
from ..subscription import VALID_SUBSCRIPTION_PLANS
from .super_admin import get_current_admin
from ..security import IPRateLimiter
_signup_rate_limiter = IPRateLimiter(requests_per_minute=20)

router = APIRouter(prefix="/api/signups", tags=["Inscrições"])
admin_router = APIRouter(prefix="/signups", tags=["SuperAdmin"])

class SignupInput(BaseModel):
    restaurant_name: str = Field(min_length=2, max_length=255)
    responsible_name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=3, max_length=100)
    phone: str = Field(min_length=10, max_length=30)
    plan: str
    billing_cycle: str
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        import re
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Informe um e-mail válido")
        return value.lower()

    @field_validator("phone")
    @classmethod
    def phone_valid(cls, value):
        digits = ''.join(c for c in value if c.isdigit())
        if not 10 <= len(digits) <= 15:
            raise ValueError("Informe um telefone válido")
        return digits

    @field_validator("plan")
    @classmethod
    def plan_valid(cls, value):
        if value not in VALID_SUBSCRIPTION_PLANS:
            raise ValueError("Plano inválido")
        return value

    @field_validator("billing_cycle")
    @classmethod
    def cycle_valid(cls, value):
        if value not in {"mensal", "anual"}:
            raise ValueError("Ciclo inválido")
        return value


def token_hash(token):
    if not token or not 40 <= len(token) <= 128:
        raise HTTPException(404, "Inscrição não encontrada ou link expirado.")
    return hashlib.sha256(token.encode()).hexdigest()


def read_signup(db, token):
    hashed = token_hash(token)
    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(text("SELECT * FROM koma_internal.read_signup(:token)"), {"token": hashed}).mappings().one_or_none()
        return dict(row) if row else None
    row = db.query(RestaurantSignup).filter(RestaurantSignup.token_hash == hashed, RestaurantSignup.expires_at > dt.datetime.now(dt.timezone.utc)).one_or_none()
    return {c.name: getattr(row, c.name) for c in RestaurantSignup.__table__.columns} if row else None


def require_signup(db, token):
    row = read_signup(db, token)
    if not row:
        raise HTTPException(404, "Inscrição não encontrada ou link expirado.")
    return row


def signup_receipt(db, signup_id):
    if db.get_bind().dialect.name == "postgresql":
        return db.execute(text("SELECT koma_internal.signup_receipt(:id)"), {"id": signup_id}).scalar()
    row = db.query(ContractAcceptance).filter(ContractAcceptance.request_id == signup_id).one_or_none()
    return row.receipt_snapshot_encrypted if row else None


@router.post("", status_code=201)
def create_signup(payload: SignupInput, request: Request, response: Response, db=Depends(get_db)):
    _signup_rate_limiter.check(request)
    response.headers["Cache-Control"] = "no-store"
    token = secrets.token_urlsafe(32)
    now = dt.datetime.now(dt.timezone.utc)
    values = dict(id=str(uuid.uuid4()), token_hash=token_hash(token), payload_encrypted=encrypt_field(json.dumps(payload.model_dump())), created_at=now, updated_at=now, expires_at=now + dt.timedelta(days=30))
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT koma_internal.create_signup(:id, :token_hash, :payload_encrypted)"), values)
    else:
        db.add(RestaurantSignup(**values))
    db.commit()
    return {"id": values["id"], "token": token, "message": "Inscrição recebida. Você pode continuar agora ou retomar neste dispositivo por 30 dias."}


@router.get("/current")
def get_signup(response: Response, x_signup_token: str = Header(default=""), db=Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    row = require_signup(db, x_signup_token)
    receipt = signup_receipt(db, row["id"])
    receipt_data = json.loads(decrypt_field(receipt)) if receipt else None
    activation = None
    if receipt_data:
        from ..services.restaurant_provisioning import resolve_activation_acceptance
        from ..models import Restaurante, Usuario
        acceptance = resolve_activation_acceptance(db, receipt_data["protocol"])
        tenant_id = acceptance.get("linked_restaurante_id") if acceptance else None
        if tenant_id:
            with tenant_session_scope(db, tenant_id):
                restaurant = db.query(Restaurante).filter(Restaurante.id == tenant_id).one()
                admin = db.query(Usuario).filter(Usuario.restaurante_id == tenant_id, Usuario.status == "pendente_ativacao", Usuario.email == receipt_data["contractingParty"]["email"].lower()).first()
                expires = admin.token_expira_em if admin else None
                if expires and expires.tzinfo is None: expires = expires.replace(tzinfo=dt.timezone.utc)
                activation = {"restaurantId": str(tenant_id), "slug": restaurant.slug,
                    "activationToken": admin.token_convite if admin and expires and expires > dt.datetime.now(dt.timezone.utc) else None}
    return {"id": row["id"], "data": json.loads(decrypt_field(row["payload_encrypted"])), "receipt": receipt_data, "activation": activation}


@admin_router.get("")
def list_signups(response: Response, admin=Depends(get_current_admin), db=Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    if db.get_bind().dialect.name == "postgresql":
        rows = db.execute(text("SELECT * FROM koma_internal.list_signups_for_admin()" )).mappings().all()
    else:
        rows = db.execute(text("""SELECT s.id, s.payload_encrypted, s.created_at, COALESCE(b.updated_at,c.accepted_at,s.updated_at) AS updated_at,
          c.protocol, b.status AS billing_status, l.restaurante_id
          FROM restaurant_signups s LEFT JOIN contract_acceptances c ON c.request_id=s.id
          LEFT JOIN saas_billing_setups b ON b.protocol=c.protocol
          LEFT JOIN restaurant_contract_acceptances l ON l.acceptance_id=c.id
          WHERE s.expires_at > CURRENT_TIMESTAMP ORDER BY s.created_at DESC LIMIT 200""")).mappings().all()
    items = []
    now = dt.datetime.now(dt.timezone.utc)
    for row in rows:
        updated = row["updated_at"]
        if isinstance(updated, str): updated = dt.datetime.fromisoformat(updated)
        if updated.tzinfo is None: updated = updated.replace(tzinfo=dt.timezone.utc)
        status = "activated" if row["restaurante_id"] else "payment_failed" if row["billing_status"] == "failed" else "payment_pending" if row["protocol"] else "started"
        items.append({"id": row["id"], **json.loads(decrypt_field(row["payload_encrypted"])), "status": status, "inactive": status != "activated" and now-updated > dt.timedelta(hours=24), "updated_at": updated.isoformat(), "protocol": row["protocol"], "restaurant_id": row["restaurante_id"]})
    return {"items": items, "limit": 200}

@admin_router.get("/deliveries")
def delivery_status(admin=Depends(get_current_admin), db=Depends(get_db)):
    if db.get_bind().dialect.name == "postgresql":
        rows = db.execute(text("SELECT * FROM koma_internal.signup_delivery_status()" )).mappings().all()
    else:
        rows = db.execute(text("SELECT id,status,attempts,last_error FROM signup_notifications ORDER BY next_attempt_at DESC LIMIT 200")).mappings().all()
    return {"items": [dict(row) for row in rows]}

@router.put("/current")
def update_signup(payload: SignupInput, response: Response, x_signup_token: str = Header(default=""), db=Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    row = require_signup(db, x_signup_token)
    if signup_receipt(db, row["id"]):
        raise HTTPException(409, "O contrato já foi aceito. Os dados desta contratação estão congelados.")
    encrypted = encrypt_field(json.dumps(payload.model_dump()))
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT koma_internal.update_signup(:token,:payload)"), {"token":token_hash(x_signup_token),"payload":encrypted})
    else:
        db.query(RestaurantSignup).filter(RestaurantSignup.id==row["id"]).update({"payload_encrypted":encrypted,"updated_at":dt.datetime.now(dt.timezone.utc)})
    db.commit()
    return {"id":row["id"], "token":x_signup_token, "message":"Inscrição atualizada."}

@admin_router.post("/deliveries/{delivery_id}/retry")
def retry_delivery(delivery_id: str, admin=Depends(get_current_admin), db=Depends(get_db)):
    if db.get_bind().dialect.name == "postgresql":
        updated = db.execute(text("SELECT koma_internal.retry_signup_notification(:id)"), {"id":delivery_id}).scalar()
    else:
        from ..signup_models import SignupNotification
        updated = db.query(SignupNotification).filter(SignupNotification.id==delivery_id, SignupNotification.status.in_(["pending","failed"]), SignupNotification.expires_at>dt.datetime.now(dt.timezone.utc), SignupNotification.payload_encrypted!='').update({"status":"pending","attempts":0,"next_attempt_at":dt.datetime.now(dt.timezone.utc),"last_error":None})
    db.commit()
    if not updated: raise HTTPException(409, "Envio concluído, em andamento ou expirado. Para convite expirado, gere um novo convite na aba Acessos.")
    return {"message":"Nova tentativa agendada."}
