"""Reconhece tamanhos antigos sem alterar catálogo em leituras."""
from .catalog_addons import normalize_catalog_name
from .models import Categoria, Produto
from .restaurant_profile_models import RestauranteOperationProfile


def enabled(db, tenant):
    profile = db.query(RestauranteOperationProfile).filter_by(restaurante_id=tenant).first()
    return bool(profile and profile.profile_key == 'marmitaria')


def size_key(name):
    name = normalize_catalog_name(name)
    for prefix in ('quentinha-', 'marmita-'):
        if name.startswith(prefix):
            name = name[len(prefix):]
            break
    return {'pequena': 'p', 'pequeno': 'p', 'media': 'm', 'medio': 'm', 'grande': 'g'}.get(name, name)


def size_category(category):
    return bool(category and (category.marmitaria_tamanho or normalize_catalog_name(category.nome) in
                             {'marmita', 'marmitas', 'quentinha', 'quentinhas'}))


def catalog_sizes(db, tenant):
    rows = db.query(Produto, Categoria).join(Categoria, (Categoria.id == Produto.categoria_id) &
                                           (Categoria.restaurante_id == Produto.restaurante_id)).filter(
        Produto.restaurante_id == tenant).order_by(Produto.nome, Produto.id).all()
    return [(p, c, p.marmitaria_tamanho or size_key(p.nome)) for p, c in rows
            if p.marmitaria_tamanho or (size_category(c) and
               (c.marmitaria_tamanho or size_key(p.nome) in {'p', 'm', 'g'}))]
