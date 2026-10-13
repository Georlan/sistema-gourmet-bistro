import type { Plugin } from 'postcss';

/** Scale absolute text sizes once, including Tailwind utilities and CSS overrides.
 * Inherited/em/percentage sizes are deliberately excluded to avoid compounding.
 * The runtime variable exists only while the operational display preference is active.
 */
export function scaleTextValue(value: string): string {
  if (value.includes('--koma-text-scale')) return value;
  if (/\d(?:em|%)(?:\b|\s|\))/.test(value)) return value;
  if (!/\d(?:px|rem)\b|var\(--text-/.test(value)) return value;
  return `calc((${value}) * var(--koma-text-scale, 1))`;
}

export function scaleOperationalText(): Plugin {
  return {
    postcssPlugin: 'koma-operational-text-scale',
    Declaration(declaration) {
      if (declaration.prop === 'font-size' || (declaration.prop === 'line-height' && /\d(?:px|rem)\b/.test(declaration.value))) declaration.value = scaleTextValue(declaration.value);
    },
  };
}
