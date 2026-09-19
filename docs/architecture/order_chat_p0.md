# Chat de pedido: commit, transporte e feed

O pedido continua sendo autoridade de status (`Comanda`/lifecycle). O chat tem
mensagens humanas em `order_messages` e uma projeção histórica independente em
`order_conversation_events`. Nenhuma transição nova ou motivo de recusa é gravado
como mensagem humana. Eventos não participam de unread nem da última mensagem.

## Transação e entrega

- Escrita, evento de feed e `pg_notify` usam a mesma transação. PostgreSQL só
  entrega a notificação após commit; rollback, inclusive de savepoint, a descarta.
- O canal `koma_order_chat` leva tenant, conversa, tipo e chave do registro (ou
  identidade do leitor). Limite defensivo de 1 KiB, sem texto, token ou histórico.
- Cada processo mantém uma conexão PostgreSQL LISTEN dedicada, iniciada/encerrada
  no lifespan. As filas em memória são somente a última etapa do fan-out SSE.
- O listener relê os registros confirmados sob o tenant e preserva os nomes SSE
  existentes. `status`/`status_changed` inclui `feed_event`; o status atual vem do
  pedido. `message`/`new_message` continua carregando a mensagem serializada.
- `connected` só é emitido depois de LISTEN pronto. Uma reconexão do listener
  invalida a geração do stream; o cliente reconecta e relê o snapshot HTTP.
  Falha de leitura após commit não transforma uma escrita confirmada em erro.
- SQLite usa after_commit, com snapshots de savepoints e BEGIN explícito antes
  do primeiro savepoint quando necessário. Não é transporte entre instâncias.

## Contratos e compatibilidade

`GET .../messages` mantém o array cronológico limitado, agora uma projeção mista:
`kind=message` para humanos, `kind=order_event` para contexto. O discriminador
`sender_type=system` permanece apenas nessa projeção para renderizadores antigos.
O campo canônico `sender_type` da tabela de mensagens aceita somente customer/staff.

O navegador gera um UUID por envio e o reutiliza em retry. A unique constraint
`(conversation_id, client_message_id)` arbitra corridas. O perdedor recupera a
mensagem existente sem abortar a transação externa. Retry da mensagem confirmada
funciona mesmo após encerramento da conversa; nova mensagem permanece bloqueada.
Chaves de outro tipo de remetente retornam 409. `client_message_id` segue opcional
para clientes antigos, que não recebem garantia de deduplicação sem uma chave.
As chaves humanas antigas em `event_key` continuam reconhecidas.

## Migração e operação

`i8d9e0f1a2b3` migra todos os registros system para a nova tabela, preservando ID,
texto, encoding e horário, restringe a tabela humana e converte client_message_id
para UUID nativo no PostgreSQL (UUID portátil no SQLite). A tabela nova tem RLS
ENABLE/FORCE e policy por tenant. A migração exige a role administrativa já usada
no pre-deploy; falha se não puder enxergar todas as linhas. Downgrade restaura as
linhas de sistema antes de remover a tabela.

A mudança de constraint exige coordenar migração e substituição dos processos:
processos antigos ainda escrevem motivo de recusa em `order_messages`. Não manter
uma versão antiga servindo essas escritas após a migração. LISTEN exige conexão
direta ou pool em modo sessão; pool transacional não mantém a inscrição.

SSE é aviso, não log durável. Cursor/delta, paginação, política de retenção,
rascunhos e demais mudanças P1/P2 não fazem parte deste bloco. Os consumidores
continuam conciliando pelo snapshot existente.

## Verificação

`test_order_chat_p0.py` cobre commit/rollback/savepoint, feed separado, retries após
encerramento e conteúdo mínimo do sinal. `test_order_chat_p0_postgres.py` cobre dois
listeners independentes, concorrência real customer/staff e upgrade/downgrade com
RLS. Exige `ORDER_CHAT_TEST_DATABASE_URL` local descartável; usa schemas isolados.
O workflow `order-chat-targeted.yml` provisiona PostgreSQL 16 para essas regressões.
O teste de navegador cobre feed e perda de resposta HTTP em desktop/mobile.
