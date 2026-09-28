# Cadastro de clientes por e-mail com Resend

O cadastro normal do cliente do Cardápio Digital usa o e-mail como prova primária
da conta. O WhatsApp não participa do caminho feliz e permanece disponível apenas
quando já existe uma ficha guest no mesmo restaurante e é necessário provar a
posse do telefone antes de herdar histórico, pontos ou cashback.

## Fluxo

1. `POST /cardapio/clientes/cadastro/solicitar` recebe nome, e-mail, telefone e
   senha. A senha é transformada em hash antes de ser persistida.
2. O backend persiste uma solicitação tenant-scoped, guarda somente o HMAC do
   token e envia pelo Resend um link em
   `/confirmar-cadastro#token=...`.
3. A página de confirmação remove o fragmento da URL antes do monitoramento e
   envia o token apenas no corpo de
   `POST /cardapio/clientes/cadastro/confirmar`.
4. Sem ficha anterior para o telefone, a conta é criada com
   `email_verificado_em` preenchido e `telefone_verificado_em` vazio.
5. Se o telefone já pertence a uma ficha guest, a confirmação por e-mail não
   reivindica essa identidade. O usuário precisa solicitar e confirmar o OTP
   telefônico; somente então a ficha original recebe e-mail/senha, preservando o
   mesmo `Cliente.id`, pedidos, pontos e cashback.

Pedidos públicos anônimos também não são vinculados automaticamente a uma conta
que tenha credenciais mas cujo telefone ainda não foi comprovado. Pedidos
autenticados continuam vinculados por `Cliente.id`.

## Configuração

O transporte reutiliza `RESEND_API_KEY`, `EMAIL_FROM` e
`KOMA_PUBLIC_APP_URL`. O cadastro fica desligado por padrão até homologação:

- `CUSTOMER_EMAIL_REGISTRATION_ENABLED=false`
- `CUSTOMER_EMAIL_VERIFICATION_TTL_SECONDS=900`
- `CUSTOMER_EMAIL_RESEND_SECONDS=60`
- `CUSTOMER_EMAIL_MAX_SENDS=5`
- `CUSTOMER_EMAIL_MAX_IP_REQUESTS=20`

Nunca coloque a chave do Resend ou o token de confirmação no frontend, logs ou
localStorage.

## Segurança

- O token contém apenas propósito, restaurante e id da solicitação dentro de um
  envelope Fernet autenticado.
- O banco armazena somente HMAC do token.
- Reenvio rotaciona o token.
- A confirmação é de uso único porque a solicitação é consumida na criação da
  conta.
- Limites persistidos protegem IP, e-mail e telefone.
- A tabela de solicitações usa RLS por `restaurante_id` no PostgreSQL.
- Confirmar e-mail nunca preenche `telefone_verificado_em`.
- O downgrade da migration é bloqueado se já houver contas verificadas apenas
  por e-mail, evitando perder a distinção de segurança entre e-mail e telefone.

A recuperação de senha continua independente em
`/auth/password-recovery/*` e o login continua em
`POST /cardapio/clientes/login` com e-mail e senha.
