import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMenuThemeTokens,
  getContrastRatio,
  getRelativeLuminance,
  KOMA_DEFAULT_BRAND_HEX,
} from '../src/cardapio/theme/komaMenuTheme.ts';
import { BRAND_COLOR_PRESETS } from '../src/components/cardapio/CardapioDigitalSettingsPanel.tsx';

const EXPECTED_PRESETS: Array<{ label: string; hex: string }> = [
  { label: 'Verde KÔMA', hex: '#00b894' },
  { label: 'Menta', hex: '#34d399' },
  { label: 'Verde-sálvia', hex: '#6b9080' },
  { label: 'Verde-escuro', hex: '#15803d' },
  { label: 'Rosa-bebê', hex: '#f4a7c1' },
  { label: 'Rosa antigo', hex: '#c47c8e' },
  { label: 'Rosa vibrante', hex: '#ec4899' },
  { label: 'Lavanda', hex: '#c4b5fd' },
  { label: 'Lilás', hex: '#a855f7' },
  { label: 'Roxo', hex: '#7c3aed' },
  { label: 'Azul-claro', hex: '#38bdf8' },
  { label: 'Azul', hex: '#2563eb' },
  { label: 'Azul-petróleo', hex: '#0f766e' },
  { label: 'Coral', hex: '#fb7185' },
  { label: 'Terracota', hex: '#c26d4a' },
  { label: 'Laranja', hex: '#ea580c' },
  { label: 'Vermelho', hex: '#e11d48' },
  { label: 'Amarelo suave', hex: '#eab308' },
  { label: 'Grafite neutro', hex: '#475569' },
];

const ADDITIONAL_EDGE_COLORS = [
  { label: 'KÔMA Green (default)', hex: KOMA_DEFAULT_BRAND_HEX },
  { label: 'Amber / Yellow', hex: '#f59e0b' },
  { label: 'Purple', hex: '#8b5cf6' },
  { label: 'Neutral Gray', hex: '#64748b' },
  { label: 'Achromatic Black', hex: '#000000' },
  { label: 'Achromatic White', hex: '#ffffff' },
];

test('BRAND_COLOR_PRESETS exposes all 19 curated presets with unique hex values', () => {
  assert.equal(BRAND_COLOR_PRESETS.length, EXPECTED_PRESETS.length);
  assert.deepEqual(
    BRAND_COLOR_PRESETS.map((p) => ({ label: p.label, hex: p.hex })),
    EXPECTED_PRESETS,
  );
  const uniqueHexes = new Set(BRAND_COLOR_PRESETS.map((p) => p.hex));
  assert.equal(uniqueHexes.size, EXPECTED_PRESETS.length);
});

for (const sample of [...BRAND_COLOR_PRESETS, ...ADDITIONAL_EDGE_COLORS]) {
  test(`komaMenuTheme maintains WCAG AA contrast & surface hierarchy for ${sample.label} (${sample.hex}) in dark & light modes`, () => {
    for (const mode of ['dark', 'light'] as const) {
      const theme = buildMenuThemeTokens(sample.hex, mode);
      const { vars } = theme;

      const inkOnCard = getContrastRatio(vars['--km-ink'], vars['--km-card']);
      const mutedOnCard = getContrastRatio(vars['--km-muted'], vars['--km-card']);
      const onAccentContrast = getContrastRatio(vars['--km-on-accent'], vars['--km-accent']);
      const onAccentHoverContrast = getContrastRatio(vars['--km-on-accent'], vars['--km-accent-hover']);
      const accentTextOnCard = getContrastRatio(vars['--km-accent-text'], vars['--km-card']);
      const ctaDarkContrast = getContrastRatio(vars['--km-cta-dark-ink'], vars['--km-cta-dark']);
      const headerContrast = getContrastRatio(vars['--km-header-ink'], vars['--km-header-deep']);
      const alertTextContrast = getContrastRatio(vars['--km-alert-text'], vars['--km-card']);
      const alertTextOnSoftContrast = getContrastRatio(vars['--km-alert-text'], vars['--km-alert-soft']);
      const accentTextOnSoftContrast = getContrastRatio(vars['--km-accent-text'], vars['--km-accent-soft']);
      const onAlertContrast = getContrastRatio(vars['--km-on-alert'], vars['--km-alert-dot']);
      const badgePastelContrast = getContrastRatio(vars['--km-badge-pastel-ink'], vars['--km-badge-pastel-bg']);
      const focusContrast = getContrastRatio(vars['--km-focus'], vars['--km-card']);

      assert.ok(inkOnCard >= 7.0, `${sample.label} (${mode}) ink/card contrast ${inkOnCard.toFixed(2)} < 7.0`);
      assert.ok(mutedOnCard >= 4.5, `${sample.label} (${mode}) muted/card contrast ${mutedOnCard.toFixed(2)} < 4.5`);
      assert.ok(onAccentContrast >= 4.5, `${sample.label} (${mode}) onAccent/accent contrast ${onAccentContrast.toFixed(2)} < 4.5`);
      assert.ok(onAccentHoverContrast >= 4.5, `${sample.label} (${mode}) onAccent/hover contrast ${onAccentHoverContrast.toFixed(2)} < 4.5`);
      assert.ok(accentTextOnCard >= 4.5, `${sample.label} (${mode}) accentText/card contrast ${accentTextOnCard.toFixed(2)} < 4.5`);
      assert.ok(accentTextOnSoftContrast >= 4.5, `${sample.label} (${mode}) accentText/accentSoft contrast ${accentTextOnSoftContrast.toFixed(2)} < 4.5`);
      assert.ok(ctaDarkContrast >= 7.0, `${sample.label} (${mode}) ctaDark contrast ${ctaDarkContrast.toFixed(2)} < 7.0`);
      assert.ok(headerContrast >= 7.0, `${sample.label} (${mode}) header contrast ${headerContrast.toFixed(2)} < 7.0`);
      assert.ok(alertTextContrast >= 4.5, `${sample.label} (${mode}) alertText/card contrast ${alertTextContrast.toFixed(2)} < 4.5`);
      assert.ok(alertTextOnSoftContrast >= 4.5, `${sample.label} (${mode}) alertText/alertSoft contrast ${alertTextOnSoftContrast.toFixed(2)} < 4.5`);
      assert.ok(onAlertContrast >= 4.5, `${sample.label} (${mode}) onAlert/alertDot contrast ${onAlertContrast.toFixed(2)} < 4.5`);
      assert.ok(badgePastelContrast >= 4.5, `${sample.label} (${mode}) badgePastel contrast ${badgePastelContrast.toFixed(2)} < 4.5`);
      assert.ok(focusContrast >= 3.0, `${sample.label} (${mode}) focus/card contrast ${focusContrast.toFixed(2)} < 3.0`);

      assert.notEqual(vars['--km-accent'], vars['--km-alert-dot'], `${sample.label} (${mode}) accent and alert-dot must stay distinct`);
      assert.notEqual(vars['--km-accent-text'], vars['--km-alert-text'], `${sample.label} (${mode}) accent-text and alert-text must stay distinct`);
      assert.ok(Boolean(vars['--km-surface-soft']), `${sample.label} (${mode}) missing --km-surface-soft`);
      assert.ok(Boolean(vars['--km-art-mid']) && Boolean(vars['--km-art-ink']), `${sample.label} (${mode}) missing art tokens`);

      const pageLum = getRelativeLuminance(vars['--km-page']);
      if (mode === 'light') {
        const canvasLum = getRelativeLuminance(vars['--km-canvas']);
        const cardLum = getRelativeLuminance(vars['--km-card']);
        assert.ok(pageLum >= 0.90, `${sample.label} (light) page luminance ${pageLum.toFixed(3)} is not airy enough`);
        assert.notEqual(vars['--km-page'], vars['--km-canvas']);
        assert.notEqual(vars['--km-page'], vars['--km-card']);
        assert.ok(cardLum > pageLum && pageLum > canvasLum, `${sample.label} (light) must keep card > page > canvas hierarchy`);
      } else {
        assert.ok(pageLum <= 0.025, `${sample.label} (dark) page luminance ${pageLum.toFixed(3)} is not deep enough`);
      }
    }
  });
}

test('komaMenuTheme preserves real differentiation between baby pink, dusty rose, and vibrant pink', () => {
  for (const mode of ['dark', 'light'] as const) {
    const baby = buildMenuThemeTokens('#f4a7c1', mode);
    const dusty = buildMenuThemeTokens('#c47c8e', mode);
    const vibrant = buildMenuThemeTokens('#ec4899', mode);

    assert.notEqual(baby.vars['--km-accent'], dusty.vars['--km-accent']);
    assert.notEqual(baby.vars['--km-accent'], vibrant.vars['--km-accent']);
    assert.notEqual(dusty.vars['--km-accent'], vibrant.vars['--km-accent']);

    assert.notEqual(baby.vars['--km-accent-text'], dusty.vars['--km-accent-text']);
    assert.notEqual(dusty.vars['--km-accent-text'], vibrant.vars['--km-accent-text']);

    const babyLum = getRelativeLuminance(baby.vars['--km-accent']);
    const dustyLum = getRelativeLuminance(dusty.vars['--km-accent']);
    const vibrantLum = getRelativeLuminance(vibrant.vars['--km-accent']);

    assert.ok(babyLum > dustyLum + 0.12, `baby pink (${babyLum.toFixed(3)}) must stay noticeably lighter than dusty rose (${dustyLum.toFixed(3)}) in ${mode}`);
    assert.ok(dustyLum > vibrantLum, `dusty rose (${dustyLum.toFixed(3)}) stays softer than vibrant magenta (${vibrantLum.toFixed(3)}) in ${mode}`);

    // Adaptive polarity: pastel/soft pink gets dark ink; vibrant hot pink gets white ink
    assert.ok(getRelativeLuminance(baby.vars['--km-on-accent']) < 0.05);
    assert.equal(vibrant.vars['--km-on-accent'], '#ffffff');
  }
});

test('komaMenuTheme adapts --km-on-accent polarity across pastels and dark/vibrant presets', () => {
  for (const pastelHex of ['#f4a7c1', '#34d399', '#c4b5fd', '#eab308', '#38bdf8']) {
    for (const mode of ['dark', 'light'] as const) {
      const theme = buildMenuThemeTokens(pastelHex, mode);
      assert.ok(
        getRelativeLuminance(theme.vars['--km-on-accent']) < 0.05,
        `${pastelHex} (${mode}) should use dark ink on pastel/luminous accent`,
      );
    }
  }

  for (const deepOrVibrantHex of ['#15803d', '#2563eb', '#7c3aed', '#e11d48', '#475569', '#0f766e']) {
    for (const mode of ['dark', 'light'] as const) {
      const theme = buildMenuThemeTokens(deepOrVibrantHex, mode);
      assert.equal(
        theme.vars['--km-on-accent'],
        '#ffffff',
        `${deepOrVibrantHex} (${mode}) should use white ink on deep/vibrant accent`,
      );
    }
  }
});

test('komaMenuTheme shifts hue when brand color changes from green to pink', () => {
  const green = buildMenuThemeTokens('#05c49d', 'dark');
  const pink = buildMenuThemeTokens('#ec4899', 'dark');

  assert.notEqual(green.vars['--km-card'], pink.vars['--km-card']);
  assert.notEqual(green.vars['--km-accent'], pink.vars['--km-accent']);
  assert.notEqual(green.vars['--km-alert-dot'], pink.vars['--km-alert-dot']);
  assert.ok(Math.abs(green.hue - pink.hue) > 60);
});

test('komaMenuTheme memoizes tokens with LRU cache capped at 64 entries', () => {
  const first = buildMenuThemeTokens('#f4a7c1', 'dark');
  const second = buildMenuThemeTokens(' #F4A7C1 ', 'dark');
  assert.strictEqual(first, second);

  const light = buildMenuThemeTokens('#f4a7c1', 'light');
  assert.notStrictEqual(first, light);

  const shorthandA = buildMenuThemeTokens('f0a', 'dark');
  const shorthandB = buildMenuThemeTokens('#ff00aa', 'dark');
  assert.strictEqual(shorthandA, shorthandB);

  const makeHex = (i: number) => `#${(0x100000 + i * 2999).toString(16).slice(0, 6).padStart(6, '0')}`;
  const firstKey = makeHex(1);
  const secondKey = makeHex(2);
  const firstRef = buildMenuThemeTokens(firstKey, 'light');
  const secondRef = buildMenuThemeTokens(secondKey, 'light');

  // Fill remaining 62 slots
  for (let i = 3; i <= 64; i++) {
    buildMenuThemeTokens(makeHex(i), 'light');
  }

  // Re-touch firstKey so secondKey becomes the LRU entry
  assert.strictEqual(buildMenuThemeTokens(firstKey, 'light'), firstRef);

  // Inserting a 65th distinct entry evicts secondKey (LRU), preserving firstKey
  buildMenuThemeTokens(makeHex(65), 'light');
  assert.strictEqual(buildMenuThemeTokens(firstKey, 'light'), firstRef);

  const recomputedSecond = buildMenuThemeTokens(secondKey, 'light');
  assert.notStrictEqual(recomputedSecond, secondRef);
  assert.deepEqual(recomputedSecond, secondRef);
});

test('komaMenuTheme preserves KÔMA baseline --km-cta-dark-ink for accessibility contract', () => {
  assert.equal(buildMenuThemeTokens(KOMA_DEFAULT_BRAND_HEX, 'dark').vars['--km-cta-dark-ink'], '#041514');
  assert.equal(buildMenuThemeTokens(KOMA_DEFAULT_BRAND_HEX, 'light').vars['--km-cta-dark-ink'], '#ffffff');
});

test('komaMenuTheme falls back safely on invalid/short/empty hex inputs', () => {
  assert.equal(buildMenuThemeTokens('', 'dark').brandHex, KOMA_DEFAULT_BRAND_HEX);
  assert.equal(buildMenuThemeTokens('not-a-color', 'light').brandHex, KOMA_DEFAULT_BRAND_HEX);
  assert.equal(buildMenuThemeTokens('f0a', 'dark').brandHex, '#ff00aa');
});
