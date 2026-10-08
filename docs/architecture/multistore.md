# Multilojas — rede explícita e índice de unidades

O restaurante mantém seu ID e continua sendo a fronteira operacional. A rede tem um ID próprio, nome e uma loja responsável pelo cadastro. Cada restaurante pode pertencer a uma única rede. Exemplo: lojas 5 e 7 pertencem à mesma rede; a loja 6 permanece independente. Nenhum ID é renumerado ou usado para inferir propriedade.

## Cadastro no SuperAdmin

Na ficha do restaurante, em **Equipe**, a seção **Rede e unidades autorizadas** permite criar uma rede com aquela loja como matriz ou vincular a loja a uma rede existente. A adesão não concede acesso a operadores.

Em separado, o SuperAdmin escolhe um gestor ativo da loja atual, a unidade de destino na mesma rede e a conta daquele mesmo gestor na unidade de destino. A autorização é explícita, por pessoa e por direção. E-mail, senha igual, proximidade entre IDs ou pertencimento à rede não concedem acesso automaticamente.

A opção **Autorizar também o retorno** cria o vínculo inverso. As duas autorizações são gravadas individualmente; se o retorno falhar, a tela informa que apenas a ida foi salva. Cada ação exige motivo e fica na auditoria do respectivo tenant. Para remover ambas as direções, revogar também na ficha da outra unidade.

## Operação

O botão **Minhas lojas** substitui o formulário de outro login:

- Sem rede cadastrada: aviso **Loja independente**, com orientação para cadastro pelo suporte.
- Com rede, sem destinos autorizados: mostra o nome da rede e informa que falta liberação de outra unidade.
- Com destinos autorizados: lista apenas suas unidades disponíveis pelo nome; selecionar e confirmar troca a sessão sem pedir outra senha.
- Falha na consulta: mostra erro e retry. Não presume que a loja é independente e não oferece login livre como fallback.

`GET /auth/lojas` monta o índice a partir do vínculo da unidade e dos acessos do operador autenticado. `POST /auth/lojas/{id}/entrar` verifica novamente vínculo explícito, mesma rede, identidade de destino, cargo ativo, remoção da conta e suspensão da unidade antes de emitir um token limitado ao restaurante de destino. A origem e a seleção, sozinhas, não autorizam um ID arbitrário.

O vínculo tem lock durante emissão/revogação. Revogar invalida as sessões existentes da conta na unidade de destino usando o mecanismo de versão de token já adotado pelo KÔMA; isso também encerra sessões comuns daquela conta. O vínculo de ida é removido e não pode emitir novos tokens. O eventual vínculo de retorno é independente.

A confirmação no cliente exige que a sessão original ainda esteja vigente. Cancelamento, timeout e erro não substituem a loja atual. A navegação limpa caches/contexto da unidade anterior e parâmetros antigos de login/pareamento. Um painel novo descarta estados React, requests e subscriptions. Outras abas permanecem em suas próprias lojas. Sessões de suporte do SuperAdmin não usam esse seletor.

## Isolamento e persistência

`restaurant_networks`, `restaurant_network_units` e `restaurant_network_access` têm FK, índices e RLS por tenant. A migration `099cff37c89d` revoga acesso direto de `PUBLIC`, `anon` e `authenticated` e concede operações somente ao runtime `koma_app`, com `USING` e `WITH CHECK`. Leituras administrativas entre tenants usam sessões isoladas e escopo explícito; não há nova função que bypassa RLS.

As contas de gestor continuam locais a cada restaurante. Não há conta global nem compartilhamento de caixa, pedido, estoque, catálogo, impressora ou cobrança. A relação de rede não muda planos ou assinaturas existentes. Uma unidade já vinculada não pode ser transferida silenciosamente para outra rede por esta API.

## Validação

Testes de API cobrem lojas independentes, rede sem autorização, vínculos nos dois sentidos, unidades sem relação, conta errada, suspensão/inativação/remoção/cargo, revogação de token, proteção de SuperAdmin, auditoria e estabilidade dos IDs. Testes reais de PostgreSQL conferem isolamento dos três novos registros, `WITH CHECK` e ausência de acesso direto dos papéis do navegador no workflow de segurança. Testes de navegador cobrem o seletor e os três estados, troca, cancelamento, falha e isolamento entre abas.
