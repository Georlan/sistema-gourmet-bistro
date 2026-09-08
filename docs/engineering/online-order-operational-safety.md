# Online Order Operational Safety

## Objetivo

Impedir que o canal público receba mais pedidos do que a operação decidiu suportar,
sem interromper pedidos já criados, acompanhamento ou chat.

## Estados de carga

Pedidos ativos para capacidade:

- `analise`
- `pendente`
- `producao`
- `pronto`

Não contam:

- pedidos agendados ainda não liberados;
- `transito`;
- `finalizado`;
- `recusado`;
- comandas fechadas.

## Precedência

1. Pausa operacional dedicada (`online_order_controls`) bloqueia novos pedidos.
2. Override legado `Forçado Fechado` continua bloqueando.
3. Caixa/agenda/delivery seguem a política existente.
4. Bloqueio tenant-local de cliente é verificado antes da criação.
5. Rate limits por telefone/IP continuam válidos.
6. Com auto-pausa habilitada, o gate de capacidade segura `FOR UPDATE` na linha de
   controle até o commit da criação da comanda, serializando a última vaga.

`max_active_orders` sem `auto_pause` é informativo: gera alerta a partir de 80%,
mas não barra vendas sozinho.

## Pausa

A operação pode pausar:

- 15 minutos;
- 30 minutos;
- 60 minutos;
- até reabertura manual.

A pausa impede **somente novos pedidos**. Pedidos existentes continuam na operação,
chat e acompanhamento.

A reabertura após auto-pausa é sempre manual nesta versão.

## Bloqueio de cliente

É sempre por restaurante. Para guest, o telefone normalizado é transformado em
fingerprint tenant/scoped antes de persistir; o telefone em claro não é salvo na
tabela de bloqueios. A listagem administrativa também não devolve esse fingerprint.

O bloqueio pode expirar em 24h, 7 dias, 30 dias ou ser permanente.

## Auditoria

Pausa, reabertura, alteração de capacidade, bloqueio e desbloqueio geram registros
em `online_order_operational_audit` com ator, motivo e snapshot antes/depois.

## Segurança do chat

Mensagens públicas permanecem limitadas a 1000 caracteres e agora possuem quotas
por conversa e IP. As chaves usadas nos rate limits são persistidas somente em hash.
