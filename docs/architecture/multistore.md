# Multilojas — primeira etapa

Administradores e gerentes encontram **Trocar loja** no menu do Caixa, em celular e desktop. Confirmam as credenciais da unidade de destino; quando o login encontra várias contas com a mesma senha, escolhem a loja antes de autenticar novamente. A troca só ocorre depois de uma confirmação explícita, com aviso de descarte de alterações não salvas.

## Autorização e sessão

- O responsável pela autorização continua sendo `POST /auth/login`, com seus controles de senha, estado da conta, rate limit, tenant e versão de token. O seletor não concede permissões.
- Cada unidade precisa ter uma conta ativa para esse operador, com perfil de administrador ou gerente. O cadastro/convite de equipe existente cria esses acessos. Compartilhar e-mail não cria vínculo nem acesso automaticamente.
- As opções retornadas no conflito de login são sugestões de seleção, não credenciais. A unidade selecionada passa novamente pelo login.
- O token da loja atual permanece durante seleção, erros e cancelamento. A confirmação verifica que a sessão original não foi substituída ou encerrada.
- `saveOperatorSession` substitui somente a sessão da aba atual e limpa os caches do restaurante anterior. A troca também limpa navegação e rascunho de pedido de teste do onboarding.
- Um reload completo descarta estados React, requests e subscriptions da operação anterior. O token novo permanece limitado a um restaurante. Outras abas continuam em suas próprias lojas.
- Nenhum turno é encerrado, pagamento registrado ou impressora pareada pela troca.
- A navegação após confirmação remove parâmetros antigos de login e pareamento da URL. O seletor não aparece em sessões de suporte do SuperAdmin; a confirmação também rejeita essas sessões.

## Limite desta entrega

Esta etapa oferece troca entre acessos existentes. Não cria organização/rede, conta global, compartilhamento de estoque/cardápio, relatório consolidado ou cobrança conjunta. As unidades continuam sendo tenants independentes.

Para a próxima etapa, modelar a organização e seus vínculos explícitos com restaurantes e operadores; conceder/revogar acesso por unidade; manter sessões operacionais limitadas a um tenant. O relacionamento da rede não deve substituir o isolamento financeiro nem o roteamento de impressão por tenant/dispositivo.

## Verificação

Os testes de `storeSwitch` cobrem autenticação antes da confirmação, seleção sem troca, erros de login, divergência de unidade, perfil não permitido, limpeza de contexto e sessão substituída. Os testes de navegador exercitam seleção, confirmação e isolamento entre abas no menu mobile/desktop.
