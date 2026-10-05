"""Cadastro único de marmitas: tamanho, preço e composição por produto."""
import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..catalog_addons import effective_modifier_payloads_by_product, normalize_catalog_name
from ..database import get_db, require_tenant_id
from ..models import Categoria, GrupoModificador, OpcaoModificador, Produto, ProdutoGrupoModificador, Restaurante, Usuario
from ..marmitaria_catalog import catalog_sizes, enabled as _enabled, size_key
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
    tamanho: Literal['P', 'M', 'G'] | None = None
    preco: Decimal = Field(ge=0, max_digits=14, decimal_places=2, allow_inf_nan=False)
    ativo: StrictBool = False
    regras: list[RegraTamanho] = Field(default_factory=list, max_length=20)

    @model_validator(mode='after')
    def validate_name_and_groups(self):
        self.nome = self.nome.strip()
        if not self.nome:
            raise ValueError('Informe o nome do tamanho.')
        if self.ativo and not self.regras:
            raise ValueError('Configure as escolhas antes de disponibilizar a marmita.')
        if len({r.grupo_id for r in self.regras}) != len(self.regras):
            raise ValueError('Configure cada grupo uma única vez por tamanho.')
        return self


def _serialize(db, tenant):
    rows = catalog_sizes(db, tenant)
    effective = effective_modifier_payloads_by_product(db, tenant, [p for p, _, _ in rows])
    return [{'id': p.id, 'categoria_id': p.categoria_id, 'nome': p.nome, 'tamanho': key.upper() if key in {'p', 'm', 'g'} else None,
             'preco': float(p.preco), 'ativo': bool(p.ativo), 'configurado': bool(p.marmitaria_tamanho),
             'regras': [{'grupo_id': g['id'], 'minimo': g['min_selecoes'], 'maximo': g['max_selecoes'],
                        'modo_selecao': g.get('modo_selecao') or 'tipos'} for g in effective.get(p.id, [])]}
            for p, _, key in rows]


def _shared_category(db, tenant):
    configured = db.query(Produto).filter(Produto.restaurante_id == tenant, Produto.marmitaria_tamanho.isnot(None)).order_by(Produto.id).first()
    if configured:
        category = db.query(Categoria).filter_by(restaurante_id=tenant, id=configured.categoria_id).one()
        category.marmitaria_tamanho = True
        return category
    categories = db.query(Categoria).filter_by(restaurante_id=tenant).order_by(Categoria.id).all()
    for name in ('marmitas', 'quentinhas', 'marmita', 'quentinha'):
        match = next((c for c in categories if normalize_catalog_name(c.nome) == name and
                      (not c.marmitaria_tamanho or name in {'marmitas', 'quentinhas'})), None)
        if match:
            match.marmitaria_tamanho = True
            return match
    category = Categoria(id=f'marmitas-{uuid.uuid4().hex}', restaurante_id=tenant, nome='Marmitas', destino_impressao='COZINHA', marmitaria_tamanho=True)
    db.add(category)
    db.flush()
    return category


@router.get('/tamanhos')
def listar_tamanhos(db: Session = Depends(get_db), user: Usuario = Depends(require_permission('catalogo:administrar'))):
    tenant = require_tenant_id()
    return {'enabled': _enabled(db, tenant), 'tamanhos': _serialize(db, tenant)}


def _save(payload, db, tenant, background_tasks, product_id=None):
    if not _enabled(db, tenant):
        raise HTTPException(403, 'O perfil Marmitaria deve ser definido pelo Super Admin.')
    # Serializa cadastros deste restaurante, inclusive adoção de registros antigos.
    db.query(Restaurante).filter_by(id=tenant).with_for_update().one()
    rows = catalog_sizes(db, tenant)
    existing_product = next((p for p, _, _ in rows if p.id == product_id), None)
    if product_id and not existing_product:
        raise HTTPException(404, 'Tamanho não encontrado.')
    key = payload.tamanho.lower() if payload.tamanho else (existing_product.marmitaria_tamanho if existing_product else None) or size_key(payload.nome)
    if any(p.id != product_id and current_key == key for p, _, current_key in rows):
        raise HTTPException(409, 'Este tamanho já está cadastrado. Edite a marmita existente.')
    group_ids = [r.grupo_id for r in payload.regras]
    groups = db.query(GrupoModificador).filter(GrupoModificador.restaurante_id == tenant, GrupoModificador.id.in_(group_ids), GrupoModificador.tipo != ARCHIVED_MODIFIER_TYPE).all()
    if len(groups) != len(group_ids):
        raise HTTPException(422, 'Um grupo não pertence ao restaurante ou não está disponível.')
    if payload.ativo:
        options = db.query(OpcaoModificador).filter(OpcaoModificador.restaurante_id == tenant, OpcaoModificador.grupo_id.in_(group_ids), OpcaoModificador.ativo.is_(True), OpcaoModificador.arquivada.is_(False)).all()
        for rule in payload.regras:
            available = sum(o.grupo_id == rule.grupo_id for o in options)
            required = rule.minimo if rule.modo_selecao == 'tipos' else min(rule.minimo, 1)
            if available < required:
                raise HTTPException(409, 'Faltam opções disponíveis para a composição. Cadastre ou reative opções, ou salve o tamanho pausado.')
    category = _shared_category(db, tenant)
    if existing_product:
        product = existing_product
    else:
        product = Produto(id=f'marmita-prod-{uuid.uuid4().hex}', restaurante_id=tenant,
                          categoria_id=category.id, nome=payload.nome, preco=payload.preco, ativo=payload.ativo)
        db.add(product)
    product.categoria_id = category.id
    product.marmitaria_tamanho = key
    product.nome = payload.nome
    product.preco = payload.preco
    product.ativo = payload.ativo
    # Os vínculos têm FK composta: grave o produto antes de inserir suas regras.
    db.flush()
    existing = db.query(ProdutoGrupoModificador).filter_by(restaurante_id=tenant, produto_id=product.id).all()
    # O grupo existe uma única vez; apenas a regra muda conforme o tamanho.
    for link in existing:
        db.delete(link)
    for rule in payload.regras:
        db.add(ProdutoGrupoModificador(restaurante_id=tenant, produto_id=product.id, grupo_id=rule.grupo_id,
                                      min_selecoes=rule.minimo, max_selecoes=rule.maximo, modo_selecao=rule.modo_selecao))
    db.commit()
    _notify_catalog_update(background_tasks, tenant, 'Composição de marmita atualizada.')
    return next(p for p in _serialize(db, tenant) if p['id'] == product.id)


def _save_safely(payload, db, tenant, background_tasks, product_id=None):
    try:
        return _save(payload, db, tenant, background_tasks, product_id=product_id)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'Este tamanho já está cadastrado. Atualize a lista e edite a marmita existente.')


@router.post('/tamanhos', status_code=201)
def criar_tamanho(payload: TamanhoInput, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('catalogo:administrar'))):
    return _save_safely(payload, db, require_tenant_id(), background_tasks)


@router.put('/tamanhos/{product_id}')
def atualizar_tamanho(product_id: str, payload: TamanhoInput, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user: Usuario = Depends(require_permission('catalogo:administrar'))):
    return _save_safely(payload, db, require_tenant_id(), background_tasks, product_id=product_id)
