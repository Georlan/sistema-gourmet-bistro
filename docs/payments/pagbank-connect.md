# PagBank no KÔMA

O restaurante autoriza sua própria conta no PagBank pelo botão em **Configurações → Integrações**. A API cria o Pix com o token desse restaurante, sem split nem comissão KÔMA. A assinatura KÔMA continua separada; eventuais tarifas são do PagBank. Novas intenções de pagamento têm taxa KÔMA zero em todos os provedores; valores históricos não são recalculados.

## Primeiro cadastro da plataforma

1. A KÔMA precisa de uma conta de desenvolvedor no Sandbox PagBank e do token da plataforma. O restaurante não informa tokens, client secret ou chave de API.
2. Criar a aplicação Connect pelo endpoint oficial `POST /oauth2/application`, com nome KÔMA, descrição do sistema, site e logo público da marca. A URL de retorno cadastrada deve ser exatamente a configurada no servidor: `<KOMA_PUBLIC_API_URL>/payments/pagbank/oauth/callback`.
3. Guardar as credenciais somente no ambiente do backend: `PAGBANK_ENV=sandbox`, `PAGBANK_CLIENT_ID`, `PAGBANK_CLIENT_SECRET`, `PAGBANK_APP_TOKEN` e `PAGBANK_OAUTH_REDIRECT_URI`. Não usar prefixo `VITE_`.
4. Publicar a migração e a aplicação, mantendo sandbox. Autorizar uma conta Sandbox, emitir e pagar um Pix simulado e coletar evidências de autorização, criação, notificação, consulta financeira e liberação única do pedido. Verificar com PagBank qual token assina as notificações Connect da aplicação; a implementação aceita SHA256 do corpo bruto com o token do vendedor atual/anterior ou token da plataforma.
5. Solicitar a homologação oficial de **Connect + API de Pedidos com Pix**. Só após a aprovação configurar as credenciais de produção e `PAGBANK_ENV=production`. Confirmar especificamente que a aplicação tem permissão para criar `/orders` em nome dos vendedores conectados.
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

## Validação local

- 990 testes unitários de frontend aprovados; TypeScript e build aprovados.
- 8 cenários de navegador em 390 e 1366 pixels aprovados, incluindo autorização única e recusa de sessão divergente.
- Suíte backend ampla executada: 2.261 passaram inicialmente; as expectativas antigas de taxa, uma consulta adicional e a dependência ausente identificadas foram corrigidas. Reexecução dos módulos afetados: 219 aprovados e 1 teste PostgreSQL ignorado por ausência de banco efêmero local.
- Migração SQLite verificada em upgrade/downgrade; PostgreSQL e a confirmação bancária real ainda dependem da homologação/configuração.
- Nenhuma credencial PagBank real foi configurada e nenhuma operação de pagamento foi feita em produção.
