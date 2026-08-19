from pathlib import Path

path = Path(__file__).resolve().parents[1] / ".github/workflows/migration-baseline-validation.yml"
text = path.read_text(encoding="utf-8")

old_import = """              Item,
              Lancamento,
              Mesa,"""
new_import = """              Item,
              Mesa,"""
if text.count(old_import) != 1:
    raise RuntimeError(f"legacy fixture import marker count={text.count(old_import)}")
text = text.replace(old_import, new_import, 1)

old_launch = """              lancamento = Lancamento(
                  id=\"lan-b1-upgrade\",
                  restaurante_id=rid,
                  comanda_id=comanda.id,
                  garcom_id=uid,
              )
              db.add(lancamento)
              db.flush()
              db.add(Item(
                  id=\"item-b1-upgrade\",
                  restaurante_id=rid,
                  comanda_id=comanda.id,
                  lancamento_id=lancamento.id,"""
new_launch = """              # O fixture representa deliberadamente um schema antigo. Não use o
              # ORM atual para linhas cujo modelo pode ganhar colunas em migrations
              # posteriores, senão o teste de upgrade quebra antes de testar a migration.
              lancamento_id = \"lan-b1-upgrade\"
              db.execute(text(\"\"\"
                  INSERT INTO lancamentos (
                      id, restaurante_id, comanda_id, garcom_id, timestamp
                  ) VALUES (
                      :id, :rid, :comanda_id, :garcom_id, CURRENT_TIMESTAMP
                  )
              \"\"\"), {
                  \"id\": lancamento_id,
                  \"rid\": rid,
                  \"comanda_id\": comanda.id,
                  \"garcom_id\": uid,
              })
              db.flush()
              db.add(Item(
                  id=\"item-b1-upgrade\",
                  restaurante_id=rid,
                  comanda_id=comanda.id,
                  lancamento_id=lancamento_id,"""
if text.count(old_launch) != 1:
    raise RuntimeError(f"legacy Lancamento fixture marker count={text.count(old_launch)}")
text = text.replace(old_launch, new_launch, 1)

old_preserve = """              for label, sql in checks.items():
                  count = conn.execute(text(sql)).scalar_one()
                  assert count == 1, f\"{label} not preserved: {count}\"

              intents = conn.execute(text("""
new_preserve = """              for label, sql in checks.items():
                  count = conn.execute(text(sql)).scalar_one()
                  assert count == 1, f\"{label} not preserved: {count}\"

              launch_origin = conn.execute(text(\"\"\"
                  SELECT origem
                  FROM lancamentos
                  WHERE restaurante_id = 9901 AND id = 'lan-b1-upgrade'
              \"\"\")).scalar_one()
              assert launch_origin == \"desconhecida\", launch_origin

              intents = conn.execute(text("""
if text.count(old_preserve) != 1:
    raise RuntimeError(f"preservation assertion marker count={text.count(old_preserve)}")
text = text.replace(old_preserve, new_preserve, 1)

old_roundtrip = """              assert conn.execute(text(\"SELECT COUNT(*) FROM usuarios WHERE id = 'b1-current-operator'\")).scalar_one() == 1
              print(\"B1.3.1 OK: SmartPOS settlement downgrade/re-upgrade preserved data\")"""
new_roundtrip = """              assert conn.execute(text(\"SELECT COUNT(*) FROM usuarios WHERE id = 'b1-current-operator'\")).scalar_one() == 1
              assert conn.execute(text(\"SELECT origem FROM lancamentos WHERE id = 'lan-b1-upgrade'\")).scalar_one() == \"desconhecida\"
              print(\"B1.3.1 OK: SmartPOS settlement downgrade/re-upgrade preserved data\")"""
if text.count(old_roundtrip) != 1:
    raise RuntimeError(f"roundtrip assertion marker count={text.count(old_roundtrip)}")
text = text.replace(old_roundtrip, new_roundtrip, 1)

path.write_text(text, encoding="utf-8")
print("Migration baseline legacy fixture hardened successfully.")
