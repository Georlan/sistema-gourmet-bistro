# Relações do cardápio e isolamento — 23/10/2026

## Escopo e limites

Restaurante 6 consultado pelo catálogo público e pelas telas autenticadas do Caixa, sem salvar alterações, abrir caixa, criar pedido, cobrar, enviar mensagem ou imprimir. Alterações de disponibilidade e pedidos foram exercitados com snapshots/fixtures locais e SQLite isolado. Mínimo de R$ 10, inclusive a configuração de retirada, preservado conforme decisão do usuário. Consumo local não infere mesa.

## Estado observado no restaurante 6

- Caixa: 19 produtos cadastrados, 13 pausados; Pitulinha ativa somente em promoções. Vitrine: cinco produtos avulsos (P R$ 7, M R$ 10, G R$ 14 e duas bebidas), sem oferta vigente. A diferença de contagem é coerente.
- Complementos disponíveis coincidem no Caixa e nas três quentinhas públicas: dez guarnições, seis proteínas, cinco saladas; seis adicionais pagos vinculados às proteínas. Ovo adicional R$ 2 e demais proteínas adicionais R$ 5.
- P exige 1 proteína/2 guarnições, M 1/3 e G 2/4; saladas opcionais com máximos 1/1/2. Porções repetidas mantêm IDs repetidos no payload e preço calculado por unidade.
- Retirada e entrega por bairro habilitadas; Centro R$ 3 na tabela atual. Pagamento disponível: dinheiro. Loja fechada por caixa fechado; mantida assim.
- Quentinhas encaminhadas à cozinha; bebidas e sobremesas sem via de preparo. Isso confirma configuração de rota, não impressão física.

## Falhas reproduzidas e corrigidas

1. **Montagem aberta usava snapshot antigo.** O evento `catalog_updated` provocava novo GET, porém o produto selecionado continuava com complementos pausados/preços antigos. Agora a montagem usa o produto do catálogo atual. Conserva quantidades repetidas, observações e escolhas ainda válidas; remove opções indisponíveis com aviso. Produto retirado do catálogo encerra a edição sem apagar a sacola nem deixar uma edição órfã.
2. **Produto sem grupos aceitava complemento não vinculado do mesmo tenant.** O domínio só verificava pertinência quando a lista de grupos era não vazia. Lista vazia agora significa nenhum complemento autorizado. A API continua aceitando o produto simples e rejeita a composição indevida sem persistir pedido.

A sacola continua sendo um rascunho: não se apagam itens automaticamente. O checkout já consulta o catálogo atual antes do POST, exige revisão de composição desatualizada e trata a corrida de disponibilidade com o servidor. Preço e disponibilidade finais continuam sob autoridade do backend.

## Isolamento e relações exercitados

- Catálogo por ID/slug e DTO público mínimo; produto, categoria, grupo, opção e origem vinculada no escopo do tenant.
- Rejeição de alteração e vínculo a registros de outro restaurante; alteração diária atômica, concorrência e proteção contra formulário antigo; preservação de preços/IDs/histórico.
- Propagação proteína → adicional pago; pausa/reativação/arquivamento sem tocar guarnições/saladas independentes.
- Contexto de sessão ORM e transação, JWT de usuário/tenant, segregação de clientes com mesmo telefone, histórico e capability de pedido.
- Atualização de catálogo para audiência interna/pública do próprio tenant; teste explícito garante que outro tenant não recebe o evento.
- Pedido com complementos repetidos, leitura pelo Caixa, composição agrupada usada por impressão e relatório de consumo. Não equivale a comprovar baixa de ingrediente sem ficha técnica ou impressão em papel.

## Validação

- 181 testes backend focais aprovados em banco SQLite exclusivamente local.
- O teste de vínculo vazio falhou antes da correção e passou depois; a API tem controle positivo (bebida sem montagem) e negativo (complemento de outro produto).
- O probe de sincronização anterior registrou dois GETs e a opção pausada ainda presente; regressão posterior: oito casos aprovados, nas duas interfaces e em celular/desktop.
- 22 testes adicionais de integração do navegador aprovados (há sobreposição de quatro casos com a regressão inicial): cardápio diário, extras vinculados, salada opcional e recuperação de rejeições.
- Snapshot do ID 6: seis montagens P/M/G nas duas interfaces e quatro checkouts G entrega/retirada interceptados localmente, com payloads equivalentes. Nenhum pedido real.
- Verificar os checks do SHA final do PR antes de integrar. Suíte backend completa e políticas RLS executadas em PostgreSQL não são certificadas por estes testes SQLite.

## Publicação e reversão

Correções em branch/PR separado da substituição visual já publicada. Não integrar sem checks finais verdes e autorização de merge. Reversão pelo fluxo de PR; nenhuma reversão exige apagar catálogo, sacolas, pedidos ou filas. Prova de provedor, impressão física e operação ao vivo após mudança de disponibilidade continuam fora desta validação passiva do ID 6.
