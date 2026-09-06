# Entrega Universal de Impressão

## Objetivo

Reduzir o tempo entre o `commit` de um `PrintJob` e a chegada do cupom ao
Spooler sem transformar rede, WebSocket/SSE ou o agente local em fonte de
verdade. A fila PostgreSQL continua autoritativa e o Print Agent continua sem
conhecer regras de pedido, preço, produto ou cliente.

## Arquitetura

```text
Qualquer canal
    |
    v
PrintIntent -> PrintingApplicationService -> PrintJob
                                           |
                                        COMMIT DB
                                           |
                +--------------------------+-------------------------+
                |                                                    |
                v                                                    v
       PostgreSQL NOTIFY                                    PrintJob persistido
       restaurante_id apenas                                      (verdade)
                |                                                    |
                v                                                    |
       Backend LISTEN/fanout                                        |
                |                                                    |
                v                                                    |
       SSE /print-agents/events                                     |
                |                                                    |
                v                                                    |
       agente acorda imediatamente ---------------------------------+
                |
                v
        POST claim-batch
                |
                v
       journal local -> Spooler RAW -> impressora
```

O evento SSE não contém `payload_text`, `job_id` nem chave de idempotência. Ele
é somente um *hint*. Se for perdido, o agente continua consultando a fila por
polling. Ao reconectar no SSE, o servidor envia `ready`, fazendo o agente tentar
`claim-batch` imediatamente para recuperar qualquer trabalho criado durante a
queda.

## Por que PostgreSQL NOTIFY

O trigger é transacional: a notificação só é entregue após o `commit`. Isso
impede o agente de acordar para um trabalho que ainda pode sofrer rollback.
Também funciona com múltiplas réplicas do backend: qualquer réplica que mantém
um agente SSE pode receber o `NOTIFY` emitido por uma transação executada em
outra réplica.

A mensagem contém apenas `restaurante_id`. O conteúdo continua no banco e só é
entregue após autenticação e `claim` atômico por tenant.

## Fallback

- Push disponível: o agente acorda pelo SSE e mantém polling de segurança em 1 s.
- Push indisponível/degradado: volta automaticamente ao `KOMA_POLL_SEC` normal
  (0,5 s por padrão).
- Backend antigo sem `/events`: o agente detecta 404/405 e continua somente em
  polling.
- Agente antigo: continua usando `claim-batch`/polling sem qualquer mudança de
  contrato.

Isso permite rollout independente de backend e agente.

## Observabilidade

Além das métricas locais já existentes (`fila_ms`, `reserva_api_ms`,
`envio_spooler_ms`), o backend registra `print_pipeline_commit` para toda
transação que cria `PrintJob`, com:

- `transaction_to_job_ms`: início da transação SQLAlchemy até o job ser
  materializado no banco;
- `transaction_to_commit_ms`: início da transação até o commit que torna o job
  visível ao agente;
- quantidade de jobs, destinos, tipos de documento e IDs técnicos dos jobs.

Isso cobre o trecho que antes não aparecia no `agent.log` e permite comparar
pedido novo, adição de item, reimpressão e fechamento sem instrumentar cada canal
separadamente.

## Invariantes

1. `PrintJob` é a única fonte de verdade para trabalho físico.
2. Push nunca substitui `claim-batch`.
3. PostgreSQL continua garantindo concorrência por `FOR UPDATE SKIP LOCKED`.
4. Journal local continua sendo gravado antes do ACK remoto.
5. Confirmação HTTP continua fora do caminho crítico do papel.
6. Falha de SSE/NOTIFY não perde impressão; apenas ativa o fallback.
7. Nenhuma borda de negócio fala diretamente com o agente.
8. Todo canal futuro que convergir para `PrintJob` ganha o wake-up automaticamente.

## Meta operacional

Medir separadamente:

```text
transação -> PrintJob -> commit -> wake-up -> claim -> spooler -> papel
```

O alvo continua sendo p95 <= 2 s do comando do operador ao início do papel em
rede estável. O push reduz especificamente a espera ociosa entre `commit` e
`claim`; tempos anteriores ao `PrintJob` agora ficam explícitos para otimização
posterior caso sejam o gargalo dominante.
