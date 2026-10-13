import assert from 'node:assert/strict';
import test from 'node:test';
import postcss from 'postcss';
import { scaleOperationalText, scaleTextValue } from '../scripts/scaleOperationalText';
import { normalizeKomaTextSize, KOMA_TEXT_SCALES } from '../src/config/textSize';

test('absolute typography scales once; inherited sizes and non-text dimensions are preserved', async () => {
  const css = '.tabs{font-size:10px!important;height:44px;line-height:14px}.label{font-size:var(--text-xs)}.nested{font-size:1em}.percent{font-size:100%}';
  const once = await postcss([scaleOperationalText()]).process(css, { from: undefined });
  const twice = await postcss([scaleOperationalText()]).process(once.css, { from: undefined });
  assert.equal(twice.css, once.css);
  assert.match(once.css, /font-size:calc\(\(10px\) \* var\(--koma-text-scale, 1\)\)!important/);
  assert.match(once.css, /height:44px/);
  assert.match(once.css, /line-height:calc/);
  assert.match(once.css, /font-size:1em/);
  assert.match(once.css, /font-size:100%/);
  assert.equal(scaleTextValue('inherit'), 'inherit');
  assert.equal(scaleTextValue('clamp(.7rem, 1vw, 1rem)').includes('--koma-text-scale'), true);
});
test('stored preference is validated and has consistent multipliers', () => {
  assert.equal(normalizeKomaTextSize('invalid'), 'padrao');
  assert.equal(normalizeKomaTextSize(null), 'padrao');
  assert.deepEqual(KOMA_TEXT_SCALES, { padrao: 1, grande: 1.2, gigante: 1.4 });
});
