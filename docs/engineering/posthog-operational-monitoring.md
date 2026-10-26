# PostHog: diagnóstico operacional com volume limitado

Projeto: 648305. Preservar o funil público existente e o dashboard 2178362.

## Contrato de eventos

- `operational_screen_viewed`: `surface=cashier`, `screen` e `sub_screen` são identificadores internos da navegação. Emitido na entrada e mudança de aba, sem ler texto do DOM. Repetições imediatas são coalescidas.
- `operational_action`: intenção de navegação do menu lateral do Caixa (`action=cashier_navigation`) e tentativa/resultado do envio da adesão (`action=signup_checkout`, `target=credit_card|pix`, `outcome=requested|blocked|succeeded|failed`). O sucesso da adesão significa resposta HTTP aceita, não cobrança ou recebimento financeiro. Não captura texto de botões, formulário, token de cartão nem resposta de erro.
- `operational_api_signal`: `endpoint` normalizado com segmentos desconhecidos substituídos por `:id`, `method`, `status`, `duration_ms`, `outcome` (`http_error`, `network_error`, `slow`); `request_id` apenas quando possui formato hexadecimal/UUID válido. Falha de rede usa status 0. Respostas bem-sucedidas com duração >= 3000 ms geram sinal lento.
- Superpropriedades existentes: `frontend_build_sha`, `frontend_build_time`. A navegação do Caixa acrescenta `operational_screen` e `operational_sub_screen`; logout remove esse contexto.

A captura só começa após inicialização bem-sucedida do SDK, com token configurado. Sem token é no-op. Não capturar corpos, headers de autorização, parâmetros, fragmentos ou mensagens da API. Não ativar autocapture genérico nem Session Replay. Apenas chamadas à origem da API; SSE/WS conhecidos ficam excluídos. A observação preserva Response e rejeição originais, ignora AbortError e não lê o body.

Limite: 30 sinais de API por janela de cinco minutos por página, com no máximo um por endpoint/método/status/outcome por minuto. O buffer de diagnóstico local retém apenas os últimos 100 registros. Esses limites NÃO representam amostragem estatística uniforme: contagens de sinais não são contagens totais de requisições e percentis sobre sinais não são latência global. Consultar Railway para volume, taxa de erro e percentis reais; desconsiderar duração de conexões SSE/WS nesses cálculos.

## Roteiro dos monitores

1. Descobrir eventos/propriedades reais no PostHog antes de consultar. Código implementado, PR aberto, merge, build publicado e primeiro evento recebido são evidências diferentes.
2. Procurar exceções e sinais novos na última hora; usar janelas equivalentes e ampliar somente se volume baixo. Agrupar por endpoint/status/tela/build e sessões anonimizadas quando disponíveis. Não transmitir identidade pessoal em relatórios.
3. Usar request_id válido para correlacionar logs Railway, sem inferir tenant de IP. A tela corresponde ao contexto do navegador no momento do envio; não prova a origem da requisição assíncrona.
4. Comparar versões com sessões/tráfego suficientes, diferenciando novo erro de aumento de uso. Não interpretar ausência de sinal como ausência de erro, nem queda de tráfego como recuperação.
5. Repetir alertas apenas com agravamento, novo impacto ou recuperação comprovada. Não gerar pedidos, pagamentos, impressão ou mensagens para validar produção.

## Cobertura e reversão

A navegação explícita cobre o Caixa e suas abas, incluindo Relacionamento; ações cobrem menu lateral e envio da adesão, sem comprovar cobertura de cada botão, Garçom ou Super Admin. O observador de API cobre fetch do navegador após inicialização; não cobre agentes Python, backend, XHR nem requisições anteriores. Cliques sem efeito e rage clicks permanecem não instrumentados. Não descrever esses eventos explícitos como `$pageview`, `$rageclick` ou `$dead_click`.

Validar com fixtures e testes locais, typecheck, suíte unitária e build. Após eventual publicação, verificar build SHA e ingestão passiva sem pedidos de teste no ID 6. Para reverter, reverter o PR; não alterar dados operacionais nem as filas. Nenhuma infraestrutura paga é necessária.

## Classificação de notificações e impressão

No legado, `falhou` com motivo exato `Automação de WhatsApp desativada.` é
bloqueio anterior ao HTTP: classificar como ignorado por configuração, separado
de tentativa de envio recusada, indisponibilidade de conexão e resultado incerto.
Não reclassificar ou apagar linhas históricas em produção. No caminho corrigido,
a elegibilidade negativa não cria registro/tarefa; ausência desses registros não
prova entrega. Na outbox operacional, estado terminal `delivered` com motivo
`Ignorado:` (ou `Avisos desativados.`) significa encerramento sem envio por
compatibilidade: contar separadamente de aceite do provedor. `wamid`, 2xx e
`printed` têm níveis de evidência distintos de entrega no aparelho e papel.

Manter por incidente: janela local e UTC, causa, primeira/última observação,
contagem na janela, fila/idade, build/versão instalada, tenant/dispositivo apenas
quando verificados, fonte, limites e lacunas. Token inválido desconhecido não
identifica tenant; IP não é dispositivo. Não expor token, hash de credencial,
telefone, URL de acompanhamento ou conteúdo dos pedidos em relatórios.

Agrupar o mesmo problema por causa e escopo seguro. Variação cumulativa pequena
não é incidente novo. Repetir por causa nova, impacto novo, fila envelhecendo,
intensidade sustentada em janelas equivalentes ou recuperação com evidência
positiva de funcionamento. Ausência de requests, sinal PostHog ou atividade fora
do horário não demonstra recuperação. Não inferir volume global das amostras.

Em 20/10/2026 o PR #1176 estava fechado sem merge registrado, enquanto este
contrato já existia na main. Descobrir a implementação publicada e ingestão reais
antes de exigir eventos novos; estado do PR isolado não determina cobertura.
Atualização deste documento não atualiza os prompts das automações hospedadas.

No caminho central, `dead_letter` com motivo de expiração, consentimento revogado
ou canal desativado também é encerramento sem tentativa, quando não há evidência
de POST ao provedor. Separar essa categoria de recusa HTTP e resposta incerta;
`attempts` pode incluir reserva/verificação de conexão, não só `sendText`.

## Diagnóstico de envio do Cardápio

`public_checkout_result` complementa o funil existente com **um resultado por
clique de envio que passou pelas validações locais**, sem um evento por campo.
Distingue `accepted`, `http_error`, `network_error`, `timeout`, `invalid_response`,
`catalog_changed`, `ordering_blocked`, `session_expired` e `client_error`.
Uma rejeição de negócio não equivale a indisponibilidade do sistema; separar
por resultado, etapa e status ao investigar. Não emitir `$exception` artificial
para cada 4xx nem ativar replay/autocapture.

Campos permitidos: `restaurant_id` (contexto declarado pelo frontend, não
credencial/autoridade), `attempt_id` aleatório de 32 caracteres hexadecimais,
`support_code`, `stage`, `status`, `duration_ms` limitada a 120 s e `request_id`
validado quando houve resposta. Release e navegador vêm da integração existente.
Não enviar mensagem da exceção, body, sacola, nome, telefone, endereço,
idempotency key, token de cliente/tracking ou resposta do pagamento.

O POST usa `X-Request-ID` já aceito pelo backend. Não adiciona endpoint, consulta,
escrita no banco, worker ou dependência. O GET do catálogo continua sem header
extra, evitando novo preflight CORS. Cada retry tem outro identificador técnico;
a **chave de idempotência continua a mesma** quando o conteúdo não mudou. Não
usar o ID de diagnóstico como autorização ou como chave para criar pedidos.

A falha mostra `Suporte: <código>` copiável junto à orientação existente. O código
usa o request ID da resposta; se não houve resposta, usa o ID local da tentativa.
O checkout declara a posse do erro inline usando `fetchWithInlineSupport`
(um Request marcado somente em memória); o aviso global 5xx não se sobrepõe
aos erros da atualização do catálogo nem do POST. Não há flag ou header de
supressão enviado à API. O
catálogo permanece responsável pelas validações antes do envio. Uma confirmação
aceita significa pedido confirmado pelo backend, não pagamento aprovado ou
impressão física.

Limite independente de 20 resultados por 5 minutos por documento. Mesmo acima
do limite, sem SDK, com bloqueador, ou com falha da coleta, o fluxo e o código de
suporte continuam funcionando; se não houver gerador criptográfico, omite-se o
ID local e o evento, preservando o pedido. Não usar essa coleta limitada como
censo de conversão, total de erros ou SLO. O ring buffer existente guarda somente
100 eventos em memória; não há fila durável nova nem replay offline.

### Investigar uma reclamação

1. Pedir código de suporte, restaurante e horário aproximado com fuso. Não pedir
   telefone/documento do consumidor para procurar um erro.
2. No projeto KÔMA Production (648305), filtrar `public_checkout_result` por
   `support_code` e período. Conferir etapa, resultado, status, request ID,
   navegador e release. A ausência do evento não prova ausência de falha.
3. Consultar `npm run ops:trace -- <código>`; quando houver `request_id`, usar o
   ID completo também. O comando pesquisa Railway nas últimas 24 h por padrão;
   ampliar a janela explicitamente quando necessário e houver retenção.
4. `network_error` pode significar rede, CORS, DNS ou bloqueador: não atribuir
   causa sem evidência. `timeout` significa confirmação incerta: consultar os
   registros canônicos, não recriar pedido manualmente. Se o POST não chegou
   à API ou a resposta se perdeu, pode não existir log correspondente ao código
   local. Erros na atualização do catálogo usam o ID daquela resposta.
5. Para erro reproduzível, usar fixture local, nunca pedido sintético no tenant 6.
   Registrar a correção e comprovar separadamente CI, versão servida e ingestão.

Referências: [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet/)
(interaction identifier e exclusão de dados sensíveis) e
[PostHog JS](https://posthog.com/docs/libraries/js) (eventos explícitos).

### Cobertura compartilhada entre módulos

Os sinais HTTP existentes agora carregam `surface` (superfície do host) e `area`
normalizada: `printing`, `payments`, `orders`, `delivery`, `catalog`, `auth` ou
`other`. A categoria usa somente nomes fixos de rotas, com precedência de
impressão/pagamentos sobre comandas; segmentos dinâmicos continuam mascarados.
Isso permite separar falhas de Cardápio, Caixa, Garçom e Entregador sem instalar
observadores por tela. O budget HTTP existente permanece independente do
resultado do checkout. Superfície/área ajudam a filtrar; não provam a causa.

Limites: XHR, eventos de WebSocket, falhas físicas de impressora, confirmação do
provedor de pagamento e regras locais de formulário precisam de evidência própria;
sucesso HTTP ou ausência de sinal não comprovam esses efeitos. Esta fundação não
instala um capturador global de payloads ou mensagens de WebSocket. Os registros
canônicos de fila/PrintJob, pagamentos e reconexão continuam sendo a autoridade.

### Envelope obrigatório de ingestão

O SDK adiciona `properties.token` com a **chave pública do projeto PostHog**.
Removê-la em `before_send` faz o SDK 1.437 descartar todos os eventos antes da
rede. O sanitizador de transporte agora repõe exclusivamente a chave configurada
no inicializador, depois de remover os campos sensíveis. Nunca reutiliza o valor
`token` recebido do chamador; JWTs, capabilities, tokens aninhados e dados pessoais
continuam removidos. O buffer de negócio/debug continua sem tokens.

A regressão usa o SDK instalado em um build de produção com chave pública
fictícia e destino loopback interceptado no Playwright. Verifica aceitação pelo
SDK, privacidade e chegada ao transporte, sem credenciais ou serviços de produção.
