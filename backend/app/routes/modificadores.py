import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db, require_tenant_id
from ..models import GrupoModificador, OpcaoModificador, ProdutoGrupoModificador, Produto, Usuario
from ..schemas import (
    GrupoModificadorCreate,
    GrupoModificadorResponse,
    OpcaoModificadorCreate,
    OpcaoModificadorResponse,
)
from ..security import get_current_user

router = APIRouter(
    prefix="/cardapio/modificadores",
    tags=["Modificadores e Complementos"]
)


def _serialize_grupo(grupo: GrupoModificador, db: Session) -> GrupoModificadorResponse:
    opcoes = db.query(OpcaoModificador).filter(
        OpcaoModificador.grupo_id == grupo.id,
        OpcaoModificador.restaurante_id == grupo.restaurante_id,
    ).all()

    produtos_vinculados = db.query(ProdutoGrupoModificador.produto_id).filter(
        ProdutoGrupoModificador.grupo_id == grupo.id,
        ProdutoGrupoModificador.restaurante_id == grupo.restaurante_id,
    ).all()

    return GrupoModificadorResponse(
        id=grupo.id,
        nome=grupo.nome,
        min_selecoes=grupo.min_selecoes,
        max_selecoes=grupo.max_selecoes,
        tipo=grupo.tipo,
        opcoes=[
            OpcaoModificadorResponse(
                id=op.id,
                grupo_id=op.grupo_id,
                nome=op.nome,
                preco_adicional=float(op.preco_adicional or 0.0),
                ativo=op.ativo,
            )
            for op in opcoes
        ],
        produto_ids=[p[0] for p in produtos_vinculados],
    )


@router.get("/grupos", response_model=List[GrupoModificadorResponse])
def listar_grupos(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rest_id = require_tenant_id()
    grupos = db.query(GrupoModificador).filter(GrupoModificador.restaurante_id == rest_id).all()
    return [_serialize_grupo(g, db) for g in grupos]


@router.get("/publico/{restaurante_id}", response_model=List[GrupoModificadorResponse])
def listar_grupos_publico(
    restaurante_id: int,
    db: Session = Depends(get_db),
):
    grupos = db.query(GrupoModificador).filter(GrupoModificador.restaurante_id == restaurante_id).all()
    return [_serialize_grupo(g, db) for g in grupos]


@router.post("/grupos", response_model=GrupoModificadorResponse, status_code=status.HTTP_201_CREATED)
def criar_grupo(
    payload: GrupoModificadorCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rest_id = require_tenant_id()
    grupo_id = f"gmod-{uuid.uuid4().hex[:8]}"

    novo_grupo = GrupoModificador(
        id=grupo_id,
        restaurante_id=rest_id,
        nome=payload.nome.strip(),
        min_selecoes=payload.min_selecoes,
        max_selecoes=payload.max_selecoes,
        tipo=payload.tipo,
    )
    db.add(novo_grupo)
    db.flush()

    if payload.opcoes:
        for op in payload.opcoes:
            nova_op = OpcaoModificador(
                id=f"opmod-{uuid.uuid4().hex[:8]}",
                restaurante_id=rest_id,
                grupo_id=grupo_id,
                nome=op.nome.strip(),
                preco_adicional=op.preco_adicional or 0.0,
                ativo=op.ativo,
            )
            db.add(nova_op)

    if payload.produto_ids:
        for pid in payload.produto_ids:
            vinculo = ProdutoGrupoModificador(
                restaurante_id=rest_id,
                produto_id=pid,
                grupo_id=grupo_id,
            )
            db.add(vinculo)

    db.commit()
    db.refresh(novo_grupo)
    return _serialize_grupo(novo_grupo, db)


@router.put("/grupos/{grupo_id}", response_model=GrupoModificadorResponse)
def atualizar_grupo(
    grupo_id: str,
    payload: GrupoModificadorCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rest_id = require_tenant_id()
    grupo = db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == rest_id,
        GrupoModificador.id == grupo_id,
    ).first()
    if not grupo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grupo não encontrado.")

    grupo.nome = payload.nome.strip()
    grupo.min_selecoes = payload.min_selecoes
    grupo.max_selecoes = payload.max_selecoes
    grupo.tipo = payload.tipo

    # Atualiza opções se enviadas
    if payload.opcoes is not None:
        db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id == rest_id,
            OpcaoModificador.grupo_id == grupo_id,
        ).delete()
        for op in payload.opcoes:
            nova_op = OpcaoModificador(
                id=op.id or f"opmod-{uuid.uuid4().hex[:8]}",
                restaurante_id=rest_id,
                grupo_id=grupo_id,
                nome=op.nome.strip(),
                preco_adicional=op.preco_adicional or 0.0,
                ativo=op.ativo,
            )
            db.add(nova_op)

    # Atualiza vínculos de produtos se enviados
    if payload.produto_ids is not None:
        db.query(ProdutoGrupoModificador).filter(
            ProdutoGrupoModificador.restaurante_id == rest_id,
            ProdutoGrupoModificador.grupo_id == grupo_id,
        ).delete()
        for pid in payload.produto_ids:
            vinculo = ProdutoGrupoModificador(
                restaurante_id=rest_id,
                produto_id=pid,
                grupo_id=grupo_id,
            )
            db.add(vinculo)

    db.commit()
    db.refresh(grupo)
    return _serialize_grupo(grupo, db)


@router.delete("/grupos/{grupo_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_grupo(
    grupo_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    rest_id = require_tenant_id()
    grupo = db.query(GrupoModificador).filter(
        GrupoModificador.restaurante_id == rest_id,
        GrupoModificador.id == grupo_id,
    ).first()
    if not grupo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grupo não encontrado.")

    db.query(ProdutoGrupoModificador).filter(
        ProdutoGrupoModificador.restaurante_id == rest_id,
        ProdutoGrupoModificador.grupo_id == grupo_id,
    ).delete()

    db.query(OpcaoModificador).filter(
        OpcaoModificador.restaurante_id == rest_id,
        OpcaoModificador.grupo_id == grupo_id,
    ).delete()

    db.delete(grupo)
    db.commit()
    return None
