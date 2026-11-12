# KÔMA — Novo pedido: reconstrução progressiva (12/11/2026)

## Objetivo

Construir um PDV mais intuitivo, rápido e reconhecivelmente KÔMA que as referências externas observadas, preservando os comportamentos aprovados, o Core de Pedidos e os custos baixos da operação. Este documento descreve **etapas de trabalho**, não aprovação estética antecipada nem promessa de desempenho.

## Referências e restrições

- Capturas reais do KÔMA (catálogo, carrinho vazio/cheio, retirada, entrega, consumo local, personalização) fornecidas em 12/11.
- Capturas do BeeFood (grade, modais, quantidade selecionada, painel de pedido, atalhos) usadas como **benchmark de tarefas**, nunca como fonte de código, identidade, fotografia ou composição a copiar.
- Fontes de verdade: `docs/design-system/DESIGN_SYSTEM.md`, `docs/design/cashier-visual-direction.md`, `docs/addons-operational-ux.md`, `AGENTS.md`.
- Inter (corpo/controles), Space Grotesk (títulos), tokens de ação/foco claros e escuros. Meta WCAG AA; preferir alvos de 44px para toque.
- Nada de servidor, cache, dependência de UI, script no asset, consulta HTTP ou estado novo para meros elementos visuais.
- Nunca testar lançamentos reais no tenant 6; só fixture local, e2e ou ambiente isolado.

## Etapas independentes

1. **Fundação do catálogo e carrinho** — PR #1302 Draft: cards separados do owner de estado, controle independente de personalização vs inclusão rápida, preço/legibilidade, quantidades selecionadas por produto; SVG próprio de carrinho vazio; suporte de toque e navegação móvel, estilos isolados.
2. **Carrinho e finalização mobile** — simplificar os blocos condicionais e as áreas roláveis sem mudar validação, total, entidade Mesa ou lançamento canônico. Confirmar um único caminho principal com ação persistente acima da navegação do app, inclusive teclado virtual e textos ampliados. Preservar a entrada rápida de observação, alteração de quantidade e remoção.
3. **Modal de produto e complementos** — priorizar foto/descrição somente quando úteis; grupos obrigatórios com estado explícito, adicionais com preço, quantidade e total corretos; folha mobile quase tela cheia com rodapé estável, foco/Escape, leitura por screen reader e recuperação do contexto.
4. **Desktop e densidade adaptativa** — ajustar largura do carrinho, grade de produtos conforme espaço real, barra de categorias, teclado físico e espaço de trabalho, sem repetir o excesso de cards minúsculos das referências.
5. **Qualidade, limpeza e medição** — remover regras legadas somente após mapear consumidores; comparar tamanho de bundle, requests, memória/renderizações, tempo de interação e performance com baseline; ambos temas, 320/360/390/430/768/1366 px, texto gigante, baixo desempenho, listas longas e produtos sem foto.

## Invariantes de UX e negócio

- `+ Adicionar` insere uma unidade limpa; abrir o card personaliza; editar item recupera as escolhas existentes.
- Total, modificadores, disponibilidade, forma de atendimento e estado de envio continuam derivados dos owners de domínio existentes.
- Retirada: identificação e pagamento podem ser opcionais nas condições já suportadas.
- Entrega: requisitos de cliente/endereço são os existentes e nunca são enfraquecidos.
- Consumo local: vínculo com mesa e identificação de atendimento continuam canônicos, inclusive a escolha de não vincular inicialmente quando permitida.
- Nenhum botão visual transforma registro financeiro, cupom, reimpressão ou envio em ação autônoma.
- Mobile: uma rolagem vertical principal; gesto no catálogo não fica preso em regiões aninhadas; ações não encobrem a navegação inferior nem o teclado.

## Definição de pronto para cada etapa

PR pequeno e reversível; TypeScript/testes unitários/build e regressões Playwright focais verdes no **SHA final**; revisão visual em claro/escuro com capturas do preview; sem merge até aprovação; pós-deploy só com evidência da versão entregue. Não afirmar redução de custo sem medida.

## Checklist acumulado

- [x] Diagnóstico dos screenshots e das diferenças KÔMA/BeeFood.
- [x] Separação do card e isolamento do CSS.
- [x] Contador de quantidade existente no pedido.
- [x] Novo SVG específico para carrinho vazio.
- [x] Melhoria da ergonomia mobile de busca, chips, carrinho e alvos.
- [ ] Revalidar os gates no commit final da etapa 1.
- [ ] Homologar o preview em celular (ambos temas).
- [ ] Etapa 2 — carrinho/formulários.
- [ ] Etapa 3 — modal e complementos.
- [ ] Etapa 4 — desktop.
- [ ] Etapa 5 — limpeza e métricas.
