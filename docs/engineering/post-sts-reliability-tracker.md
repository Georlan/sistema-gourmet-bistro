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

Postgres Railway: online, deploy ativo, sem falha crítica observada. Logs de checkpoint são mensagens LOG normais, apesar da classificação error do coletor. A descrição exata do warning histórico não foi disponibilizada pelo conector; a API de notificações recusou acesso e a interface não mostrou aviso ativo do Postgres. Não presumir que é o limite de backups. Não reiniciar nem alterar o banco para apagar o contador.

## B: observabilidade

PR #1055 corrige cancelamento de vite:preloadError que podia resolver undefined e produzir leitura .default em React.lazy. Mantém recuperação limitada e rascunhos. Dois erros históricos têm pilha compatível; sua associação a um deploy específico não foi demonstrada. SDK passa a capturar erros/rejeições e identificar SHA/horário do build; sanitização recursiva protege propriedades e URLs. Replay e autocapture de DOM continuam desativados.

Lint, 976 testes frontend e build passaram; navegador: 41 passaram/5 pulados, mais quatro testes com preview de produção. CI verde, integrado em 2136d57288431ae9ead7a82a7dd899e326c8cbc0. Smoke somente GET/OPTIONS confirmou frontend nesse SHA, assets válidos, readiness e CORS; backend permaneceu saudável em ce90157fc2e8.

Dashboard existente ampliado, sem duplicação: https://us.posthog.com/project/648305/dashboard/2178362. Visitantes/sessões e cinco etapas públicas consultados ponta a ponta, com filterTestAccounts=true. Em 08/10: 53 visitantes, 67 sessões, 130 aberturas, 79 visualizações de produto, 59 adições, 30 checkouts e 26 envios. Eventos não equivalem a pessoas; envio não equivale a aceite ou pagamento. Hoje é janela parcial.

data_catalog:read indisponível limita catálogo governado, mas consultas dos eventos e dashboard funcionaram. Não há comprovação de eventos de leads, pagamentos/aceites ou web vitals na janela consultada; esses indicadores permanecem indisponíveis. Falta instrumentação seletiva e validação de novos eventos reais.

PR #1057 separa p50/p95 de HTTP bem-sucedido de SSE/WS, autenticação e erros, por impressão/checkout/pagamento/comandas. Informa amostragem e duração ausente como desconhecida. 977 testes frontend, lint e build passaram. É diagnóstico local, não painel permanente nem alerta configurado. Smoke público diário já existente é não destrutivo; faltam alertas proporcionais com janela e amostra mínima.

## C: segurança e comandas

Autenticação do agente valida hash e role/tenant; cache negativo limitado reduz consultas de tokens inválidos. Não substituir por bloqueio amplo por IP compartilhado. Falta telemetria específica para distinguir instalações mal configuradas de abuso; não há ataque confirmado. Integração com eventos de segurança Cloudflare não foi disponibilizada pelos conectores desta sessão.

Transferência já verifica tenant, mesa ocupada e atendimento; ocupa destino com bloqueio no endpoint, duplica transferência ao mesmo destino sem novo movimento e devolve 409 instruindo Mesclar quando ocupado. Nenhuma alteração de semântica 409 foi aplicada. Ainda falta reproduzir os dois eventos históricos, testar concorrência PostgreSQL específica de transferência e melhorar atualização da tela após conflito. Um teste sequencial SQLite não comprova concorrência PostgreSQL.

## D: banco, backups e custos

Supabase ACTIVE_HEALTHY, aproximadamente 30 MB. Advisors atuais: 31 FKs sem índice, 63 initplans RLS e quatro pares duplicados. Tabelas operacionais pequenas, maiores abaixo de 2 mil linhas; estatísticas sem data de reset não provam inutilidade de índice. Não criar 31 índices nem remover 79 automaticamente. Os quatro pares possuem ix standalone e uq vinculado a constraint; futura remoção deve comparar definição e dependências, usar timeout/CONCURRENTLY e plano de reversão. Sem DDL em produção nesta rodada.

koma_internal.transaction_reset_backups tem RLS habilitada e não concede SELECT a anon/authenticated/koma_runtime. Ausência de policy conserva acesso negado; não adicionar policy permissiva para eliminar INFO. Revisão de initplan e planos de execução continua pendente.

Backup Supabase de 09/10: archive validado, 1.108.815 bytes, upload às 03:01 UTC, dez objetos diários observados. O monitor agora explicita que isso não cobre Postgres Railway, Redis, mídias, configuração nem journal dos agentes. PITR Railway desativado, criação de backup nativo exige Pro na interface. Não mudar plano/volume automaticamente. Retenção atual é dez cópias diárias; cópias semanais externas continuam necessárias.

Ensaio da aplicação usa container PostgreSQL 17 local sem rede, dados em tmpfs, nenhum conector real. Escopo public+koma_internal; owners normalizados para postgres, roles/ACL e membership runtime recriados. Contagens de todas as 117 tabelas da aplicação coincidiram com o archive; 154 policies restauradas. A role runtime não lê comandas sem contexto de tenant e, com tenant 6, não lê comandas de outros tenants. Isso verifica dados e isolamento básico da cópia de hoje. Schemas gerenciados Supabase, mídias, segredos e restauração do Postgres/Evolution não são comprovados por esse ensaio; não confundir restore parcial com recuperação completa.

Regressão backend local: 2.245 testes passaram e 57 foram pulados por ausência dos ambientes PostgreSQL específicos; 1.563 warnings de dependências/testes. Esse resultado não substitui os testes de concorrência PostgreSQL pulados.

Custos em R$ não verificados. Nenhum serviço desligado/reduzido: Postgres/Redis atendem Evolution e a cópia histórica pre-purge é preservada. Fatura por componente e retenção contratada dependem de acesso de billing; consumo/estimativa não representam cobrança efetiva.

## Validação manual sem interromper o ID 6

1. Durante uso normal, observar atualização das mesas e pedidos; não enviar pedido sintético ao restaurante.
2. Em homologação, provocar falha de bundle, confirmar uma recuperação automática, rascunho preservado e recuperação manual se a falha persistir.
3. Fora do atendimento, testar cliente novo contra ambiente isolado: válido autentica; inválido suspende; rede indisponível desacelera e recupera sem duplicar; confirmar spooler e papel separadamente.
4. Testar transferência duplicada, destino ocupado e duas origens para mesmo destino em banco isolado; não ensaiar concorrência sobre mesas reais.
5. Antes de ampliar cobertura, comprovar backup/restore específico do banco Evolution e das mídias; não restaurar em produção.
