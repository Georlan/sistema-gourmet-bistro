import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('CardapioProductModal - modificadores e adicionais visíveis e validação de recheio obrigatório', () => {
  const modalSource = readFileSync(
    new URL('../src/cardapio/components/CardapioProductModal.tsx', import.meta.url),
    'utf8',
  );

  // 1. Modificadores obrigatórios devem ser abertos por padrão para visibilidade imediata
  assert.match(
    modalSource,
    /const expanded = !collapsible \|\| expandedExtras\[modifier\.id\] === true;/,
    'Modificadores obrigatórios não-colapsáveis (!collapsible) ficam sempre abertos por padrão',
  );

  // 2. Deve calcular unsatisfiedModifiers e hasUnsatisfied
  assert.match(
    modalSource,
    /const unsatisfiedModifiers = useMemo\(\(\) => \{[\s\S]*return !selectionWithinRules\(/,
    'Deve computar unsatisfiedModifiers reativamente a partir das regras dos modificadores',
  );
  assert.match(
    modalSource,
    /const hasUnsatisfied = needsVariantSelection \|\| unsatisfiedModifiers\.length > 0;/,
    'Deve expor hasUnsatisfied para modificadores ou variante obrigatória ainda não escolhidos',
  );

  // 3. Bloqueio no avanço (handleAdd) se houver grupos obrigatórios não satisfeitos
  assert.match(
    modalSource,
    /if \(unsatisfiedModifiers\.length > 0\) \{[\s\S]*setFeedback\(.*unsatisfiedModifiers[\s\S]*return;/,
    'handleAdd deve bloquear avanço e orientar o cliente quando faltar seleção obrigatória',
  );

  // 4. Indicador visual antes do botão principal quando faltar opção obrigatória
  assert.match(
    modalSource,
    /Escolha \$\{unsatisfiedModifiers\.map\(\(m\) => m\.title\)\.join\(", "\)\} para continuar/,
    'Deve exibir aviso orientando a seleção de modificadores obrigatórios',
  );

  // 4b. A variante (tamanho/sabor) é tão obrigatória quanto os modificadores.
  assert.match(
    modalSource,
    /if \(needsVariantSelection\) \{[\s\S]*setFeedback\([\s\S]*return;/,
    'Deve bloquear a inclusão de família sem escolha do tamanho ou sabor',
  );
  assert.match(
    modalSource,
    /Escolha o tamanho para continuar[\s\S]*Escolha o sabor para continuar/,
    'Deve informar qual escolha está faltando no modal',
  );

  // 5. Botão de adicionar comunica a pendência e estiliza estado de aviso adaptativo
  assert.match(
    modalSource,
    /hasUnsatisfied[\s\S]*--km-alert-border[\s\S]*--km-accent/,
    'Botão de ação deve distinguir visualmente quando há escolhas pendentes',
  );

  // 6. Hierarquia de camadas (Imagem 8): sem sticky -top- no header do grupo, sem z-10 no wrapper de stepper, z-20/z-0 explícitos
  assert.doesNotMatch(
    modalSource,
    /sticky\s+-top-/,
    'Cabeçalho de grupo de modificadores não deve usar sticky -top- que colide com steppers durante a rolagem',
  );
  assert.doesNotMatch(
    modalSource,
    /z-10[^"\n]*koma-art-stepper-pill/,
    'Wrapper de .koma-art-stepper-pill não deve usar z-10',
  );
  assert.match(
    modalSource,
    /className="shrink-0 relative z-20[^"]*"[\s\S]*data-testid="modifier-steps-bar"/,
    'Barra de etapas deve ficar em camada z-20 acima do container rolável',
  );
  assert.match(
    modalSource,
    /className="relative z-0 min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pt-3[^"]*" data-testid="product-modal-scroll"/,
    'Container rolável do modal deve ficar em camada z-0 com scroll-pt-3',
  );
  assert.match(
    modalSource,
    /className="shrink-0 relative z-20[^"]*" data-testid="product-modal-footer"/,
    'Footer do modal deve ficar em camada z-20 acima do container rolável',
  );

  // 7. Destaque de grupo obrigatório e feedback (Imagem 7): tokens --km-alert-* sem rose-500 hardcoded
  assert.doesNotMatch(
    modalSource,
    /border-rose-|bg-rose-|ring-rose-|rose-500/,
    'Destaques de grupo obrigatório, variante e feedback devem usar tokens --km-alert-* sem classes rose-* hardcoded',
  );
  assert.match(
    modalSource,
    /isHighlighted[\s\S]*rounded-2xl border p-3\.5 overflow-hidden[\s\S]*var\(--km-alert-soft\)[\s\S]*var\(--km-alert-border\)[\s\S]*var\(--km-alert-dot\)/,
    'Grupo destacado deve formar container único coeso com tokens --km-alert-*',
  );
});
