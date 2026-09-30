"""Configuração assistida: um produto/categoria por tamanho e opções compartilhadas."""
import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..catalog_addons import CategoriaGrupoModificador
from ..database import get_db, require_tenant_id
from ..models import Categoria, GrupoModificador, OpcaoModificador, Produto, Usuario
from ..restaurant_profile_models import RestauranteOperationProfile
from ..security import require_permission
from .modificadores import ARCHIVED_MODIFIER_TYPE, _notify_catalog_update

router = APIRouter(prefix='/cardapio/marmitaria', tags=['Cardápio Marmitaria'])


class RegraTamanho(BaseModel):
    model_config = ConfigDict(extra='forbid')
    grupo_id: str = Field(min_length=1, max_length=100)
    minimo: int = Field(ge=0, le=100, strict=True)
    maximo: int = Field(ge=1, le=100, strict=True)
    modo_selecao: Literal['porcoes', 'tipos'] = 'porcoes'

    @model_validator(mode='after')
    def validate_limits(self):
        if self.minimo > self.maximo:
            raise ValueError('O mínimo não pode superar o máximo.')
        return self


class TamanhoInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    nome: str = Field(min_length=1, max_length=100)
    preco: Decimal = Field(ge=0, max_digits=14, decimal_places=2, allow_inf_nan=False)
    ativo: StrictBool = False
    regras: list[RegraTamanho] = Field(min_length=1, max_length=20)

    @model_validator(mode='after')
    def validate_name_and_groups(self):
        self.nome = self.nome.strip()
        if not self.nome:
            raise ValueError('Informe o nome do tamanho.')
        if len({r.grupo_id for r in self.regras}) != len(self.regras):
            raise ValueError('Configure cada grupo uma única vez por tamanho.')
        return self


def _enabled(db, tenant):
    profile = db.query(RestauranteOperationProfile).filter_by(restaurante_id=tenant).first()
    return bool(profile and profile.profile_key == 'marmitaria')


def _serialize(db, tenant):
    products = db.query(Produto).join(Categoria, (Categoria.id == Produto.categoria_id) & (Categoria.restaurante_id == Produto.restaurante_id)).filter(
        Produto.restaurante_id == tenant, Categoria.marmitaria_tamanho.is_(True),
    ).order_by(Produto.nome).all()
    links = db.query(CategoriaGrupoModificador).filter_by(restaurante_id=tenant).all()
    return [{'id': p.id, 'categoria_id': p.categoria_id, 'nome': p.nome, 'preco': float(p.preco), 'ativo': bool(p.ativo),
             'regras': [{'grupo_id': l.grupo_id, 'minimo': l.min_selecoes, 'maximo': l.max_selecoes, 'modo_selecao': l.modo_selecao or 'tipos'}
                        for l in links if l.categoria_id == p.categoria_id and l.min_selecoes is not None]} for p in products]


@router.get('/tamanhos')
def listar_tamanhos(db: Session = Depends(get_db), user: Usuario = Depends(require_permission('catalogo:administrar'))):
    tenant = require_tenant_id()
    return {'enabled': _enabled(db, tenant), 'tamanhos': _serialize(db, tenant)}


def _save(payload, db, tenant, background_tasks, product_id=None):
    if not _enabled(db, tenant):
        raise HTTPException(403, 'O perfil Marmitaria deve ser definido pelo Super Admin.')
    group_ids = [r.grupo_id for r in payload.regras]
    groups = db.query(GrupoModificador).filter(GrupoModificador.restaurante_id == tenant, GrupoModificador.id.in_(group_ids), GrupoModificador.tipo != ARCHIVED_MODIFIER_TYPE).all()
    if len(groups) != len(group_ids):
        raise HTTPException(422, 'Um grupo não pertence ao restaurante ou não está disponível.')
    if payload.ativo:
        options = db.query(OpcaoModificador).filter(OpcaoModificador.restaurante_id == tenant, OpcaoModificador.grupo_id.in_(group_ids), OpcaoModificador.ativo.is_(True)).all()
        for rule in payload.regras:
            available = sum(o.grupo_id == rule.grupo_id for o in options)
            required = rule.minimo if rule.modo_selecao == 'tipos' else min(rule.minimo, 1)
            if available < required:
                raise HTTPException(409, 'Faltam opções disponíveis para a composição. Cadastre ou reative opções, ou salve o tamanho pausado.')
    if product_id:
        product = db.query(Produto).filter_by(restaurante_id=tenant, id=product_id).with_for_update().one_or_none()
        category = db.query(Categoria).filter_by(restaurante_id=tenant, id=product.categoria_id if product else '', marmitaria_tamanho=True).one_or_none()
        if not product or not category:
            raise HTTPException(404, 'Tamanho não encontrado.')
    else:
        category = Categoria(id=f'marmita-cat-{uuid.uuid4().hex}', restaurante_id=tenant, nome=payload.nome, marmitaria_tamanho=True, destino_impressao='COZINHA')
        db.add(category)
        db.flush()
        product = Produto(id=f'marmita-prod-{uuid.uuid4().hex}', restaurante_id=tenant, categoria_id=category.id, nome=payload.nome, preco=payload.preco, ativo=payload.ativo)
        db.add(product)
    category.nome = product.nome = payload.nome
    product.preco = payload.preco
    product.ativo = payload.ativo
    existing = db.query(CategoriaGrupoModificador).filter_by(restaurante_id=tenant, categoria_id=category.id).all()
    by_group = {link.grupo_id: link for link in existing}
    for link in existing:
        if link.grupo_id not in group_ids:
            db.delete(link)
    for rule in payload.regras:
        link = by_group.get(rule.grupo_id)
        if link is None:
            link = CategoriaGrupoModificador(restaurante_id=tenant, categoria_id=category.id, grupo_id=rule.grupo_id)
            db.add(link)
        link.incluir_subcategorias = False
        link.min_selecoes, link.max_selecoes = rule.minimo, rule.maximo
        link.modo_selecao = rule.modo_selecao
    db.commit()
    _notify_catalog_update(background_tasks, tenant, 'Composição de marmita atualizada.')
    return next(p for p in _serialize(db, tenant) if p['id'] == product.id)


def _save_safely(payload, db, tenant, background_tasks, product_id=None):
    try:
        return _save(payload, db, tenant, background_tasks, product_id=product_id)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'Já existe uma categoria com esse nome. Use um nome diferente.')


@router.post('/tamanhos', status_code=201)
def criar_tamanho(payload: TamanhoInput, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('catalogo:administrar'))):
    return _save_safely(payload, db, require_tenant_id(), background_tasks)


@router.put('/tamanhos/{product_id}')
def atualizar_tamanho(product_id: str, payload: TamanhoInput, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('catalogo:administrar'))):
    return _save_safely(payload, db, require_tenant_id(), background_tasks, product_id=product_id)
