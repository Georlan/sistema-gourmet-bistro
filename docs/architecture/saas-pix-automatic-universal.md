# Pix Automático universal — cobrança SaaS KÔMA

## Decisão de produto

O método chamado **Pix Automático** no checkout SaaS do KÔMA significa exclusivamente a jornada interoperável do arranjo Pix:

1. o KÔMA cria uma autorização de recorrência;
2. o cliente recebe **QR Code e/ou Pix Copia e Cola** de autorização;
3. o cliente autoriza no banco/PSP que já utiliza, desde que compatível com Pix Automático;
4. a autorização não exige conta ou login Mercado Pago do pagador;
5. as cobranças futuras são executadas no trilho Pix;
6. o recebedor da mensalidade é a **conta Mercado Pago do KÔMA**.

O checkout hospedado de `/preapproval` ou `/preapproval_plan` do produto de Assinaturas do Mercado Pago **não satisfaz este requisito** e não pode ser apresentado ao cliente como Pix Automático universal.

## Separação dos fluxos

### Cartão recorrente

Continua na integração de assinatura já homologada. Tokenização e autorização do cartão permanecem independentes deste documento.

### Saldo Mercado Pago

Pode continuar usando produto/checkout Mercado Pago, desde que a UI identifique explicitamente que é **Saldo Mercado Pago** e que o fluxo seja homologado ponta a ponta.

### Pix de pedidos

O Pix de pedidos do Cardápio Online é um Pix avulso. Ele já pode gerar `qr_code`, `qr_code_base64` e `ticket_url` através da API de pagamentos e pode incluir `application_fee` no modelo marketplace. Este fluxo não cria autorização recorrente e não deve ser reutilizado como se fosse Pix Automático.

### Pix Automático SaaS

Possui adapter próprio (`saas_pix_automatic.py`) e fica **fail-closed** até que o PSP recebedor forneça/ative uma API capaz de cumprir a jornada universal definida acima.

## Contrato mínimo do provider

A futura implementação precisa retornar e persistir, no mínimo:

- `provider_authorization_id` — identificador da autorização/recorrência;
- `status` — `pending`, `authorized`, `rejected`, `cancelled` ou equivalente normalizado;
- `qr_code` — payload interoperável de autorização;
- `qr_code_base64` ou imagem equivalente, quando fornecida;
- `copy_paste` — código de autorização Pix Copia e Cola;
- `expires_at` — validade da jornada de autorização;
- `payer_psp` quando disponível;
- `external_reference` igual ao protocolo contratual KÔMA;
- dados suficientes para confirmar valor, periodicidade e recebedor sem confiar no frontend.

## Invariantes de segurança

- KÔMA/FastAPI permanece como fonte de verdade do contrato, valor e estado da assinatura.
- Nenhum QR de Pix avulso pode ativar uma assinatura recorrente.
- Nenhum checkout que exija conta Mercado Pago do pagador pode ser anunciado como Pix Automático universal.
- A autorização precisa ser confirmada no backend por consulta/webhook do provider antes de liberar o restaurante.
- Idempotência deve impedir duas recorrências para o mesmo protocolo.
- O trial de 7 dias continua começando somente após a implantação essencial, conforme a regra canônica atual.
- Segredos, tokens e chaves privadas nunca são enviados ao frontend nem persistidos em logs.
- Produção permanece indisponível (`pix_automatic=false`) enquanto a capability interoperável não estiver homologada.

## Recebimento

A conta recebedora alvo é a conta Mercado Pago do KÔMA. Diferentemente dos pagamentos de pedidos de restaurantes, a mensalidade SaaS não usa split/application fee: **100% da mensalidade pertence ao KÔMA**.

O uso do Mercado Pago como PSP recebedor não altera a exigência de interoperabilidade do pagador. O cliente deve poder autorizar pelo banco/PSP compatível que preferir.

## Gate para habilitar em produção

`pix_automatic` só pode voltar a `true` quando todos os itens abaixo estiverem confirmados:

- API de Pix Automático recebedor habilitada para a conta Mercado Pago do KÔMA;
- QR Code/Copia e Cola de autorização gerados pelo provider;
- autorização concluída com pelo menos um banco externo ao Mercado Pago;
- webhook/consulta confirma o identificador da recorrência e o protocolo KÔMA;
- cancelamento homologado;
- primeira cobrança pós-trial homologada sem cobrança antecipada;
- falha/retentativa homologada;
- recebimento confirmado na conta Mercado Pago do KÔMA;
- regressões automatizadas verdes e capability fail-closed testada.
