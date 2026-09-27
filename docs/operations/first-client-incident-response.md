# Primeira resposta a incidente de cliente

1. Peça o **código de suporte** mostrado após erro de servidor. Registre horário e ação feita, sem pedir senha ou dados de pagamento.
2. Rode `npm run ops:trace -- <código>` (ou acrescente `homologation`). O resultado traz rota, status, duração, instância, restaurante e tipo da exceção. Se não achar, peça o ID completo e procure no intervalo correto: `KOMA_TRACE_SINCE=48h npm run ops:trace -- <id>`.
3. Rode `npm run ops:doctor`. Com sessão Railway CLI disponível, o backup também é conferido. Use `npm run ops:doctor -- --deep` para deploy, réplicas, CPU, RAM, 5xx e p95 Railway.
4. Abra **Super Admin → Central de Incidentes** para Outbox, pagamento, impressão e estado do restaurante. A Central não contém telemetria Railway.
5. Registre a primeira ação e confirme com o cliente se o fluxo voltou.

| Sintoma | Verificação e primeira ação segura |
|---|---|
| KÔMA inteiro fora | `ops:doctor`; veja a issue do **External availability monitor** e o deployment Railway. Se ready falha, trate API/DB como crítico. |
| Erro em uma ação | `ops:trace` pelo código; compare rota, tenant e instância. Não repita ação financeira antes de conferir o estado. |
| Lentidão | `ops:doctor -- --deep`; compare p95 HTTP, `database_latency_ms` e duração da rota nos logs. |
| Pedido não apareceu | Central → Outbox; verifique eventos presos/stale e retries. Confira o pedido antes de qualquer reenvio. |
| Impressão não saiu | Central → Impressão; confira PrintJob falho/repetido e agente offline. Reimprima somente após conferir o estado. |
| Pagamento divergiu | Central → Mercado Pago; compare o estado registrado com o provedor. Não faça cobrança/reembolso pelo diagnóstico. |
| Backup atrasado | `ops:doctor` mostra STALE/ERRO; confira o job **Postgres S3 Backup** no Railway. Não baixe o dump. |

Se a CLI Railway não estiver autenticada, `ops:doctor` marca backup e telemetria como indisponíveis. O monitor externo roda a cada 30 minutos; confirma indisponibilidade após duas falhas consecutivas, atualiza uma única issue e a fecha após dois sucessos. Na pior fase do agendamento, confirmação leva cerca de 60 minutos. Para o primeiro restaurante, mudar o cron para 15 minutos reduz esse máximo para cerca de 30 minutos. Severidade operacional: **crítico** para frontend/ready/DB indisponível ou divergência financeira comprovada; **alto** para 5xx recorrentes, Outbox parada ou impressão contratada indisponível; **médio** para latência/retries em alta ou backup próximo de 36 horas.
