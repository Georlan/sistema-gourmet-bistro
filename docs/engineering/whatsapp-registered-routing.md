# WhatsApp central com destinatários do cadastro

## Consentimento administrativo por restaurante (Bloco 1)

O restaurante agora autoriza **separadamente** duas funções em Configurações → Integrações → WhatsApp:
receber comandas em um telefone cadastrado e permitir que seus compradores escolham receber
avisos no WhatsApp pelo Business KÔMA. O segundo serviço não exige pareamento nem cadastro
de um telefone operacional. Usa `ConfiguracaoRestaurante.whatsapp_customer_notices_enabled`,
default `false`, com POST autenticado `/caixa/configuracoes/whatsapp/customer-notices` restrito
a `configuracoes:administrar`. Somente um restaurante já allowlisted na plataforma pode ativá-lo.

O catálogo público publica somente `avisos_whatsapp_disponiveis` quando há autorização
persistida **e** transporte/cota da plataforma válidos. Não carrega nem expõe telefone ou
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
para voltar a oferecer a caixa no checkout. O limite mensal de tentativas e a vazão
globais permanecem como estavam; sua revisão está reservada ao Bloco 2.

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
- Deduplicação estável por tenant + comanda + marco. TTL de 10 minutos, estado/contato/consentimento revalidados imediatamente antes de enviar. Aviso obsoleto é descartado, não convertido em outra mensagem.
- Prioridade: operador, cancelamento, demais eventos/final, recebido do cliente.

## Controle compartilhado e orçamento

`central_whatsapp_sender_state` é estado técnico GLOBAL do transporte, sem telefone, credenciais ou conteúdo. Um lock curto persiste uma janela de 15 segundos por instância Business e circuito compartilhado. Nenhum lock SQL é mantido durante chamadas HTTP. Um 429 abre pausa de cinco minutos para todos os tenants do remetente; três falhas de disponibilidade também abrem circuito. Estados de tentativas incertas não são reenviados automaticamente.

O orçamento do cliente é reservado sob lock da configuração do tenant: mês UTC, tentativas e custo persistidos. Conta também falhas/incertezas e não estorna automaticamente. A retenção da outbox, recadastro ou remoção de telefone não apagam contadores. Tarifa explícita e teto de mensagens são obrigatórios, mesmo que a tarifa seja zero; o orçamento padrão é R$10. A tarifa é informada por operação, não inferida como uma tarifa da Meta/Evolution. Custos de infraestrutura não são medidos por esse contador.

## Descadastro

A mensagem leva a `/whatsapp/avisos#token=...` no app. O token contém apenas tipo, tenant, hash do contato e validade. O fragmento é retirado antes de inicializar analytics; não é colocado em query/path, armazenamento local ou logs. A página só envia o token no corpo de um POST depois da confirmação. Abrir/visualizar o link não muda estado. Uma chave de tipo diferente não autoriza o descadastro.

`whatsapp_contact_opt_outs` guarda somente HMAC + tenant e data, com FORCE RLS. Bloqueia avisos pendentes e futuros do contato nesse restaurante, inclusive se um novo checkout marcar a caixa. Não bloqueia pedidos nem usa preferências de marketing do CRM. Ainda não existe fluxo de reativação do número na UI; não apagar bloqueios manualmente para simular homologação.

## Rollout

Todas as flags novas são default-off. A implantação do código não muda envs automaticamente.

- `KOMA_CENTRAL_WA_ENABLED` + `KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS`: somente tenants liberados; vazio/malformado/wildcard bloqueia. Se a lista estiver ausente, o antigo `KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID` continua funcionando como um único tenant.
- `KOMA_CENTRAL_WA_OPERATOR_PHONE` e `KOMA_CENTRAL_WA_PILOT_CUSTOMER_PHONE` deixam de governar os destinos. Não há fallback para eles.
- `KOMA_CUSTOMER_WA_ENABLED` + `KOMA_CUSTOMER_WA_ALLOWED_RESTAURANT_IDS`: liberação INDEPENDENTE para cliente, intersectada com a central. Se a lista nova estiver ausente, só herda o antigo tenant único do piloto, nunca uma lista expandida de operadores.
- O catálogo público expõe `avisos_whatsapp_disponiveis` somente se há transporte/configuração/cota válidos para aquele tenant. A UI não depende mais da flag de build global.
- Teste manual inicial: restaurante 8 e contatos explicitamente autorizados pelo usuário. Não ativar outros tenants. ID6 permanece somente leitura.
- Para o teste do amigo, liberar apenas o fluxo do tenant8 depois dos gates e conferência do transporte. O usuário faz o pedido e marca a caixa voluntariamente; o agente não envia mensagem independente nem cria pedido real por conta própria.

Evolution é o transporte temporário de homologação solicitado pelo usuário; não há promessa de impedir bloqueio do provedor. Aceite HTTP é registrado como aceite do conector, nunca como confirmação de leitura/entrega física.

## Verificação e reversão

Testes cobrem cadastro dinâmico, destinos separados, opt-in/opt-out, TTL, estado atrasado, agregação, deduplicação, timeout, 429/circuito compartilhado, orçamento durável, RLS e corrida real de reserva em PostgreSQL. Testes de browser cobrem checkout com/sem checkbox, consentimento inicialmente desmarcado, ausência de OTP e confirmação do descadastro sem capability em URL/logs.

Em regressão: desligar a liberação afetada, preservar fila/contador e usar revert por PR. Não executar downgrade destrutivo de preferências/contadores ou reabrir dead letters para testar.
