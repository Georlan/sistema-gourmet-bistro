"""Explicit, tenant-scoped links between included complements and paid extras."""
import re
import unicodedata
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import GrupoModificador, OpcaoModificador


def _key(name: str) -> str:
    return ' '.join(''.join(c for c in unicodedata.normalize('NFKD', name.casefold()) if not unicodedata.combining(c)).split())


def sync_linked_complements(db: Session, restaurante_id: int, changed_group_id: str) -> list[str]:
    groups = db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == restaurante_id,
        GrupoModificador.grupo_origem_id.isnot(None),
        (GrupoModificador.id == changed_group_id) | (GrupoModificador.grupo_origem_id == changed_group_id),
    ).all()
    changed_groups = []
    for group in groups:
        changed = False
        source = db.query(OpcaoModificador).filter_by(restaurante_id=restaurante_id, grupo_id=group.grupo_origem_id, arquivada=False).all()
        targets = db.query(OpcaoModificador).filter_by(restaurante_id=restaurante_id, grupo_id=group.id, arquivada=False).all()
        linked = {option.opcao_origem_id: option for option in targets if option.opcao_origem_id}
        for original in source:
            target = linked.get(original.id)
            if target is None:
                # Adopt only an unambiguous existing copy; never replace historical IDs.
                matches = [option for option in targets if not option.opcao_origem_id and re.sub(r' adicional$', '', _key(option.nome)) == _key(original.nome)]
                if len(matches) > 1 or sum(_key(option.nome) == _key(original.nome) for option in source) > 1:
                    raise HTTPException(409, "Há nomes duplicados. Identifique as opções antes de sincronizar.")
                target = matches[0] if matches else OpcaoModificador(
                    id=f"opmod-{uuid.uuid4().hex}", restaurante_id=restaurante_id, grupo_id=group.id,
                    preco_adicional=group.preco_novo_ovo if re.search(r'\bovos?\b', _key(original.nome)) else group.preco_novo_adicional,
                )
                if not matches:
                    db.add(target)
                    targets.append(target)
                target.opcao_origem_id = original.id
                changed = True
            changed = changed or target.nome != f"{original.nome} adicional" or target.ativo != original.ativo
            target.nome = f"{original.nome} adicional"
            target.ativo = original.ativo
        source_ids = {option.id for option in source}
        for target in targets:
            if target.opcao_origem_id and target.opcao_origem_id not in source_ids:
                changed = changed or bool(target.ativo)
                target.ativo = False
        if changed:
            changed_groups.append(group.id)
    return changed_groups
