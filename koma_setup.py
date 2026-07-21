#!/usr/bin/env python3
"""
koma_setup.py — Kôma Internal Setup Wizard
============================================
Ferramenta INTERNA para onboarding de novos clientes.
NÃO é exposta ao cliente final.

Uso:
  python koma_setup.py                  → wizard interativo
  python koma_setup.py --from-json setup.json → importa configuração pronta
  python koma_setup.py --export-json    → exporta configuração atual do DB como JSON
  python koma_setup.py --migrate        → aplica migrações de schema sem apagar dados
"""

import argparse
import json
import sys
import os
import uuid
import datetime
import textwrap
from pathlib import Path

# Ensure we can import the app package (works from project root or backend/)
_here = Path(__file__).parent
for candidate in [_here / "backend", _here]:
    if (candidate / "app").is_dir():
        sys.path.insert(0, str(candidate))
        break

from app.database import engine, Base, SessionLocal
from app.models import (
    Usuario, Categoria, Produto, Mesa, ObservacaoPredefinida,
    Motoboy, ConfiguracaoRestaurante, ConfiguracaoIA,
    Insumo, Distribuidor
)
from app.security import get_password_hash

# ─── ANSI Colors ──────────────────────────────────────────────────────────────
R = "\033[0m"
BOLD = "\033[1m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BLUE = "\033[94m"
GRAY = "\033[90m"

def c(color, text): return f"{color}{text}{R}"
def ok(msg): print(c(GREEN, f"  ✔  {msg}"))
def warn(msg): print(c(YELLOW, f"  ⚠  {msg}"))
def err(msg): print(c(RED, f"  ✘  {msg}"))
def info(msg): print(c(CYAN, f"  ℹ  {msg}"))
def header(msg): print(c(BOLD, f"\n{'─'*60}\n  {msg}\n{'─'*60}"))
def ask(prompt, default=""):
    val = input(f"  {CYAN}{prompt}{R} [{GRAY}{default}{R}]: ").strip()
    return val if val else default

def ask_bool(prompt, default=True):
    d = "S/n" if default else "s/N"
    val = input(f"  {CYAN}{prompt}{R} [{d}]: ").strip().lower()
    if not val:
        return default
    return val in ("s", "sim", "y", "yes", "1")

def ask_choice(prompt, choices):
    print(f"  {CYAN}{prompt}{R}")
    for i, ch in enumerate(choices, 1):
        print(f"    {GRAY}{i}{R}. {ch}")
    while True:
        raw = input(f"  Escolha [1-{len(choices)}]: ").strip()
        try:
            idx = int(raw) - 1
            if 0 <= idx < len(choices):
                return choices[idx]
        except ValueError:
            pass
        warn("Opção inválida, tente novamente.")

# ─── SCHEMA MIGRATION (sem Alembic, mas versionado) ──────────────────────────
def migrate_schema():
    """
    Aplica alterações de schema de forma segura (ADD COLUMN) sem apagar dados.
    Idempotente — pode ser rodado várias vezes.
    """
    from sqlalchemy import text, inspect
    header("Verificando schema do banco de dados...")

    insp = inspect(engine)
    
    migrations = [
        # Formato: (tabela, coluna, tipo_sql, valor_default)
        ("categorias", "destino_impressao", "VARCHAR", "'COZINHA'"),
        ("configuracaorestaurante", "plano", "VARCHAR", "'bistro'"),
        ("configuracaorestaurante", "impressao_ativa", "BOOLEAN", "1"),
        ("mesas", "capacidade", "INTEGER", "4"),
    ]

    with engine.connect() as conn:
        for table, col, col_type, default in migrations:
            try:
                cols = [c["name"] for c in insp.get_columns(table)]
            except Exception:
                warn(f"Tabela '{table}' não existe ainda — será criada pelo create_all.")
                continue
            
            if col not in cols:
                try:
                    conn.execute(text(
                        f"ALTER TABLE {table} ADD COLUMN {col} {col_type} DEFAULT {default}"
                    ))
                    conn.commit()
                    ok(f"Coluna '{table}.{col}' adicionada.")
                except Exception as e:
                    warn(f"Não foi possível adicionar '{table}.{col}': {e}")
            else:
                info(f"'{table}.{col}' já existe — pulando.")

    # Ensure all model tables exist (safe, non-destructive)
    Base.metadata.create_all(bind=engine)
    ok("Schema atualizado com sucesso.")


# ─── EXPORT CURRENT CONFIG ───────────────────────────────────────────────────
def export_config(output_path="koma_config_export.json"):
    """Exporta a configuração atual do DB como JSON para replicar em outro ambiente."""
    header("Exportando configuração atual...")
    db = SessionLocal()
    try:
        data = {
            "exported_at": datetime.datetime.now().isoformat(),
            "usuarios": [
                {"id": u.id, "nome": u.nome, "usuario": u.usuario, "role": u.role}
                for u in db.query(Usuario).all()
            ],
            "categorias": [
                {
                    "id": c.id,
                    "nome": c.nome,
                    "destino_impressao": c.destino_impressao,
                    "observacoes": [o.texto for o in c.observacoes_predefinidas]
                }
                for c in db.query(Categoria).all()
            ],
            "mesas": [
                {"id": m.id, "capacidade": m.capacidade, "nome": m.nome}
                for m in db.query(Mesa).all()
            ],
            "motoboys": [
                {"id": mb.id, "nome": mb.nome, "telefone": mb.telefone}
                for mb in db.query(Motoboy).all()
            ],
            "produtos": [
                {
                    "id": p.id,
                    "nome": p.nome,
                    "categoria_id": p.categoria_id,
                    "preco": p.preco,
                    "descricao": p.descricao,
                    "imagem": p.imagem,
                    "ativo": p.ativo
                }
                for p in db.query(Produto).all()
            ],
            "insumos": [
                {
                    "id": i.id,
                    "nome": i.nome,
                    "estoque_atual": i.estoque_atual,
                    "estoque_minimo": i.estoque_minimo,
                    "estoque_maximo": i.estoque_maximo,
                    "unidade_medida": i.unidade_medida,
                    "preco_medio_custo": i.preco_medio_custo
                }
                for i in db.query(Insumo).all()
            ],
            "distribuidores": [
                {
                    "id": d.id,
                    "nome_fantasia": d.nome_fantasia,
                    "razao_social": d.razao_social,
                    "cnpj": d.cnpj,
                    "lead_time_dias": d.lead_time_dias
                }
                for d in db.query(Distribuidor).all()
            ],
        }
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        ok(f"Configuração exportada para: {output_path}")
        return data
    finally:
        db.close()


# ─── IMPORT FROM JSON ─────────────────────────────────────────────────────────
def import_from_json(json_path, reset_db=False):
    """Importa configuração de um arquivo JSON (para onboarding rápido de cliente)."""
    header(f"Importando configuração de '{json_path}'...")
    
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    if reset_db:
        warn("ATENÇÃO: Banco será completamente recriado! Todos os dados atuais serão apagados.")
        confirm = input("  Digite 'CONFIRMAR' para continuar: ").strip()
        if confirm != "CONFIRMAR":
            err("Operação cancelada.")
            return
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        ok("Banco recriado.")
    else:
        migrate_schema()

    db = SessionLocal()
    try:
        # Usuários
        if "usuarios" in data:
            for u in data["usuarios"]:
                if not db.query(Usuario).filter_by(id=u["id"]).first():
                    senha = u.get("senha", "koma2025")
                    db.add(Usuario(
                        id=u["id"], nome=u["nome"], usuario=u["usuario"],
                        senha_hash=get_password_hash(senha), role=u["role"]
                    ))
                    ok(f"Usuário: {u['nome']} ({u['role']})")

        # Categorias + Observações
        if "categorias" in data:
            for cat in data["categorias"]:
                if not db.query(Categoria).filter_by(id=cat["id"]).first():
                    db.add(Categoria(
                        id=cat["id"], nome=cat["nome"],
                        destino_impressao=cat.get("destino_impressao", "COZINHA")
                    ))
                    for obs_text in cat.get("observacoes", []):
                        db.add(ObservacaoPredefinida(categoria_id=cat["id"], texto=obs_text))
                    ok(f"Categoria: {cat['nome']} ({cat.get('destino_impressao', 'COZINHA')})")

        # Mesas
        if "mesas" in data:
            for m in data["mesas"]:
                if not db.query(Mesa).filter_by(id=m["id"]).first():
                    db.add(Mesa(id=m["id"], capacidade=m.get("capacidade", 4), nome=m.get("nome")))
            ok(f"{len(data['mesas'])} mesas importadas.")

        # Motoboys
        if "motoboys" in data:
            for mb in data["motoboys"]:
                if not db.query(Motoboy).filter_by(id=mb["id"]).first():
                    db.add(Motoboy(id=mb["id"], nome=mb["nome"], telefone=mb.get("telefone", ""), ativo=True))
            ok(f"{len(data['motoboys'])} motoboys importados.")

        # Produtos
        if "produtos" in data:
            for p in data["produtos"]:
                if not db.query(Produto).filter_by(id=p["id"]).first():
                    db.add(Produto(
                        id=p["id"],
                        nome=p["nome"],
                        categoria_id=p["categoria_id"],
                        preco=p["preco"],
                        descricao=p.get("descricao", ""),
                        imagem=p.get("imagem", ""),
                        ativo=p.get("ativo", True)
                    ))
            ok(f"{len(data['produtos'])} produtos importados.")

        # Insumos
        if "insumos" in data:
            for ins in data["insumos"]:
                if not db.query(Insumo).filter_by(id=ins["id"]).first():
                    db.add(Insumo(
                        id=ins["id"],
                        nome=ins["nome"],
                        estoque_atual=ins.get("estoque_atual", 0.0),
                        estoque_minimo=ins.get("estoque_minimo", 10.0),
                        estoque_maximo=ins.get("estoque_maximo", 50.0),
                        unidade_medida=ins.get("unidade_medida", "un"),
                        preco_medio_custo=ins.get("preco_medio_custo", 0.0)
                    ))
            ok(f"{len(data['insumos'])} insumos importados.")

        # Distribuidores
        if "distribuidores" in data:
            for d in data["distribuidores"]:
                if not db.query(Distribuidor).filter_by(id=d["id"]).first():
                    db.add(Distribuidor(
                        id=d["id"],
                        nome_fantasia=d["nome_fantasia"],
                        razao_social=d.get("razao_social"),
                        cnpj=d.get("cnpj"),
                        lead_time_dias=d.get("lead_time_dias", 3)
                    ))
            ok(f"{len(data['distribuidores'])} distribuidores importados.")

        db.commit()
        ok("Importação concluída com sucesso!")
    except Exception as e:
        db.rollback()
        err(f"Erro durante importação: {e}")
        raise
    finally:
        db.close()


# ─── INTERACTIVE WIZARD ───────────────────────────────────────────────────────
def interactive_wizard():
    print(f"""
{BOLD}{CYAN}╔══════════════════════════════════════════════════╗
║         KÔMA — INTERNAL SETUP WIZARD             ║
║       Ferramenta de onboarding de clientes       ║
╚══════════════════════════════════════════════════╝{R}
""")
    print(c(YELLOW, "  Esta é uma ferramenta interna. Não compartilhe com clientes.\n"))

    mode = ask_choice("O que deseja fazer?", [
        "Configurar novo cliente (wizard completo)",
        "Editar categorias e destinos de impressão",
        "Editar observações predefinidas por categoria",
        "Gerenciar usuários (garçons, caixas, admin)",
        "Gerenciar mesas",
        "Exportar configuração atual (JSON)",
        "Aplicar migrações de schema (sem apagar dados)",
        "Sair",
    ])

    if mode == "Sair":
        print("\n  Até logo!\n")
        return

    if mode == "Aplicar migrações de schema (sem apagar dados)":
        migrate_schema()
        return

    if mode == "Exportar configuração atual (JSON)":
        path = ask("Caminho do arquivo", "koma_config_export.json")
        export_config(path)
        return

    if mode == "Configurar novo cliente (wizard completo)":
        wizard_novo_cliente()
        return

    if mode == "Editar categorias e destinos de impressão":
        wizard_editar_categorias()
        return

    if mode == "Editar observações predefinidas por categoria":
        wizard_editar_observacoes()
        return

    if mode == "Gerenciar usuários (garçons, caixas, admin)":
        wizard_usuarios()
        return

    if mode == "Gerenciar mesas":
        wizard_mesas()
        return


def wizard_novo_cliente():
    header("Configurar Novo Cliente")
    
    nome_restaurante = ask("Nome do restaurante", "Restaurante Exemplo")
    nicho = ask_choice("Nicho do restaurante", ["hamburgueria", "bagueteria", "pastelaria", "bistrô", "pizzaria", "outro"])
    num_mesas = int(ask("Número de mesas", "10"))
    delivery_ativo = ask_bool("Ativar módulo de delivery?", False)
    modo_exclusivo_salao = not delivery_ativo

    info(f"Configurando '{nome_restaurante}' ({nicho})...")

    reset = ask_bool("Recriar banco do zero? (APAGA TUDO)", False)
    
    if reset:
        confirm = input(c(RED, "  ⚠  Digite 'CONFIRMAR' para apagar tudo: ")).strip()
        if confirm != "CONFIRMAR":
            warn("Operação cancelada.")
            return
        Base.metadata.drop_all(bind=engine)
    
    Base.metadata.create_all(bind=engine)
    migrate_schema()

    db = SessionLocal()
    try:
        # Usuários padrão
        header("Usuários Padrão")
        usuarios_padrao = [
            {"id": "a-01", "nome": "Admin", "usuario": os.getenv("DEFAULT_ADMIN_USER", "admin"), "senha": os.getenv("DEFAULT_ADMIN_PASS", secrets.token_hex(8)), "role": "admin"},
            {"id": "c-01", "nome": "Caixa 1", "usuario": os.getenv("DEFAULT_CAIXA_USER", "caixa1"), "senha": os.getenv("DEFAULT_CAIXA_PASS", secrets.token_hex(8)), "role": "caixa"},
            {"id": "g-01", "nome": "Garçom 1", "usuario": os.getenv("DEFAULT_GARCOM_USER", "garcom1"), "senha": os.getenv("DEFAULT_GARCOM_PASS", secrets.token_hex(8)), "role": "garcom"},
        ]
        print(c(GRAY, "  Usuários padrão que serão criados:"))
        for u in usuarios_padrao:
            print(f"    {u['role']:8} → {u['usuario']} / {u['senha']}")
        
        adicionar_mais = ask_bool("Adicionar mais usuários agora?", False)
        if adicionar_mais:
            while True:
                nome_u = ask("Nome do usuário (ENTER para finalizar)", "")
                if not nome_u:
                    break
                login = ask("Login", nome_u.lower().replace(" ", ""))
                senha = ask("Senha", "koma2025")
                role = ask_choice("Função", ["garcom", "caixa", "admin"])
                uid = f"{role[0]}-{uuid.uuid4().hex[:4]}"
                usuarios_padrao.append({"id": uid, "nome": nome_u, "usuario": login, "senha": senha, "role": role})

        for u in usuarios_padrao:
            if not db.query(Usuario).filter_by(id=u["id"]).first():
                db.add(Usuario(
                    id=u["id"], nome=u["nome"], usuario=u["usuario"],
                    senha_hash=get_password_hash(u["senha"]), role=u["role"]
                ))
        ok(f"{len(usuarios_padrao)} usuários configurados.")

        # Mesas
        header("Configuração de Mesas")
        for i in range(1, num_mesas + 1):
            if not db.query(Mesa).filter_by(id=i).first():
                db.add(Mesa(id=i, capacidade=4, nome=None))
        ok(f"{num_mesas} mesas criadas.")

        # Categorias
        header("Configuração de Categorias")
        info("Agora configure as categorias e seus destinos de impressão.")
        info("Destinos: COZINHA | BAR | NENHUM")
        print()
        
        categorias = []
        while True:
            nome_cat = ask("Nome da categoria (ENTER para finalizar)", "")
            if not nome_cat:
                break
            cat_id = "cat-" + nome_cat.lower().replace(" ", "-").replace("ã", "a").replace("ç", "c")
            destino = ask_choice(f"Destino de impressão para '{nome_cat}'", ["COZINHA", "BAR", "NENHUM"])
            
            # Observações
            obs_list = []
            info(f"Observações predefinidas para '{nome_cat}' (ENTER p/ pular cada uma):")
            while True:
                obs = ask("Adicionar observação", "")
                if not obs:
                    break
                obs_list.append(obs)
            
            categorias.append({"id": cat_id, "nome": nome_cat, "destino": destino, "observacoes": obs_list})
            ok(f"Categoria '{nome_cat}' adicionada ({destino})")

        for cat in categorias:
            if not db.query(Categoria).filter_by(id=cat["id"]).first():
                db.add(Categoria(id=cat["id"], nome=cat["nome"], destino_impressao=cat["destino"]))
                for obs in cat["observacoes"]:
                    db.add(ObservacaoPredefinida(categoria_id=cat["id"], texto=obs))

        ok(f"{len(categorias)} categorias configuradas.")

        # Config do Restaurante
        if not db.query(ConfiguracaoRestaurante).first():
            db.add(ConfiguracaoRestaurante(
                nicho=nicho,
                mapa_mesas_ativo=True,
                delivery_ativo=delivery_ativo,
                taxa_servico_ativa=True,
                taxa_servico_padrao=10.0,
                unificar_vias_delivery=False,
                modo_exclusivo_salao=modo_exclusivo_salao
            ))
        
        if not db.query(ConfiguracaoIA).first():
            db.add(ConfiguracaoIA(
                permitir_descontos=False, desconto_maximo=10.0,
                permitir_upsell=True, tom_de_voz="direto", teto_interacoes=5
            ))

        db.commit()
        
        header("✅ Setup Concluído!")
        ok(f"Restaurante: {nome_restaurante}")
        ok(f"Mesas: {num_mesas}")
        ok(f"Categorias: {len(categorias)}")
        ok(f"Usuários: {len(usuarios_padrao)}")
        ok(f"Delivery: {'Ativo' if delivery_ativo else 'Inativo'}")
        print()
        info("Exporte a configuração com --export-json para replicar em outro ambiente.")
        
    except Exception as e:
        db.rollback()
        err(f"Erro durante setup: {e}")
        raise
    finally:
        db.close()


def wizard_editar_categorias():
    header("Editar Categorias e Destinos de Impressão")
    db = SessionLocal()
    try:
        categorias = db.query(Categoria).all()
        if not categorias:
            warn("Nenhuma categoria cadastrada.")
            return
        
        print(f"\n  {'ID':<30} {'NOME':<30} {'DESTINO'}")
        print(f"  {'─'*30} {'─'*30} {'─'*10}")
        for cat in categorias:
            d = cat.destino_impressao or "COZINHA"
            color = GREEN if d == "COZINHA" else (BLUE if d == "BAR" else GRAY)
            print(f"  {cat.id:<30} {cat.nome:<30} {color}{d}{R}")
        
        print()
        cat_id = ask("ID da categoria para editar (ENTER para sair)", "")
        if not cat_id:
            return
        
        cat = db.query(Categoria).filter_by(id=cat_id).first()
        if not cat:
            err(f"Categoria '{cat_id}' não encontrada.")
            return
        
        novo_nome = ask(f"Novo nome", cat.nome)
        novo_destino = ask_choice("Destino de impressão", ["COZINHA", "BAR", "NENHUM"])
        
        cat.nome = novo_nome
        cat.destino_impressao = novo_destino
        db.commit()
        ok(f"Categoria '{novo_nome}' atualizada → {novo_destino}")
        
        mais = ask_bool("Editar outra categoria?", False)
        if mais:
            wizard_editar_categorias()
    finally:
        db.close()


def wizard_editar_observacoes():
    header("Editar Observações Predefinidas")
    db = SessionLocal()
    try:
        categorias = db.query(Categoria).all()
        for i, cat in enumerate(categorias, 1):
            obs = [o.texto for o in cat.observacoes_predefinidas]
            obs_str = ", ".join(obs) if obs else c(GRAY, "(nenhuma)")
            print(f"  {i:2}. {cat.nome:<30} {obs_str}")
        
        print()
        cat_id = ask("ID ou nome da categoria para editar", "")
        if not cat_id:
            return
        
        cat = db.query(Categoria).filter(
            (Categoria.id == cat_id) | (Categoria.nome == cat_id)
        ).first()
        if not cat:
            err(f"Categoria não encontrada: '{cat_id}'")
            return
        
        header(f"Observações: {cat.nome}")
        obs_atuais = db.query(ObservacaoPredefinida).filter_by(categoria_id=cat.id).all()
        
        for i, obs in enumerate(obs_atuais, 1):
            print(f"    {i}. {obs.texto}")
        
        acao = ask_choice("O que fazer?", [
            "Adicionar nova observação",
            "Remover observação existente",
            "Substituir todas (limpa e recria)",
            "Cancelar"
        ])
        
        if acao == "Adicionar nova observação":
            texto = ask("Texto da observação")
            if texto:
                db.add(ObservacaoPredefinida(categoria_id=cat.id, texto=texto))
                db.commit()
                ok(f"Observação '{texto}' adicionada.")
        
        elif acao == "Remover observação existente":
            idx = int(ask("Número da observação para remover", "1")) - 1
            if 0 <= idx < len(obs_atuais):
                db.delete(obs_atuais[idx])
                db.commit()
                ok(f"Observação '{obs_atuais[idx].texto}' removida.")
        
        elif acao == "Substituir todas (limpa e recria)":
            for obs in obs_atuais:
                db.delete(obs)
            print(c(CYAN, "  Digite as novas observações (ENTER vazio para finalizar):"))
            while True:
                texto = ask("Observação")
                if not texto:
                    break
                db.add(ObservacaoPredefinida(categoria_id=cat.id, texto=texto))
            db.commit()
            ok("Observações substituídas.")
    finally:
        db.close()


def wizard_usuarios():
    header("Gerenciar Usuários")
    db = SessionLocal()
    try:
        usuarios = db.query(Usuario).all()
        print(f"\n  {'ID':<10} {'NOME':<20} {'LOGIN':<15} {'ROLE'}")
        print(f"  {'─'*10} {'─'*20} {'─'*15} {'─'*10}")
        for u in usuarios:
            role_color = RED if u.role == "admin" else (CYAN if u.role == "caixa" else GREEN)
            print(f"  {u.id:<10} {u.nome:<20} {u.usuario:<15} {role_color}{u.role}{R}")
        
        print()
        acao = ask_choice("Ação", ["Adicionar usuário", "Redefinir senha", "Remover usuário", "Cancelar"])
        
        if acao == "Adicionar usuário":
            nome = ask("Nome completo")
            login = ask("Login (sem espaços)")
            senha = ask("Senha", "koma2025")
            role = ask_choice("Função", ["garcom", "caixa", "admin"])
            uid = f"{role[0]}-{uuid.uuid4().hex[:4]}"
            
            if db.query(Usuario).filter_by(usuario=login).first():
                err(f"Login '{login}' já existe.")
            else:
                db.add(Usuario(id=uid, nome=nome, usuario=login, senha_hash=get_password_hash(senha), role=role))
                db.commit()
                ok(f"Usuário '{nome}' criado (ID: {uid})")
        
        elif acao == "Redefinir senha":
            login = ask("Login do usuário")
            u = db.query(Usuario).filter_by(usuario=login).first()
            if not u:
                err(f"Usuário '{login}' não encontrado.")
            else:
                nova_senha = ask("Nova senha")
                u.senha_hash = get_password_hash(nova_senha)
                db.commit()
                ok(f"Senha de '{login}' redefinida.")
        
        elif acao == "Remover usuário":
            login = ask("Login do usuário para remover")
            u = db.query(Usuario).filter_by(usuario=login).first()
            if not u:
                err(f"Usuário '{login}' não encontrado.")
            else:
                confirm = ask_bool(f"Confirmar remoção de '{u.nome}'?", False)
                if confirm:
                    db.delete(u)
                    db.commit()
                    ok(f"Usuário '{u.nome}' removido.")
    finally:
        db.close()


def wizard_mesas():
    header("Gerenciar Mesas")
    db = SessionLocal()
    try:
        mesas = db.query(Mesa).order_by(Mesa.id).all()
        print(f"\n  Total de mesas: {len(mesas)}")
        for m in mesas:
            nome_display = m.nome if m.nome else f"Mesa {m.id}"
            print(f"  [{m.id:3}] {nome_display:<25} capacidade: {m.capacidade}")
        
        print()
        acao = ask_choice("Ação", [
            "Adicionar mesa",
            "Editar nome/capacidade de uma mesa",
            "Remover mesa",
            "Adicionar bloco de mesas (ex: 10 a 20)",
            "Cancelar"
        ])
        
        if acao == "Adicionar mesa":
            mesa_id = int(ask("ID da mesa"))
            if db.query(Mesa).filter_by(id=mesa_id).first():
                err(f"Mesa {mesa_id} já existe.")
            else:
                cap = int(ask("Capacidade", "4"))
                nome = ask("Nome personalizado (opcional)", "")
                db.add(Mesa(id=mesa_id, capacidade=cap, nome=nome or None))
                db.commit()
                ok(f"Mesa {mesa_id} criada.")
        
        elif acao == "Editar nome/capacidade de uma mesa":
            mesa_id = int(ask("Número da mesa"))
            m = db.query(Mesa).filter_by(id=mesa_id).first()
            if not m:
                err(f"Mesa {mesa_id} não encontrada.")
            else:
                novo_nome = ask("Novo nome (deixe vazio para padrão)", m.nome or "")
                nova_cap = int(ask("Nova capacidade", str(m.capacidade)))
                m.nome = novo_nome or None
                m.capacidade = nova_cap
                db.commit()
                ok(f"Mesa {mesa_id} atualizada.")
        
        elif acao == "Remover mesa":
            mesa_id = int(ask("Número da mesa"))
            m = db.query(Mesa).filter_by(id=mesa_id).first()
            if not m:
                err(f"Mesa {mesa_id} não encontrada.")
            else:
                confirm = ask_bool(f"Confirmar remoção da Mesa {mesa_id}?", False)
                if confirm:
                    db.delete(m)
                    db.commit()
                    ok(f"Mesa {mesa_id} removida.")
        
        elif acao == "Adicionar bloco de mesas (ex: 10 a 20)":
            inicio = int(ask("Mesa inicial"))
            fim = int(ask("Mesa final"))
            cap = int(ask("Capacidade padrão", "4"))
            criadas = 0
            for i in range(inicio, fim + 1):
                if not db.query(Mesa).filter_by(id=i).first():
                    db.add(Mesa(id=i, capacidade=cap, nome=None))
                    criadas += 1
            db.commit()
            ok(f"{criadas} mesas criadas (de {inicio} a {fim}).")
    finally:
        db.close()


# ─── PRINT QUEUE MONITOR ──────────────────────────────────────────────────────
def monitor_print_queue():
    """Exibe os jobs de impressão pendentes na fila."""
    from app.config import settings
    jobs_dir = settings.PRINT_JOBS_DIR
    header(f"Fila de Impressão — {jobs_dir}")
    
    if not os.path.exists(jobs_dir):
        warn("Diretório de jobs não encontrado. Servidor não foi iniciado ainda.")
        return
    
    jobs = sorted(os.listdir(jobs_dir))
    if not jobs:
        ok("Fila vazia — nenhum job pendente.")
        return
    
    print(f"\n  {len(jobs)} job(s) na fila:\n")
    for job in jobs:
        path = os.path.join(jobs_dir, job)
        size = os.path.getsize(path)
        print(f"  📄 {job} ({size} bytes)")
    
    acao = ask_choice("Ação", ["Visualizar job", "Limpar fila", "Sair"])
    if acao == "Visualizar job":
        nome = ask("Nome do arquivo")
        path = os.path.join(jobs_dir, nome)
        if os.path.exists(path):
            print("\n" + "─" * 48)
            with open(path, "r", encoding="utf-8") as f:
                print(f.read())
            print("─" * 48)
        else:
            err("Arquivo não encontrado.")
    elif acao == "Limpar fila":
        confirm = ask_bool("Remover todos os jobs da fila?", False)
        if confirm:
            for job in jobs:
                os.remove(os.path.join(jobs_dir, job))
            ok(f"{len(jobs)} jobs removidos.")


# ─── MAIN ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Kôma Internal Setup Wizard",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""
        Exemplos:
          python koma_setup.py                        # Wizard interativo
          python koma_setup.py --migrate              # Migrar schema sem apagar dados
          python koma_setup.py --export-json          # Exportar config atual
          python koma_setup.py --from-json setup.json # Importar config de JSON
          python koma_setup.py --print-queue          # Monitorar fila de impressão
        """)
    )
    parser.add_argument("--migrate", action="store_true", help="Aplicar migrações de schema sem apagar dados")
    parser.add_argument("--export-json", metavar="PATH", nargs="?", const="koma_config_export.json", help="Exportar configuração como JSON")
    parser.add_argument("--from-json", metavar="PATH", help="Importar configuração de um arquivo JSON")
    parser.add_argument("--reset", action="store_true", help="Recriar banco do zero ao importar JSON (APAGA TUDO)")
    parser.add_argument("--print-queue", action="store_true", help="Monitorar fila de impressão")
    
    args = parser.parse_args()
    
    if args.migrate:
        migrate_schema()
    elif args.export_json:
        export_config(args.export_json)
    elif args.from_json:
        import_from_json(args.from_json, reset_db=args.reset)
    elif args.print_queue:
        monitor_print_queue()
    else:
        interactive_wizard()
