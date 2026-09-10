# Perfis operacionais de restaurante

## Objetivo

Definir uma arquitetura canônica para adaptar o KÔMA a diferentes operações (pizzaria, açaí, churrasco e futuras variações) sem transformar o produto em aplicações separadas e sem voltar a criar adicionais/presets silenciosamente.

Este documento é contrato de arquitetura. Nesta fase não altera schema, onboarding, preços, estoque, regras de pedido nem dados em produção.

## Estado observado

- `Restaurante` é a raiz do tenant e ainda não possui metadado de perfil operacional.
- `Categoria` e `Produto` já são tenant-local por `restaurante_id`.
- `GrupoModificador`, `OpcaoModificador` e `ProdutoGrupoModificador` também são tenant-local e já suportam seleção obrigatória/opcional e `meio_a_meio`.
- O catálogo operacional já resolve complementos efetivos por produto/categoria, portanto perfis não devem criar um segundo motor de adicionais.
- O onboarding atual provisiona o restaurante e configura a base SaaS, mas não deve inferir catálogo, adicionais, preços ou regras a partir do nome/tipo do estabelecimento.
- A direção existente de produto exige que adicionais continuem compartilhados e isolados por restaurante, sem cadastro duplicado e sem inventar regra de preço.

## Princípio central

**Perfil operacional é configuração explícita do tenant, não uma regra de domínio.**

O Core continua genérico. O perfil serve para orientar UX, defaults seguros, exemplos e templates opcionais. Pedido, preço, estoque, disponibilidade, modificadores e validações continuam sendo definidos pelos cadastros canônicos já existentes.

## Modelo conceitual

### 1. Perfil base

Cada tenant pode declarar zero ou um `primary_profile` inicialmente:

- `generic`
- `pizzeria`
- `acai`
- `churrasco`

Ausência deve equivaler a `generic`.

O valor deve ser tratado como metadado de produto/UX. Nenhuma regra financeira ou operacional crítica pode depender somente dele.

### 2. Capacidades

Perfis não devem virar `if pizzeria`, `if acai`, `if churrasco` espalhados pela aplicação. A camada de apresentação deve resolver capacidades declarativas, por exemplo:

- `supports_half_and_half`
- `supports_size_variants`
- `supports_weight_sale`
- `supports_build_your_own`
- `suggests_crust_group`
- `suggests_toppings_group`

Essas capacidades podem ser derivadas do perfil para UX, mas a autoridade final continua no catálogo real do tenant.

### 3. Combinação futura

Um restaurante pode operar mais de um modelo. A arquitetura deve permitir evolução de `primary_profile` para uma coleção de `operation_profiles`/capabilities sem migração destrutiva.

Exemplo: churrascaria com pizza no jantar ou açaíteria que também vende hambúrgueres.

Por isso:

- não codificar regras irreversíveis em enum fechado espalhado pelo código;
- centralizar catálogo de perfis/capacidades;
- manter fallback `generic`;
- tratar capacidades desconhecidas como desativadas.

## Templates

Templates são **opcionais, explícitos e reversíveis**.

Um template pode sugerir estrutura de cadastro, mas deve obedecer às regras:

1. nunca aplicar automaticamente na criação do tenant;
2. exigir ação explícita do operador;
3. mostrar preview do que será criado;
4. criar somente rascunhos/configurações confirmadas;
5. nunca inventar preços;
6. nunca sobrescrever categorias, produtos, grupos ou opções existentes;
7. registrar origem (`template_id`/versão) apenas como metadado de auditoria, sem tornar o registro dependente do template;
8. permitir edição e remoção posterior pelos fluxos normais;
9. respeitar `restaurante_id` em toda leitura/escrita;
10. ser idempotente por aplicação, evitando duplicação acidental.

## Exemplos de UX por perfil

### Pizzaria

Pode priorizar atalhos para tamanhos, sabores, meio a meio, borda e adicionais da pizza. A existência real desses grupos continua vindo de `GrupoModificador`/vínculos canônicos.

### Açaí

Pode priorizar tamanho, base, frutas, cremes e toppings, com UX de montagem. Quantidades, limites e preços continuam nos grupos/opções reais.

### Churrasco

Pode priorizar ponto da carne, corte, acompanhamentos e venda por peso quando essa capacidade existir. O perfil sozinho não ativa cálculo por peso; isso exige suporte explícito no domínio antes de ser habilitado.

## Onboarding

O onboarding deve perguntar explicitamente o tipo de operação, com opção `Outro / configurar depois`.

A escolha deve:

- salvar somente metadado/configuração de perfil;
- não criar catálogo automaticamente;
- oferecer depois um passo separado de “Configurar meu cardápio” com templates opcionais;
- permitir trocar o perfil sem alterar silenciosamente produtos/modificadores existentes.

## Isolamento multi-tenant

Qualquer futura tabela/configuração de perfil deve ter `restaurante_id` explícito ou pertencer diretamente à linha de `Restaurante`.

Requisitos mínimos:

- nenhuma busca por perfil sem escopo de tenant;
- templates aplicados sempre dentro de transação tenant-local;
- IDs de categorias/produtos/modificadores continuam validados em conjunto com `restaurante_id`;
- testes negativos obrigatórios para garantir que tenant A não consegue ler/aplicar template/configuração do tenant B.

## Rollout

A implementação deve ser incremental:

1. adicionar metadado neutro de perfil com fallback `generic`;
2. expor leitura/escrita somente em fluxos administrativos autorizados;
3. adicionar capacidades centralizadas no frontend/backend sem mudar domínio;
4. habilitar templates apenas por feature flag;
5. validar um tenant QA por perfil;
6. somente depois considerar UX especializada no cardápio/caixa.

## Decisões que permanecem abertas

Não implementar até haver contrato específico:

- venda por peso;
- composição de preço por tamanho/sabor em pizza;
- regra de cobrança em meio a meio;
- relação entre adicional e ingrediente/estoque;
- produto composto/montável genérico;
- migração automática de modificadores existentes.

## Checklist priorizada

### P0

- [x] Definir arquitetura canônica de perfis sem presets automáticos.
- [ ] Adicionar metadado mínimo e reversível de perfil ao tenant com fallback `generic`.
- [ ] Adicionar testes de isolamento multi-tenant para leitura/escrita do perfil.
- [ ] Garantir que onboarding não cria categorias/modificadores automaticamente.

### P1

- [ ] Criar catálogo central de capabilities por perfil.
- [ ] Expor seleção explícita de perfil no onboarding/admin.
- [ ] Criar mecanismo de templates opcionais com preview, confirmação e idempotência.
- [ ] Criar templates iniciais de pizzaria, açaí e churrasco sem preços.
- [ ] Criar testes de não sobrescrita e não duplicação de catálogo existente.

### P2

- [ ] Adaptar UX do editor/cardápio por capabilities, mantendo fallback genérico.
- [ ] Permitir múltiplos perfis/capabilities por tenant quando houver caso real.
- [ ] Criar matriz QA por perfil em desktop/mobile.
- [ ] Avaliar venda por peso e composição avançada de pizza em documentos de domínio próprios.
