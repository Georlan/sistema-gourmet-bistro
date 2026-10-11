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
