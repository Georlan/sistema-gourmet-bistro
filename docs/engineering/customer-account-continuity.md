# Continuidade de clientes no cardápio

Atualização em 20/11/2026 — sucessora dos PRs #1428 e #1429.

## Contrato

- Restaurante identificado exclusivamente por seu ID canônico. Tanto slug quanto ID apontam para o mesmo tenant.
- Visitantes continuam comprando com nome e celular sem conta. Reconhecimento público por telefone retorna somente existência, nunca perfil, saldos, endereço ou histórico.
- Nome e celular do visitante ficam apenas na aba atual, sem opção de lembrar contato por 90 dias. Registros anteriores de lembrança de 90 dias são descartados no acesso ao checkout. Nunca persistir endereço entre compras.
- Após pedido, criar conta continua opcional e pré-preenchido; abrir cadastro não cria outro pedido.
- O cookie usa identificador derivado da origem da vitrine e do restaurante: scripts em outra origem de loja não podem recuperar a sessão só por conhecer o ID.
- Após login ou confirmação de cadastro, o backend emite um cookie Secure, HttpOnly, SameSite=None, Partitioned e específico por ID de restaurante, com caminho /cardapio/clientes. Prazo do cookie = CUSTOMER_TOKEN_EXPIRE_MINUTES (padrão de 30 dias). Não persiste senha ou credencial em localStorage.
- Ao abrir outra aba ou voltar ao cardápio, GET /cardapio/clientes/sessao?restaurante_id=... valida JWT, prazo, cliente e tenant no banco antes de restaurar a conta. O token de compatibilidade com endpoints existentes permanece apenas em sessionStorage da aba.
- A restauração devolve dados com Cache-Control: no-store, private; desconexão em uma aba é propagada para as demais sem compartilhar credenciais.
- POST /cardapio/clientes/sessao/sair limpa o cookie. Logout também apaga sessão local e marca ID do restaurante como explicitamente desconectado, evitando reentrada automática quando o dispositivo está offline. O logout não revoga JWT já emitido; o risco residual segue o prazo atual do token.
- Histórico, pontos, cashback e identidade continuam só vinculados ao cadastro mediante confirmação pelo fluxo canônico. Digitar um telefone, sozinho, não autentica nem faz merge de histórico.
- CORS aceita credenciais apenas de origens confiáveis explícitas; o header de logout é autorizado. Navegadores que bloqueiam cookies de terceiros podem não permitir restauração entre abas quando o frontend e a API são cross-site; o login manual permanece disponível.
- Sem migration, sem alteração de pagamentos, pedidos ou dados de produção.

## Validação e reversão

Regressões focalizam cookie, sessão, isolamento e logout, além de remoção da caixa e preservação do pedido único. Reversão por revert do PR; os cookies da versão revertida ficam inertes sem a rota de restauração.
