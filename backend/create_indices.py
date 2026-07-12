import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Carregar variáveis do .env
load_dotenv()

db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("DATABASE_URL não configurada no .env")
    exit(1)

print(f"Conectando ao banco de dados...")
engine = create_engine(db_url)

indices = [
    ("ix_pagamentos_cpf_cliente", "pagamentos", "cpf_cliente"),
    ("ix_pagamentos_comanda_id", "pagamentos", "comanda_id"),
    ("ix_caixa_turnos_status", "caixa_turnos", "status"),
    ("ix_caixa_movimentacoes_turno_id", "caixa_movimentacoes", "turno_id"),
    ("ix_itens_lancamento_id", "itens", "lancamento_id")
]

with engine.connect() as conn:
    for idx_name, table, col in indices:
        try:
            sql = f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({col})"
            print(f"Executando: {sql}")
            conn.execute(text(sql))
            conn.commit()
            print(f"Índice {idx_name} criado/verificado com sucesso.")
        except Exception as e:
            print(f"Erro ao criar índice {idx_name}: {e}")

print("Concluído!")
