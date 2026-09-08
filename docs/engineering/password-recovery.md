# Recuperação de senha com Resend

O envio fica **desabilitado por padrão**. Esta PR não configura produção, não
verifica domínio e não envia mensagens reais durante os testes.

Configuração no servidor:

- `PASSWORD_RECOVERY_ENABLED=false`: manter assim até verificar o domínio no Resend.
- `RESEND_API_KEY`: segredo configurado somente no ambiente do servidor.
- `EMAIL_FROM`: endereço de remetente autorizado no domínio verificado; sem padrão no código.
- `KOMA_PUBLIC_APP_URL`: origem confiável do frontend, usada para criar os links.

Depois da verificação do domínio e da configuração das variáveis, habilitar
`PASSWORD_RECOVERY_ENABLED=true` e validar a entrega com uma conta de teste autorizada.
Referência do transporte: [Resend — Send Email](https://resend.com/docs/api-reference/emails/send-email).

O endpoint de solicitação responde genericamente para contas existentes,
inexistentes, visitantes e contas limitadas por cota. Operadores são resolvidos
pela busca canônica de identidade; clientes sempre informam o restaurante ativo.
Para operadores com o mesmo e-mail em vários restaurantes, cada link é limitado à
respectiva identidade e o e-mail identifica o restaurante.

Tokens expiram em 15 minutos, usam chave derivada exclusiva para recuperação,
purpose explícito, nonce aleatório e prova HMAC vinculada à identidade, restaurante,
e-mail e hash atual da senha. A confirmação bloqueia a linha da identidade antes
de comparar a prova e trocar a senha. O novo hash invalida todos os links anteriores,
inclusive em confirmações concorrentes. Nenhum reset adota um registro guest.

O reset revoga sessões operacionais pelo mecanismo canônico de versões. Para
clientes, a migração `3b4c5d6e7f80` adiciona `password_reset_at`; tokens de sessão
emitidos antes dessa data deixam de servir tanto para perfil quanto para checkout.
O fluxo nunca autentica automaticamente após o reset.

O token vai no fragmento do link, é removido da URL antes de iniciar o monitoramento
do frontend, não entra em localStorage e é enviado ao servidor apenas no corpo da
confirmação. Logs do transporte registram somente falha/status, sem destinatário,
conteúdo, token ou segredo. Os limites persistidos usam fingerprints, além da
barreira de IP já usada no backend.

Testes cobrem transporte simulado, envio desligado, visitantes, expiração, alteração
do token, isolamento, revogação e concorrência real com RLS no PostgreSQL. Os testes
não substituem a verificação do domínio e o teste posterior de entrega real.
