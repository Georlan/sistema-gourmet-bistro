import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('CardapioProductModal - modificadores e adicionais visíveis e validação de recheio obrigatório', () => {
  const modalSource = readFileSync(
    new URL('../src/cardapio/components/CardapioProductModal.tsx', import.meta.url),
    'utf8',
  );

  // 1. Modificadores devem ser abertos por padrão para visibilidade imediata
  assert.match(
    modalSource,
    /const expanded = !collapsible \|\| expandedExtras\[modifier\.id\] !== false;/,
    'Modificadores devem ser abertos por padrão (!== false) em vez de ocultos em accordion fechado',
  );

  // 2. Deve calcular unsatisfiedModifiers e hasUnsatisfied
  assert.match(
    modalSource,
    /const unsatisfiedModifiers = useMemo\(\(\) => \{[\s\S]*return !selectionWithinRules\(/,
    'Deve computar unsatisfiedModifiers reativamente a partir das regras dos modificadores',
  );
  assert.match(
    modalSource,
    /const hasUnsatisfied = unsatisfiedModifiers\.length > 0;/,
    'Deve expor hasUnsatisfied para feedback visual em tempo real',
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
    /Escolha \{unsatisfiedModifiers\.map\(\(m\) => m\.title\)\.join\(", "\)\} para continuar/,
    'Deve exibir aviso orientando a seleção do modificador obrigatório',
  );

  // 5. Botão de adicionar comunica a pendência e estiliza estado de aviso
  assert.match(
    modalSource,
    /hasUnsatisfied[\s\S]*border-amber-500\/50[\s\S]*from-emerald-500/,
    'Botão de ação deve distinguir visualmente quando há escolhas pendentes',
  );
});
