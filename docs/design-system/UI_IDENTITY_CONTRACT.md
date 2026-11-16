# Contrato de Identidade Visual KÔMA (Guia para Criação de Telas)

> **Objetivo:** garantir que qualquer nova tela ou componente (inclusive protótipos gerados com ChatGPT, Codex ou outros agentes) siga exatamente a identidade visual já implementada no KÔMA — com suporte nativo a modo claro e escuro — sem gerar estética genérica de IA.
> **Fontes de verdade no código:** [`src/styles/komaFoundation.css`](../../src/styles/komaFoundation.css), [`src/index.css`](../../src/index.css), [`src/components/caixa/navigation/cashierChrome.css`](../../src/components/caixa/navigation/cashierChrome.css) e [`docs/design-system/DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).

---

## 1. Regras anti-"cara de IA" (obrigatórias)

1. **Zero emojis na UI:** nunca usar emojis (`🎉`, `🔥`, `✅`, `📦`, `🚀`, etc.) em títulos, botões, badges, empty states ou rótulos.
2. **Uma única entrega coerente:** não gerar múltiplas versões/variações ("Opção 1, 2, 3") a menos que explicitamente solicitado.
3. **Sem efeitos decorativos gratuitos:** proibido `backdrop-filter: blur(...)`, brilhos neon, gradientes arco-íris, bordas luminosas, cards aninhados sem função ou textos publicitários genéricos.
4. **Sem dados ou estados falsos:** usar rótulos operacionais reais, curtos e diretos; empty state informa o fato e, se aplicável, a próxima ação.

---

## 2. Tipografia obrigatória

| Uso | Token CSS | Família real | Regra |
|---|---|---|---|
| Corpo, controles, rótulos, listas | `var(--koma-font-body)` | `"Inter", ui-sans-serif, system-ui, sans-serif` | Pesos `400` (leitura), `500–600` (rótulo/botão) |
| Títulos de seção, contadores, identificadores | `var(--koma-font-display)` | `"Space Grotesk", sans-serif` | Pesos `600–700`, `letter-spacing: -0.025em` |
| Códigos técnicos / chaves | `var(--font-mono)` | `"JetBrains Mono", monospace` | Apenas códigos técnicos, não como regra geral de preço |
| Números comparáveis, contadores, valores | — | — | Sempre aplicar `font-variant-numeric: tabular-nums` |

---

## 3. Cores, contraste e modos Claro / Escuro

**Nunca** hardcodar `#ffffff`, `#000000`, `bg-slate-*`, `bg-zinc-*` ou `text-white` em componentes operacionais. Toda cor deve vir dos tokens semânticos para funcionar automaticamente sob `[data-koma-theme="dark"]` e `[data-koma-theme="light"]`:

### Tokens semânticos globais (`komaFoundation.css` / `@theme` em `index.css`)
- **Superfícies (do fundo para o topo):**
  - `--koma-surface-page` / `bg-koma-page`
  - `--koma-surface-canvas` / `bg-koma-canvas`
  - `--koma-surface-panel` / `bg-koma-panel`
  - `--koma-surface-card` / `bg-koma-card`
  - `--koma-surface-raised` / `bg-koma-raised`
  - `--koma-surface-input` / `bg-koma-input`
  - `--koma-surface-dialog` / `bg-koma-dialog`
- **Textos:**
  - `--koma-text-primary` / `text-koma-foreground`
  - `--koma-text-secondary` / `text-koma-secondary`
  - `--koma-text-muted` / `text-koma-muted`
  - `--koma-text-subtle` / `text-koma-subtle`
- **Bordas e foco:**
  - `--koma-border-subtle`, `--koma-border-default` (`border-koma-border`), `--koma-border-strong` (`border-koma-border-strong`)
  - `--koma-focus-ring` (`outline: 2px solid var(--koma-focus-ring); outline-offset: 2px;`)
- **Ação principal e destaque:**
  - Ação principal: `background: var(--koma-action-bg); color: var(--koma-action-text);` (hover: `var(--koma-action-hover)`)
  - Referência da marca: `--koma-brand-reference: #05c49d` (dark) / `--koma-accent: #00875f` (light)
- **Estados semânticos:** `--koma-{success,danger,warning,info}-{bg,border,text}`

### Paleta operacional do Caixa / Vendas (`.cashier-shell` em `cashierChrome.css`)
Dentro de `.cashier-shell`, os tokens `--koma-surface-*` já assumem automaticamente a paleta verde-floresta no escuro e verde-sálvia suave no claro:
- **Dark:** superfícies `#13231b` → `#1d3328` → `#284235` → `#355242`; bordas `#496754` / `#577664` / `#729681`; texto `#f3faf5` / `#d5e7db`.
- **Light:** superfícies `#dce2dc` → `#e8ede6` → `#f2f4ed`; bordas `#a1b5a5` / `#849e8e`; texto `#1b3024` / `#354c40`.
- **Estado selecionado (abas, estágios ativos, dock mobile):** fundo `--kc-chrome-selected: #83e3c6` com texto `--kc-chrome-on-selected: #07382c`.

---

## 4. Hierarquia, profundidade e geometria

- **Profundidade sem blur:** separar camadas por degrau de superfície (`canvas` < `panel` < `card` < `raised`) + borda `1px solid var(--koma-border-default)`.
- **Relevo tátil discreto em controles interativos e colunas:** `box-shadow: inset 0 1px 0 #ffffff20, 0 2px 0 #082d2059` (ou `0 3px 0`), com `transform: translateY(1px)` no `:active`.
- **Raios padrão do Caixa:**
  - Inputs e botões de toolbar: `0.75rem` (`rounded-xl`)
  - Painéis, toolbars e abas: `1rem`
  - Colunas / cards principais: `1.25rem`
- **Alvos touch (mobile-first):** botões e controles interativos devem ter altura mínima de `44px` (`min-h-11` / `2.75rem`).

---

## 5. Ícones, componentes e assets existentes

- **Ícones de UI:** usar exclusivamente `lucide-react` (ex.: `Menu`, `Search`, `Check`, `MessageSquare`, `ReceiptText`, `CirclePlus`, `ChefHat`, `Wallet`, `AlertTriangle`, `Clock`, `MapPin`).
- **Estados vazios:**
  - Para telas gerais: usar [`KomaEmptyState`](../../src/components/shared/KomaEmptyState.tsx).
  - Para ilustrações vetoriais do Caixa: reutilizar os SVGs oficiais em `public/brand/cashier/` (`closing-empty-v1.svg`, `order-ticket-v1.svg`, `salon-empty-v1.svg`, `pdv-empty-cart-v1.svg`, `inbox-orders-v1.svg`, `cashier-counter-v1.svg`, `operator-access-v1.svg`, `chat-pair-v1.svg`, `pause-menu-v1.svg`, `support-note-v1.svg`) com `alt=""` e `aria-hidden="true"`.
- **Marca:** importar via [`src/brand/komaBrand.ts`](../../src/brand/komaBrand.ts) (`on-dark` para fundo escuro, `on-light` para fundo claro).
- **Não inventar novos assets SVG/PNG** quando já existir equivalente no catálogo em [`docs/design-system/ASSETS.md`](./ASSETS.md).
