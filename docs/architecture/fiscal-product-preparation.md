# Preparação dos produtos — etapa 1

Cada produto aparece automaticamente em uma projeção fiscal, consultada sob demanda
em `GET /api/onboarding/fiscal/products`. Nome e preço atual vêm de `Produto`, sem
duplicação comercial, integração externa ou alteração das rotas do cardápio.
Produtos sem perfil fiscal aparecem como pendentes virtuais: ler a tela não cria
registros, não faz backfill e não escreve no tenant 6 ou em qualquer outro tenant.
Novos produtos aparecem na próxima consulta sem efeito adicional na criação.

O endpoint usa o tenant autenticado, exige administrador/gerente e pagina até 100
produtos. A tela consulta 50 por página somente quando aberta, sem polling.
São três consultas por página não vazia, sem N+1 nem leitura de todo o histórico
tributário. Produtos inativos continuam visíveis para revisão.

A última revisão de `ProductFiscalProfile` é apresentada com seu estado e vigência.
“Cadastro revisado” descreve o estado cadastral registrado, não certifica NCM,
tributação, vigência legal ou aptidão para emissão. Não é um gate tributário.
`issuanceReady` permanece falso: nenhum adapter é acionado e nenhuma configuração
fiscal é habilitada por esta tela. Não copiar impostos da referência BeeFood.

Preço mostrado é o preço atual do cardápio, não o valor de vendas anteriores.
Emissão deverá consumir snapshot da operação efetivamente vendida, preservando
valores, descontos e classificação aplicável. Documentos existentes não são alterados.

Próximas etapas: editar/salvar classificação versionada com responsável fiscal;
adicionais, variantes e combos; snapshot de venda e vínculo de pagamentos;
emissor, eventos, contingência e entrega do DANFE. Não liberar emissão até que
esses caminhos estejam implementados e homologados.

Esta entrega é independente dos PRs de simplificação do onboarding e do contrato
de provedor. Ao integrar, conservar o painel na tela fiscal simplificada.
Reversão: reverter o PR; não há migration ou escrita a desfazer.
