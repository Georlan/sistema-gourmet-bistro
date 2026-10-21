# Bloco 1 — onboarding, perfis e catálogo

## Decisões confirmadas

- Mostrar o cardápio cedo. A inscrição oferece o endereço público canônico em outra aba; a prévia de identidade acompanha o formulário. Consultar não altera liberação comercial, trial ou aceitação de pedidos.
- Perfil simples e editável. Os cinco identificadores permanecem generic, marmitaria, pizzaria, acai e churrasco. O perfil organiza a experiência; não cria produtos ou regras de preço.
- Duas marmitarias usam a mesma função de complementos, com registros independentes por restaurante. Compartilhar um grupo entre produtos significa compartilhar dentro do tenant.
- Priorizar ações e informação visual; explicações curtas devem esclarecer uma decisão, sem repetir o mesmo aviso em vários blocos.

## Melhorias implementadas

- Cinco cartões de perfil substituídos por um seletor nativo com rótulo, foco visível e confirmação pela API existente.
- Prévia durante a primeira etapa, inclusive no celular. A antiga demonstração com categorias de pizza e preços fictícios foi removida; a prévia declara seu alcance visual.
- Consultas de status limitadas a uma requisição ativa por instância. Uma confirmação mais recente invalida a leitura anterior. Desmontagem, mudança de autenticação e início de edição cancelam leituras pendentes. Os intervalos existentes de 8/30 segundos e o prazo de 10 segundos são preservados.
- Horários vazios no fluxo guiado recebem orientação antes do PUT. Mensagens de erro são anunciadas; adicionar/remover linhas fica bloqueado durante a confirmação, junto aos campos.
- Cadastro de complementos usa dialog nativo, título e campo associados, foco inicial, contenção por teclado, Esc, retorno ao acionador e proteção durante o salvamento. Regras e endpoints de complementos são os mesmos.

## Evidência e limites

- Baseline: 16 cenários existentes de onboarding em 390 e 1366 px.
- Gates locais: 1074 testes unitários, tipos e build aprovados.
- Backend completo: 2792 aprovados, 79 ignorados, em SQLite isolado. Os testes ignorados incluem PostgreSQL efêmero e capacidades externas; isso não comprova RLS em produção.
- Novo teste de integração: duas marmitarias criam grupos/opções homônimos; listagem própria e recusas de edição, exclusão, pausa e vínculo a produtos estrangeiros preservam os registros.
- Cinco perfis: escolha/salvamento e cadastro de complementos com teclado, cancelamento e salvamento pendente.
- Matriz anterior à última melhoria de diálogo: 216 cenários aprovados. A matriz final ampliada está em execução, incluindo 360, 390, 412, 430, 768, 1024, 1366, 1440 e 1920 px. Registrar seu resultado antes da integração.
- Navegação manual: primeira configuração com API simulada local; catálogo, complementos, disponibilidade diária e cardápio público com FastAPI/SQLite próprios e restaurantes fictícios. O cardápio fechado recusou a inclusão na sacola. Nenhuma configuração, pedido, pagamento ou impressão foi alterado no restaurante real ID 6.

## Referências aplicadas

- [React: efeitos e limpeza](https://react.dev/reference/react/useEffect): cancelamento e descarte de respostas obsoletas, aplicado às leituras de onboarding. Nenhum cache global novo.
- [W3C: diálogo modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): foco dentro do cadastro, Esc e retorno ao acionador.
- [WCAG 2.2: alvos de interação](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): 24 CSS px é o mínimo AA com exceções; 44 px foi escolhido como conforto para as ações alteradas, sem atribuir esse número ao mínimo AA.
- [Karlson e Bederson, ThumbSpace, INTERACT 2007](https://www.microsoft.com/en-us/research/wp-content/uploads/2007/01/karlson-interact07.pdf): alcance, precisão e densidade precisam ser equilibrados. Estudo histórico, usado como lente; não comprova usabilidade do KÔMA nem uma dimensão universal.
- [PostgreSQL: políticas por linha](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): isolamento na aplicação e RLS são camadas distintas. Testes SQLite não substituem teste com papel restrito em PostgreSQL.

## Continuidade

Concluído: investigação dos contratos e das skills, primeiro conjunto de mudanças e testes locais indicados acima. Skills existentes preservadas; novas instruções instaladas sem novas dependências no aplicativo. analytics-tracking corresponde a analytics na origem atual; as duas verticais exigiram apenas adaptação de arquivo Markdown para SKILL.md. O CLI externo do Playwright não foi instalado nem a versão do projeto alterada.

Jornada integrada na PR #1183 (14f0c75313ab): matriz final de 261 cenários aprovada; CI e revisões servidas de API/frontend confirmados. Em andamento: redesenho mobile do cardápio público em checkout separado, preservando o catálogo e a montagem existentes.

Próximo: validar visualmente a nova apresentação pública com/sem imagens e nos cinco perfis; testar montagem, sacola, checkout, estado fechado, erro, teclado e responsividade. Não transformar sugestões de logística/estoque/custos das skills em novas regras sem decisão de produto.

Decisões de negócio pendentes nesta entrega: nenhuma. Preço de pizza fracionada, limites comerciais de açaí, venda por peso e regras novas de estoque permanecem fora do escopo.

Reversão: reverter o PR; sem migrações, flags ou alterações de infraestrutura.
