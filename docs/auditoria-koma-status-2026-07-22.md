# Status da remediação da auditoria Kôma

Fonte: `Relatorio_Auditoria_KOMA_2026-07-22.docx`, auditado originalmente no
commit `bfcee7f`. Este arquivo registra o que foi confirmado no código atual e
o que ainda falta para atender aos critérios de saída do relatório.

Atualizado em 22/07/2026. Referência publicada mais recente: `251e2fe` em
`main`. A correção P0-02 descrita abaixo ainda aguarda rollout coordenado entre
Supabase e Railway.

## Resumo dos P0

| ID | Estado | O que já foi confirmado | O que falta |
|---|---|---|---|
| P0-01 — chaves multi-tenant | Resolvido em `main` | PKs técnicas, unicidades por restaurante, FKs compostas e testes de IDs de negócio repetidos entre tenants (`251e2fe`). | Executar a migração no PostgreSQL de produção durante o próximo deploy e validar o snapshot pós-migração. |
| P0-02 — cadeia RLS | Em rollout | Correção preparada: `FORCE RLS` dinâmico para todas as tabelas tenant, `SET LOCAL` em toda transação, sentinela bloqueante para sessão pública, tenant explícito em tarefas background, funções privadas mínimas para login/convite/agente e separação entre credenciais de runtime e migração. Testes locais cobrem dois restaurantes e background jobs. | Criar a role `koma_runtime` sem `SUPERUSER`/`BYPASSRLS` e não proprietária; configurar `DATABASE_URL` e `MIGRATION_DATABASE_URL` no Railway; publicar; provar no PostgreSQL zero leitura/escrita cruzada por ORM, SQL bruto e job. |
| P0-03 — autorização por cargo | Resolvido no código | `require_roles`, bloqueio de conta inativa, `force` restrito e reabertura/relatórios/catálogos sensíveis com matriz de cargos (`a3ddf03`, `3f89869`). Testes negativos retornam 403. | Corrigir a expectativa antiga de `test_orders.py::test_flow`, que ainda espera que garçom reabra comanda; ampliar a matriz documentada para todos os endpoints administrativos. |
| P0-04 — token do agente no Git | Parcial | `koma-print-agent/config.json` foi removido do índice e incluído no `.gitignore` (`897a4dd`). | Revogar/rotacionar o token no ambiente real; confirmar que caixas usam o novo token; remover o segredo do histórico Git com janela coordenada e secret scan posterior. O arquivo antigo ainda aparece no histórico. |
| P0-05 — migrações | Resolvido no código | Migração `e8d7…` usa batch mode; startup falha em produção quando Alembic falha; upgrade limpo até o head atual passou em SQLite (`4198e7c`). | Validar upgrade de snapshot e banco vazio em PostgreSQL de staging; depois remover o DDL emergencial residual do startup. |
| P0-06 — cardápio, cashback, OTP e IA | Parcial | Cashback deixou de ser gravado diretamente pelo navegador; consulta pré-OTP mascara PII; OTP usa gerador criptográfico, TTL, uso único, intervalo de reenvio e limite de tentativas (`3635466`). | Persistir OTP/rate limit em Redis ou armazenamento compartilhado, armazenar somente hash do OTP, elevar entropia, limitar o endpoint público de IA e adicionar idempotência ao pedido online. Validar que nenhuma mutação de saldo é possível pelo cliente. |
| P0-07 — impressão | Resolvido no código; validação PostgreSQL pendente | Claim usa `UPDATE` condicional e retorna conflito ao segundo agente; recuperação de lease travado e testes de dois agentes existem (`b7412d5`). A autenticação pré-tenant e sessões do agente são fechadas pela correção P0-02. | Rodar teste concorrente real em PostgreSQL com dois agentes e confirmar exatamente um claim/impressão e recuperação após abandono. |

## Ordem imediata

1. Concluir o rollout seguro do P0-02 no Supabase/Railway e executar os testes
   PostgreSQL pós-deploy.
2. Encerrar o P0-04 com rotação do token, atualização dos agentes instalados e
   limpeza coordenada do histórico.
3. Encerrar o P0-06 com estado distribuído para OTP/rate limit, hash do código,
   idempotência de pedido e limite de IA.
4. Executar o teste concorrente PostgreSQL que encerra o critério operacional
   do P0-07.

## Backlog após os P0

| ID | Prioridade | Pendência principal |
|---|---|---|
| 08 | P1 | Migrar dinheiro de `Float` para `Numeric(12,2)` ou centavos inteiros e reconciliar cálculos. |
| 09 | P1 | Reduzir duração/armazenamento de JWT, restringir CORS e terminar a sanitização de respostas. |
| 10 | P1 | Adicionar idempotência às mutações críticas e substituir sequências `max+1`. |
| 11 | P1 | Tirar estado de OTP/WebSocket da memória do processo e remover saúde mockada do super-admin. |
| 12 | P1 | Paginar/agregar no SQL, eliminar N+1 restantes e reduzir o bundle inicial/frontend monolítico. |
| 13 | P1 | Versionar CI com Postgres/RLS, migrações, testes, build, auditoria e secret scan. |
| 14 | P2 | Consolidar impressão, remover artefatos versionados, atualizar README e travar dependências Python. |

## Evidências de teste atuais

- Testes focados de tenant, autorização e impressão: 21 aprovados.
- Suíte backend: 137 aprovados funcionalmente; permanece uma falha de baseline
  em `test_orders.py::test_flow` por expectativa incompatível com o RBAC já
  corrigido. Dois testes de upload passam quando o proxy SOCKS do ambiente de
  execução é removido.
- Alembic em SQLite vazio: upgrade até `d5e6f7a8b9c0` aprovado localmente.
- Supabase de produção, inspeção somente leitura: há tabelas tenant recentes
  sem `FORCE RLS`, a role administrativa possui `BYPASSRLS` e ainda não existe
  uma role dedicada `koma_runtime`. Nenhum DDL de produção foi aplicado durante
  essa inspeção.
