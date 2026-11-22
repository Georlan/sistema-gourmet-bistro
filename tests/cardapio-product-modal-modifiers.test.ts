import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';

register('./helpers/staticAssetsLoader.mjs', import.meta.url);

const {
  formatModifierCounter,
  resolveScrollSpyActiveModifierId,
} = await import('../src/cardapio/components/CardapioProductModal');
const { selectionTypeCount } = await import('../src/domain/modifierQuantity');

test('CardapioProductModal - modificadores, barra sincronizada com scroll-spy e separação navegação vs erro', () => {
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
    /if \(unsatisfiedModifiers\.length > 0\) \{[\s\S]*setFeedback\(.*unsatisfiedModifiers[\s\S]*scrollToModifierGroup\(unsatisfiedModifiers\[0\]\.id,\s*"error"\);[\s\S]*return;/,
    'handleAdd deve bloquear avanço, orientar o cliente e ativar foco de erro quando faltar seleção obrigatória',
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
    /if \(needsVariantSelection\) \{[\s\S]*triggerErrorFocus\("__variant__"\)[\s\S]*return;/,
    'Deve bloquear a inclusão de família sem escolha do tamanho ou sabor e destacar erro em variante',
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

  // 6. Hierarquia de camadas: hero compacto com modificadores, sem sticky -top- no header do grupo,
  // sem z-10 em .koma-art-stepper-pill, z-20/z-0 explícitos e zero z-index 9999
  assert.match(
    modalSource,
    /allModifiers\.length > 0 \? "h-28 sm:h-40" : "h-52 sm:h-64"/,
    'Hero do modal deve ficar compacto (h-28 sm:h-40) quando houver grupos de modificadores',
  );
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
  assert.doesNotMatch(
    modalSource,
    /z-\[9999\]|zIndex:\s*9999|z-index:\s*9999/i,
    'Modal não deve usar z-index 9999',
  );
  assert.match(
    modalSource,
    /className="shrink-0 relative z-20[^"]*"[\s\S]*data-testid="modifier-steps-bar"/,
    'Barra de etapas deve ficar em camada z-20 acima do container rolável',
  );
  assert.match(
    modalSource,
    /className="relative z-0 min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pt-3[^"]*"[\s\S]*data-testid="product-modal-scroll"/,
    'Container rolável do modal deve ficar em camada z-0 com scroll-pt-3',
  );
  assert.match(
    modalSource,
    /className="shrink-0 relative z-20[^"]*" data-testid="product-modal-footer"/,
    'Footer do modal deve ficar em camada z-20 acima do container rolável',
  );

  // 7. Separação estrita entre navFocusedGroupId (navegação) e errorGroupId (erro real)
  assert.match(
    modalSource,
    /const \[navFocusedGroupId,\s*setNavFocusedGroupId\] = useState<string \| null>\(null\);/,
    'Deve manter estado dedicado navFocusedGroupId para destaque sutil de navegação',
  );
  assert.match(
    modalSource,
    /const \[errorGroupId,\s*setErrorGroupId\] = useState<string \| null>\(null\);/,
    'Deve manter estado dedicado errorGroupId exclusivo para falhas reais de validação',
  );
  assert.match(
    modalSource,
    /onClick=\{\(\) => scrollToModifierGroup\(modifier\.id,\s*"navigate"\)\}/,
    'Clique nas abas da barra de etapas deve navegar com modo "navigate", nunca modo de erro',
  );
  assert.match(
    modalSource,
    /isNavFocused[\s\S]*border-\[var\(--km-accent-border\)\] bg-\[var\(--km-accent-soft\)\]/,
    'Navegação por aba deve destacar grupo com --km-accent-border e --km-accent-soft sem pintura de erro',
  );
  assert.doesNotMatch(
    modalSource,
    /border-rose-|bg-rose-|ring-rose-|rose-500/,
    'Destaques de grupo obrigatório, variante e feedback devem usar tokens --km-alert-* sem classes rose-* hardcoded',
  );
  assert.match(
    modalSource,
    /isErrorFocused[\s\S]*rounded-2xl border p-3\.5 overflow-hidden[\s\S]*var\(--km-alert-soft\)[\s\S]*var\(--km-alert-border\)[\s\S]*var\(--km-alert-dot\)/,
    'Grupo com erro real deve formar container único coeso com tokens --km-alert-*',
  );

  // 8. Scroll-spy passivo com requestAnimationFrame e cleanup completo + pill scrollIntoView horizontal-only
  assert.match(
    modalSource,
    /ref=\{scrollContainerRef\}[\s\S]*data-testid="product-modal-scroll"/,
    'Container rolável deve receber scrollContainerRef',
  );
  assert.match(
    modalSource,
    /window\.requestAnimationFrame\(detectActiveModifier\)[\s\S]*container\.addEventListener\("scroll",\s*handleScroll,\s*\{\s*passive:\s*true\s*\}\);[\s\S]*container\.removeEventListener\("scroll",\s*handleScroll\)[\s\S]*window\.cancelAnimationFrame\(rafId\)/,
    'Scroll-spy deve registrar listener passivo com requestAnimationFrame e remover listener/frame no cleanup',
  );
  assert.match(
    modalSource,
    /aria-current=\{isActiveStep \? "step" : undefined\}[\s\S]*data-step-active=\{isActiveStep \? "true" : "false"\}/,
    'Etapa ativa na barra deve expor aria-current="step" e data-step-active="true"',
  );
  assert.match(
    modalSource,
    /pill\.scrollIntoView\(\{\s*inline:\s*"nearest",\s*block:\s*"nearest"\s*\}\)/,
    'Pílula ativa deve usar scrollIntoView com inline: "nearest" e block: "nearest" sem puxar scroll vertical',
  );

  // 9. Semântica de contadores com totalUnits e tipos distintos
  assert.match(
    modalSource,
    /\$\{selectedTypes\}\/\$\{max\} · \$\{totalUnits\} un\./,
    'Deve exibir "${selectedTypes}/${max} · ${totalUnits} un." quando houver repetição em modo padrão',
  );
});

test('formatModifierCounter e resolveScrollSpyActiveModifierId respeitam exatamente os modos de quantidade e scroll-spy', () => {
  // 1. Modo padrão com max > 1 (1 bacon + 1 cebola + 2 cheddar -> 3/4 · 4 un.)
  const selectedIds = ['bacon', 'cebola', 'cheddar', 'cheddar'];
  const rules = {
    optionIds: ['bacon', 'cebola', 'cheddar', 'picles'],
    minSelection: 0,
    maxSelection: 4,
  };
  const selectedTypes = selectionTypeCount(rules, selectedIds);
  const totalUnits = selectedIds.length;
  assert.equal(selectedTypes, 3);
  assert.equal(totalUnits, 4);

  const freeRepeatWithMulti = formatModifierCounter({
    selectedTypes,
    totalUnits,
    max: 4,
  });
  assert.equal(freeRepeatWithMulti.label, '3/4 · 4 un.');
  assert.match(freeRepeatWithMulti.ariaLabel, /3 de 4 tipos/);
  assert.match(freeRepeatWithMulti.ariaLabel, /4 unidades/);
  assert.match(freeRepeatWithMulti.hintSuffix, /Repetição livre/);

  // Sem repetição no modo padrão: mostra apenas tipos/max
  const freeRepeatNoDup = formatModifierCounter({
    selectedTypes: 2,
    totalUnits: 2,
    max: 4,
  });
  assert.equal(freeRepeatNoDup.label, '2/4');
  assert.match(freeRepeatNoDup.hintSuffix, /Repetição livre/);

  // 2. Modo porcoes: exibe totalUnits/max + Pode repetir
  const portions = formatModifierCounter({
    selectedTypes: 1,
    totalUnits: 2,
    max: 2,
    selectionMode: 'porcoes',
  });
  assert.equal(portions.label, '2/2');
  assert.equal(portions.hintSuffix, ' · Pode repetir');
  assert.match(portions.ariaLabel, /2 de 2 porções/);

  // 3. Modo tipos e max === 1: exibe selectedTypes/max sem sufixo de repetição
  const typesOnly = formatModifierCounter({
    selectedTypes: 2,
    totalUnits: 2,
    max: 3,
    selectionMode: 'tipos',
  });
  assert.equal(typesOnly.label, '2/3');
  assert.equal(typesOnly.hintSuffix, '');

  const singleChoice = formatModifierCounter({
    selectedTypes: 1,
    totalUnits: 1,
    max: 1,
  });
  assert.equal(singleChoice.label, '1/1');
  assert.equal(singleChoice.hintSuffix, '');

  // 4. Guarnições livres da marmitaria
  assert.equal(
    formatModifierCounter({ selectedTypes: 0, totalUnits: 0, max: 20, selectionMode: 'porcoes', freeGarnishes: true }).label,
    'Livre',
  );
  assert.equal(
    formatModifierCounter({ selectedTypes: 1, totalUnits: 3, max: 20, selectionMode: 'porcoes', freeGarnishes: true }).label,
    '3',
  );

  // 5. Scroll-spy: detecta grupo no topo e último grupo ao chegar no fim do container
  const groups = [
    { id: 'proteinas', top: 220, bottom: 440, height: 220 },
    { id: 'guarnicoes', top: 460, bottom: 720, height: 260 },
    { id: 'adicionais', top: 740, bottom: 980, height: 240 },
  ];
  assert.equal(
    resolveScrollSpyActiveModifierId({
      groups,
      containerTop: 100,
      containerBottom: 600,
      scrollTop: 0,
      scrollHeight: 1100,
      clientHeight: 500,
    }),
    'proteinas',
  );
  assert.equal(
    resolveScrollSpyActiveModifierId({
      groups: [
        { id: 'proteinas', top: -180, bottom: 40, height: 220 },
        { id: 'guarnicoes', top: 60, bottom: 320, height: 260 },
        { id: 'adicionais', top: 340, bottom: 580, height: 240 },
      ],
      containerTop: 100,
      containerBottom: 600,
      scrollTop: 400,
      scrollHeight: 1100,
      clientHeight: 500,
    }),
    'guarnicoes',
  );
  assert.equal(
    resolveScrollSpyActiveModifierId({
      groups: [
        { id: 'proteinas', top: -380, bottom: -160, height: 220 },
        { id: 'guarnicoes', top: -140, bottom: 120, height: 260 },
        { id: 'adicionais', top: 180, bottom: 420, height: 240 },
      ],
      containerTop: 100,
      containerBottom: 600,
      scrollTop: 600,
      scrollHeight: 1100,
      clientHeight: 500,
    }),
    'adicionais',
  );
});
