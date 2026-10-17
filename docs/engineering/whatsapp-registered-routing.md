# WhatsApp central com destinatários do cadastro

## Identidade do restaurante e descadastro compacto

Avisos transacionais ao cliente começam com \u0027*KÔMA | Nome da loja*\u0027 e o pedido/status aparecem com hierarquia curta. A loja é resolvida por tenant na leitura, não por variável global nem pela conta Business. Para cadastros antigos com nome genérico de plataforma \u0027Kôma\u0027, um slug público válido pode servir como identificação comercial (ex.: d8-burger → D8 Burger). Um nome específico configurado na loja sempre prevalece. Isso não altera o cadastro do restaurante.

O link segue em HTTPS, em \u0027/whatsapp/avisos#token=...\u0027; o token novo é compacto (76 caracteres URL-safe em vez do JWT longo), HMAC-SHA256 com tag 128-bit, escopo do restaurante, digest do contato e expiração de 90 dias. O fragmento é removido antes de analytics; nenhuma capability é enviada por GET ou registrada em query/path; a alteração exige confirmação via POST. Links JWT anteriores continuam sendo aceitos até a expiração original. A confirmação é idempotente e os bloqueios permanecem isolados por tenant. Não encurtar o link com redirecionador externo ou com segredo em path/query.


## Bloco 3 — autorização de plataforma e operação central

O Super Admin utiliza **Plataforma → Saúde → WhatsApp Business compartilhado**.
Uma nova permissão de plataforma vive em `configuracoes_restaurante`, protegida pelo RLS existente:

- `whatsapp_platform_managed=false`: mantém a política anterior das allowlists do Railway. A migration não autoriza nenhum restaurante novo, não escreve telefones e não altera as escolhas do dono.
- `whatsapp_platform_managed=true`: os campos `whatsapp_platform_operator_allowed` e `whatsapp_platform_customer_allowed` passam a ser fonte de verdade para a autorização de cada canal. Um canal pode ser suspenso sem desativar o outro; um novo restaurante pode ser autorizado explicitamente sem redeploy.
- `KOMA_CENTRAL_WA_ENABLED` continua como kill switch GLOBAL para o remetente; `KOMA_CUSTOMER_WA_ENABLED` continua independente para avisos ao cliente. A existência de permissão no banco não sobrepõe um kill switch desligado.
- Autorização do Super Admin **não substitui** `whatsapp_customer_notices_enabled` da loja, opt-in do pedido, opt-out nem validade da mensagem. Os envios precisam passar por todos esses gates tanto no enqueue como imediatamente antes do POST à Evolution.

Admin APIs (exclusivas do JWT de Super Admin existente):
- `GET /api/super-admin/whatsapp/overview?limit=25&offset=0`: lê no escopo do tenant; usa `whatsapp_usage_metrics`, outbox e `central_whatsapp_sender_state` para contagens mensais, atrasos e sinalização de TTL. Identidade do remetente **não verificada** sem sondagem. `verify_sender=true` executa apenas o diagnóstico explícito de sessão, sem mensagens.
- `PATCH /api/super-admin/whatsapp/restaurantes/{id}/permissions` com `reason` e pelo menos um booleano `operator_allowed`/`customer_allowed`. Atualização com lock tenant-scoped, cancelamento atômico das pendências do canal revogado e `SuperAdminAuditLog` imutável. Reativação não ressuscita mensagens mortas.

O painel não expõe celulares, mensagens, tokens, hashes de contatos ou valores de segredo.
O contador `accepted` indica exclusivamente HTTP 2xx da Evolution, não entrega/visualização.
Fila próxima da expiração é uma estimativa conservadora por *grupo* de evento, baseada na idade do mais antigo; não representa o número exato de avisos prestes a expirar.
O overview é limitado e manual (sem polling no navegador); totais correspondem à página exibida.
Indicadores de Railway (CPU, memória, rede) são externos e não podem ser inferidos dos contadores de mensagens.
Não há reenvio automático de resultado incerto, alteração no pacing ou novas instâncias Evolution.
Não ativar novos tenants antes de homologar explicitamente o fluxo; a migração por si só mantém o piloto anterior.


## Bloco 2 — observabilidade sem corte arbitrário de avisos

A autorização do restaurante, opt-in por pedido, descadastro por tenant, deduplicação e
a allowlist de plataforma continuam obrigatórios. O `KOMA_CUSTOMER_WA_MONTHLY_MESSAGE_LIMIT`
e o orçamento mensal deixam de ser gates de entrega; não excluir mensagens legítimas
apenas porque um contador atingiu o teto. `KOMA_CUSTOMER_WA_UNIT_COST_BRL` é estimativa
opcional; vazio/inválido significa custo não informado, **não** custo real zero.
O contador legado em `configuracoes_restaurante` continua compatível e cumulativo no
mês UTC. Custos reais dependem do Railway/provedor e não são estimados por isso.

`whatsapp_usage_metrics` persiste agregados UTC por tenant, protegidos por FORCE RLS:
tentativas reservadas, aceites HTTP pelo conector (não entrega no celular), falhas,
descartes, adiamentos e soma/amostras de latência na fila, mais custo unitário estimado
do cliente quando informado. Não contém contatos, IDs de pedido, tokens ou mensagens.
O total do Business compartilhado é a soma desses agregados para os tenants autorizados;
não criar endpoint público nem contornar RLS. Para alertas, comparar deltas no tempo e
backlog real da outbox, sem travar o checkout. Não reivindicar precisão de custos da Meta.

Pacing: `KOMA_CENTRAL_WA_MIN_INTERVAL_SECONDS` tem padrão e mínimo de 15 segundos,
máximo de 120, com janela global atômica por instância compartilhada. Circuito por 429
ou indisponibilidade continua fail-closed, sem simulação de digitação, presença ou
conteúdo humano. Claims da outbox mantêm prioridade operacional/cancelamento e intercalam
restaurantes por prioridade em amostra limitada (justiça de melhor esforço).
Aviso de pedido recebido e alerta de nova comanda expiram em 10 min; pronto, despacho e
cancelamento podem aguardar até 30 min somente enquanto o estado/consentimento continuarem
válidos. Revalidar antes do POST; nunca reenviar resultado incerto automaticamente.

Na homologação, usar somente eventos sintéticos, sem envios reais não autorizados.
Métricas de memória/CPU/rede da Evolution e backend no Railway são complementares;
alertar se backlog se aproximar da janela de validade, se 429/falhas crescerem ou
se o custo de infraestrutura por pedido aumentar de forma sustentada.
Migrar para Cloud API oficial quando a escala, a segurança operacional ou obrigações de
templates/opt-in exigirem; Evolution/Baileys não garante proteção contra bloqueios.

## Consentimento administrativo por restaurante (Bloco 1)

O restaurante agora autoriza **separadamente** duas funções em Configurações → Integrações → WhatsApp:
receber comandas em um telefone cadastrado e permitir que seus compradores escolham receber
avisos no WhatsApp pelo Business KÔMA. O segundo serviço não exige pareamento nem cadastro
de um telefone operacional. Usa `ConfiguracaoRestaurante.whatsapp_customer_notices_enabled`,
default `false`, com POST autenticado `/caixa/configuracoes/whatsapp/customer-notices` restrito
a `configuracoes:administrar`. Somente um restaurante já allowlisted na plataforma pode ativá-lo.

O catálogo público publica somente `avisos_whatsapp_disponiveis` quando há autorização
persistida **e** transporte autorizado da plataforma válido. Não carrega nem expõe telefone ou
identidade da instância operacional. Revogar a autorização invalida imediatamente eventos
pendentes/claimed do cliente daquele tenant e impede novas publicações e despachos. Não
interfere nos avisos ao operador nem apaga histórico/descadastros. Um aviso já aceito por
uma chamada de rede concluída não pode ser revogado retroativamente.

Mensagens utilizam negrito nativo do WhatsApp, identificam o KÔMA como canal de avisos,
não como o restaurante, e explicam o link de descadastro. Não incluir nome de um
comprador em aviso ao cliente sem prova de titularidade do telefone; o operador pode
receber nome da comanda já no contexto autorizado da sua própria loja.

A migration de consentimento é default-off para **todos** os restaurantes, inclusive o
piloto ID 8. O responsável pelo restaurante precisa ativar a nova chave após o deploy
para voltar a oferecer a caixa no checkout. O teto mensal foi substituído por observabilidade no Bloco 2; o intervalo global conservador permanece.

## Contrato

Uma conexão Business KÔMA na Evolution atende os tenants explicitamente liberados. Nenhum número de restaurante/comprador é hardcoded ou configurado por variável de deploy. O remetente e a instância são configuração protegida do transporte; os destinos vêm do banco:

- Operador: `ConfiguracaoRestaurante.whatsapp_recipient_phone`, com marcador `koma-central`, autorização declarada no cadastro e canal individual desligado. A leitura usa o tenant do evento. Uma troca vale para novas tentativas; o endpoint cancela avisos ainda pendentes do cadastro anterior. Se o destinatário mudar durante a consulta do provedor, a tentativa é cancelada antes do POST.
- Cliente: `Comanda.delivery_telefone` da própria comanda, `whatsapp_status_opt_in=true`, conta vinculada compatível quando existir, e ausência de opt-out naquele restaurante/número. Um HMAC na fila impede redirecionar o consentimento para outro contato depois de enfileirar.

Telefone digitado e checkbox não comprovam titularidade. O checkout continua como visitante, sem OTP obrigatório; as mensagens são mínimas, sem endereço, itens, valor ou dados pessoais do cliente. Os avisos ao dono continuam contendo a comanda da própria loja.

## Reuso e eventos

Reaproveita `central_whatsapp`, `IntegrationOutbox`, publicação transacional dos eventos canônicos, dispatcher/worker existentes, `customer_status_whatsapp` e `whatsapp_notice_policy` dos PRs #1119–#1123. Nenhum polling novo, serviço Railway ou conexão Evolution por tenant.

- Aviso do operador quando o pedido online é liberado; autoaceite não gera segundo aviso.
- Cliente: recebido, pronto para retirada OU saiu para entrega, cancelamento/recusa excepcional. Aceite, preparo e conclusão não geram mensagens adicionais.
- Pix pendente/agendamento não liberado não publicam recebido. A transição final só é enfileirada quando a comanda agregada realmente atingiu o estado; um lote parcial pronto não gera aviso prematuro.
- Deduplicação estável por tenant + comanda + marco. TTL de 10 minutos para recebimento/nova comanda e até 30 minutos para avisos críticos, com estado/contato/consentimento revalidados imediatamente antes de enviar. Aviso obsoleto é descartado, não convertido em outra mensagem.
- Prioridade: operador, cancelamento, demais eventos/final, recebido do cliente.

## Controle compartilhado e orçamento

`central_whatsapp_sender_state` é estado técnico GLOBAL do transporte, sem telefone, credenciais ou conteúdo. Um lock curto persiste uma janela configurável de no mínimo 15 segundos por instância Business e circuito compartilhado. Nenhum lock SQL é mantido durante chamadas HTTP. Um 429 abre pausa de cinco minutos para todos os tenants do remetente; três falhas de disponibilidade também abrem circuito. Estados de tentativas incertas não são reenviados automaticamente.

A contabilidade do cliente continua sob lock da configuração do tenant, por mês UTC. Não há mais bloqueio por orçamento ou quantidade mensal. A nova tabela de métricas mantém tentativas e resultados após a limpeza da outbox. Uma tarifa estimada opcional não equivale a custo oficial da Meta ou custo de infraestrutura.

## Descadastro

A mensagem leva a `/whatsapp/avisos#token=...` no app. O token contém apenas tipo, tenant, hash do contato e validade. O fragmento é retirado antes de inicializar analytics; não é colocado em query/path, armazenamento local ou logs. A página só envia o token no corpo de um POST depois da confirmação. Abrir/visualizar o link não muda estado. Uma chave de tipo diferente não autoriza o descadastro.

`whatsapp_contact_opt_outs` guarda somente HMAC + tenant e data, com FORCE RLS. Bloqueia avisos pendentes e futuros do contato nesse restaurante, inclusive se um novo checkout marcar a caixa. Não bloqueia pedidos nem usa preferências de marketing do CRM. Ainda não existe fluxo de reativação do número na UI; não apagar bloqueios manualmente para simular homologação.

## Rollout

Todas as flags novas são default-off. A implantação do código não muda envs automaticamente.

- `KOMA_CENTRAL_WA_ENABLED` + `KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS`: somente tenants liberados; vazio/malformado/wildcard bloqueia. Se a lista estiver ausente, o antigo `KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID` continua funcionando como um único tenant.
- `KOMA_CENTRAL_WA_OPERATOR_PHONE` e `KOMA_CENTRAL_WA_PILOT_CUSTOMER_PHONE` deixam de governar os destinos. Não há fallback para eles.
- `KOMA_CUSTOMER_WA_ENABLED` + `KOMA_CUSTOMER_WA_ALLOWED_RESTAURANT_IDS`: liberação INDEPENDENTE para cliente, intersectada com a central. Se a lista nova estiver ausente, só herda o antigo tenant único do piloto, nunca uma lista expandida de operadores.
- O catálogo público expõe `avisos_whatsapp_disponiveis` somente se há transporte/configuração/autorização válidos para aquele tenant. A UI não depende mais da flag de build global.
- Teste manual inicial: restaurante 8 e contatos explicitamente autorizados pelo usuário. Não ativar outros tenants. ID6 permanece somente leitura.
- Para o teste do amigo, liberar apenas o fluxo do tenant8 depois dos gates e conferência do transporte. O usuário faz o pedido e marca a caixa voluntariamente; o agente não envia mensagem independente nem cria pedido real por conta própria.

Evolution é o transporte temporário de homologação solicitado pelo usuário; não há promessa de impedir bloqueio do provedor. Aceite HTTP é registrado como aceite do conector, nunca como confirmação de leitura/entrega física.

## Verificação e reversão

Testes cobrem cadastro dinâmico, destinos separados, opt-in/opt-out, TTL, estado atrasado, agregação, deduplicação, timeout, 429/circuito compartilhado, orçamento durável, RLS e corrida real de reserva em PostgreSQL. Testes de browser cobrem checkout com/sem checkbox, consentimento inicialmente desmarcado, ausência de OTP e confirmação do descadastro sem capability em URL/logs.

Em regressão: desligar a liberação afetada, preservar fila/contador e usar revert por PR. Não executar downgrade destrutivo de preferências/contadores ou reabrir dead letters para testar.
