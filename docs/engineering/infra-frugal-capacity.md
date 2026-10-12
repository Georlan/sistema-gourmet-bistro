# Infraestrutura econômica por demanda

Decisão do proprietário em 11/10/2026: operar sem homologação permanente paga. A quantidade de restaurantes é um marco comercial, não uma medida de capacidade. Esta política não certifica 100 ou 1.000 restaurantes nem prevê uma fatura exata.

## Base operacional

- Frontend estático no Cloudflare Pages; backend compartilhado no Railway, inicialmente uma réplica; banco de produção no Supabase. Preservar isolamento, RLS e contratos existentes.
- `DB_POOL_SIZE=4` e `DB_MAX_OVERFLOW=0` observados em produção. Não aumentar conexões cegamente: réplicas multiplicam pools e tarefas de fundo. Orçar conexões de migração, workers, listeners e outras aplicações separadamente.
- Evolution tem sessão conectada; seu Postgres e Redis são consumidores reais. `KOMA_WHATSAPP_AUTOMATION_ENABLED=false` não comprova que o WhatsApp inteiro pode ser desligado. Não remover por essa flag.
- Preservar backup diário. Reduzir infraestrutura não substitui validar restauração. Não manter um novo banco permanentemente apenas para testar backups.
- Homologação: fontes GitHub desconectadas e implantações paradas. Os volumes de teste são retenção de dados, não capacidade ativa; excluí-los somente após exportação validada/autorização aplicável. Nenhum teste deve voltar a usar esses hosts automaticamente.

## Marcos de crescimento

| Restaurantes | Política econômica | Evidência exigida antes de aumentar |
| --- | --- | --- |
| 1 | Uma réplica compartilhada; nenhuma homologação permanente; alertar ao atingir US$ 5 de Compute; Railway Agent com limite zero. | Medir RAM, CPU, erros, latência e fila durante o expediente real. |
| 10 | Reutilizar o mesmo backend/banco. Sem replicação por cliente. | Ensaio isolado com concorrência representativa de pedidos, caixa e impressão; medir p95, espera do pool e filas. |
| 100 | Otimizar consultas/índices e trabalho ocioso primeiro. Adicionar capacidade somente se necessário. | Pico sustentado e teste de falha, orçamento de conexões, idempotência entre réplicas e restauração validada. |
| 1000 | Orçamento específico por carga e custo por restaurante; workers e réplicas compartilhados conforme gargalos comprovados. | Teste representativo isolado, conexões persistentes, falhas de provedor, filas, RLS entre tenants e margem após todos os custos. Não declarar suporte só por um smoke HTTP. |

Critérios iniciais propostos para revisão de capacidade: p95 de leituras críticas acima de 2 s no pico, espera recorrente do pool, erros/timeouts, crescimento da fila ou RAM sustentada próxima do limite. Um evento isolado não justifica escalar. Medir antes/depois sob a mesma carga e incluir latência até a impressão; não economizar atrasando pedidos.

## A carga de impressão cresce mesmo sem pedidos

O agente em código tem heartbeat de 5 s e polling configurado de 0,5 s. Com SSE disponível, `fallback_poll_seconds()` usa pelo menos 30 s. Agentes instalados podem ter versões/configurações diferentes: verificar antes de extrapolar.

Hipótese de planejamento: um agente conectado por restaurante. Só heartbeats produzem `N/5` requisições/s: 0,2; 2; 20; 200 nos marcos 1, 10, 100 e 1.000. A janela de persistência de 20 s da PR #1082 pode reduzir escritas ociosas em estado estável, mas não elimina requisições, leituras de autenticação nem escritas quando hardware/estado muda.

Com SSE saudável, polling de fallback acrescenta aproximadamente `N/30` requisições/s; sem SSE, configuração de 0,5 s pode chegar a `2*N` por segundo. O crescimento deve preservar wakeup, fila PostgreSQL, claim atômico e idempotência; não aumentar réplicas indiscriminadamente para compensar polling desnecessário. Estas contas são taxas teóricas, não teste de throughput.

## Cálculo correto dos custos

Referência oficial Railway consultada em 11/10/2026: RAM US$ 10/GB-mês, CPU US$ 20/vCPU-mês, egress US$ 0,05/GB e volume US$ 0,15/GB-mês. São médias de uso no período, não máximos configurados. Não multiplicar GB-minuto por tarifa de GB-hora.

Modelo aproximado de 30 dias: `recursos = 10 * RAM_média_GB + 20 * CPU_média_vCPU + 0,05 * egress_GB + 0,15 * volume_médio_GB + backups + outros_itens`. A fatura precisa considerar compromisso do plano, créditos e gasto separado do Agent conforme cobrança real. No Hobby normal, US$ 5 incluem US$ 5 de consumo; não somar a base de novo sem aplicar o crédito.

Exemplo: 0,210 GB de RAM contínua representam aproximadamente US$ 2,10/mês só de RAM; não US$ 0,04. Não prometer infraestrutura gratuita como consequência de usar Railway Hobby. Supabase, WhatsApp, domínio, e-mail, pagamentos e impostos ficam fora desta conta Railway e precisam entrar na margem total.

No ciclo 10/09–10/10, o painel mostrou US$ 13,50 de uso: RAM US$ 7,5332, CPU US$ 0,3989, egress US$ 0,4763, volumes US$ 0,0951 e Railway Agent US$ 4,9989. A ordem volume/egress e o Agent devem permanecer corretos. Uso não é comprovante de pagamento; estimativa no início do ciclo não é fatura fechada.

## Verificação e mudanças

1. Testar localmente/CI com fixtures ou banco isolado. Nunca importar credenciais de produção para um teste de carga. Criação de ambiente pago temporário exige autorização específica; não é a alternativa automática ao teste local.
2. Manter uma réplica até existir evidência para aumentar. Ao adicionar réplicas, verificar outbox/watchers/listeners, orçamento agregado de conexões e replay de pagamentos/impressão antes do rollout.
3. Registrar fatura, custo por restaurante pagante, p95, erros, CPU/RAM, espera do pool e atraso de fila. Definir orçamento pela margem real, não por contagem de restaurantes sozinha.
4. Conferir estado efetivo após parar serviço: configuração salva ou comando de escala não prova que containers pararam. No Railway, retirar a última região pode recriar uma região padrão; verificar implantações ativas e interrompê-las quando necessário.
5. Nunca usar `capacity-five-tenants.mjs` contra produção após retirar homologação. A proteção de host deve continuar bloqueando produção; eventual migração para teste local precisa preservar essa proteção.

Fontes: [preços](https://docs.railway.com/pricing/plans), [cobrança](https://docs.railway.com/pricing/understanding-your-bill), [controle de gastos](https://docs.railway.com/pricing/cost-control).

## Reconciliação Supabase em 12/10/2026

Base `0547a91b3992`, também servida por backend e frontend na leitura passiva; API readiness 200/banco saudável. #1082 agrupou escritas de heartbeat; #1083 corrigiu a validade do diagnóstico e #1084 tornou a simulação do agente instalado um gate. Preservar essas três entregas juntas. #1058 já comprovou restauração isolada de dados/policies da aplicação; recuperação completa de mídia/Evolution/segredos continua pendente.

Painel fornecido pelo proprietário às 13:04 Fortaleza: ciclo 08/10–08/11, egress 0,727/5 GB, cached egress 0,218/5 GB, database 0,049/0,5 GB, storage 0,116/1 GB e Logs Query 86,771/100 GB. São consumo da organização e escopos do billing, não medidas por restaurante. Contadores foram reiniciados no novo ciclo: comparar totais de ciclos diferentes não comprova economia percentual. Aviso de carência até 02/11 continua visível.

SQL somente leitura às 13:07–13:08: projeto ACTIVE_HEALTHY, PostgreSQL 17.6, banco corrente 33.696.915 bytes, 12 conexões cliente (sete runtime), zero locks aguardando e zero idle in transaction. Banco corrente SQL e máximo/billing não têm o mesmo escopo/instante. D6: 341 jobs retidos confirmados como printed e nenhuma outra situação retornada; isso não comprova papel e não autoriza replay. Nenhum pedido, pagamento, configuração ou DDL foi executado em produção. Nova leitura de manutenção: 41 conversas encerradas ainda não purgadas, nenhuma elegível a 30 ou 90 dias; não há economia imediata de espaço comprovada com esta correção.

Estatísticas acumuladas não têm data de reset disponível. Na amostra de 32,9 s, consultas legadas de lista global de restaurantes e despacho de outbox por tenant não cresceram; autenticação do agente cresceu seis chamadas e claim de avisos cresceu uma. Não atribuir milhões de chamadas históricas ao código atual nem extrapolar esse intervalo para capacidade de pico.

### Gap corrigido em código, publicação pendente

O worker atualiza o relógio da retenção a cada despacho, inclusive ocioso: ciclos frequentes podem impedir a manutenção de seis horas após a execução inicial. A correção só marca manutenção global concluída quando ela realmente estava vencida e a rodada terminou sem falha; rodada de um tenant não adia a dos demais. Mantém o owner existente, limite por lote, escopo de tenant, configuração de retenção e preservação de conversa/pedido. Não muda cadência de envio, polling, TTL do agente ou banco/RLS.

Antes da publicação, conferir `ORDER_CHAT_RETENTION_DAYS` efetivo e backlog elegível: a rotina existente remove conteúdo antigo de conversas encerradas, eventos e inscrições de push. O código usa 30 dias por padrão; a antiga tasklist de 90 dias não configura o runtime. Reversão do relógio não recupera conteúdo já removido; backup validado e política de retenção precisam integrar a revisão. Não executar limpeza manual no D6.

### Próximas tarefas de economia

- [ ] Comprovar carga operacional representativa em 10/100/1000 tenants isolados. O teste de descoberta ociosa agora cobre até 1000 e exige uma consulta, mas não certifica throughput, p95, impressão ou concorrência financeira.
- [ ] Priorizar planos de consultas reais antes de mexer em índices/RLS. Advisors: 31 FKs sem índice, 63 avisos initplan e quatro pares duplicados; já constavam em 09/10. Não criar/remover em lote. Sem alerta security WARN/ERROR nesta leitura; INFO deny-all do backup interno permanece intencional.
- [ ] Medir custo de autenticação do agente sem cache positivo que atrase revogação; preservar agentes instalados e diagnóstico além do TTL.
- [ ] Reduzir consultas administrativas de logs: janela pequena, filtro de fonte/status e nenhuma rotina de polling do Logs Explorer. 86,771 GB são dados varridos para ler logs, não tamanho do banco nem tráfego dos clientes; aplicação do limite anunciada para início de 2027. A autoria dessas consultas não foi determinada e nenhum log amplo foi consultado nesta rodada.
- [ ] Medir bytes por pedido/visita e p95 sob o mesmo cenário antes/depois. Não aumentar pool, réplica, plano ou contratar cache baseado apenas em quantidade de restaurantes.

Referências: [Logs Query](https://supabase.com/docs/guides/platform/manage-your-usage/log-query), [FKs sem índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [RLS initplan](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [índices duplicados](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index). Supabase anunciou em 12/10 desativação de cifras TLS antigas nas APIs HTTP a partir de 10/11; não é atualização automática de capacidade e conexões PostgreSQL não entram nessa mudança: [aviso oficial](https://supabase.com/changelog/cbc-tls-ciphers-deprecated).

## Retenção de conversas — decisão operacional de 12/10/2026

- Proprietário confirmou 30 dias; runtime Railway não possui `ORDER_CHAT_RETENTION_DAYS` configurada e portanto usa o default explícito de 30 dias. Sem troca de plano, variável, pedido ou limpeza manual.
- SQL agregado somente leitura na produção Supabase, em 12/10: **42 conversas encerradas ainda não purgadas**, das quais **0 elegíveis a 30 dias** e **0 a 90 dias**. A mais antiga encerrou em 02/10/2026 (UTC). É um retrato temporal, não uma garantia futura.
- Log do serviço Railway Postgres S3 Backup em 12/10 às 03:05 UTC: arquivo de 1,31 MB validado e upload ao S3 confirmado. A nova cópia não passou por ensaio próprio de restauração.
- Evidência de restore de aplicação: PR #1058 registra ensaio real em 09/10 usando PostgreSQL 17 isolado e a cópia Supabase/S3: contagens coincidentes das 117 tabelas, 154 policies restauradas e isolamento tenant verificado. A evidência é **da base KÔMA**; não cobre recuperação completa do Evolution, mídias, credenciais, segredos ou agentes, e não deve ser anunciada como recuperação integral.
- Merge deste ajuste: rodar os checks sobre a `main` reconciliada; manter 30 dias e a política do método `purge_expired_order_chat_content` sem novos dados ou estrutura; conferir readiness e backlog antes e depois do deploy. Não fazer replay de impressões nem teste destrutivo no ID 6.
