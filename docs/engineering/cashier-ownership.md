# Caixa: ownership e medidas após o hardening

Continuação atual: [fronteiras locais, navegação e rotas](cashier-boundaries.md).
Dados compartilhados entre papéis: [owners operacionais do App](operational-app-owners.md).
Direção atual e manutenção de mesas/contexto: [universalização incremental](koma-universalization.md).

Evolução após `b4e1473`: [módulos administrativos, PDV e carregamento sob demanda](cashier-loading.md).
As medidas abaixo registram o primeiro bloco de ownership; os limites e as medidas atuais estão no novo documento.

## Abrir primeiro

| Alteração | Owner | Contratos / prova |
|---|---|---|
| Checkout, seleção e idempotência | `caixa/checkout/useCheckoutController.ts` | `CheckoutDialog.tsx`, `cashierContracts.ts`, E2E operacional |
| Cancelamento, transferência, delivery e atualização otimista | `caixa/orders/useCashierOrders.ts` | `cashierWorkspaceTypes.ts`, testes de escopo |
| SmartPOS, bloqueio e reconciliação | `caixa/smartpos/useCashierSmartPos.ts` | Callback `onReconciled`; não recebe setters de checkout |
| Turno, movimentos e fechamento | `caixa/shift/useCashShift.ts` | Contratos de caixa em `src/types.ts` |
| Alertas, relógio e fallback de sincronização | `caixa/realtime/*` | Cleanup no próprio efeito; polling pausa conforme visibilidade/conexão |
| Composição e navegação legada | `CaixaPanel.tsx` | Apenas chama os owners acima e encaminha suas ações |

Os caminhos `caixa/*` acima estão em `src/components/caixa/`.
O controller de checkout permanece montado quando o diálogo fecha. O ref síncrono de processamento,
a chave de idempotência, o reset após confirmação e os erros continuam no mesmo owner.
O diálogo não executa HTTP, não cria estado financeiro e não registra subscriptions.
O SmartPOS solicita fechamento via callback somente depois de confirmar a reconciliação.

As fórmulas e protocolos foram transplantados, não redesenhados. Uma comparação estrutural das
árvores TypeScript com `5be341b` encontrou 51 declarações nomeadas equivalentes; a única mudança
entre as 52 comparadas foi a chamada de `onReconciled()` no lugar dos dois setters do checkout.
Isso é evidência complementar à revisão local e aos testes, não prova formal nem revisão independente.

## Guardas leves

`tests/cashierArchitecture.test.ts` roda dentro do check de frontend:

- impede corpos de ações transacionais na raiz e exige a ligação real dos sete hooks;
- limita a raiz a 141 chamadas de estado, 17 efeitos e 61 chamadas HTTP diretas;
- mantém `domain.ts` como reexportação de compatibilidade, sem funções próprias;
- impede imports de `CaixaPanel`/barrel genérico nos novos owners;
- verifica pares de registro/cleanup por efeito: oito listeners e três intervalos.

Os limites são um ratchet de dívida, não metas de qualidade nem snapshots para regenerar
automaticamente. Uma mudança legítima de fronteira exige decisão explícita e revisão do limite.
Os helpers de consumo, relógio, catálogo e busca agora vivem em módulos concretos de `src/domain/`.
Consumidores antigos podem continuar usando o barrel durante a migração gradual.

## Medição reproduzível

Com dependências instaladas, na raiz do checkout:

```sh
node scripts/architecture-metrics.mjs --ref 5be341b
npm run build
node scripts/architecture-metrics.mjs
```

O CI publica o JSON depois do build. LOC é contagem de newline, como `wc -l`; bytes são UTF-8.
Os pacotes de leitura abaixo são pontos de entrada sugeridos + contratos explícitos. Não são
o fechamento transitivo de imports, nem tokens realmente usados por uma pessoa ou modelo.
Alterações entre owners ainda exigem consultar a composição e os testes relacionados.

| Arquivo / leitura | Antes (`5be341b`) | Depois da extração |
|---|---:|---:|
| `CaixaPanel.tsx` | 9.438 linhas / 491.125 bytes | 7.244 linhas / 390.978 bytes |
| `App.tsx` | 2.310 / 86.693 | 2.312 / 86.819 |
| `domain.ts` | 327 / 12.369 | 5 / 502 |
| Entrada de checkout + contratos | 9.863 / 501.508 | 2.504 / 91.168 |
| Entrada de pedidos + contratos | 9.863 / 501.508 | 1.200 / 38.273 |

Novos owners: checkout 644 linhas; pedidos 729; SmartPOS 187; turno 189;
alertas 227; relógio 30; fallback realtime 45. A view de checkout tem 1.202 linhas e o contrato 44.
O código não desapareceu: foi movido e formatado com fronteiras próprias.
O contexto obrigatório anterior em `.agents/AGENTS.md` tinha 274 linhas;
o roteador novo tem 36 e o ponteiro de compatibilidade tem cinco.

## Bundle e dívida restante

Build local Vite, mesmas dependências; kB decimais, minificado / gzip:

| Chunk | Antes (`a613f7e`, governança) | Após consistência + ownership |
|---|---:|---:|
| CaixaPanel | 1.082,52 / 265,44 kB | 1.086,47 / 269,13 kB |
| App | 644,31 / 171,11 kB | 645,00 / 171,68 kB |

Não houve ganho de bundle: os dois chunks continuam acima de 500 kB e cresceram ligeiramente.
Não se aumentou o limite do warning. A próxima decisão de code splitting deve partir de medição
de carregamento/uso real por rota, não apenas da quantidade de arquivos.

A raiz continua grande: catálogo, estoque, CRM, configurações, PDV e parte de seus listeners/HTTP
ainda são legados. Busca e navegação permanecem na composição. Há tipos `any` herdados nos
fluxos movidos; esta extração não os transforma em contratos de domínio novos.
Não confundir essas melhorias com conclusão de toda a dívida estrutural.
