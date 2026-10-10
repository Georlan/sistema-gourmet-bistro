# Pós-STS: confiabilidade e evidência de operação

Atualizado em 09/10/2026. Tenant 6 em operação real. Nenhuma alteração de credencial, replay de impressão, pedido ou pagamento de teste em produção. As fases ficam abertas enquanto seus critérios completos não forem comprovados.

- [ ] Fase A — Contenção e confiabilidade
- [ ] Fase B — Observabilidade
- [ ] Fase C — Segurança e consistência
- [ ] Fase D — Eficiência e custos

## A: impressão e infraestrutura

PRs #1052 e #1054 corrigem reconexão SSE e tentativas de heartbeat/claim, com backoff exponencial limitado e jitter. Credenciais 401/403 continuam rejeitadas e suspendem o agente; acknowledgements e journal não entram no cooldown. 137 testes do agente passaram, além dos checks Linux/Windows e contrato PostgreSQL. Ambos integrados à main. Isso disponibiliza código; não atualiza o agente instalado no restaurante nem prova impressão física.

Snapshot somente leitura às 12:45 UTC: tenant 6 com agente primário ativo e heartbeat recente, 341 jobs confirmados como printed, nenhum pending/claimed, zero chaves idempotentes duplicadas, um failed histórico de 03/10. Não reprocessar esse failed sem diagnóstico local. Estado printed comprova confirmação pelo agente/spooler, não saída no papel.

O agente válido atual funciona. O código instalado que originou os 401 históricos não foi identificado; não é possível atribuir uma credencial rejeitada a um tenant válido por inferência. O painel não deve exibir autenticação inválida sem evidência vinculada ao agente. Faltam migração planejada dos clientes antigos e prova física fora do atendimento.

Postgres Railway: online, deploy ativo, sem falha crítica observada. Nova consulta às 13:50 UTC mantém um warning, zero críticos e zero falhas recentes. API: última hora com 2.479 requisições, zero 5xx e 14 4xx; janela agregada não identifica causas de cada 4xx. Logs de checkpoint são mensagens LOG normais, apesar da classificação error do coletor. A descrição exata do warning histórico não foi disponibilizada pelo conector; a API de notificações recusou acesso e a interface não mostrou aviso ativo do Postgres. Não presumir que é o limite de backups. Não reiniciar nem alterar o banco para apagar o contador.

## B: observabilidade

PR #1055 corrige cancelamento de vite:preloadError que podia resolver undefined e produzir leitura .default em React.lazy. Mantém recuperação limitada e rascunhos. Dois erros históricos têm pilha compatível; sua associação a um deploy específico não foi demonstrada. SDK passa a capturar erros/rejeições e identificar SHA/horário do build; sanitização recursiva protege propriedades e URLs. Replay e autocapture de DOM continuam desativados.

Lint, 976 testes frontend e build passaram; navegador: 41 passaram/5 pulados, mais quatro testes com preview de produção. CI verde, integrado em 2136d57288431ae9ead7a82a7dd899e326c8cbc0. Smoke somente GET/OPTIONS confirmou frontend nesse SHA, assets válidos, readiness e CORS; backend permaneceu saudável em ce90157fc2e8.

Dashboard existente ampliado, sem duplicação: https://us.posthog.com/project/648305/dashboard/2178362. Visitantes/sessões e cinco etapas públicas consultados ponta a ponta, com filterTestAccounts=true. Em 08/10: 53 visitantes, 67 sessões, 130 aberturas, 79 visualizações de produto, 59 adições, 30 checkouts e 26 envios. Eventos não equivalem a pessoas; envio não equivale a aceite ou pagamento. Hoje é janela parcial.

data_catalog:read indisponível limita catálogo governado, mas consultas dos eventos e dashboard funcionaram. Não há comprovação de eventos de leads, pagamentos/aceites ou web vitals na janela consultada; esses indicadores permanecem indisponíveis. PR #1063 adiciona catalog_load_ms ao evento inicial já existente de abertura de cardápio, sem novos eventos ou dados pessoais. Mede obtenção HTTP, decodificação e projeção do catálogo; não é LCP. Dois testes com resposta deliberadamente atrasada passaram em celular/desktop, inclusive preview. Insight de p50/p95/amostras foi adicionado ao dashboard, sem transformar ausência em zero e excluindo is_test_account=true. CI verde e integrado; frontend implantado e smoke da revisão esperado passou às 14:16 UTC. Consulta inicial não tinha amostras; após deploy, catalog_load_ms ainda não consta na taxonomia consultada. Não gerar visitas sintéticas e apresentá-las como uso real. O painel continua sem amostras até ingestão de novas visitas reais. Falta validar eventos novos reais e instrumentação seletiva de aquisição.

PR #1057 separa p50/p95 de HTTP bem-sucedido de SSE/WS, autenticação e erros, por impressão/checkout/pagamento/comandas. Informa amostragem e duração ausente como desconhecida. 977 testes frontend, lint e build passaram. É diagnóstico local, não painel permanente de métricas backend. Smoke público diário já existente é não destrutivo. No PostHog, alerta habilitado para 5 ou mais exceções JS no dia completo, avaliado diariamente às 09h America/Fortaleza, apenas para o proprietário. Limiar usa a base consultada (0 na maior parte dos dias e 2 em 08/10), com contas de teste excluídas. Primeira avaliação agendada para 10/10 às 12h UTC; estado inicial Not firing. Não foi enviada notificação de teste. Faltam alertas de infraestrutura/checkout com janela e amostra suficientes.

## C: segurança e comandas

Autenticação do agente valida hash e role/tenant; cache negativo limitado reduz consultas de tokens inválidos. Não substituir por bloqueio amplo por IP compartilhado. Falta telemetria específica para distinguir instalações mal configuradas de abuso; não há ataque confirmado. Integração com eventos de segurança Cloudflare não foi disponibilizada pelos conectores desta sessão. Limites existentes de login usam duas janelas persistentes por tenant/identificador (origem+conta), evitando bloqueio amplo de IP compartilhado; pedidos públicos e aceite de contrato também têm limites próprios. Seis regressões desses controles passaram. Isso não implementa identificação do cliente de impressão rejeitado nem comprova ausência de abuso.

Transferência já verifica tenant, mesa ocupada e atendimento; ocupa destino com bloqueio no endpoint, duplica transferência ao mesmo destino sem novo movimento e devolve 409 instruindo Mesclar quando ocupado. A semântica de destino ocupado permanece 409; só erros específicos de concorrência passam a um conflito recuperável. PR #1061 reproduziu deadlock SQLSTATE 40P01 em transferências recíprocas em PostgreSQL 17 isolado. Origem e destino agora são bloqueados em ordem comum; origem é confirmada novamente após a espera. Duplicação ao mesmo destino permanece idempotente; destino ocupado mantém 409. Deadlock/serialização faz rollback e retorna conflito recuperável; outros erros não são ocultados. O Caixa atualiza mesas/pedidos, preserva a explicação e limpa o destino após 409, exigindo nova seleção sem repetir a mutação. Quatro testes de concorrência reais verificam destino disputado, duplicação, transferências recíprocas e destinos divergentes, incluindo ausência de deadlock no banco e auditoria sem duplicação. Outros testes conferem rollback e isolamento de tenant. Validação local: 20 testes backend direcionados, 980 frontend, lint/build e dois testes de preview celular/desktop passaram. Não foi demonstrado que o deadlock explica os dois 409 históricos. Integrado com CI verde (2.261 backend passaram/61 pulados, além dos checks PostgreSQL separados). Deploy backend SUCCESS e /health/ready saudável confirmados às 14:16 UTC; smoke GET/OPTIONS validou a revisão esperada do backend e do frontend, assets, readiness de contratos e CORS. Sem transferência sintética em produção; efeito funcional exercitado em banco isolado e preview. Railway permaneceu aguardando CI após os workflows já concluídos; reenvio da verificação da mesma revisão coincidiu com avanço do deploy, sem prova de causalidade e sem desativar proteção.

## D: banco, backups e custos

Supabase ACTIVE_HEALTHY; medição anterior da aplicação aproximadamente 30 MB, painel de billing mostra banco total 44,55 MB e storage 0,113 GB. Escopos distintos não representam crescimento comprovado. Advisors atuais: 31 FKs sem índice, 63 initplans RLS e quatro pares duplicados. Tabelas operacionais pequenas, maiores abaixo de 2 mil linhas; estatísticas sem data de reset não provam inutilidade de índice. Não criar 31 índices nem remover 79 automaticamente. Os quatro pares possuem ix standalone e uq vinculado a constraint; futura remoção deve comparar definição e dependências, usar timeout/CONCURRENTLY e plano de reversão. Sem DDL em produção nesta rodada.

koma_internal.transaction_reset_backups tem RLS habilitada e não concede SELECT a anon/authenticated/koma_runtime. Ausência de policy conserva acesso negado; não adicionar policy permissiva para eliminar INFO. Revisão de initplan e planos de execução continua pendente.

Backup Supabase de 09/10: archive validado, 1.108.815 bytes, upload às 03:01 UTC, dez objetos diários observados. O monitor agora explicita que isso não cobre Postgres Railway, Redis, mídias, configuração nem journal dos agentes. PITR Railway desativado, criação de backup nativo exige Pro na interface. Não mudar plano/volume automaticamente. Retenção atual é dez cópias diárias; cópias semanais externas continuam necessárias.

Ensaio da aplicação usa container PostgreSQL 17 local sem rede, dados em tmpfs, nenhum conector real. Escopo public+koma_internal; owners normalizados para postgres, roles/ACL e membership runtime recriados. Contagens de todas as 117 tabelas da aplicação coincidiram com o archive; 154 policies restauradas. A role runtime não lê comandas sem contexto de tenant e, com tenant 6, não lê comandas de outros tenants. Isso verifica dados e isolamento básico da cópia de hoje. Schemas gerenciados Supabase, mídias, segredos e restauração do Postgres/Evolution não são comprovados por esse ensaio; não confundir restore parcial com recuperação completa.

Regressão backend local anterior às mudanças #1061: 2.245 testes passaram e 57 foram pulados por ausência dos ambientes PostgreSQL específicos; 1.563 warnings de dependências/testes. Esse resultado não substitui os testes de concorrência PostgreSQL pulados.

### Custos consultados diretamente em 09/10

Railway, ciclo aberto 10/09–10/10: https://railway.com/workspace/usage. Valores em USD são consumo acumulado exibido, não fechamento da fatura nem cobrança em reais.

| Componente de produção | Consumo acumulado USD |
| --- | ---: |
| API Kôma | 2,36 |
| Evolution API | 1,64 |
| Postgres Railway | 0,6512 |
| Redis | 0,1272 |
| Serviço Postgres S3 Backup | 0,0001 |
| Serviço histórico pre-purge | 0,0000 |
| Serviços excluídos durante o ciclo | 0,1400 |
| Projeto produção, total arredondado | 4,91 |

Homologação acumula USD 3,20. Workspace acumula USD 13,11, incluindo USD 5,00 de Railway Agent (ferramenta da plataforma, não agente de impressão). Projeção USD 13,50 não é custo realizado. Histórico em https://railway.com/workspace/billing mostra registros de assinatura de USD 5,00 em 10/08 e 10/09; pagamento efetivo em reais/cartão não foi consultado. Armazenamento externo S3 não está incluído como custo comprovado no serviço de backup.

Supabase Free: https://supabase.com/dashboard/org/plucnlcltnxlincfrvmr/billing. Quatro faturas de USD 0,00 marcadas Paid, última em 07/10. Sem cobrança de excesso; isso não garante disponibilidade. Aviso atual: ciclo anterior teve 6,689 GB de egress e 5,141 GB cached egress, acima das quotas de 5 GB. Grace period termina em 02/11/2026; se o excesso continuar, a plataforma pode restringir requisições com 402. Ciclo atual 08/10–08/11 estava em 0,202/5 GB egress e 0,059/5 GB cached egress. Uso atual abaixo da quota não encerra por si só o aviso histórico. Controlar o volume ou decidir upgrade antes da data; nenhuma compra, troca de plano ou spend cap foi feita.

PostHog e Cloudflare: tentativa de consulta direta redirecionou para login, sem sessão autenticada de billing. O conector PostHog disponível consulta métricas, não comprovou faturas. Não inserir credenciais nem aceitar termos para obter preços. S3 externo: fatura não consultada. Esses custos permanecem desconhecidos. Custo em R$ não verificado. Nenhum serviço desligado/reduzido: Postgres/Redis atendem Evolution e a cópia histórica pre-purge é preservada. Consumo/estimativa não representam cobrança efetiva. A interface Railway também mostrou uma cópia nativa pre-security-patch de 108 MB de cerca de um mês atrás, sem agenda de backup; ela não comprova recuperação atual do Evolution. Tentativa de conexão de leitura pelo endereço público existente falhou antes da consulta (OperationalError, sem SQLSTATE); nenhuma porta, credencial ou permissão foi alterada. Backup/restore atual desse banco permanece pendente, não coberto pelo ensaio Supabase.

### Verificação operacional posterior

Às 14:16:51 UTC, após deploy de #1061/#1063: heartbeat primário tenant 6 às 14:16:48, última confirmação de impressão às 14:16:45, nenhuma fila pending/claimed/printing e zero chaves idempotentes duplicadas. Um failed histórico continua preservado. Não é prova de impressão física. A quantidade retida de jobs não é contador cumulativo de impressões.

## Entregas e arquivos revisáveis

| PR | Problema e arquivos principais | Estado |
| --- | --- | --- |
| [#1052](https://github.com/Georlan/sistema-gourmet-bistro/pull/1052) | Reconexão SSE: print-agent/wake_listener.py e teste de wakeup | CI verde, integrado; instalação local pendente |
| [#1054](https://github.com/Georlan/sistema-gourmet-bistro/pull/1054) | Heartbeat/claim: print-agent/api_client.py, retry_budget.py e regressões | CI verde, integrado; instalação local pendente |
| [#1055](https://github.com/Georlan/sistema-gourmet-bistro/pull/1055) | Bundles/exceções: src/main.tsx, src/analytics/posthog.ts, testes unitários e app-recovery | CI verde, integrado e frontend validado em produção |
| [#1057](https://github.com/Georlan/sistema-gourmet-bistro/pull/1057) | Classificação HTTP: scripts/http-observability.mjs, ops-doctor.mjs e teste | CI verde, integrado; ferramenta de diagnóstico |
| [#1058](https://github.com/Georlan/sistema-gourmet-bistro/pull/1058) | Cobertura de backup: scripts/check-backup-freshness.mjs e infra-contract.md | CI verde, integrado; backup/restore parcial verificado |
| [#1061](https://github.com/Georlan/sistema-gourmet-bistro/pull/1061) | Transferências: backend/app/routes/atendimentos.py, services/atendimentos.py, useCashierOrders.ts e regressões PostgreSQL/browser | CI verde, integrado e backend/frontend verificados em produção |
| [#1063](https://github.com/Georlan/sistema-gourmet-bistro/pull/1063) | Tempo do catálogo: src/cardapio/CardapioPage.tsx, src/analytics/types.ts e public-menu-order.spec.ts | CI verde, integrado e frontend verificado; novas amostras reais pendentes |

#1059 foi fechado e consolidado em #1061 para evitar duas publicações do backend para o mesmo problema. Nenhum PR desta rodada atualiza por conta própria o executável instalado no restaurante.

## Validação manual sem interromper o ID 6

1. Durante uso normal, observar atualização das mesas e pedidos; não enviar pedido sintético ao restaurante.
2. Em homologação, provocar falha de bundle, confirmar uma recuperação automática, rascunho preservado e recuperação manual se a falha persistir.
3. Fora do atendimento, testar cliente novo contra ambiente isolado: válido autentica; inválido suspende; rede indisponível desacelera e recupera sem duplicar; confirmar spooler e papel separadamente.
4. Testar transferência duplicada, destino ocupado e duas origens para mesmo destino em banco isolado; não ensaiar concorrência sobre mesas reais.
5. Antes de ampliar cobertura, comprovar backup/restore específico do banco Evolution e das mídias; não restaurar em produção.
