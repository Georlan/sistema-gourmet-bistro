# KÔMA — Revisão tonal do PDV (13/11/2026)

## Motivo

A captura real do carrinho em modo escuro mostrou menta brilhante aplicada simultaneamente à modalidade, ao valor dos itens, aos controles secundários e à ação final. Isso reduzia a hierarquia do checkout e contrariava a diretriz **baixo ruído / alto sinal**. Não era necessário criar banners, ilustrações ou um novo tema global.

## Fontes de design verificadas

- `docs/design-system/DESIGN_SYSTEM.md` — marca `#05c49d` não deve virar a cor de todo botão; ação principal acima de seleção e superfície; texto de corpo com contraste mínimo 4,5:1 e controle crítico de 44 px.
- `docs/design/cashier-visual-direction.md` e `src/styles/komaFoundation.css` — Inter para controles, Space Grotesk em valores/identificação, estados independentes e paletas de operação e compra preservadas.
- `src/components/caixa/pdv/cashierPdvCart.css`, `cashierPdvVisual.css`, `cashierPdvMobileWorkspace.css` e `cashierPdvConfig.css` — usos reais de modo ativo, contexto de mesa, preços, detalhes, total e CTA.

## Decisões incorporadas

- Novo módulo **`src/components/caixa/pdv/cashierPdvTone.css`**, importado apenas pelo CSS da aplicação e escopado a `.cashier-pdv-view`. Não modifica marca, Garçom, Salão, Entregador, receitas financeiras ou a identidade dos restaurantes.
- As variáveis `--pdv-*` representam **funções**, não cores por superstição: `canvas`, `surface`, `card`, `raised`, `inset`, `border`, `text`, `secondary`, `selection`, `quiet-action`, `primary` e `focus`. O tema claro tem correspondência completa, sem copiar valor de tema escuro.
- Verde menta mais intenso apenas na **ação principal** `Lançar Pedido`. Adicionar produto e `Ver pedido` são botões secundários tonalizados; selecionados de modalidade, categoria e pagamento usam fundo + borda + texto de contraste. Não há glow, gradiente ou animação artificial nova.
- Preços de itens e contagem usam cor de texto/valor em vez de outro destaque saturado. O total mantém alto contraste; título e valor continuam diferenciados tipograficamente.
- `CashierPdvView.tsx` deixa de injetar classes Tailwind com verde fixo em cada categoria e no total. O estado nativo `aria-pressed` é a única autoridade do estilo ativo. Reduzimos repetição de classes e impedimos divergência futura ao mudar paleta.
- Alvos touch, foco, temas, modo de movimento reduzido, rolagem interna e estados de erro/indisponibilidade são preservados. Nenhuma regra de pedido, catálogo, mesa, Pix, Mercado Pago, lançamento ou backend mudou.

## Contraste e aceite

As combinações sólidas foram escolhidas para legibilidade: ação escura `#2dc9a6` / `#0a231b` (~7,9:1), botão de ação claro `#00745f` / `#fff` (~5,7:1), seleção escura `#284a3c` / `#f2f7f3` e seleção clara `#dceee3` / `#1c3027`. Um teste Playwright mede **cores computadas** de modalidade, categoria, CTA, valor e botões secundários para exigir ≥4,5:1 em ambos os temas, além de verificar que modo ativo e botão principal não tenham a mesma superfície.

Validar ainda viewport 320/390/430/768/1366, catálogo, modalidades, cliente, pagamento, pedido para mesa, foco e estado do carrinho. Publicação somente com CI verde, `/meta.json` confirmando SHA novo e smoke de produção não destrutivo.

### Limitação preexistente do auditor global

`npm run audit:light` continua retornando tokens ausentes no verificador legado (que lê `index.css` e não resolve integralmente as variáveis importadas de `komaFoundation.css`). O **mesmo resultado foi reproduzido sem qualquer mudança na versão anterior `9699ee4f`**, em worktree separado. Não fazer correção oportunista desse verificador neste PR visual. Os novos testes Playwright de contraste calculam cores **efetivamente renderizadas** nas superfícies do PDV nos dois temas e aprovam os pares de texto + superfície com ≥4,5:1.
