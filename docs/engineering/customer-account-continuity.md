# Continuidade do cliente no cardápio

Escopo aprovado em 20/11/2026: reduzir redigitação de telefone e incentivar conta após compra. Base: `38ff84ae`.

## Contrato e comportamento

- `restaurante.id` retornado pelo cardápio é a chave de armazenamento, tanto na entrada por `/c/:slug` quanto por `restaurante_id`. Slugs não viram identidades de clientes.
- Visitantes continuam comprando pelo contato. Reconhecimento público retorna somente existência, nunca perfil, endereço, saldos ou autenticação.
- Nome e celular podem ser lembrados com opção explícita por até 90 dias desde o último uso. A opção existe no checkout e na autenticação. Apenas esses dois campos são duráveis; endereço, e-mail, senha e token não entram nesse armazenamento.
- Sem opção marcada, permanece a memória da aba. Desmarcar remove a lembrança durável. Sair da conta limpa também o contato do visitante neste restaurante. Trocar telefone limpa o nome em edição para não enviar o de outra pessoa.
- O sucesso da compra mantém acompanhamento como ação principal e oferece cadastro opcional com nome e telefone preenchidos. Abrir cadastro finaliza somente a apresentação do checkout; não cria outro pedido.
- Conta usa os endpoints canônicos existentes de cadastro por e-mail e confirmação de telefone quando já há ficha. `Cliente.id`, histórico e saldos são preservados pelo backend após verificação. Nenhuma fusão entre restaurantes e nenhuma associação de histórico baseada apenas em telefone digitado foram introduzidas.
- Tokens de conta continuam limitados à aba; a lembrança de contato é conveniência, não sessão autenticada persistente. O envio de e-mail/WhatsApp depende das integrações existentes. Não foram enviados testes a clientes reais.

## Evidência e reversão

- Regressões unitárias: opt-in, nova aba, isolamento, expiração, exclusão, ausência de endereço/e-mail/token duráveis e armazenamento bloqueado.
- Browser com API simulada em 390 e 1366 px: fechar/reabrir aba, retorno por slug após entrada por ID, outro restaurante, remoção da opção, convite pós-compra, cadastro preenchido, envio ao tenant correto e pedido único.
- Suíte backend existente `test_customer_email_registration.py`: sete testes, incluindo confirmação de telefone, preservação de ID/saldos e isolamento entre restaurantes.
- Sem migrations, mudanças no backend ou configurações de produção. Reverter o commit do PR restaura o fluxo anterior. A chave `koma_remembered_contact:<id>` deixa de ser lida ao reverter e possui expiração validada na leitura quando esta versão é usada.
