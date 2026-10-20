# WhatsApp e impressão: correção de elegibilidade e retries

## Baseline verificado em 20/10/2026

Base: `fbabc3f1` de `origin/main`. Produção consultada somente em leitura.
Às 14h22 America/Fortaleza, desde 18/10 00h00 local, o restaurante 6 tinha
178 registros `status_pedido` e 40 `atribuicao_motoboy`, todos `falhou`,
`error_title = Automação de WhatsApp desativada.` e sem `wamid`.
As flags consultadas de avisos operacionais, cliente e autorização de cliente
pela plataforma estavam falsas. Havia 95 jobs `printed`, sem outros estados
nesse recorte. O agente principal informava versão `2026.09.27.1`.

Esses registros legados são bloqueios internos: `whatsapp.py` retorna antes de
abrir cliente HTTP. Não são 218 requisições à Evolution nem falhas de entrega.
O recorte não mede todo tráfego externo. `printed` confirma registro pelo agente,
não papel. A amostra HTTP recente continha claims/heartbeats/confirmações 200;
não permite declarar recuperação dos 401 anteriores, atribuí-los ao ID 6 ou
identificar um dispositivo por IP. A consulta de logs não respeitou o filtro
401 pedido; não interpretar a amostra resultante como busca exaustiva por 401.

## Caminhos e política

- Eventos canônicos de pedidos persistem `IntegrationOutbox` transacionalmente.
  Avisos para restaurante usam `tenant_order_whatsapp` ou `central_whatsapp`;
  cliente usa `customer_whatsapp_dispatch`. A criação de evento de domínio
  continua necessária mesmo quando não há comunicação elegível.
- Existia também caminho legado em `orders_core`/`orders` → BackgroundTasks →
  `notificacoes` → transporte global. Criava `NotificacaoWhatsApp` antes do kill
  switch e não exigia consentimento do cliente. Agora o kill switch corta antes
  de consultas, tarefa e registro. Atribuição ao entregador exige habilitação
  operacional do tenant, sem tomar emprestado o consentimento do cliente.
- Status legado exige permissão do tenant, opt-in do pedido, contato e cliente
  no mesmo tenant e ausência de opt-out. Verifica antes de agendar e na tarefa.
  Se a outbox canônica de cliente estiver liberada, ela possui os marcos; o legado
  não duplica o envio. Nenhuma dessas checagens consulta conexão na Evolution.
- Após reservar notificação pendente, revalida autorização e libera transação
  antes do HTTP. Revogação retorna `ignorado`. Repetir evento não reenvia falha
  anterior, inclusive resposta incerta; não há replay do histórico ao habilitar.
  A linha da Comanda serializa tarefas concorrentes no PostgreSQL. O registro
  pendente permanece como proteção conservadora em crash durante tentativa.
- Outbox do restaurante já limitava a três tentativas, espera exponencial e
  circuito; agora expira em dez minutos, inclusive antes de espera por vazão ou
  circuito, e revalida associação/permissão após verificar conexão. Reconexão
  não libera aviso vencido. Resultados incertos do provedor continuam terminais.
- Outbox central já revalida consentimento depois da verificação do provedor,
  tem limite de tentativas, espaçamento compartilhado e expiração por estado:
  dez minutos para recebido/operador e trinta para outros marcos do cliente.
  A conexão é verificada pelo worker após elegibilidade e reserva de vazão,
  não na transação de cada pedido. Não foi introduzido cache de conexão no
  sender: ele enfraqueceria a checagem de identidade da sessão. O diagnóstico
  legado tem cache próprio, que não substitui a validação de envio.

## Agente de impressão

Credenciais de agente são permanentes até revogação; o backend valida hash e
vínculo tenant a cada autorização (cache é hint, não concessão). Já existem
single-instance lock, journal local, claim atômico e processamento separado de
heartbeat e confirmações. Não foram alterados leases, roteamento, validade de
diagnóstico nem o contrato de confirmação física.

A versão atual já encerra em 401 e pede pareamento explícito. Portanto o código
atual não prova a causa da tempestade observada em instalações antigas.
Versão instalada e processos duplicados continuam lacunas dos clientes rejeitados.
Não revogar tokens ou reiniciar instalações reais com base nessa hipótese.

Correções adicionais:

- Heartbeat 403 deixa de ser tratado como prova de revogação e não apaga token.
- 403 aguarda pelo menos 60 segundos; falhas transitórias usam jitter exponencial
  com teto de 30 segundos. `Retry-After` numérico ou HTTP-date pode ampliar a espera.
- SSE segue a mesma política, fecha resposta antes da espera e continua em 401
  terminal. EOF imediato não significa recuperação; evento real reinicia backoff.
- Fallbacks antigos `claim-next`/`next` respeitam o orçamento compartilhado do claim.
- Confirmação e heartbeat não ficam bloqueados pelo orçamento de claim. O journal
  continua preservando efeitos ambíguos, sem reimpressão automática.

Essas mudanças exigem distribuir e atualizar o executável do agente. Publicar só
backend não altera binário instalado. Reautenticação é necessária apenas para
credencial efetivamente rejeitada com 401, após identificar a instalação. 403
não autoriza remover credenciais. Versionamento novo: `2026.10.20.1`.

## Varredura adicional, sem refatoração ampla

`useCashierRealtime`: fallback de 12s somente sem WS, operação ativa e página
visível; listeners têm cleanup. SmartPOS usa `createVisibleRefresh` para coalescer
invalidações e polling. `authFetch` possui timeout de 12s e não repete POSTs.
`DirectPixPendingPanel` consulta a cada 15s visível, inclusive sem pendências;
pode coincidir com uma atualização manual. É candidato menor para coalescência,
mas não foi alterado junto da conciliação recém-integrada em #1179. Esses são
intervalos de código, não medidas de tráfego ou prova de tempestade em produção.

## Publicação, observação e reversão

1. Revisar PR e checks no SHA final. Não fazer merge/deploy neste trabalho.
2. Após autorização futura, publicar backend e confirmar SHA servido; nenhuma
   mudança de flags, replay de outbox ou alteração da fila acompanha a publicação.
3. Distribuir agente separadamente, preservando credencial, journal e configurações.
   Não prometer correção dos clientes antigos pelo deploy do servidor.
4. Observar passivamente múltiplas janelas de heartbeat/TTL e operação real:
   idade da fila, novos claims, confirmação, diagnósticos e rejeições. Não criar
   pedidos, cobranças, mensagens ou impressões de teste no tenant 6.
5. Validar versão efetivamente instalada. Queda de requisições sem diagnóstico
   fresco/avanço de trabalho não é recuperação. Papel exige confirmação própria.
6. Reverter commits via PR se houver regressão. Não apagar filas, journal nem
   credenciais; não reenviar resultados incertos. Rever fila envelhecida antes
   de qualquer reativação autorizada de consumidor.

## Monitores hospedados: acesso e limites deste trabalho

Foram lidos os alertas recentes de infraestrutura e saúde publicados na conversa
`Monitoramento de quatro agentes`, além do prompt completo e execução recente
`KÔMA — saúde dos pedidos` na conversa de execução vinculada. Os alertas de
infraestrutura repetiam o mesmo incidente a cada mudança de contagem; os de saúde
tratavam bloqueio pré-envio por configuração como falha de entrega.

A pasta local `automations` estava vazia. As ferramentas disponíveis não expõem
listagem/edição das automações ChatGPT hospedadas que originaram esses alertas.
A interface de navegador disponível também falhou ao carregar sua política de
acesso. Não foi possível identificar com segurança a configuração editável dos
três monitores nem ler o prompt completo de infraestrutura e erros de uso.
Nenhum monitor foi duplicado, reconfigurado ou enviado a outra conversa. O
contrato revisado neste repositório está preparado para a atualização posterior
dos prompts existentes; não alegar que a documentação altera o agendamento ativo.

PostHog 648305 foi confirmado como KÔMA Production, fuso America/Fortaleza.
A taxonomia consultada (snapshot 20/10 14h16 local) lista eventos do funil público
e exceções, mas não os dois eventos operacionais; a consulta específica de
propriedades de `operational_api_signal` também não encontrou definição. Isso
não é prova de ausência definitiva de ingestão: não foi feita consulta exaustiva
a eventos brutos. A API servia `fbabc3f15a9e`, que inclui os arquivos de analytics
via #1179, apesar de #1176 estar fechado sem merge. Novos sinais permanecem
sem comprovação de ingestão; nenhum relatório depende deles neste trabalho.
