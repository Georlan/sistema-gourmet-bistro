import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMenuThemeTokens,
  getContrastRatio,
  getRelativeLuminance,
  KOMA_DEFAULT_BRAND_HEX,
} from '../src/cardapio/theme/komaMenuTheme.ts';

const SAMPLE_BRAND_COLORS = [
  { name: 'KÔMA Green (default)', hex: KOMA_DEFAULT_BRAND_HEX },
  { name: 'Pink / Magenta', hex: '#ec4899' },
  { name: 'Crimson Red', hex: '#e11d48' },
  { name: 'Amber / Yellow', hex: '#f59e0b' },
  { name: 'Royal Blue', hex: '#2563eb' },
  { name: 'Purple', hex: '#8b5cf6' },
  { name: 'Neutral Gray', hex: '#64748b' },
];

for (const sample of SAMPLE_BRAND_COLORS) {
  test(`komaMenuTheme maintains WCAG AA contrast for ${sample.name} in dark & light modes`, () => {
    for (const mode of ['dark', 'light'] as const) {
      const theme = buildMenuThemeTokens(sample.hex, mode);
      const { vars } = theme;

      const inkOnCard = getContrastRatio(vars['--km-ink'], vars['--km-card']);
      const mutedOnCard = getContrastRatio(vars['--km-muted'], vars['--km-card']);
      const onAccentContrast = getContrastRatio(vars['--km-on-accent'], vars['--km-accent']);
      const accentTextOnCard = getContrastRatio(vars['--km-accent-text'], vars['--km-card']);
      const ctaDarkContrast = getContrastRatio(vars['--km-cta-dark-ink'], vars['--km-cta-dark']);
      const headerContrast = getContrastRatio(vars['--km-header-ink'], vars['--km-header-deep']);
      const alertTextContrast = getContrastRatio(vars['--km-alert-text'], vars['--km-card']);
      const onAlertContrast = getContrastRatio(vars['--km-on-alert'], vars['--km-alert-dot']);
      const badgePastelContrast = getContrastRatio(vars['--km-badge-pastel-ink'], vars['--km-badge-pastel-bg']);

      assert.ok(inkOnCard >= 7.0, `${sample.name} (${mode}) ink/card contrast ${inkOnCard.toFixed(2)} < 7.0`);
      assert.ok(mutedOnCard >= 4.5, `${sample.name} (${mode}) muted/card contrast ${mutedOnCard.toFixed(2)} < 4.5`);
      assert.ok(onAccentContrast >= 4.5, `${sample.name} (${mode}) onAccent/accent contrast ${onAccentContrast.toFixed(2)} < 4.5`);
      assert.ok(accentTextOnCard >= 4.5, `${sample.name} (${mode}) accentText/card contrast ${accentTextOnCard.toFixed(2)} < 4.5`);
      assert.ok(ctaDarkContrast >= 7.0, `${sample.name} (${mode}) ctaDark contrast ${ctaDarkContrast.toFixed(2)} < 7.0`);
      assert.ok(headerContrast >= 7.0, `${sample.name} (${mode}) header contrast ${headerContrast.toFixed(2)} < 7.0`);
      assert.ok(alertTextContrast >= 4.5, `${sample.name} (${mode}) alertText/card contrast ${alertTextContrast.toFixed(2)} < 4.5`);
      assert.ok(onAlertContrast >= 4.5, `${sample.name} (${mode}) onAlert/alertDot contrast ${onAlertContrast.toFixed(2)} < 4.5`);
      assert.ok(badgePastelContrast >= 4.5, `${sample.name} (${mode}) badgePastel contrast ${badgePastelContrast.toFixed(2)} < 4.5`);
      assert.ok(Boolean(vars['--km-surface-soft']), `${sample.name} (${mode}) missing --km-surface-soft`);
      assert.ok(Boolean(vars['--km-art-mid']) && Boolean(vars['--km-art-ink']), `${sample.name} (${mode}) missing art tokens`);

      const pageLum = getRelativeLuminance(vars['--km-page']);
      if (mode === 'light') {
        assert.ok(pageLum >= 0.90, `${sample.name} (light) page luminance ${pageLum.toFixed(3)} is not airy enough`);
      } else {
        assert.ok(pageLum <= 0.025, `${sample.name} (dark) page luminance ${pageLum.toFixed(3)} is not deep enough`);
      }
    }
  });
}

test('komaMenuTheme shifts hue when brand color changes from green to pink', () => {
  const green = buildMenuThemeTokens('#05c49d', 'dark');
  const pink = buildMenuThemeTokens('#ec4899', 'dark');

  assert.notEqual(green.vars['--km-card'], pink.vars['--km-card']);
  assert.notEqual(green.vars['--km-accent'], pink.vars['--km-accent']);
  assert.notEqual(green.vars['--km-alert-dot'], pink.vars['--km-alert-dot']);
  assert.ok(Math.abs(green.hue - pink.hue) > 60);
});

test('komaMenuTheme falls back safely on invalid/short/empty hex inputs', () => {
  assert.equal(buildMenuThemeTokens('', 'dark').brandHex, KOMA_DEFAULT_BRAND_HEX);
  assert.equal(buildMenuThemeTokens('not-a-color', 'light').brandHex, KOMA_DEFAULT_BRAND_HEX);
  assert.equal(buildMenuThemeTokens('f0a', 'dark').brandHex, '#ff00aa');
});
