"""Team activation emails use the existing encrypted, durable Resend queue."""
import hashlib
from sqlalchemy import text, inspect, select
from ..config import settings
from ..signup_models import SignupNotification
from .signup_notifications import enqueue


def delivery_prefix(tenant_id):
    return f"team-{tenant_id}-"


def delivery_id(user):
    if not user.token_convite:
        return None
    ref = hashlib.sha256(str(user.token_convite).encode("utf-8")).hexdigest()[:16]
    return f"{delivery_prefix(user.restaurante_id)}{user.id}-{ref}:invite:email"


def enqueue_invite(db, user, restaurant_name):
    if not user.email:
        return False
    queue_id = delivery_id(user)
    enqueue(db, protocol=queue_id.removesuffix(':invite:email'), kind='invite',
            email=user.email, phone=None, expires_hours=24,
            subject=f"Convite para a equipe — {restaurant_name}",
            message=(f"Olá, {user.nome}! Você foi convidado para trabalhar no {restaurant_name}.\n\n"
                     f"Crie sua senha e ative seu acesso: {settings.KOMA_PUBLIC_APP_URL}/ativar#token={user.token_convite}\n\n"
                     "Este link é pessoal e expira em 24 horas. Não encaminhe esta mensagem.\n"
                     "Se não esperava este convite, ignore este e-mail."))
    return True


def with_delivery_status(db, users, tenant_id):
    if db.get_bind().dialect.name == 'postgresql':
        rows = db.execute(text('SELECT * FROM koma_internal.team_invite_delivery_status()')).mappings().all()
    elif inspect(db.get_bind()).has_table('signup_notifications'):
        rows = db.execute(select(SignupNotification.id, SignupNotification.status, SignupNotification.last_error).where(
            SignupNotification.id.startswith(delivery_prefix(tenant_id)))).mappings().all()
    else:
        rows = []
    states = {row['id']: (row['status'], row['last_error']) for row in rows}
    for user in users:
        state, error = states.get(delivery_id(user), (None, None))
        user.convite_email_status = ('enviado' if state == 'sent' else 'falhou' if error or state == 'failed'
                                    else 'na_fila' if state else 'email_ausente' if not user.email else 'nao_agendado')
    return users
