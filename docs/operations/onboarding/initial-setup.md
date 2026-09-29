# Primeiro acesso e configuração inicial

Abra o convite no e-mail do administrador, defina a senha e confirme que entrou
no restaurante certo. Na **Implantação inicial**, siga os atalhos das etapas.
A mesma área pode ser reaberta em **Configurações → Implantação inicial**.

| Onde entrar | Fazer | Resultado e trava |
|---|---|---|
| Cardápio online → Perfil | Salvar nome/descrição/endereço/contato e conferir a identidade pública | Perfil do cliente certo; não avançar com contato/endereço errado |
| Implantação inicial → horários / Cardápio online → Pedidos online | Cadastrar dias e intervalos; manter Automático para regra de agenda | Horários publicados, inclusive pausas; Forçado Aberto muda a política, não usar para esconder erro |
| Implantação inicial → modalidades | Selecionar somente consumo local, retirada e/ou delivery usados | Ao menos uma modalidade explícita; delivery com taxas/área conferidas |
| Cardápio → Produtos | Criar categorias e produto ativo, preço e descrição; publicar | Produto aparece no link público; foto/PDF enviado sem produto publicado não conclui essencial |
| Cardápio → Complementos | Configurar adicionais, preços, mínimo/máximo e obrigatoriedade | Conferir total e limites num pedido; não avançar com combinação impossível |
| Cardápio → Preparo e impressão | Mapear destinos usados (cozinha/bar) quando impressão liberada | Cupom vai ao destino esperado; não depender de estoque/KDS fora do escopo |
| Equipe → Pessoas | Cadastrar operadores e e-mails; enviar convite | Operador ativa seu próprio acesso; “enviado ao Resend” não prova recebimento |
| Equipe → Funções e acessos | Conferir cargo e mínimo necessário | Caixa consegue vender/receber; acesso de gestão restrito; testar login do operador |
| Configurações → Mesas / Taxa de Serviço | Configurar somente quando usados | Layout e taxa combinados com o cliente |
| Cardápio online → Entrega | Conferir área, taxa, mínimo e prazo, se delivery | Pedido de teste tem endereço/taxa corretos |
| Cardápio online → Divulgação | Copiar link/QR e abrir no celular fora da sessão de gestão | Restaurante correto, categorias, preços, adicionais e contato visíveis |

## Pagamentos sem Mercado Pago do restaurante

**No Caixa**, o recebimento pode ser registrado como Dinheiro, Pix, Crédito ou
Débito recebido externamente. Confirme Pix na conta do restaurante e cartão na
maquininha antes de marcar recebido. Selecionar “Pix” no Caixa não comprova
transferência. Não conecte Mercado Pago apenas para habilitar operação offline.

**No checkout público**, abra **Cardápio online → Pagamentos**, habilite somente
os meios desejados e salve. Para o teste solicitado: Dinheiro ON, Pix OFF,
Crédito OFF, Débito OFF, pagamento online desconectado. Abra **Ver cardápio**,
adicione um produto e confira sacola/revisão: somente Dinheiro, sem Mercado Pago.

Crédito/débito públicos são pagamentos no atendimento/entrega, compatíveis com
maquininha própria. Pix público depende de cobrança online ativa e conta Mercado
Pago conectada; não existe Pix manual no checkout público atual. Não prometer
ou ativar esse fluxo para a primeira cliente. Demais meios não são inventados
pelo checkout. As formas do checkout público não são uma lista global de todos
os recebimentos internos do Caixa.

Não avançar se opções desabilitadas aparecerem. Backend também valida a lista
explícita para novas solicitações; retornar pedido existente por replay idempotente
não cria outra venda. Cadastros legados sem lista preservam o tratamento anterior
de Dinheiro; sempre salve uma lista explícita para novos restaurantes.

## Consulta fora do horário

Com **Automático** e horários fechados, o link público continua abrindo categorias,
produtos, preços e adicionais. Deve indicar **Estabelecimento fechado**, com
próxima abertura quando calculável, e impedir novo pedido imediato. Caixa fechado
também pode bloquear recebimento de pedidos pela política atual. Confira com um
horário fechado controlado e depois restaure a agenda real.

Pedidos agendados seguem validação própria; este roteiro não modifica essa regra.
Catálogo vazio, restaurante suspenso ou link incorreto são situações diferentes
de fechamento por horário: diagnosticar pelo [guia de suporte](evidence-and-support.md).
