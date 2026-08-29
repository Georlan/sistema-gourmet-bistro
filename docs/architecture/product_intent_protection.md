# KÔMA — Product Intent Protection

Esta diretriz é persistente e rege todas as auditorias, revisões, refatorações e análises de código e interface no KÔMA.

## REGRA FUNDAMENTAL

NUNCA classifique automaticamente uma diferença entre telas como bug.

Todo achado visual ou comportamental deve ser estritamente classificado em uma destas categorias:

### [BUG CONFIRMADO]
Existe comportamento contrário a uma regra de produto conhecida, invariante de domínio, teste existente ou especificação formal documentada.

### [COMPORTAMENTO INTENCIONAL]
Existe evidência de que a diferença ou projeção foi deliberadamente projetada para atender a uma necessidade operacional. **Preservar.**

### [AMBIGUIDADE DE UI]
A regra de negócio e os dados subjacentes estão corretos, mas o rótulo (label), a apresentação ou a terminologia da interface podem induzir o operador a uma interpretação errônea.
*Ação:* Ajustar clareza de apresentação/rótulo quando na fase apropriada; nunca alterar regra de domínio ou cálculo.

### [HIPÓTESE DE UX]
Parece estranho ou incomum ao agente, mas não existe especificação provando que está incorreto.
*Ação:* Apresentar como hipótese para validação do usuário; **nunca alterar automaticamente**.

### [NÃO DETERMINADO]
Falta evidência técnica ou de especificação para decidir se é intencional ou divergente.

---

## PRINCÍPIOS DE ENGENHARIA

1. **Diferença visual $\neq$ Inconsistência de domínio.**
2. **Diferença entre projeções $\neq$ Bug.**
3. **Preferência do agente $\neq$ Requisito do produto.**

Antes de modificar qualquer comportamento existente, procurar:
- Testes automatizados que o protegem;
- Comentários e documentações arquiteturais;
- Regras de negócio vigentes;
- Comportamento equivalente em outros canais/telas;
- Intenção de produto previamente definida.

Se uma alteração proposta modificar significado operacional, cálculo, status, agrupamento, totalização ou fluxo do usuário: **PARAR e apresentar a proposta antes de implementar.**

---

## CASO ESPECÍFICO: FATIAMENTO OPERACIONAL DO CAIXA

Preservar integralmente a decisão de projeção do Caixa/Kanban:

Uma mesma `Comanda` pode ser projetada em diferentes fatias operacionais por estágio de produção.

Exemplo:
```text
Comanda total = R$ 160,00
├── Em preparo = R$ 112,00
└── Pronto     = R$  48,00

112,00 + 48,00 = 160,00
```

Esses valores parciais são **intencionais** e permitem ao operador responder imediatamente quanto valor da mesa já foi produzido pela cozinha e quanto ainda está na linha de preparo.

* **Não** substituir os subtotais das fatias pelo total consolidado da Comanda.
* É permitido apenas melhorar a clareza dos rótulos (ex: deixar explícito "Em preparo R$ 112" e "Pronto R$ 48") dentro do escopo da fase correspondente.

---

## IDENTIDADE OPERACIONAL DE CARDS

Não assumir que cards visualmente separados correspondem automaticamente a `Orders`/`Lancamentos` diferentes.
Antes de aplicar identificadores como `24-A` / `24-B`, confirmar qual `lancamento_id` e identidade operacional cada card efetivamente representa.

Quando houver dúvida entre:
* *"Isso parece inconsistente"* e
* *"Isso pode ser uma decisão deliberada de produto"*,

**Classificar obrigatoriamente como `[HIPÓTESE DE UX]` ou `[NÃO DETERMINADO]` e não alterar.**
