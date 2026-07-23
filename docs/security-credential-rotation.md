# 🔐 Guia de Rotação de Credenciais e Segurança de Migrations

Este documento orienta a rotação manual de credenciais de banco de dados e infraestrutura referentes à migração `997233f4ca30_add_rls_tenant_isolation.py`.

---

## ⚠️ Contexto de Segurança

A migração `997233f4ca30_add_rls_tenant_isolation.py` continha anteriormente um comando `CREATE ROLE koma_app LOGIN PASSWORD '...'` com uma senha hardcoded no código do repositório.

A migração foi atualizada para criar a role `koma_app` apenas com a instrução `NOLOGIN`, servindo como grupo de privilégios e permissões de RLS no PostgreSQL.

---

## 📌 Ações Necessárias para Bancos Já Migrados

**Importante**: Editar um arquivo de migração do Alembic **NÃO altera automaticamente** bancos de dados onde a migração já foi aplicada previamente em ambiente de desenvolvimento, staging ou produção.

Caso o banco de dados de produção ou staging já tenha executado a versão anterior desta migração, execute manualmente os seguintes comandos de administração PostgreSQL (`psql` como superusuário `postgres`):

### 1. Desativar o Login da Role Antiga
```sql
ALTER ROLE koma_app WITH NOLOGIN;
```

### 2. Criar uma Role de Runtime Dedicada com Senha Segura Gerada Externamente
```sql
-- Exemplo de criação de usuário de aplicação runtime com senha segura:
CREATE ROLE koma_runtime WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'UTILIZE_UMA_SENHA_GERADA_E_SEGURA';
GRANT koma_app TO koma_runtime;
```

O proprietário das tabelas e o usuário usado pelo Alembic não podem ser
`koma_runtime`. A aplicação recusa iniciar se `DATABASE_URL` usar uma role
superuser, `BYPASSRLS`, proprietária de tabela tenant ou que não pertença a
`koma_app`.

### 3. Atualizar as variáveis de ambiente do banco
No painel de hospedagem (Supabase / Railway / Render / AWS):
```bash
DATABASE_URL="postgresql://koma_runtime:SENHA_GERADA@host:5432/postgres"
MIGRATION_DATABASE_URL="postgresql://koma_migrator:SENHA_ADMIN@host:5432/postgres"
```

- `DATABASE_URL`: usada exclusivamente pelas requisições e tarefas de runtime.
- `MIGRATION_DATABASE_URL`: credencial administrativa usada no startup apenas
  para executar Alembic/DDL. Mantenha-a no cofre de segredos da plataforma.

A migração `d5e6f7a8b9c0` aplica `FORCE ROW LEVEL SECURITY` a `restaurantes` e a
todas as tabelas com `restaurante_id`. Login, convite e autenticação do agente
de impressão usam funções `SECURITY DEFINER` no schema privado `koma_internal`,
com retorno mínimo, execução revogada de `PUBLIC` e acesso concedido somente à
role `koma_app`. Após a
descoberta do tenant, a transação de lookup é encerrada e uma nova transação é
aberta com `app.current_restaurante_id` configurado via `SET LOCAL`.

---

## 🚫 Regras Gerais de Migrations no Kôma

1. **Nunca insira senhas, tokens ou chaves em arquivos `.py` dentro de `alembic/versions/`**.
2. Todas as contas de login de banco de dados devem ser provisionadas via scripts de infraestrutura ou painéis gerenciados com senhas armazenadas em cofres de segredos (Secret Managers).
