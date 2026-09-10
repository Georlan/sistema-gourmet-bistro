# Onboarding adaptativo por perfil de restaurante

## Objetivo

Definir o contrato de UX e produto para seleção explícita de perfil operacional no onboarding do KÔMA sem acoplar regras de domínio, criar catálogo automaticamente ou transformar pizzaria, açaí e churrasco em produtos separados.

## Princípios obrigatórios

1. O perfil operacional é metadado do tenant e nunca fonte autoritativa de preço, estoque, pedido ou modificadores.
2. A ausência de perfil explícito equivale a `generic`.
3. Nenhum perfil pode criar categorias, produtos, adicionais, preços ou estoque silenciosamente.
4. Templates são opcionais, exibidos primeiro como preview e aplicados somente após confirmação explícita do operador.
5. O operador pode trocar o perfil depois; a troca não apaga nem sobrescreve catálogo existente.
6. Capabilities futuras devem ser independentes e combináveis para permitir operações híbridas.
7. A UX deve continuar funcional para qualquer restaurante no modo genérico.

## Perfis iniciais de apresentação

- `generic`: experiência neutra, sem sugestões específicas.
- `pizzaria`: enfatiza tamanhos, sabores, bordas e adicionais como atalhos de configuração, sem presumir regra de preço meio a meio.
- `acai`: enfatiza tamanhos/volumes, complementos e montagem, sem presumir quantidade grátis ou cobrança excedente.
- `churrasco`: enfatiza cortes, porções e pontos/preparos, sem presumir venda por peso.

Esses nomes são chaves de apresentação e configuração assistida. Não devem virar enum rígido de domínio.

## Fluxo de onboarding

### 1. Criação do tenant

O Super Admin cria o restaurante como hoje: nome, slug, plano e administrador inicial. O formulário passa a aceitar também uma escolha explícita de perfil operacional com default `generic`.

Persistir o perfil deve ocorrer na mesma transação de onboarding do tenant, respeitando `restaurante_id` e RLS. Nenhum template é aplicado nessa transação.

### 2. Primeiro acesso do operador

Após autenticação, o operador vê o perfil atual e pode:

- manter o perfil escolhido;
- trocar para outro perfil;
- continuar em `generic`;
- abrir uma etapa separada de configuração assistida.

A escolha do perfil jamais bloqueia o acesso às funcionalidades gerais.

### 3. Configuração assistida

A configuração assistida mostra somente sugestões derivadas do perfil. Para cada template:

1. gerar preview puro;
2. mostrar claramente o que seria criado;
3. não incluir preços inventados;
4. exigir confirmação explícita;
5. aplicar de forma idempotente;
6. nunca sobrescrever cadastro existente sem ação específica do operador.

Cancelar ou fechar o preview não produz side effect.

## Regras de UX

- Rotular o campo como **Tipo de operação** ou **Perfil do restaurante**, evitando linguagem que sugira limitação funcional.
- Explicar: “Isso só adapta sugestões e atalhos. Você continua com acesso a todos os recursos do KÔMA.”
- Mostrar `generic`, Pizzaria, Açaí e Churrasco inicialmente.
- Nunca inferir perfil pelo nome do restaurante.
- Nunca selecionar template automaticamente ao selecionar perfil.
- A troca de perfil deve exibir confirmação curta: “Seu cardápio atual não será alterado.”
- Se houver catálogo existente, o preview deve deixar evidente que sugestões são adicionais e não substituições.

## Contrato de API recomendado

O onboarding administrativo pode aceitar opcionalmente:

```json
{
  "operation_profile": "pizzaria"
}
```

Regras:

- campo opcional;
- normalização para lowercase;
- vazio ou ausente -> `generic`;
- tamanho máximo de 64 caracteres;
- regex recomendada: `^[a-z0-9][a-z0-9_-]{0,63}$`;
- persistência tenant-local em `restaurante_operation_profiles`;
- valor retornado na resposta de onboarding para confirmação visual;
- nenhum side effect sobre catálogo.

## Capabilities futuras

Perfis não devem conter condicionais espalhadas pela aplicação. Uma camada futura pode resolver capabilities a partir de perfil + flags explícitas, por exemplo:

- `supports_size_variants`
- `supports_flavor_composition`
- `supports_modifier_groups`
- `supports_weight_pricing`
- `supports_build_your_own`

A presença de uma capability apenas habilita UX/configuração; regras financeiras continuam no domínio específico.

## Segurança e multi-tenant

- Toda leitura/escrita de perfil deve ser filtrada pelo tenant corrente.
- Alteração administrativa deve ser auditável quando feita por Super Admin.
- Não permitir lookup ou alteração de perfil por identificador público sem autenticação/autorização adequada.
- Testes devem cobrir impossibilidade de ler/alterar perfil de outro tenant.

## Critérios de aceite da etapa de onboarding

- Super Admin consegue escolher `generic`, `pizzaria`, `acai` ou `churrasco` na criação do tenant.
- O perfil é persistido na mesma transação do onboarding.
- A resposta confirma o perfil salvo.
- Criar tenant com qualquer perfil não cria categoria, produto, modificador, preço ou estoque.
- Perfil ausente continua funcionando como `generic`.
- Trocar perfil depois não altera catálogo existente.
- Teste multi-tenant impede leitura/escrita cruzada.

## Sequência segura de implementação

1. Backend: aceitar e persistir `operation_profile` no onboarding, com testes de normalização, transação e ausência de efeitos colaterais.
2. Frontend Super Admin: adicionar seletor explícito no modal de novo tenant e mostrar perfil no resumo de criação.
3. Primeiro acesso/admin: permitir visualizar e alterar perfil sem alterar catálogo.
4. Só depois conectar a tela de templates ao preview já existente.

Nenhum desses passos deve aplicar template automaticamente.