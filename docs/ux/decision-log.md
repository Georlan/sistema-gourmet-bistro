# Decisões de UX operacional

## 2026-09-12 — Checkout não presume pagamento

Decisão: abrir recebimento de mesa sem método, itens ou valor implicitamente escolhidos.

Motivo: essas três informações representam intenção operacional/financeira do operador. Pré-selecioná-las reduz cliques, mas aumenta o risco de baixa incorreta e dificulta entender o que será registrado.

O backend continua sendo a autoridade da baixa. O frontend apenas torna a intenção explícita antes da chamada.
