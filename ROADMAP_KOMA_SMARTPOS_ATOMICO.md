# Kôma SmartPOS — Roadmap Atômico de Implementação

**Objetivo:** desenvolver o SmartPOS do Kôma em incrementos pequenos, testáveis, reversíveis e com baixo custo de contexto/tokens, evitando quebrar o sistema existente.

**Regra principal:**

> **1 etapa = 1 comportamento novo = 1 branch = 1 PR = 1 ponto claro de rollback.**

Não implementar várias etapas estruturais de uma vez.

---

## 1. Princípios de arquitetura

O SmartPOS deve ser **mais uma interface sobre as regras financeiras existentes do Kôma**, e não um segundo sistema financeiro.

Estrutura conceitual:

```text
KÔMA
│
├── Frontend
│   ├── Caixa
│   ├── Garçom
│   ├── Admin
│   └── SmartPOS
│
├── Backend FastAPI
│   ├── pedidos
│   ├── mesas
│   ├── caixa
│   ├── pagamentos
│   └── smartpos
│
└── PostgreSQL / Supabase
    └── mesmas entidades financeiras
```

Evitar duplicações como:

```text
smartpos_payments
cashier_payments
restaurant_payments
```

A direção preferida é uma única entidade financeira, por exemplo:

```text
payments
├── source = cashier
└── source = smartpos
```

---

# 2. Roadmap atômico

## ETAPA 0 — Congelar o contrato financeiro

Não programar SmartPOS ainda.

Documentar as regras que ele não pode violar:

- SmartPOS não fecha mesa sozinho.
- SmartPOS registra pagamento.
- Caixa continua responsável pelo fechamento da mesa.
- Pagamento de mesa só pode ocorrer com caixa aberto.
- Pagamentos parciais são permitidos.
- Dinheiro entregue ao garçom precisa ficar identificado como dinheiro.
- SmartPOS pode receber pagamento não associado a mesa.
- Pagamentos pertencem ao restaurante correto.
- Operação registra usuário/garçom responsável.
- Futuramente pode haver vários caixas.
- Confirmação de pagamento deve ser idempotente.
- Faturamento continua baseado em pagamentos aprovados.
- Realtime nunca será a fonte de verdade financeira.

**Código alterado:** nenhum ou apenas documentação.

**Critério de saída:** contrato revisado e aceito.

---

## ETAPA 1 — Criar a casca do SmartPOS

Branch sugerida:

```bash
feat/smartpos-shell
```

Criar apenas uma rota/tela:

```text
/smartpos
```

Interface inicial:

```text
KÔMA SmartPOS

[ Receber ]
[ Mesas ]
[ Histórico ]
```

Ainda sem pagamentos reais.

**Não alterar:**
- Caixa
- pedidos
- pagamentos
- relatórios
- impressão
- banco

**Critério de saída:** Kôma existente funciona exatamente como antes.

---

## ETAPA 2 — Autenticação e contexto

SmartPOS passa a conhecer:

```text
restaurante_id
usuario_id
perfil
sessão
```

Futuramente:

```text
device_id
```

Reutilizar a autenticação existente.

Perguntas que o sistema precisa responder:

- Quem está usando?
- Em qual restaurante?
- Tem autorização para receber?

Testes mínimos:

```text
Garçom restaurante A
não enxerga
restaurante B
```

```text
Sessão inválida
→ SmartPOS bloqueado
```

---

## ETAPA 3 — Feature flag

Adicionar mecanismo como:

```text
smartpos_enabled
```

por estabelecimento/plano.

Objetivo: desenvolver e manter o módulo desligado para quem não deve acessá-lo.

**Critério de saída:** SmartPOS pode ser ativado/desativado sem alterar código.

---

## ETAPA 4 — SmartPOS lê estado do caixa

Primeira integração real com backend.

Somente leitura.

SmartPOS mostra:

```text
Caixa aberto
```

ou:

```text
Caixa fechado
Recebimentos indisponíveis.
```

Invariante:

```text
caixa fechado
→ botão Receber desabilitado
```

Nenhuma regra financeira existente deve ser modificada.

---

## ETAPA 5 — SmartPOS lê mesas

Adicionar mapa/lista de mesas em modo somente leitura.

Exemplo:

```text
Mesa 01
R$ 83,40
Ocupada

Mesa 02
Livre

Mesa 03
R$ 142,00
Ocupada
```

Reutilizar quando possível:

- API de mesas
- tipos TypeScript
- formatação monetária
- status
- componentes existentes

---

## ETAPA 6 — Detalhes da mesa

Exibir consumo e saldo:

```text
Mesa 08

Pessoa A
2 × Hambúrguer
1 × Refrigerante

Pessoa B
1 × Pizza

Total consumido     R$ 94,00
Já pago             R$ 20,00
Restante             R$ 74,00

[ Receber ]
```

Ainda sem realizar pagamento.

---

## ETAPA 7 — Fluxo "Receber"

Construir apenas a interface.

Prioridade: digitar valor.

```text
Receber

R$ 0,00
────────────

[1] [2] [3]
[4] [5] [6]
[7] [8] [9]
[,] [0] [⌫]

Restante da mesa: R$ 74,00

[ Continuar ]
```

Regra de entrada monetária:

```text
1    → R$ 0,01
10   → R$ 0,10
100  → R$ 1,00
1000 → R$ 10,00
```

Ainda sem cobrança real.

---

## ETAPA 8 — Seleção opcional de itens

Adicionar:

```text
[ Digitar valor ]
ou
[ Selecionar itens ]
```

Exemplo:

```text
☑ 1 Hambúrguer       R$ 28
☑ 1 Refrigerante     R$ 8
☐ 1 Pizza            R$ 38

Selecionado           R$ 36
```

O domínio financeiro deve receber apenas o valor final:

```text
valor_a_receber = 36
```

Pagamento não precisa entender o cardápio.

---

## ETAPA 9 — Payment Intent interno

Introduzir conceito interno:

```text
PaymentIntent
```

Campos conceituais:

```text
id
restaurante_id
caixa_id
mesa_id?
usuario_id
valor
origem = smartpos
status
created_at
```

Estados:

```text
CREATED
   ↓
PROCESSING
   ↓
APPROVED
```

ou:

```text
PROCESSING
   ↓
DECLINED
```

ou:

```text
PROCESSING
   ↓
CANCELLED
```

Usar inicialmente um provider fake.

Exemplo:

```text
[ Simular aprovação ]
[ Simular recusa ]
```

---

## ETAPA 10 — Idempotência

Obrigatória antes de dinheiro real.

Cenário:

```text
SmartPOS cobra R$50
internet oscila
usuário tenta novamente
```

O sistema não pode registrar:

```text
R$50 + R$50
```

Cada operação deve ter uma chave única.

Exemplo:

```text
payment_intent_id
```

Uma confirmação repetida deve resultar em:

```text
pagamento já processado
```

e nunca em um novo lançamento.

---

## ETAPA 11 — Aprovação atualiza pagamento da mesa

Primeira alteração financeira real.

Fluxo:

```text
PaymentIntent APPROVED
        ↓
pagamento registrado
        ↓
saldo restante recalculado
```

Exemplo:

```text
Mesa: R$100
SmartPOS recebe R$30

Consumido      R$100
Pago            R$30
Restante        R$70
```

Não fazer:

```text
pagamento aprovado
→ fecha mesa
```

---

## ETAPA 12 — Estado "aguardando fechamento"

Quando o pagamento integral ocorrer:

```text
Mesa 12

Consumido       R$100
Pago            R$100
Restante         R$0

AGUARDANDO FECHAMENTO
```

O caixa verá algo como:

```text
Mesa 12
Pagamento concluído pelo SmartPOS

[ Conferir ]
[ Fechar mesa ]
```

Separar:

```text
pagamento
```

de:

```text
encerramento operacional da mesa
```

---

## ETAPA 13 — Pagamento parcial

Exemplo:

```text
Conta: R$120
```

Pessoa 1:

```text
R$40 cartão
```

Estado:

```text
Pago       R$40
Restante   R$80
```

Pessoa 2:

```text
R$50 PIX
```

Estado:

```text
Pago       R$90
Restante   R$30
```

Pessoa 3:

```text
R$30 dinheiro
```

Resultado:

```text
Pago      R$120
Restante    R$0

Aguardando fechamento
```

---

## ETAPA 14 — Dinheiro

Registrar:

```text
forma = DINHEIRO
responsavel = garçom X
```

Exemplo de auditoria:

```text
R$30 recebidos em dinheiro pelo garçom João
```

O caixa deve conseguir visualizar:

```text
PAGAMENTOS DA MESA

Cartão      R$40
PIX         R$50
Dinheiro    R$30
            ─────
Total      R$120

Dinheiro em posse do garçom:
R$30
```

---

## ETAPA 15 — Pagamento avulso

Adicionar:

```text
SmartPOS
→ Receber
→ Sem mesa
```

Fluxo:

```text
Digite o valor

R$35,00

Descrição opcional

[ Continuar ]
```

Backend:

```text
mesa_id = null
```

Mantendo:

```text
restaurante
caixa
usuário
valor
forma
origem
horário
```

---

## ETAPA 16 — Histórico do SmartPOS

Inicialmente somente leitura.

```text
MEUS RECEBIMENTOS

11:32    Mesa 12      R$40   Cartão
11:17    Avulso       R$20   PIX
10:58    Mesa 04      R$30   Dinheiro
```

Preferencialmente mostrar os pagamentos do usuário atual.

---

## ETAPA 17 — Vários terminais simultâneos

Testar concorrência:

```text
SmartPOS A
        \
         → Mesa 10
        /
SmartPOS B
```

Cenário crítico:

```text
Restante: R$50

POS A tenta cobrar R$50
POS B tenta cobrar R$50
```

O backend deve ser a autoridade final.

---

## ETAPA 18 — Realtime

Somente depois da consistência transacional.

Fluxo:

```text
SmartPOS
  ↓ pagamento aprovado
Backend
  ↓
Realtime
 ├── Caixa
 ├── outro SmartPOS
 └── mapa de mesas
```

Regra:

> **Realtime atualiza a interface. Banco/backend garantem consistência.**

---

## ETAPA 19 — Adapter do provedor de pagamento

Criar abstração:

```text
PaymentProvider
│
├── FakePaymentProvider
│
└── ProviderReal
```

Interface conceitual:

```text
start_payment()
cancel_payment()
get_status()
```

O restante do Kôma não deve depender diretamente de Stone, PagBank, Mercado Pago, Getnet, Rede, Cielo etc.

---

## ETAPA 20 — Primeiro provedor real

Fluxo:

```text
Kôma
 ↓
PaymentIntent
 ↓
PaymentProvider
 ↓
SDK/API da maquininha
 ↓
Adquirente
 ↓
APPROVED
 ↓
Kôma
```

Objetivo: substituir o provider fake sem redesenhar o domínio financeiro.

---

## ETAPA 21 — Recuperação de falhas

Testar deliberadamente:

```text
internet cai
backend cai
terminal reinicia
pagamento aprovado mas resposta não chega
usuário aperta duas vezes
mesa é transferida durante pagamento
caixa fecha durante tentativa
dois SmartPOS recebem simultaneamente
```

Criar mecanismos de recuperação e reconciliação conforme necessário.

---

## ETAPA 22 — Auditoria financeira

Conferir convergência entre:

```text
SmartPOS
        \
Caixa    → faturamento
        /
Pedidos
```

Deve existir uma única fonte de verdade para receita.

---

## ETAPA 23 — Impressão e comprovantes

Depois que o domínio financeiro estiver consolidado.

Adicionar:

- comprovante
- reimpressão
- auditoria de impressão
- marcação apropriada de reimpressão

Sem redesenhar pagamento.

---

## ETAPA 24 — UX específica da maquininha

Otimizar para hardware real:

- botões grandes
- teclado monetário
- contraste
- operação com uma mão
- loading explícito
- bloquear duplo toque
- estado offline
- feedback háptico se disponível
- boa orientação em telas pequenas

---

## ETAPA 25 — Piloto

Liberar inicialmente para:

```text
1 restaurante
1 terminal
1 caixa
```

Testar:

```text
pagamento integral
pagamento parcial
dinheiro
cartão
PIX
avulso
reabertura
fechamento
troca de garçom
queda de internet
```

Depois escalar:

```text
1 → 2 terminais
```

e somente então:

```text
2 → vários terminais
```

---

# 3. Fluxo de Git para cada etapa

Cada etapa deve seguir:

```text
Issue
  ↓
branch isolada
  ↓
implementação
  ↓
testes locais
  ↓
Pull Request
  ↓
Quality Gate
  ↓
review
  ↓
Squash & Merge
  ↓
main
  ↓
apagar branch
```

A `main` deve representar o Kôma conhecido como funcional.

---

# 4. Regra para trabalho em dupla

Nunca desenvolver duas etapas estruturais dependentes do SmartPOS simultaneamente.

Evitar:

```text
Pessoa A → etapa 10
Pessoa B → etapa 11
```

Preferir:

```text
Pessoa A → etapa 10
Pessoa B → outra Issue independente
```

ou:

```text
Pessoa A → implementação
Pessoa B → review/teste
```

Depois alternar.

---

# 5. Estados de acompanhamento

Cada etapa pode ter apenas um dos estados:

```text
⬜ NÃO INICIADA
🟨 EM DESENVOLVIMENTO
🟦 EM VALIDAÇÃO
🟩 CONCLUÍDA
```

Não avançar estruturalmente enquanto a etapa anterior não estiver validada.

---

# 6. Estratégia para economizar tokens/contexto

Nunca pedir a uma IA:

> Implemente as etapas 1 a 8.

Usar:

> SmartPOS — Etapa 4. Audite o estado atual e implemente somente essa etapa. Não avance para a 5.

Cada execução precisa carregar apenas:

```text
estado atual
+
regra da etapa
+
arquivos afetados
```

Evitar reanalisar o repositório inteiro sem necessidade.

---

# 7. Resumo executivo das etapas

```text
0   Contrato financeiro
1   Shell SmartPOS
2   Autenticação/contexto
3   Feature flag
4   Estado do caixa
5   Lista de mesas
6   Detalhes da mesa
7   Tela receber
8   Seleção de itens
9   Payment Intent
10  Idempotência
11  Registrar pagamento
12  Aguardando fechamento
13  Pagamentos parciais
14  Dinheiro
15  Pagamento avulso
16  Histórico
17  Concorrência
18  Realtime
19  Payment Provider
20  Provedor real
21  Recuperação de falhas
22  Auditoria financeira
23  Comprovantes
24  UX terminal
25  Piloto
```

---

# 8. Instrução para continuar o projeto em outro site/IA

Ao mover este roadmap para outra ferramenta, fornecer este arquivo junto com o repositório e usar a instrução:

```text
Este arquivo é o roadmap oficial do Kôma SmartPOS.

Regras:
1. Não pule etapas.
2. Trabalhe somente na etapa que eu indicar.
3. Antes de editar, audite o estado atual do repositório relacionado à etapa.
4. Não refatore áreas não necessárias.
5. Preserve compatibilidade com o Kôma existente.
6. Toda alteração financeira deve respeitar os invariantes documentados.
7. Cada etapa deve ser pequena, testável e reversível.
8. Não avance para a próxima etapa sem minha autorização.
9. Prefira reutilizar serviços, entidades e componentes existentes a duplicar lógica.
10. Informe claramente quais arquivos foram alterados e quais testes validam a etapa.
```

---

**Documento vivo:** este roadmap deve ser atualizado quando uma decisão arquitetural mudar, mas alterações não devem apagar o histórico ou os invariantes já consolidados sem justificativa técnica.
