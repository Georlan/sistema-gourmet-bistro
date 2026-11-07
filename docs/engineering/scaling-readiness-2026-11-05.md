# Prontidao para escala — auditoria somente leitura (2026-11-05)

## Escopo e limites da evidencia

Fontes: Railway producao (deploys, HTTP, logs, CPU/RAM em 7 dias), Supabase producao (consultas SELECT sobre estatisticas e contagens agregadas, Performance/Security Advisors), codigo e workflows GitHub. Nenhum pedido, pagamento, credencial, configuracao ou banco foi alterado; nao houve teste de carga em producao. Informacoes de planos/variaveis de ambiente foram fornecidas com valores ocultos pela API; nao assumir que valores historicamente documentados continuam identicos.

**Veredito:** capacidade disponivel de CPU/RAM, mas orcamento de conexoes praticamente esgotado em rollout; necessidades maiores sao confiabilidade transitoria, economizar polling em massa e comprovacao isolada de throughput.

## Incidente de conexoes (prioridade P0)

- Em 2026-11-05 05:43:52–05:43:53 UTC, o Supavisor recusou conexoes em modo session/5432 com `EMAXCONNSESSION` e `pool_size: 15`; os loops de reconciliacao de pagamentos e notificacao tiveram falha de conexao. Houve `GET /health/ready` com 503 durante a publicacao.
- A documentacao `infra-contract.md` registra `DB_POOL_SIZE=4`, `DB_MAX_OVERFLOW=0` observados em 2026-10-03, 1 listener operacional, 1 listener de chat e possivelmente 1 de impressao por processo. Teto teorico de 7 sessoes/processo, ou 14 durante duas versoes sobrepostas. Isso deixa uma unica vaga no limite 15, antes de outras ferramentas/processos. Nao e contagem observada no instante do erro.
- Snapshot SQL em 13:16 UTC: 7 sessoes `Supavisor` ociosas, nenhuma transacao ociosa aberta, nenhum bloqueio observado. Estado de projeto `ACTIVE_HEALTHY` e ultimo deploy Railway `SUCCESS`. A amostra nao exclui picos.
- **Nesta PR:** o listener de chat deixa de iniciar no lifespan quando nao ha assinantes SSE; as rotas de inscricao ja chamam `ensure_started()` e esperam `wait_ready()`. Isso reduz ate 1 conexao session ociosa por processo *sem clientes SSE de chat*. Com chat ativo, teto continua 7: mudanca e incremental, nao solucao definitiva.
- **Proxima melhoria:** estudo/PR independente de multiplexacao dos tres `LISTEN` em uma unica sessao por replica, mantendo isolamento por tenant, reconexao e fallback HTTP/SSE. Validar separado o uso de transaction pooler 6543 para SQL ORM; listeners que usam `LISTEN` ficam em session mode. Nunca trocar `DATABASE_URL` inteiro sem testes de RLS, notificacoes, transacoes e locks.

## Dados e filas (agregados, sem identificadores de clientes)

- Banco atual ~39 MB no SQL; cinco registros de restaurante, **nao equivalem a cinco clientes pagantes**.
- `integration_outbox`: 4.559 delivered e 1 dead_letter historico; nos ultimos sete dias, 609 delivered e nenhuma pendencia com os estados retornados. A dead letter historica de 17/10 era `koma.whatsapp.customer_status`; nao fazer replay automatico.
- `print_jobs`: 174 printed, 9 failed e 1 cancelled; os 9 failed ocorreram entre 01/11 e 03/11, pertencem a um tenant, com 3 tentativas cada, sem `last_error` registrado. Investigar no agente/fluxo sem reimprimir automaticamente.
- `online_payment_intents`: 7 error, 6 approved, 4 cancelled, todos os estados em registros antigos ate 28/10; nenhum intent criado nas ultimas 72h na amostra. Nao declarar perda de dinheiro ou reconciliacao pendente sem inspecionar os casos.
- `scheduled_orders`: nenhum pedido com `released_at IS NULL` e vencido no instante da consulta.
- A rota fiscal `/api/onboarding/fiscal/municipalities` devolveu 503 em 05/11 06:08 UTC. Seu codigo busca IBGE externo com timeout de 5s e cache em memoria de 6h; ausencia de cache quente/fallback explica vulnerabilidade a indisponibilidade externa.
- A rota `/api/online-orders/control` devolveu 500 em 05/11 06:08 UTC. `GET` usa `get_or_create_control` e `commit`, portanto pode escrever ao inicializar tenant. A causa do 500 especifico nao foi demonstrada pelo trecho de log; investigar concorrencia/erros sem pressupor causa.

## SQL, seguranca e capacidade

- `pg_stat_statements` foi resetado em 2026-07-20; seus milhoes de chamadas sao **historicos**. Na amostra de 150 segundos em 05/11, as duas consultas recorrentes de Outbox mantiveram contagem igual, descoberta de tenants aumentou 7, notificacoes 5, e `product_image_referenced` 0. Otimizacoes de idle parecem vigentes.
- `product_image_referenced` teve 1.007 chamadas acumuladas e media historica ~2.699 ms; funcao percorre produtos comparando texto normalizado, sem predicado indexado simples. Nenhuma execucao nova no intervalo curto. Investigar plano e seguranca de referencias cruzadas em ambiente isolado antes de alterar.
- Supabase Performance Advisors: 31 FKs sem indice (INFO), 1 policy de `cardapios` com custo de initplan (WARN), 76 indices sem uso observado (INFO), 4 pares de indices duplicados (WARN). Nao aplicar criacoes/remocoes em lote; medir `EXPLAIN`, acessos e efeito de escrita/RLS.
- Security Advisors: 1 INFO de RLS ligada sem policy em `koma_internal.transaction_reset_backups`. O projeto documenta esse deny-all como intencional; nao adicionar policy permissiva para remover aviso.
- `max_tenants_per_sweep=8` na reconciliacao a cada 20s e limite *por rodada*, nao maximo de restaurantes cadastrados. Para 100 tenants optados, um ciclo completo nominal requer 13 rodadas (~260s) antes de considerar IO do provedor; dimensionar fallback financeiro e verificar idempotencia e webhooks.
- `max_active_orders` ate 500 no controle de pedidos e um limite operacional **por restaurante**, nao limite de clientes do KOMA.
- A area fiscal atualmente valida CE somente; isso e uma restricao geografica de modulo, nao do cardapio geral.

## Custo estimado e vigilancia

Metrias Railway dos ultimos 7 dias (medias CPU/RAM em cinco servicos: API, Evolution, Redis, Postgres auxiliar e backup) somam aproximadamente 0,634 GB de RAM e 0,0085 vCPU. Pelas tarifas documentadas (US$ 10/GB-mes e US$ 20/vCPU-mes), equivalente mensal aproximado de computacao: **US$ 6,51**, supondo medias constantes. **Nao e fatura.** Exclui volumes, egress, credito/plano, banco Supabase, storage, mensagens, email, pagamento, suporte e impostos; nunca multiplicar linearmente por restaurantes.

Ja existem dois mecanismos no GitHub:
- `external-availability-monitor.yml` a cada 30 min, 2 falhas consecutivas antes de issue de indisponibilidade.
- `production-smoke.yml` diario e em push para main (GET/OPTIONS).
Rastreamento distribuido Railway estava desativado e sem webhooks configurados. Antes de comprar APM, aproveitar logs estruturados, monitor gratuito existente e alertas de falha de rollout.

## Gates recomendados antes de expandir

1. **P0, confiabilidade:** manter esta melhoria lazy com CI verde. Em PR separado, reduzir conexoes LISTEN dedicadas, medir perfil real da sobreposicao, e documentar reserva para listeners, migrações, workers e monitoramento. Garantir que falta de conexoes nao quebre readiness nem aceite financeiro.
2. **P1, impressao:** analisar 9 failed do agente, classificacao de falhas sem dados pessoais e fluxo seguro de retry; testar reconexao e deduplicacao sem reenviar pedidos reais.
3. **P1, custo ocioso:** medir heartbeats/polling dos agentes sob 1/10/100 clientes simulados (1 agente/tenant como hipotese), preservando revogacao rapida, SSE e latencia ate papel.
4. **P1, dependencias:** cache com fallback seguro da lista IBGE e 422 para erros de validacao de pedido no lugar de 500, onde aplicavel. Testar operacao sem internet externa em homologacao.
5. **P2, banco:** plano de indices dirigido por query, teste de `product_image_referenced` e politicas RLS sem relaxar segregacao.
6. **P2, produto/comercial:** monitorar tempo manual por onboarding, atendimento e cobranca, separar COGS variavel por restaurante. Revisar release manual antes de ampliar a carteira sem perder controle.
7. **Teste de capacidade isolado:** executar cenarios com 10, 100 e 1.000 tenants ficticios fora de producao, com cargas representativas de caixa, pedidos, pagamento, chat e impressao; registrar p95, erros, saturacao de pool, tamanho das filas, uso medio de CPU/RAM e custo estimado. Nunca disparar scripts de carga na producao.

**Nao realizar agora:** upgrade de plano por antecipacao, aumento cego de DB_POOL_SIZE/replicas, troca global para porta 6543, indices em massa, limpeza de registros, replay de filas, envio de WhatsApp de teste para clientes, testes de carga em producao ou mudanca financeira.
