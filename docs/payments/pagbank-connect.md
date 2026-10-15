# PagBank no KÔMA

O restaurante autoriza sua própria conta no PagBank pelo botão em **Configurações → Integrações**. A API cria o Pix com o token desse restaurante, sem split nem comissão KÔMA. A assinatura KÔMA continua separada; eventuais tarifas são do PagBank. Novas intenções de pagamento têm taxa KÔMA zero em todos os provedores; valores históricos não são recalculados.

## Primeiro cadastro da plataforma

1. A KÔMA precisa de uma conta de desenvolvedor no Sandbox PagBank e do token da plataforma. O restaurante não informa tokens, client secret ou chave de API.
2. Criar a aplicação Connect pelo endpoint oficial `POST /oauth2/application`, com nome KÔMA, descrição do sistema, site e logo público da marca. A URL de retorno cadastrada deve ser exatamente a configurada no servidor: `<KOMA_PUBLIC_API_URL>/payments/pagbank/oauth/callback`.
3. Guardar as credenciais somente no ambiente do backend: `PAGBANK_ENV=sandbox`, `PAGBANK_CLIENT_ID`, `PAGBANK_CLIENT_SECRET`, `PAGBANK_APP_TOKEN` e `PAGBANK_OAUTH_REDIRECT_URI`. Não usar prefixo `VITE_`.
4. Publicar a migração e a aplicação, mantendo sandbox. Autorizar uma conta Sandbox, emitir e pagar um Pix simulado e coletar evidências de autorização, criação, notificação, consulta financeira e liberação única do pedido. Verificar com PagBank qual token assina as notificações Connect da aplicação; a implementação aceita SHA256 do corpo bruto com o token do vendedor atual/anterior (sem aceitar token ou segredo da plataforma).
5. Solicitar a homologação oficial de **Connect + API de Pedidos com Pix**. Manter `PAGBANK_ENV=sandbox` no backend compartilhado e configurar produção somente pelo opt-in por restaurante abaixo, após aprovação. Confirmar especificamente que a aplicação tem permissão para criar `/orders` em nome dos vendedores conectados.
6. Um restaurante piloto deve ter conta PagBank e ao menos uma chave Pix ativa. Após autorizar a aplicação, fazer uma transação real pequena e conferir o crédito no extrato, a liberação no Caixa e a ausência de comissão KÔMA. Não usar o restaurante ID 6 para testes de escrita.

Ao mudar de Sandbox para produção, o restaurante precisa autorizar novamente a conta no ambiente de produção. Contas e intenções de outro ambiente não são reutilizadas.

Sem credenciais, a interface mostra **Conexão em preparação**. Sandbox é identificado como teste e não é comprovante de recebimento real. Este código não conclui cadastro, homologação, deployment ou teste bancário real por si só.

## Contratos e correções em relação ao relatório inicial

- O Pix atual da API Order usa `charges[].payment_method.type=PIX`, valor inteiro em centavos e `charges[].qr_code.text`. O payload antigo baseado apenas em `qr_codes` está depreciado para Pix.
- CPF/CNPJ do comprador é obrigatório na API. O cardápio pede esse dado quando PagBank é o recebedor; a borda valida os dígitos verificadores antes de criar a cobrança. O documento não é incluído nas respostas públicas nem no evento de auditoria de webhook.
- O `state` documentado tem limite de 128 caracteres. A implementação usa estado compacto autenticado com HMAC, validade de dez minutos e vínculo com o estado salvo na sessão do navegador. O callback retorna ao aplicativo; a conclusão exige o token autenticado do mesmo administrador e restaurante. Isso evita cookies de terceiros entre Railway e o domínio do aplicativo. PKCE não é presumido como requisito do Connect.
- O webhook da API Order documenta `x-authenticity-token = SHA256(token + '-' + corpo bruto)`. ECDSA/`x-payload-signature` pertence à documentação de outro serviço de notificações e não foi presumido como contrato da API Order. Confirmar o contrato efetivo durante a homologação.
- A notificação nunca aprova o pedido por si: o backend consulta o pedido no PagBank com a credencial do restaurante e verifica referência, identificador, moeda e valor antes de reutilizar o serviço financeiro e a outbox existentes.
- A deduplicação financeira continua transacional; notificações repetidas não criam pagamentos ou pedidos duplicados. A auditoria usa hash de conta + corpo e guarda somente o ID externo, sem dados do comprador.
- Conectar PagBank seleciona esse recebedor para novas cobranças e desativa o Pix manual. A troca de conta e a desconexão são bloqueadas enquanto há intenções pendentes. Credenciais de outros provedores não são revogadas durante a seleção, permitindo conciliação de intenções antigas.
- O adapter não inventa cancelamento de Pix pendente: consulta a situação real. Estorno PagBank pela interface ainda não faz parte desta entrega; a proteção financeira bloqueia baixa local sem devolução confirmada. A devolução deve ser feita no PagBank e conciliada antes de registrar o estorno.
- Somente uma cobrança Pix em BRL por pedido é aceita. Pedidos com múltiplas cobranças ou outro meio de pagamento são rejeitados para revisão.

## Fontes oficiais consultadas em 10/10/2026

- [Connect](https://developer.pagbank.com.br/docs/connect)
- [Criar aplicação](https://developer.pagbank.com.br/reference/criar-aplicacao)
- [Connect Authorization](https://developer.pagbank.com.br/docs/connect-authorization)
- [Obter access token](https://developer.pagbank.com.br/reference/obter-access-token)
- [Renovar access token](https://developer.pagbank.com.br/reference/renovar-access-token)
- [Pix via charges](https://developer.pagbank.com.br/reference/criar-pedido-com-qr-code-pix-v2)
- [Objeto Order](https://developer.pagbank.com.br/reference/objeto-order)
- [Autenticidade Order](https://developer.pagbank.com.br/reference/confirmar-autenticidade-da-notificacao)
- [Solicitar homologação](https://developer.pagbank.com.br/docs/solicitar-homologacao)

## Validação local histórica (10/10/2026)

Esta seção registra a validação da primeira entrega; não descreve o cadastro ou deploy atuais. As credenciais de aplicação de produção e a conexão do piloto foram configuradas posteriormente. Isso não comprova homologação ou recebimento.

- 990 testes unitários de frontend aprovados; TypeScript e build aprovados.
- 8 cenários de navegador em 390 e 1366 pixels aprovados, incluindo autorização única e recusa de sessão divergente.
- Suíte backend ampla executada: 2.261 passaram inicialmente; as expectativas antigas de taxa, uma consulta adicional e a dependência ausente identificadas foram corrigidas. Reexecução dos módulos afetados: 219 aprovados e 1 teste PostgreSQL ignorado por ausência de banco efêmero local.
- Migração SQLite verificada em upgrade/downgrade; PostgreSQL e a confirmação bancária real ainda dependem da homologação/configuração.
- Nenhuma credencial PagBank real foi configurada e nenhuma operação de pagamento foi feita em produção.


## Recuperação financeira e isolamento (10/10/2026)

- O relógio local não encerra Pix PagBank ou Mercado Pago: somente um estado terminal observado em consulta autenticada passa pelo finalizador canônico, com estorno de estoque e fechamento idempotentes. `WAITING` após vencer o QR continua indeterminado, sem fabricar `expired`.
- `reconciliation_attempted_at` é persistido atomicamente antes da consulta: no máximo uma tentativa por intenção a cada três segundos, ou sessenta segundos depois do vencimento local, inclusive quando a chamada falha e com múltiplas abas/processos. O vencimento não ignora o limite. Não é um lock durante toda a chamada HTTP; consultas que duram além do intervalo podem se sobrepor, mas seus efeitos passam por locks e idempotência canônicos.
- A consulta pública continua tentando enquanto o cliente acompanha o pedido. Webhooks autenticados podem reconciliar sem esperar o polling. Sem navegador aberto, a recuperação depende do webhook ou da fila administrativa abaixo; não foi introduzido um worker financeiro global.
- Administradores consultam `GET /payments/pagbank/reconciliation` e repetem `POST /payments/pagbank/reconciliation/{intent_id}` usando a sessão normal do restaurante. A fila não retorna tokens nem CPF/CNPJ, inclui horário da última tentativa e marca revisão após quinze minutos do vencimento ou uma falha registrada. O retry respeita o mesmo limite e nunca confirma por payload do administrador.
- Operação: verificar essa fila no início e no fechamento do turno e sempre que um cliente relatar pagamento sem confirmação. Indisponibilidade persistente ou `WAITING` quinze minutos após vencer exige revisão no PagBank/suporte. Não trocar recebedor, cancelar localmente nem reenviar cobrança enquanto a situação estiver incerta. Após restabelecer a API, repetir a reconciliação; se continuar indeterminada, manter o registro e escalar ao PagBank. Não existe prazo seguro que transforme ausência de evidência em pagamento não realizado.
- Aprovação posterior a um encerramento definitivo permanece bloqueada para revisão humana; o webhook registra evento `failed` com indicação de divergência financeira, sem reabrir cozinha nem duplicar estoque. Conferir no PagBank e resolver a entrega/devolução com autorização do responsável.
- Falhas de webhook ficam auditadas sem corpo ou dados pessoais. A assinatura SHA256 aceita apenas o token atual/anterior do vendedor; `PAGBANK_APP_TOKEN` e `PAGBANK_CLIENT_SECRET` não são autoridades alternativas. A retenção cobre uma rotação anterior, não um histórico ilimitado de tokens. Polling autenticado recupera notificações antigas rejeitadas.
- A documentação de [assinatura ECDSA](https://developer.pagbank.com.br/reference/validacao-de-autenticidade) apresenta outro contrato e ressalva a URL de produção. Não ativar esse contrato por suposição nem misturar assinaturas: a aplicação continua no contrato Order `x-authenticity-token` até o PagBank confirmar qual serviço/assinatura está habilitado para o Connect. Assinatura ausente ou divergente continua em 401.
- O `state` OAuth é autenticado por ambiente, administrador e restaurante, com validade de dez minutos. A interface exige correspondência com a sessão que iniciou o fluxo; a conclusão exige autenticação do mesmo administrador. O código de autorização é de uso único no PagBank; seu consumo precisa ser comprovado no teste real OAuth, além dos mocks.

### Produção sem substituir Sandbox

Executar testes isolados localmente e no CI; não criar ou religar homologação permanente paga no Railway. Para o piloto de produção, usar somente a seleção por restaurante descrita abaixo. Não alterar `PAGBANK_ENV` no backend compartilhado nem copiar tokens de vendedores entre ambientes. Esta entrega não provisiona infraestrutura.

Antes de habilitar, confirmar com PagBank: Connect de produção homologado, permissão de `payments.read`/`payments.create` para Pix Order em nome dos vendedores, callback exato `/payments/pagbank/oauth/callback`, contrato de assinatura dos webhooks Connect e token que assina durante renovação. O piloto deve ter conta recebedora própria e chave Pix ativa. Apenas o titular autoriza o pagamento real após conferir destinatário e valor.

### Credenciais previamente expostas

Tratar `PAGBANK_APP_TOKEN`, `PAGBANK_CLIENT_ID`, `PAGBANK_CLIENT_SECRET`, access/refresh tokens do vendedor Sandbox e credenciais de login de teste anteriormente compartilhadas como candidatos a intervenção. `CLIENT_ID` é identificador público, não segredo; sua troca só ocorre se a aplicação for recriada. Não reproduzir valores nem rotacionar globalmente. Inventariar cobranças pendentes e contas vinculadas; reconciliar os pagamentos antes de revogar tokens; coordenar rotação/reautorização por ambiente com o PagBank. Não rotacionar `SECRET_KEY` ou `ENCRYPTION_KEY` como atalho: afeta sessões/credenciais criptografadas de outros provedores. Ausência em scan do Git não prova ausência em logs ou conversas anteriores.

### Piloto de produção por restaurante

Com `PAGBANK_ENV=sandbox`, o backend pode selecionar produção somente para os IDs explicitamente listados em `PAGBANK_PRODUCTION_RESTAURANT_IDS` (lista separada por vírgulas). Os demais restaurantes continuam usando as credenciais e o host Sandbox. O piloto exige `PAGBANK_PRODUCTION_CLIENT_ID`, `PAGBANK_PRODUCTION_CLIENT_SECRET` e `PAGBANK_PRODUCTION_APP_TOKEN`; nenhuma dessas credenciais usa fallback para as de Sandbox. `PAGBANK_PRODUCTION_OAUTH_REDIRECT_URI` deve coincidir com o cadastro da aplicação; se omitida, usa o callback HTTPS já configurado.

O estado OAuth é vinculado ao ambiente selecionado do restaurante: alterar a seleção invalida autorizações em andamento. A nova conexão exige autorização do titular em produção e continua bloqueada se houver pagamentos pendentes de uma conta/ambiente anterior. A criação de novas cobranças exige conta autorizada no ambiente selecionado. Consultas de intenções anteriores, webhooks, renovação e revogação usam o ambiente persistido da conta original, permitindo reconciliar Sandbox antes da troca sem enviar tokens de vendedores ao outro host.

Essa seleção é uma configuração explícita de piloto, não uma prova de homologação, permissão para `/orders`, liquidação ou funcionamento integral. O cadastro da aplicação com HTTP 201 não garante a liberação da API Order. Não incluir o restaurante ID 6 na lista de piloto. Remover o ID da lista exige a mesma revisão de pendências e reautorização; não desfazer a seleção durante um pagamento em andamento.


### Retorno OAuth no mesmo domínio e recusa de produção

O início da conexão usa o `Origin` da requisição autenticada, aceitando somente os domínios oficiais KÔMA ou a origem configurada no servidor. Um identificador curto dessa origem é incluído no estado autenticado (limite de 128 caracteres); o callback retorna ao mesmo domínio. Assim, iniciar em `app.komafood.com.br` não transfere a conclusão para `komafood.com.br`, onde localStorage/sessionStorage e a sessão são diferentes. Estados antigos sem identificador continuam usando a origem configurada. Não enviar tokens de sessão na URL nem compartilhar credenciais entre domínios.

Conectar a conta não comprova liberação da API de Pedidos em produção. Em 11/10/2026, o piloto conectado em produção recebeu HTTP 403 na criação de Pix, sem ID de pedido bancário registrado; o responsável confirmou que apenas cadastrou a aplicação e conectou a conta, sem homologação. Solicitar ao PagBank homologação/liberação de `POST https://api.pagseguro.com/orders` com Pix em nome dos vendedores via Connect. Verificar permissões da aplicação e da conta recebedora. Não trocar para Pix manual ou Sandbox para mascarar a recusa. O checkout diferencia a falta de autorização de um erro transitório e mantém a tentativa idempotente.

Fonte oficial: https://developer.pagbank.com.br/docs/codigos-de-status

### Rastreio e retorno em outra aba (11/10/2026)

A aba que inicia a conexão grava apenas o estado aleatório em sessionStorage e um registro de validade de dez minutos no localStorage da mesma origem. Isso permite concluir em outra aba do mesmo navegador depois de autenticar o mesmo administrador, sem transportar códigos ou tokens para armazenamento compartilhado. Origens, perfis e navegadores diferentes continuam isolados; o servidor mantém a validação de MAC, ambiente, restaurante, administrador e prazo. Retornos desconhecidos não apagam uma autorização válida em andamento. Estados antigos em sessionStorage continuam compatíveis.

A investigação das 17:33–17:38 encontrou callback 303 sem POST /complete; não comprovou a causa no navegador original. O cenário de retorno em outra aba agora tem regressão simulada própria, mas não foi declarado como causa confirmada desse incidente.

Recusas da API passam a conservar apenas o código técnico validado em error_messages e o identificador de requisição do PagBank (quando fornecido). O corpo bruto, descrições, documentos e tokens não são registrados. Logs de acesso ocultam code/state e credenciais de query string. O diagnóstico novo se aplica às chamadas futuras; não recupera a resposta descartada no incidente anterior.

Antes da homologação, ainda é necessário obter evidências genuínas de Connect + Order no Sandbox e validar qual token assina o webhook de Order criado via Connect. Não substituir assinatura por suposição, não declarar mocks como logs do banco e não apagar intenções de erro para forçar troca/desconexão de conta.

## Continuidade do protocolo 1461335012

O escopo atual pretendido é Connect OAuth + Order Pix, sem cartão, boleto, split ou comissão KÔMA. Em 12/10/2026 foram lidos os dois e-mails originais de 10/10/2026 na conta Gmail do titular, ambos encontrados no Spam: abertura e triagem do chamado 1461335012. A triagem exige mascarar cartão/omitir CVV, IDs reais, JSON de request/response Sandbox, `payment_method.type`, endpoint Sandbox e interpretação dos logs; boleto requer análise manual. O item `type` enumera cartão/boleto, sem mencionar Pix. Solicitar confirmação da atualização do escopo no chamado existente, usando a referência oficial Pix v2; não atribuir ao suporte aprovação de Pix nem dispensar requisitos de Sandbox. Evidências de produção com HTTP 403 não substituem logs Sandbox.

- Todos os escritores de recebedor travam a linha do restaurante antes de alterar contas. Pix `created`, `pending` ou `error` impedem troca de provedor/vendedor/ambiente; renovar o mesmo vendedor continua permitido.
- Uma identidade de vendedor/ambiente com histórico não pode ser sobrescrita: os intents atuais referenciam restaurante/provedor, sem conta versionada. Trocar de provedor preserva a conta anterior para consulta histórica.
- Estados com mais de um recebedor ativo, inclusive Pix Direto legado, deixam de oferecer Pix público e são rejeitados na criação. O Pix manual continua fora da interface atual.
- A conta titular da aplicação é rejeitada quando o identificador foi verificado e configurado em `PAGBANK_APPLICATION_OWNER_ACCOUNT_ID` (Sandbox) ou `PAGBANK_PRODUCTION_APPLICATION_OWNER_ACCOUNT_ID` (piloto). Obter o `account_id` por `GET /oauth2/application/{client_id}` autenticado no ambiente correspondente. Sem essa configuração, a proteção adicional de titularidade não está ativa; não inferir por nome ou documentos. As demais proteções de tenant permanecem obrigatórias.

### Homologação Connect Sandbox com titular da aplicação — somente QA ID 9 (15/10/2026)

Conforme resposta do PagBank no chamado **1462968488**, o consentimento no Connect Sandbox pode utilizar a **conta principal proprietária da aplicação**, com login antecipado no Portal do Desenvolvedor. Contas adicionais não acessam o Sandbox. Esse consentimento **não autoriza** vincular a titular da plataforma como recebedora de pedidos dos restaurantes.

Para gerar apenas os logs reais da troca OAuth de uso único, habilitar **somente no backend**:

- `PAGBANK_SANDBOX_OAUTH_EVIDENCE_RESTAURANT_IDS=9` (captura sanitizada existente).
- `PAGBANK_SANDBOX_QA9_OAUTH_EVIDENCE_ONLY=true` (opt-in separado; ausente ou qualquer outro valor mantém bloqueio).

O bypass de **persistência**, não de validação, só existe com essas duas condições **e** `restaurant_id == 9` **e** ambiente efetivo `sandbox`. Não se aplica ao D8/ID 8, a outros tenants nem a nenhuma conta em produção, independentemente de variáveis. O fluxo continua validando state assinado, prazo, administrador, tenant e credenciais Sandbox antes de trocar o código. No retorno de sucesso, o backend registra metadados sanitizados reais de `POST /oauth2/token` e evento `connection_evidence_only`, devolvendo `sandbox_evidence_captured` à interface. **Não grava access_token/refresh_token, não cria ou habilita RestaurantPaymentAccount, não altera o Pix Direto, não seleciona provedor recebedor e não cria pedidos ou cobranças.** A interface apresenta sucesso da evidência, mas mostra PagBank como **não conectado**. O token só existe em memória durante a resposta bancária e não deve ser compartilhado ou copiado para coleta manual.

Desabilitar `PAGBANK_SANDBOX_QA9_OAUTH_EVIDENCE_ONLY` depois de coletar e revisar os logs; manter o bloqueio normal da conta titular para conexão financeira. Caso o PagBank retorne erro, registrar apenas status HTTP e presença de campos, sem declarar sucesso na obtenção de token. Não repetir códigos OAuth antigos. Para testes financeiros posteriores, utilizar vendedor independente ou estratégia aprovada e não esse modo de evidência.

### Captura de evidências genuínas

`scripts/pagbank-sandbox-evidence.py` aceita somente o host Sandbox e não importa o banco KÔMA. A operação `application` consulta o cadastro; `create` e `get` exigem o token OAuth individual do vendedor em `PAGBANK_SANDBOX_SELLER_ACCESS_TOKEN`. Nunca substituir por `PAGBANK_APP_TOKEN`. O consentimento e a troca de código devem ocorrer pelo fluxo canônico do KÔMA; o coletor não consome códigos nem persiste tokens.

Credenciais entram por ambiente, nunca argumentos ou arquivos de evidência. O payload privado do comprador (`--request-file`) fica fora do Git e dos anexos. Usar idempotência em `PAGBANK_SANDBOX_IDEMPOTENCY_KEY`. O coletor preserva IDs técnicos e códigos de erro, remove cartão/CVV/segredos (incluindo aliases de headers/camelCase), mascara documentos formatados e conteúdo do QR e omite descrições/mensagens livres que podem ecoar dados privados. Salva endpoint, horário UTC, método, request, response, status e resultado sem sobrescrever evidências existentes. Explicar o resultado em texto separado após revisão do JSON; a sanitização não dispensa inspeção humana antes do envio.

Consulta da aplicação com HTTP 200 **não comprova** vendedor autorizado, criação de Order, QR, pagamento, webhook ou conciliação. Testes com fixtures/mocks devem ficar separados do pacote bancário. Não enviar pacote como homologação completa enquanto faltarem request/response reais de `/orders`, consulta e confirmação pertinente. Confirmar com o PagBank o mecanismo de assinatura aplicável especificamente ao Connect + Order antes de alegar validação de webhook real.
