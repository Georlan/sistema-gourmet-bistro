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
- Matriz ampliada da PR #1183 concluída antes do merge: 261 cenários aprovados em 360, 390, 412, 430, 768, 1024, 1366, 1440 e 1920 px. A cobertura foi de onboarding e complementos; não equivale à jornada operacional completa.
- Navegação manual: primeira configuração com API simulada local; catálogo, complementos, disponibilidade diária e cardápio público com FastAPI/SQLite próprios e restaurantes fictícios. O cardápio fechado recusou a inclusão na sacola. Nenhuma configuração, pedido, pagamento ou impressão foi alterado no restaurante real ID 6.

## Referências aplicadas

- [React: efeitos e limpeza](https://react.dev/reference/react/useEffect): cancelamento e descarte de respostas obsoletas, aplicado às leituras de onboarding. Nenhum cache global novo.
- [W3C: diálogo modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): foco dentro do cadastro, Esc e retorno ao acionador.
- [WCAG 2.2: alvos de interação](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): 24 CSS px é o mínimo AA com exceções; 44 px foi escolhido como conforto para as ações alteradas, sem atribuir esse número ao mínimo AA.
- [Karlson e Bederson, ThumbSpace, INTERACT 2007](https://www.microsoft.com/en-us/research/wp-content/uploads/2007/01/karlson-interact07.pdf): alcance, precisão e densidade precisam ser equilibrados. Estudo histórico, usado como lente; não comprova usabilidade do KÔMA nem uma dimensão universal.
- [PostgreSQL: políticas por linha](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): isolamento na aplicação e RLS são camadas distintas. Testes SQLite não substituem teste com papel restrito em PostgreSQL.

## Continuidade

Concluído: investigação dos contratos e das skills, primeiro conjunto de mudanças e testes locais indicados acima. Skills existentes preservadas; novas instruções instaladas sem novas dependências no aplicativo. analytics-tracking corresponde a analytics na origem atual; as duas verticais exigiram apenas adaptação de arquivo Markdown para SKILL.md. O CLI externo do Playwright não foi instalado nem a versão do projeto alterada.

PR #1183 integrada em `14f0c75313ab5a4151fed13076063bd6d4ab9d13`: matriz final de 261 cenários aprovada, conforme evidências daquela PR. PR #1184 integrada em `c3e7a5f7db6e063586951283baee2b259797eb32`: vitrine comercial prioriza ranking canônico, composição mobile compacta e regressões de apresentação aprovadas conforme evidências daquela PR. Não refazer esses entregáveis.

## Fronteira de homologação após #1184 — 21/10/2026

**Estado do Bloco 1: em validação; NÃO homologado ponta a ponta.** Testes interceptados de layout e escolha de perfil não substituem frontend + FastAPI + dados isolados com persistência, montagem, sacola, revisão e envio de pedido de teste. Nenhuma dessas jornadas integradas novas foi executada nesta atualização documental.

- [x] Seleção e confirmação dos cinco perfis, segurança do formulário e navegação responsiva: evidências da #1183.
- [x] Vitrine mobile, ranking real do restaurante, responsividade em nove larguras e montagem já existente em regressões dirigidas: evidências da #1184.
- [ ] Marmitaria: cadastro/edição P/M/G como produtos, limites por produto, porções/tipos, Sem salada, extras pagos, pausa diária e pedido local até o Order Core.
- [ ] Pizzaria: tamanhos/sabores/bordas/complementos reais, montagem, sacola, revisão e pedido local; sem decidir fórmula de meio a meio.
- [ ] Açaí: volumes, toppings e limites explícitos, sem inventar gratuitos ou excedentes.
- [ ] Churrasco: cortes, preparo e acompanhamentos existentes; sem introduzir venda por peso.
- [ ] Genérico/hamburgueria: itens simples e montáveis pelo contrato atual.
- [ ] Catálogo híbrido persistido, alternância de perfil com snapshot dos IDs/vínculos/preços antes/depois e dois tenants do mesmo perfil; negativas canônicas de leitura/escrita e RLS PostgreSQL com role de runtime.
- [ ] Navegação administrativa real desktop/mobile: foco, teclado, touch, loading, erro, cancelamento, reload, salvamento e comparação de telas antes/depois; coletar evidência visual somente das telas efetivamente alteradas.
- [ ] Executar jornada em 360, 390, 430, 768, 1024, 1366, 1440 e 1920 px sem perder a largura extra 412; registrar Firefox/WebKit como executados ou não disponíveis, sem inferir aprovação.
- [ ] Revisar polling, concorrência e consultas por evidência de duplicidade; evitar refatoração sem baseline e regressão de continuidade.
- [ ] Gate obrigatório `Merge verdict` no SHA final, regressões focais relevantes, conferência de publicação e versão servida de cada nova correção.

Um teste E2E interceptado de catálogo misto por perfil só estabelece visibilidade e navegação sem filtragem pela apresentação; NÃO comprova persistência, troca de perfil, preço/cobrança ou isolamento de banco. O isolamento de duas marmitarias coberto em `backend/tests/test_marmitaria_catalog_tenant_isolation.py` foi informado na #1183, mas não substitui um ensaio do conjunto híbrido em PostgreSQL/RLS.

**Decisões fora do escopo:** preço de pizza meio a meio, adicionais grátis e excedentes de açaí, venda por peso, nova política de estoque e limite ilimitado formal (`max_selecoes=null`). Nenhuma deve ser criada implicitamente. Não transformar sugestões genéricas das skills em regras novas.

Reversão: reverter o PR; sem migrações, flags ou alterações de infraestrutura.
