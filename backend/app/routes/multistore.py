"""Explicit network membership and operator access; tenant isolation stays unchanged."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db, tenant_session_scope
from ..models import RestaurantNetwork, RestaurantNetworkUnit, RestaurantNetworkAccess, Restaurante, Usuario, SuperAdminAuditLog
from ..security import get_current_user, create_access_token, get_user_token_version, revoke_user_sessions
from .super_admin import get_current_admin

router = APIRouter(prefix='/lojas', tags=['Multilojas'])
admin_router = APIRouter(prefix='/multistore', tags=['SuperAdmin'])


def _manager(user):
    if str(user.id).startswith('support:') or user.status != 'ativo' or user.cargo not in ('admin', 'gerente'):
        raise HTTPException(403, 'Acesso restrito aos gestores da unidade.')


def _membership(db, tenant_id):
    row = db.query(RestaurantNetworkUnit).filter_by(restaurante_id=tenant_id).first()
    return {'id': row.network_id, 'owner_id': row.network_owner_id} if row else None


def _network(owner_id, network_id):
    with SessionLocal() as db, tenant_session_scope(db, owner_id):
        row = db.query(RestaurantNetwork).filter_by(id=network_id).first()
        if not row:
            raise HTTPException(404, 'Rede não encontrada.')
        return {'id': row.id, 'owner_id': row.restaurante_id, 'nome': row.nome}


def _target(target_id, user_id, network_id, *, issue_token=False):
    with SessionLocal() as db, tenant_session_scope(db, target_id):
        membership = _membership(db, target_id)
        restaurant = db.query(Restaurante).filter_by(id=target_id).first()
        user = db.query(Usuario).filter_by(id=user_id, restaurante_id=target_id).first()
        if not membership or membership['id'] != network_id or not restaurant or restaurant.saas_status != 'active' or not user or user.removed_at is not None:
            raise HTTPException(403, 'Esta unidade não está disponível para seu acesso.')
        _manager(user)
        result = {'id': target_id, 'nome': restaurant.nome}
        if issue_token:
            version = get_user_token_version(db, user_id=user.id, restaurante_id=target_id)
            result = {'access_token': create_access_token(user.id, target_id, token_version=version),
                      'usuario': {'id': user.id, 'nome': user.nome, 'role': user.cargo, 'cargo': user.cargo, 'restaurante_id': target_id}}
        return result


@router.get('')
def list_my_units(user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    _manager(user)
    membership = _membership(db, user.restaurante_id)
    restaurant = db.query(Restaurante).filter_by(id=user.restaurante_id).first()
    result = {'current': {'id': user.restaurante_id, 'nome': restaurant.nome if restaurant else 'Loja atual'}, 'network': None, 'units': []}
    if not membership:
        return result
    result['network'] = _network(membership['owner_id'], membership['id'])
    grants = db.query(RestaurantNetworkAccess).filter_by(restaurante_id=user.restaurante_id, usuario_id=user.id, network_id=membership['id']).all()
    targets = [(grant.destino_restaurante_id, grant.destino_usuario_id) for grant in grants]
    for target_id, user_id in targets:
        try:
            result['units'].append(_target(target_id, user_id, membership['id']))
        except HTTPException as exc:
            if exc.status_code != 403:
                raise
    return result


@router.post('/{target_id}/entrar')
def switch_unit(target_id: int, user: Usuario = Depends(get_current_user), db: Session = Depends(get_db)):
    _manager(user)
    membership = _membership(db, user.restaurante_id)
    if not membership or target_id == user.restaurante_id:
        raise HTTPException(403, 'Selecione uma unidade vinculada ao seu acesso nesta rede.')
    # Serializes token issuance with grant revocation. Client-provided IDs never confer access.
    grant = db.query(RestaurantNetworkAccess).filter_by(restaurante_id=user.restaurante_id, usuario_id=user.id, destino_restaurante_id=target_id, network_id=membership['id']).with_for_update().first()
    if not grant:
        raise HTTPException(403, 'Esta unidade não está vinculada ao seu acesso nesta rede.')
    result = _target(target_id, grant.destino_usuario_id, membership['id'], issue_token=True)
    db.commit()
    return result


class AuditMutation(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)
    model_config = ConfigDict(extra='forbid')

    @field_validator('reason')
    @classmethod
    def useful_reason(cls, value):
        clean = value.strip()
        if len(clean) < 5:
            raise ValueError('Informe um motivo com pelo menos cinco caracteres úteis.')
        return clean


class NetworkCreate(AuditMutation):
    owner_id: int = Field(gt=0)
    nome: str = Field(min_length=2, max_length=120)
    @field_validator('nome')
    @classmethod
    def useful_name(cls, value):
        clean = value.strip()
        if len(clean) < 2:
            raise ValueError('Informe o nome da rede.')
        return clean


class UnitLink(AuditMutation):
    network_id: str = Field(min_length=1, max_length=36)
    owner_id: int = Field(gt=0)


class AccessLink(AuditMutation):
    user_id: str = Field(min_length=1)
    target_id: int = Field(gt=0)
    target_user_id: str = Field(min_length=1)


def _audit(db, tenant_id, admin, action, reason, after):
    db.add(SuperAdminAuditLog(restaurante_id=tenant_id, actor=str(admin['user']), action=action, reason=reason, after_data=after))


@admin_router.get('/units/{tenant_id}')
def admin_unit_index(tenant_id: int, admin=Depends(get_current_admin)):
    if tenant_id <= 0:
        raise HTTPException(422, 'ID da loja inválido.')
    with SessionLocal() as db, tenant_session_scope(db, tenant_id):
        if not db.query(Restaurante).filter_by(id=tenant_id).first():
            raise HTTPException(404, 'Loja não encontrada.')
        membership = _membership(db, tenant_id)
        grants = db.query(RestaurantNetworkAccess).filter_by(restaurante_id=tenant_id).all()
        result = {'network': None, 'accesses': [{'id': g.id, 'user_id': g.usuario_id, 'target_id': g.destino_restaurante_id, 'target_user_id': g.destino_usuario_id} for g in grants]}
    if membership:
        result['network'] = _network(membership['owner_id'], membership['id'])
    return result


@admin_router.get('/networks/{owner_id}')
def admin_owner_networks(owner_id: int, admin=Depends(get_current_admin)):
    if owner_id <= 0:
        raise HTTPException(422, 'ID da matriz inválido.')
    with SessionLocal() as db, tenant_session_scope(db, owner_id):
        return [{'id': row.id, 'owner_id': owner_id, 'nome': row.nome} for row in db.query(RestaurantNetwork).filter_by(restaurante_id=owner_id).all()]


@admin_router.post('/networks')
def create_network(payload: NetworkCreate, admin=Depends(get_current_admin)):
    with SessionLocal() as db, tenant_session_scope(db, payload.owner_id):
        if not payload.nome.strip() or not payload.reason.strip():
            raise HTTPException(422, 'Nome e motivo são obrigatórios.')
        if not db.query(Restaurante).filter_by(id=payload.owner_id).with_for_update().first():
            raise HTTPException(404, 'Loja não encontrada.')
        if _membership(db, payload.owner_id):
            raise HTTPException(409, 'Esta loja já pertence a uma rede.')
        network = RestaurantNetwork(restaurante_id=payload.owner_id, nome=payload.nome.strip())
        db.add(network); db.flush()
        result = {'id': network.id, 'owner_id': payload.owner_id, 'nome': network.nome}
        db.add(RestaurantNetworkUnit(restaurante_id=payload.owner_id, network_id=network.id, network_owner_id=payload.owner_id))
        _audit(db, payload.owner_id, admin, 'multistore.network.create', payload.reason, result)
        db.commit()
        return result


@admin_router.put('/units/{tenant_id}')
def link_unit(tenant_id: int, payload: UnitLink, admin=Depends(get_current_admin)):
    if tenant_id <= 0:
        raise HTTPException(422, 'ID da loja inválido.')
    network = _network(payload.owner_id, payload.network_id)
    with SessionLocal() as db, tenant_session_scope(db, tenant_id):
        if not db.query(Restaurante).filter_by(id=tenant_id).with_for_update().first():
            raise HTTPException(404, 'Loja não encontrada.')
        existing = db.query(RestaurantNetworkUnit).filter_by(restaurante_id=tenant_id).with_for_update().first()
        if existing and existing.network_id != payload.network_id:
            raise HTTPException(409, 'Esta loja já pertence a outra rede. O vínculo deve ser revisado antes de transferir.')
        if not existing:
            db.add(RestaurantNetworkUnit(restaurante_id=tenant_id, network_id=payload.network_id, network_owner_id=payload.owner_id))
            _audit(db, tenant_id, admin, 'multistore.unit.link', payload.reason, network)
        db.commit()
        return network


@admin_router.post('/units/{tenant_id}/accesses')
def link_access(tenant_id: int, payload: AccessLink, admin=Depends(get_current_admin)):
    if tenant_id <= 0:
        raise HTTPException(422, 'ID da loja inválido.')
    with SessionLocal() as db, tenant_session_scope(db, tenant_id):
        membership = _membership(db, tenant_id)
        source = db.query(Usuario).filter_by(id=payload.user_id, restaurante_id=tenant_id).with_for_update().first()
        if not source or source.removed_at is not None or not membership or payload.target_id == tenant_id:
            raise HTTPException(403, 'Origem inválida para vínculo de multilojas.')
        _manager(source)
        _target(payload.target_id, payload.target_user_id, membership['id'])
        existing = db.query(RestaurantNetworkAccess).filter_by(restaurante_id=tenant_id, usuario_id=payload.user_id, destino_restaurante_id=payload.target_id).with_for_update().first()
        if existing:
            if existing.destino_usuario_id != payload.target_user_id:
                raise HTTPException(409, 'Revogue o vínculo anterior antes de alterar a identidade de destino.')
            return {'id': existing.id}
        grant = RestaurantNetworkAccess(restaurante_id=tenant_id, usuario_id=payload.user_id, destino_restaurante_id=payload.target_id, destino_usuario_id=payload.target_user_id, network_id=membership['id'])
        db.add(grant); db.flush()
        result = {'id': grant.id, 'user_id': payload.user_id, 'target_id': payload.target_id, 'target_user_id': payload.target_user_id}
        _audit(db, tenant_id, admin, 'multistore.access.link', payload.reason, result)
        db.commit()
        return result


class AccessRevoke(AuditMutation):
    pass


@admin_router.delete('/units/{tenant_id}/accesses/{access_id}')
def unlink_access(tenant_id: int, access_id: str, payload: AccessRevoke, admin=Depends(get_current_admin)):
    if tenant_id <= 0:
        raise HTTPException(422, 'ID da loja inválido.')
    with SessionLocal() as db, tenant_session_scope(db, tenant_id):
        grant = db.query(RestaurantNetworkAccess).filter_by(restaurante_id=tenant_id, id=access_id).with_for_update().first()
        if not grant:
            raise HTTPException(404, 'Vínculo não encontrado.')
        target_id, target_user_id = grant.destino_restaurante_id, grant.destino_usuario_id
        with SessionLocal() as target_db, tenant_session_scope(target_db, target_id):
            revoke_user_sessions(target_db, user_id=target_user_id, restaurante_id=target_id)
            target_db.commit()
        _audit(db, tenant_id, admin, 'multistore.access.revoke', payload.reason, {'id': access_id, 'target_id': target_id})
        db.delete(grant); db.commit()
        return {'revoked': True}
