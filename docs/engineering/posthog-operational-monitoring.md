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
