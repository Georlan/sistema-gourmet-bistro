# Publicar com restaurantes em operação

O tenant 6 recebe atualizações normais e migrations compatíveis. É proibido usá-lo
como QA, para seed, reset, pedido/pagamento/impressão artificial ou ensaio de carga.
Desenvolver e validar em ambiente isolado antes de publicar para todos.

1. Branch + PR pequeno; descrever impacto operacional, compatibilidade N/N-1,
   contenção e rollback. Feature crítica nova começa desligada e exige controle
   backend; deploy de código não implica liberação para todos.
2. Testar localmente com banco isolado e em Koma Homologacao. O check obrigatório
   `Merge verdict` deve passar no SHA atual, com base atualizada. Conferir também
   todos os checks relevantes disparados; não fazer merge com falha relevante.
3. Schema: expandir primeiro; campos opcionais/default no servidor, manter rotas,
   DTOs e eventos antigos. Backfill limitado separado do deploy. Remover/renomear
   somente após encerrar a janela de clientes antigos e revisar rollout/rollback.
   Não editar revisões históricas. `check_migration_safety.py --base <base-sha>`
   examina upgrades novos via AST (não executa migrations). SQL dinâmico/raw,
   backfill e mudanças destrutivas exigem exceção em
   `migration-safety-exceptions.json`, com SHA256 exato do arquivo, motivo,
   compatibilidade, rollback e link de PR de revisão. O revisor deve conferir a
   exceção; o linter detecta riscos óbvios e não prova compatibilidade ou duração.
4. Antes do merge, conferir pré-deploy Railway: somente migrations revisadas,
   nunca reset/seed. Depois, validar backend e frontend separadamente: deployment
   SUCCESS + SHA da API; Cloudflare + `/meta.json` e assets. Executar
   `scripts/production-smoke.mjs` com SHAs esperados. O backend pode manter SHA
   anterior se o commit só muda frontend, pois seu watch path é `/backend/**`.
5. Smoke público usa apenas GET/OPTIONS. Transação sintética exige QA oficialmente
   identificado e isolado, sem integrações reais; nunca inferir QA pelo nome/ID.
   Sem QA validado, registrar a validação transacional como NÃO VERIFICADO.
6. Monitorar erros, latência e `db_pool` nos logs. `db_pool_timeout` prova timeout
   de aquisição; `db_pool_slow_acquire` mede fila + conexão + pre-ping, não apenas
   fila. Contadores são locais ao processo e reiniciam com ele. Correlacionar
   janela, instância, ocupação e queries/locks antes de alterar tamanho do pool.

P0 durante operação: conter → desligar a feature se disponível → branch hotfix →
correção mínima → testes focais + CI → merge verde → conferir ambos os deploys →
validar QA → monitorar produção. Sem refactor paralelo. Rollback de código somente
se compatível com o schema atual; não executar downgrade destrutivo automático.

O reset legado de primeiro dia está desativado. Qualquer reset futuro é outro
escopo: exige marcador QA, ID explícito, allowlist, dry-run revisado, transação,
auditoria e confirmação. Não reativar o reset antigo por conveniência.
