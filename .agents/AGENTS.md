# Diretrizes do Projeto Kôma / Sistema Gourmet Bistro

- **Git Commits e Push Diretos**: Sempre realize `git commit` e `git push origin main` diretamente no repositório após concluir as alterações solicitadas pelo usuário para atualizar o deploy no Cloudflare Pages.

- **Modelos da landing**: Preservar o visual 3D aprovado. Novos dispositivos devem ter moldura de boa qualidade com transparência real e tela separada/substituível. Validar alpha e fundos claro/escuro; quadriculado desenhado não conta como transparência. Seguir `.cursor/rules/landing-device-mockups.mdc` e os guias `docs/landing-*-mockup.md`.

---

# KÔMA — Memória Arquitetural: Comanda, Pedido e Identidade Operacional

Esta é uma decisão arquitetural persistente do projeto KÔMA e deve ser considerada em todas as próximas fases de organização, refatoração e migração.

## MODELO CONCEITUAL CANÔNICO

Não tratar Comanda e Pedido como sinônimos.

Mapeamento conceitual atual:

- AtendimentoMesa = sessão de atendimento / ServiceSession
- Comanda = conta financeira / Check / Tab
- Lancamento = predecessor persistido do conceito canônico Order/Pedido
- Item = OrderItem
- LancamentoIdentidade = identidade operacional/humana do pedido dentro da família da Comanda

Exemplo:

Mesa 7
└── Atendimento
    └── Comanda #24
        ├── Lancamento 1 → Pedido 24-A
        ├── Lancamento 2 → Pedido 24-B
        └── Lancamento 3 → Pedido 24-C

Portanto:

COMANDA #24 ≠ PEDIDO 24-A

Uma Comanda pode possuir vários Pedidos.

## IDENTIDADE DO PEDIDO

A identidade humana por família já existe no legado:

sequencia 1 → A
sequencia 2 → B
...
sequencia 26 → Z
sequencia 27 → AA

Exemplo:

24-A
24-B
24-C

Essa regra não deve permanecer específica de Garçom/Mesa/Impressão.

No domínio universal, ela deve se tornar uma propriedade canônica do Order, consumível por qualquer projeção/interface.

Manter distinção entre:

- order.id = ID técnico interno
- order.display_number = "24-B"
- order.comanda_id = vínculo com a conta
- order.sequence = 2
- order.external_reference = ID externo de iFood/99Food/Keeta/etc.
- order.channel = origem do pedido

Nunca usar display_number como chave técnica global.

## PROBLEMA LEGADO CONHECIDO

Algumas partes do sistema, especialmente projeções/telas do Caixa, ainda podem usar o numero_pedido da Comanda pai como identificação visual.

Isso pode gerar algo visualmente equivalente a:

Comanda #24
├── Pedido #24
└── Pedido #24

quando semanticamente os pedidos são:

24-A
24-B

Isso é uma inconsistência de projeção/consumo do modelo, não motivo para criar uma segunda regra de identificação.

## ARQUITETURA ALVO

Todos os canais:

- Garçom
- Mesa
- PDV/Balcão
- Cardápio Web
- QR
- Totem
- iFood
- 99Food
- Keeta
- WhatsApp
- API

devem convergir para o mesmo conceito canônico de Order.

Fluxo alvo:

Canal
  ↓
Adapter
  ↓
Command
  ↓
OrderApplicationService
  ↓
Order
  ├── id
  ├── display_number
  ├── comanda_id
  ├── sequence
  ├── channel
  ├── fulfillment_type
  ├── status
  └── items

Interfaces como Caixa, KDS, Mesa e impressão devem futuramente CONSUMIR essa identidade canônica, não recalculá-la independentemente.

## REGRA PARA AS FASES DE REFATORAÇÃO

Não fazer uma refatoração paralela específica do Caixa apenas para corrigir 24-A/24-B enquanto o Universal Order Core ainda está sendo construído, salvo se existir bug operacional crítico.

Durante as fases atuais:

1. preservar o comportamento existente;
2. registrar onde a identidade de pedido é derivada;
3. evitar criar novas derivações duplicadas;
4. reutilizar funções existentes quando necessário;
5. formalizar Lancamento ≈ Order nos contratos canônicos;
6. migrar cada consumidor para a fonte canônica quando sua fase chegar;
7. remover a derivação legada somente depois que não houver consumidores.

Quando tocar em CaixaPanel, MesaDetailsModal, atendimentos, printing, KDS ou projeções de pedido, verificar se existe oportunidade SEGURA e pertencente à fase atual de substituir lógica local por identidade canônica.

Não ampliar o escopo da PR apenas para antecipar essa migração.

## OBJETIVO FINAL

A regra deve existir uma vez:

Order.display_number = identidade operacional canônica

E ser consumida por:

Caixa
Mesa
Garçom
KDS
Impressão
Delivery
integrações externas

O canal não inventa a identidade do pedido.
O frontend não inventa a identidade do pedido.
A impressão não inventa a identidade do pedido.

O Core é a fonte de verdade.

## REGRA DE EVIDÊNCIA

Sempre distinguir:

[OBSERVADO]
Comportamento confirmado no repositório/testes.

[ALVO]
Arquitetura que estamos construindo.

Não afirmar que o Caixa, PDV ou qualquer outro consumidor já usa Order.display_number até isso ser efetivamente implementado e validado.

Se durante a refatoração forem encontradas novas inconsistências entre Comanda e Pedido, registrar antes de corrigir e verificar se a correção pertence à fase atual.

---

# KÔMA — Product Intent Protection

Durante auditorias, refatorações e análises visuais:

NUNCA classifique automaticamente uma diferença entre telas como bug.

Antes de propor alteração, classifique o achado em uma destas categorias:

[BUG CONFIRMADO]
Existe comportamento contrário a uma regra de produto conhecida, invariante, teste ou especificação existente.

[COMPORTAMENTO INTENCIONAL]
Existe evidência de que a diferença foi deliberadamente projetada. Preservar.

[AMBIGUIDADE DE UI]
A regra pode estar correta, mas label, apresentação ou contexto podem induzir interpretação errada. Não alterar regra de domínio.

[HIPÓTESE DE UX]
Parece estranho ao agente, mas não existe especificação provando que está errado. Nunca corrigir automaticamente.

[NÃO DETERMINADO]
Falta evidência para decidir.

REGRA CRÍTICA:

Diferença visual ≠ inconsistência de domínio.
Diferença entre projeções ≠ bug.
Preferência do agente ≠ requisito do produto.

Antes de modificar comportamento já existente, procurar:
1. testes que o protegem;
2. comentários/documentação;
3. regras de negócio;
4. comportamento equivalente em outras telas;
5. intenção de produto já definida.

Se uma alteração modificar significado operacional, cálculo, status, agrupamento, totalização ou fluxo do usuário, PARAR e apresentar a proposta antes de implementar.

Em particular, preservar esta decisão do Caixa:

Uma mesma Comanda pode ser projetada em diferentes fatias operacionais.

Exemplo:

Comanda total = R$160
Em preparo = R$112
Pronto = R$48

112 + 48 = 160.

Esses valores parciais são intencionais e permitem ao operador saber quanto valor está pronto e quanto ainda está em produção.

Não substituir os subtotais das fatias pelo total da Comanda.

É permitido melhorar a clareza dos labels sem alterar o cálculo, desde que isso pertença ao escopo da fase atual.

Também não assumir que cards visualmente separados correspondem automaticamente a Orders/Lancamentos diferentes.
Antes de aplicar identificadores como 24-A/24-B, confirmar qual lancamento_id / identidade operacional cada card representa.

Quando houver dúvida entre:
"isso parece inconsistente"
e
"isso pode ser uma decisão de produto",

classificar como HIPÓTESE e não alterar.

---

# KÔMA — Memória Arquitetural: Projeções de Mesa (Caixa e Garçom - Fase 7)

## Janela Única e Projeção Canônica Compartilhada

Caixa e Garçom representam **as mesmas mesas**.
Quando representam o mesmo estado operacional, devem utilizar a **mesma linguagem visual, cores, labels e tempo decorrido**.

## Separação Semântica: Pronto ≠ Aguardando Pagamento

$$\text{PREPARANDO} \longrightarrow \text{PRONTO} \longrightarrow \text{ENTREGUE} \longrightarrow \text{AGUARDANDO PAGAMENTO}$$

- Não inferir que uma mesa está aguardando pagamento apenas porque todos os itens terminaram de ser preparados na cozinha.
- Separar:
  1. `FREE` (Livre) → Verde
  2. `IN_SERVICE / PREPARING` (Em atendimento) → Base operacional
  3. `HAS_READY_ITEMS` / `ALL_ITEMS_READY` (Tem item pronto / Tudo pronto para servir) → Amarelo / Âmbar
  4. `AWAITING_PAYMENT` (Aguardando pagamento / Fechamento) → Destaque de cobrança/fechamento
- `AWAITING_PAYMENT` decorre de evento financeiro/operacional (ex: `status_comanda == 'aguardando_pagamento'` ou solicitação de conta), e não simplesmente de `allReady`.

## Arquitetura Alvo da Fase 7

- Nunca duplicar lógica entre `MesaCard.tsx` e `CaixaPanel.tsx`.
- Criar seletor universal compartilhado `deriveTableOperationalState(...)` consumido igualmente por ambos os componentes.
