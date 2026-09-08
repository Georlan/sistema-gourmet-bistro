# QA — Online Order Operational Safety

## Automatizado nesta PR

- pausa/reabertura e auditoria;
- política pública bloqueada durante pausa;
- motivo interno não exposto ao consumidor;
- capacidade configurável;
- auto-pausa no limite;
- agendados futuros fora da carga atual;
- bloqueio por fingerprint sem telefone em claro;
- expiração de bloqueio;
- listagem sem fingerprint;
- rota administrativa exige autenticação;
- rate limit de chat por conversa/IP;
- FORCE RLS e grants mínimos na migration.

## Manual obrigatório antes de homologar produção

Sessão A — cliente mobile:

1. abrir Cardápio;
2. montar pedido;
3. manter checkout aberto;
4. operação pausa novos pedidos;
5. confirmar que novo POST é rejeitado;
6. confirmar que Cardápio continua navegável;
7. acompanhar pedido criado antes da pausa;
8. enviar/receber chat durante pausa;
9. reabrir pedidos;
10. confirmar nova compra.

Sessão B — Caixa:

1. localizar controle de emergência na navegação principal;
2. pausar 15/30/60 min e indefinido;
3. verificar carga aguardando/produção/pronto/ativos;
4. configurar `max_active_orders`;
5. testar alerta >= 80%;
6. testar auto-pausa no limite;
7. confirmar que não existe auto-reabertura.

## Carga

Executar somente em ambiente local/staging dedicado:

- 10 requisições concorrentes;
- 25;
- 50;
- 100.

Nunca executar burst destrutivo em restaurante de produção.
