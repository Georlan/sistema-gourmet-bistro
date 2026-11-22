/**
 * Universal perceptual color & lighting system for KÔMA Cardápio Digital.
 *
 * Keeps KÔMA green (#05c49d / #00875f) as the canonical baseline and adapts
 * surfaces, borders, soft tints and action tokens to any restaurant brand
 * hue in OKLCH space while guaranteeing WCAG AA (>= 4.5:1) contrast.
 */

export type MenuThemeMode = 'dark' | 'light';

export const KOMA_DEFAULT_BRAND_HEX = '#05c49d';

const MENU_THEME_CACHE_LIMIT = 64;
const menuThemeCache = new Map<string, MenuThemeTokens>();

export interface MenuThemeTokens {
  mode: MenuThemeMode;
  brandHex: string;
  hue: number;
  isAchromatic: boolean;
  vars: Record<string, string>;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Oklch {
  l: number;
  c: number;
  h: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function normalizeHexColor(input?: string | null): string {
  if (!input) return KOMA_DEFAULT_BRAND_HEX;
  const trimmed = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[0]}${trimmed[0]}${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(trimmed)) {
    return `#${trimmed.toLowerCase()}`;
  }
  return KOMA_DEFAULT_BRAND_HEX;
}

function hexToRgb(hex: string): Rgb {
  const clean = normalizeHexColor(hex).slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const toByte = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;

function rgbToOklch(rgb: Rgb): Oklch {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bLab = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

  const C = Math.hypot(a, bLab);
  let H = (Math.atan2(bLab, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return { l: L, c: C, h: H };
}

function oklchToLinearRgbRaw(L: number, C: number, H: number): Rgb {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  };
}

function isInsideGamut(rgb: Rgb): boolean {
  const eps = 0.0005;
  return (
    rgb.r >= -eps && rgb.r <= 1 + eps &&
    rgb.g >= -eps && rgb.g <= 1 + eps &&
    rgb.b >= -eps && rgb.b <= 1 + eps
  );
}

export function oklchToHex(L: number, C: number, H: number): string {
  const safeL = clamp01(L);
  let low = 0;
  let high = Math.max(0, C);
  let best = oklchToLinearRgbRaw(safeL, 0, H);

  if (isInsideGamut(oklchToLinearRgbRaw(safeL, high, H))) {
    best = oklchToLinearRgbRaw(safeL, high, H);
  } else {
    for (let i = 0; i < 14; i++) {
      const mid = (low + high) / 2;
      const candidate = oklchToLinearRgbRaw(safeL, mid, H);
      if (isInsideGamut(candidate)) {
        best = candidate;
        low = mid;
      } else {
        high = mid;
      }
    }
  }

  return rgbToHex({
    r: linearToSrgb(clamp01(best.r)),
    g: linearToSrgb(clamp01(best.g)),
    b: linearToSrgb(clamp01(best.b)),
  });
}

export function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function getContrastRatio(hexA: string, hexB: string): number {
  const lumA = getRelativeLuminance(hexA);
  const lumB = getRelativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureMinContrast(
  lightnessStart: number,
  chroma: number,
  hue: number,
  againstHex: string,
  minRatio: number,
  direction: 'lighter' | 'darker',
): string {
  let l = lightnessStart;
  for (let i = 0; i < 40; i++) {
    const candidate = oklchToHex(l, chroma, hue);
    if (getContrastRatio(candidate, againstHex) >= minRatio) {
      return candidate;
    }
    l = direction === 'darker' ? Math.max(0.12, l - 0.015) : Math.min(0.96, l + 0.015);
  }
  return oklchToHex(l, chroma, hue);
}

/** Ensures a color meets `minRatio` contrast against two reference backgrounds simultaneously. */
function ensureMinContrastPair(
  lightnessStart: number,
  chroma: number,
  hue: number,
  againstHexA: string,
  againstHexB: string,
  minRatio: number,
  direction: 'lighter' | 'darker',
): string {
  let l = lightnessStart;
  for (let i = 0; i < 40; i++) {
    const candidate = oklchToHex(l, chroma, hue);
    if (
      getContrastRatio(candidate, againstHexA) >= minRatio &&
      getContrastRatio(candidate, againstHexB) >= minRatio
    ) {
      return candidate;
    }
    l = direction === 'darker' ? Math.max(0.12, l - 0.015) : Math.min(0.96, l + 0.015);
  }
  return oklchToHex(l, chroma, hue);
}

/** Resolves `--km-accent`, `--km-accent-hover`, and adaptive `--km-on-accent` preserving pastel/earthy/vibrant character. */
function resolveAdaptiveAccent(
  parsedLightness: number,
  accentChroma: number,
  accentHue: number,
  deepHue: number,
  isAchromatic: boolean,
  mode: MenuThemeMode,
): { accent: string; accentHover: string; onAccent: string } {
  const minL = mode === 'dark' ? 0.49 : 0.22;
  const maxL = mode === 'dark' ? 0.84 : 0.815;
  const baseL = Math.min(maxL, Math.max(minL, parsedLightness));
  const darkOnAccent = oklchToHex(
    0.16,
    isAchromatic ? 0 : Math.min(0.05, accentChroma * 0.34),
    deepHue,
  );
  const lightOnAccent = '#ffffff';

  const preferDarkInk =
    parsedLightness >= 0.675 ||
    (parsedLightness >= 0.61 && accentChroma <= 0.125) ||
    (accentHue >= 68 && accentHue <= 185 && parsedLightness >= 0.62);

  if (!preferDarkInk) {
    const onAccent = lightOnAccent;
    let l = baseL;
    for (let i = 0; i < 40; i++) {
      const candidate = oklchToHex(l, accentChroma, accentHue);
      if (getContrastRatio(candidate, onAccent) >= 4.65) break;
      l = Math.max(0.16, l - 0.012);
    }
    const accent = oklchToHex(l, accentChroma, accentHue);
    const hoverTarget = mode === 'dark' ? Math.min(0.68, l + 0.045) : Math.max(0.15, l - 0.055);
    const hoverCandidate = oklchToHex(hoverTarget, accentChroma, accentHue);
    const accentHover =
      getContrastRatio(hoverCandidate, onAccent) >= 4.55
        ? hoverCandidate
        : ensureMinContrast(hoverTarget, accentChroma, accentHue, onAccent, 4.65, 'darker');
    return { accent, accentHover, onAccent };
  }

  const onAccent = darkOnAccent;
  let l = baseL;
  for (let i = 0; i < 32; i++) {
    const candidate = oklchToHex(l, accentChroma, accentHue);
    if (getContrastRatio(candidate, onAccent) >= 4.75) break;
    l = Math.min(maxL, l + 0.012);
  }
  const accent = oklchToHex(l, accentChroma, accentHue);
  const hoverTarget = mode === 'dark' ? Math.min(0.89, l + 0.045) : Math.max(minL, l - 0.045);
  const hoverCandidate = oklchToHex(hoverTarget, accentChroma, accentHue);
  const accentHover =
    getContrastRatio(hoverCandidate, onAccent) >= 4.55
      ? hoverCandidate
      : ensureMinContrast(hoverTarget, accentChroma, accentHue, onAccent, 4.75, 'lighter');
  return { accent, accentHover, onAccent };
}

function normalizeHue(h: number): number {
  const mod = h % 360;
  return mod < 0 ? mod + 360 : mod;
}

/**
 * Generates an artistic two-tone OKLCH hue pairing from a single brand hue,
 * keeping `accentHue` faithful to the chosen brand color while shifting
 * `deepHue` and `artDomeHue` smoothly for organic illustrations and deep headers.
 */
function computeArtisticHuePair(
  hue: number,
  isAchromatic: boolean,
): { accentHue: number; deepHue: number; artDomeHue: number } {
  if (isAchromatic) {
    return { accentHue: hue, deepHue: hue, artDomeHue: hue };
  }

  // Warm amber / yellow / orange: keep warm terracotta/espresso without crossing into crimson
  if (hue >= 35 && hue <= 115) {
    return {
      accentHue: hue,
      deepHue: normalizeHue(hue - 12),
      artDomeHue: normalizeHue(hue + 10),
    };
  }

  // Green / mint / sage / emerald: pair with deep petrol teal
  if (hue > 115 && hue <= 195) {
    return {
      accentHue: hue,
      deepHue: normalizeHue(hue + 18),
      artDomeHue: normalizeHue(hue - 10),
    };
  }

  // Cyan / blue: pair with deep navy indigo
  if (hue > 195 && hue <= 275) {
    return {
      accentHue: hue,
      deepHue: normalizeHue(hue + 12),
      artDomeHue: normalizeHue(hue - 12),
    };
  }

  // Purple / violet / lavender: pair with deep plum
  if (hue > 275 && hue <= 325) {
    return {
      accentHue: hue,
      deepHue: normalizeHue(hue + 12),
      artDomeHue: normalizeHue(hue - 10),
    };
  }

  // Pink / rose / coral / crimson: pair with deep berry wine
  return {
    accentHue: hue,
    deepHue: normalizeHue(hue - 10),
    artDomeHue: normalizeHue(hue + 10),
  };
}

export function buildMenuThemeTokens(
  rawBrandHex?: string | null,
  mode: MenuThemeMode = 'dark',
): MenuThemeTokens {
  const brandHex = normalizeHexColor(rawBrandHex);
  const cacheKey = `${brandHex}|${mode}`;
  const cached = menuThemeCache.get(cacheKey);
  if (cached) {
    menuThemeCache.delete(cacheKey);
    menuThemeCache.set(cacheKey, cached);
    return cached;
  }

  const parsed = rgbToOklch(hexToRgb(brandHex));
  const isAchromatic = parsed.c < 0.02;
  const hue = isAchromatic ? 168 : parsed.h;
  const { accentHue, deepHue, artDomeHue } = computeArtisticHuePair(hue, isAchromatic);
  const accentChroma = isAchromatic ? 0 : Math.min(0.21, Math.max(0.028, parsed.c));
  const isWarmHue = hue >= 35 && hue <= 115;
  // Adaptive opposite/alert hue: coral-red for cool/green brands; warm amber-gold for pink/red/orange brands
  const isWarmOrPinkBrand = !isAchromatic && (hue <= 45 || hue > 315);
  const alertHueBase = isWarmOrPinkBrand ? 76 : 22;
  const alertChroma = isWarmOrPinkBrand ? 0.135 : 0.148;

  const { accent, accentHover, onAccent } = resolveAdaptiveAccent(
    parsed.l,
    accentChroma,
    accentHue,
    deepHue,
    isAchromatic,
    mode,
  );

  let result: MenuThemeTokens;

  if (mode === 'light') {
    const surfaceChroma = isAchromatic
      ? 0
      : isWarmHue
        ? Math.min(0.010, accentChroma * 0.065)
        : Math.min(0.014, Math.max(0.004, accentChroma * 0.09));
    // Clear hierarchy in light mode: canvas (0.948) < page (0.972) < card (#ffffff)
    const page = oklchToHex(0.972, surfaceChroma, deepHue);
    const canvas = oklchToHex(0.948, surfaceChroma * 1.25, deepHue);
    const shell = oklchToHex(0.984, surfaceChroma * 0.6, deepHue);
    const panel = '#ffffff';
    const card = '#ffffff';
    const surfaceSoft = oklchToHex(0.942, isAchromatic ? 0 : Math.min(0.026, accentChroma * 0.18), accentHue);
    const raised = oklchToHex(0.922, surfaceChroma * 1.45, deepHue);
    const input = '#ffffff';
    const dialog = oklchToHex(0.968, surfaceChroma * 0.75, deepHue);

    const accentSoft = oklchToHex(
      0.944,
      isAchromatic ? 0 : Math.min(0.040, Math.max(0.008, accentChroma * 0.34)),
      accentHue,
    );
    const accentBorder = oklchToHex(
      0.80,
      isAchromatic ? 0 : Math.min(0.085, Math.max(0.016, accentChroma * 0.52)),
      accentHue,
    );
    const accentTextStart = parsed.l >= 0.74 ? 0.45 : 0.40;
    const accentText = ensureMinContrastPair(
      accentTextStart,
      isAchromatic ? 0 : Math.min(0.165, accentChroma * 0.90),
      accentHue,
      card,
      accentSoft,
      4.75,
      'darker',
    );

    const headerDeep = ensureMinContrast(
      0.30,
      isAchromatic ? 0 : Math.min(0.105, accentChroma * 0.66),
      deepHue,
      '#f8faf9',
      8.2,
      'darker',
    );
    const headerInk = '#ffffff';
    const artField = oklchToHex(0.41, isAchromatic ? 0 : Math.min(0.115, accentChroma * 0.72), deepHue);
    const artDome = oklchToHex(0.77, isAchromatic ? 0 : Math.min(0.115, accentChroma * 0.72), artDomeHue);
    const artMid = oklchToHex(0.88, isAchromatic ? 0 : Math.min(0.085, accentChroma * 0.56), accentHue);
    const artPaper = oklchToHex(0.96, isAchromatic ? 0 : Math.min(0.026, accentChroma * 0.24), accentHue);
    const artInk = oklchToHex(0.32, isAchromatic ? 0 : Math.min(0.07, accentChroma * 0.45), deepHue);
    const badgeChroma = isAchromatic ? 0 : Math.min(0.085, Math.max(0.014, accentChroma * 0.50));
    const badgePastelBg = oklchToHex(0.91, badgeChroma, accentHue);
    const badgePastelInk = ensureMinContrast(0.28, badgeChroma, deepHue, badgePastelBg, 5.2, 'darker');

    const alertSoft = oklchToHex(0.945, alertChroma * 0.25, alertHueBase);
    const alertBorder = oklchToHex(0.80, alertChroma * 0.55, alertHueBase);
    let alertHue = alertHueBase;
    let alertText = ensureMinContrastPair(0.45, alertChroma * 0.95, alertHue, card, alertSoft, 4.8, 'darker');
    const onAlert = '#ffffff';
    let alertDot = ensureMinContrast(0.54, alertChroma, alertHue, onAlert, 4.6, 'darker');
    if (alertDot === accent || alertText === accentText) {
      alertHue = normalizeHue(alertHueBase + 35);
      alertText = ensureMinContrastPair(0.45, alertChroma * 0.95, alertHue, card, alertSoft, 4.8, 'darker');
      alertDot = ensureMinContrast(0.54, alertChroma, alertHue, onAlert, 4.6, 'darker');
    }

    const ink = oklchToHex(0.18, isAchromatic ? 0 : Math.min(0.016, accentChroma * 0.12), deepHue);
    const ink2 = oklchToHex(0.32, isAchromatic ? 0 : Math.min(0.018, accentChroma * 0.14), deepHue);
    const muted = ensureMinContrast(
      0.48,
      isAchromatic ? 0 : Math.min(0.016, accentChroma * 0.12),
      deepHue,
      card,
      4.8,
      'darker',
    );
    const subtle = oklchToHex(0.56, isAchromatic ? 0 : Math.min(0.014, accentChroma * 0.10), deepHue);

    const ctaDark = oklchToHex(0.19, isAchromatic ? 0 : Math.min(0.032, accentChroma * 0.22), deepHue);
    const ctaDarkInk = '#ffffff';
    const focus = getContrastRatio(accent, card) >= 3.2 ? accent : accentText;

    result = {
      mode,
      brandHex,
      hue,
      isAchromatic,
      vars: {
        '--km-page': page,
        '--km-canvas': canvas,
        '--km-shell': shell,
        '--km-panel': panel,
        '--km-card': card,
        '--km-surface-soft': surfaceSoft,
        '--km-raised': raised,
        '--km-input': input,
        '--km-dialog': dialog,
        '--km-overlay': 'rgba(15, 23, 20, 0.52)',
        '--km-ink': ink,
        '--km-ink-2': ink2,
        '--km-muted': muted,
        '--km-subtle': subtle,
        '--km-line': 'rgba(17, 24, 21, 0.09)',
        '--km-line-subtle': 'rgba(17, 24, 21, 0.06)',
        '--km-line-strong': 'rgba(17, 24, 21, 0.16)',
        '--km-accent': accent,
        '--km-accent-hover': accentHover,
        '--km-on-accent': onAccent,
        '--km-accent-text': accentText,
        '--km-accent-soft': accentSoft,
        '--km-accent-border': accentBorder,
        '--km-focus': focus,
        '--km-cta-dark': ctaDark,
        '--km-cta-dark-ink': ctaDarkInk,
        '--km-header-deep': headerDeep,
        '--km-header-ink': headerInk,
        '--km-art-field': artField,
        '--km-art-dome': artDome,
        '--km-art-mid': artMid,
        '--km-art-paper': artPaper,
        '--km-art-ink': artInk,
        '--km-art-line': headerDeep,
        '--km-badge-pastel-bg': badgePastelBg,
        '--km-badge-pastel-ink': badgePastelInk,
        '--km-alert-soft': alertSoft,
        '--km-alert-border': alertBorder,
        '--km-alert-text': alertText,
        '--km-alert-dot': alertDot,
        '--km-on-alert': onAlert,
        '--km-shadow-card': '0 6px 20px -6px rgba(17, 24, 21, 0.08)',
        '--km-shadow-tactile': '0 2px 0 rgba(17, 24, 21, 0.08)',
        '--km-shadow-cta': '0 8px 20px -6px rgba(17, 24, 21, 0.22)',
      },
    };
  } else {
    // Rich two-tone Dark mode: deep harmonic surfaces (deepHue) + faithful adaptive accent (accentHue)
    const surfaceChroma = isAchromatic
      ? 0
      : isWarmHue
        ? Math.min(0.022, accentChroma * 0.16)
        : Math.min(0.034, Math.max(0.008, accentChroma * 0.24));
    const page = oklchToHex(0.215, surfaceChroma * 0.9, deepHue);
    const canvas = oklchToHex(0.185, surfaceChroma * 0.9, deepHue);
    const shell = oklchToHex(0.24, surfaceChroma * 0.95, deepHue);
    const panel = oklchToHex(0.265, surfaceChroma, deepHue);
    const card = oklchToHex(0.29, surfaceChroma * 1.02, deepHue);
    const surfaceSoft = oklchToHex(0.32, surfaceChroma * 1.08, deepHue);
    const raised = oklchToHex(0.345, surfaceChroma * 1.12, deepHue);
    const input = oklchToHex(0.245, surfaceChroma * 0.95, deepHue);
    const dialog = oklchToHex(0.26, surfaceChroma, deepHue);

    const accentSoft = oklchToHex(
      0.28,
      isAchromatic ? 0 : Math.min(0.055, Math.max(0.010, accentChroma * 0.35)),
      accentHue,
    );
    const accentBorder = oklchToHex(
      0.47,
      isAchromatic ? 0 : Math.min(0.11, Math.max(0.018, accentChroma * 0.54)),
      accentHue,
    );
    const accentTextStart = parsed.l >= 0.74 ? 0.86 : 0.79;
    const accentText = ensureMinContrastPair(
      accentTextStart,
      isAchromatic ? 0 : Math.min(0.145, accentChroma * 0.85),
      accentHue,
      card,
      accentSoft,
      5.2,
      'lighter',
    );

    const headerDeep = ensureMinContrast(
      0.27,
      isAchromatic ? 0 : Math.min(0.095, accentChroma * 0.62),
      deepHue,
      '#ffffff',
      8.5,
      'darker',
    );
    const headerInk = '#ffffff';
    const artField = oklchToHex(0.38, isAchromatic ? 0 : Math.min(0.11, accentChroma * 0.7), deepHue);
    const artDome = oklchToHex(0.79, isAchromatic ? 0 : Math.min(0.115, accentChroma * 0.72), artDomeHue);
    const artMid = oklchToHex(0.86, isAchromatic ? 0 : Math.min(0.085, accentChroma * 0.54), accentHue);
    const artPaper = oklchToHex(0.94, isAchromatic ? 0 : Math.min(0.032, accentChroma * 0.28), accentHue);
    const artInk = oklchToHex(0.31, isAchromatic ? 0 : Math.min(0.068, accentChroma * 0.44), deepHue);
    const badgeChroma = isAchromatic ? 0 : Math.min(0.085, Math.max(0.014, accentChroma * 0.50));
    const badgePastelBg = oklchToHex(0.90, badgeChroma, accentHue);
    const badgePastelInk = ensureMinContrast(0.27, badgeChroma, deepHue, badgePastelBg, 5.2, 'darker');

    const alertSoft = oklchToHex(0.275, alertChroma * 0.34, alertHueBase);
    const alertBorder = oklchToHex(0.52, alertChroma * 0.65, alertHueBase);
    let alertHue = alertHueBase;
    let alertText = ensureMinContrastPair(0.82, alertChroma * 0.85, alertHue, card, alertSoft, 5.2, 'lighter');
    const onAlert = oklchToHex(0.16, alertChroma * 0.30, alertHue);
    let alertDot = ensureMinContrast(0.72, alertChroma * 0.95, alertHue, onAlert, 4.8, 'lighter');
    if (alertDot === accent || alertText === accentText) {
      alertHue = normalizeHue(alertHueBase + 35);
      alertText = ensureMinContrastPair(0.82, alertChroma * 0.85, alertHue, card, alertSoft, 5.2, 'lighter');
      alertDot = ensureMinContrast(0.72, alertChroma * 0.95, alertHue, onAlert, 4.8, 'lighter');
    }

    const ctaDark = '#ffffff';
    const ctaDarkInk = oklchToHex(0.18, isAchromatic ? 0 : Math.min(0.024, accentChroma * 0.18), deepHue);

    const ink = '#f7faf8';
    const ink2 = oklchToHex(0.91, isAchromatic ? 0 : Math.min(0.012, accentChroma * 0.10), deepHue);
    const muted = ensureMinContrast(
      0.74,
      isAchromatic ? 0 : Math.min(0.016, accentChroma * 0.12),
      deepHue,
      card,
      4.8,
      'lighter',
    );
    const subtle = oklchToHex(0.62, isAchromatic ? 0 : Math.min(0.016, accentChroma * 0.12), deepHue);
    const focus = getContrastRatio(accent, card) >= 3.2 ? accent : accentText;

    result = {
      mode,
      brandHex,
      hue,
      isAchromatic,
      vars: {
        '--km-page': page,
        '--km-canvas': canvas,
        '--km-shell': shell,
        '--km-panel': panel,
        '--km-card': card,
        '--km-surface-soft': surfaceSoft,
        '--km-raised': raised,
        '--km-input': input,
        '--km-dialog': dialog,
        '--km-overlay': 'rgba(0, 0, 0, 0.78)',
        '--km-ink': ink,
        '--km-ink-2': ink2,
        '--km-muted': muted,
        '--km-subtle': subtle,
        '--km-line': oklchToHex(0.45, surfaceChroma * 1.1, deepHue),
        '--km-line-subtle': 'rgba(255, 255, 255, 0.09)',
        '--km-line-strong': oklchToHex(0.56, surfaceChroma * 1.2, deepHue),
        '--km-accent': accent,
        '--km-accent-hover': accentHover,
        '--km-on-accent': onAccent,
        '--km-accent-text': accentText,
        '--km-accent-soft': accentSoft,
        '--km-accent-border': accentBorder,
        '--km-focus': focus,
        '--km-cta-dark': ctaDark,
        '--km-cta-dark-ink': ctaDarkInk,
        '--km-header-deep': headerDeep,
        '--km-header-ink': headerInk,
        '--km-art-field': artField,
        '--km-art-dome': artDome,
        '--km-art-mid': artMid,
        '--km-art-paper': artPaper,
        '--km-art-ink': artInk,
        '--km-art-line': headerDeep,
        '--km-badge-pastel-bg': badgePastelBg,
        '--km-badge-pastel-ink': badgePastelInk,
        '--km-alert-soft': alertSoft,
        '--km-alert-border': alertBorder,
        '--km-alert-text': alertText,
        '--km-alert-dot': alertDot,
        '--km-on-alert': onAlert,
        '--km-shadow-card': '0 10px 24px -10px rgba(0, 0, 0, 0.45)',
        '--km-shadow-tactile': '0 2px 0 rgba(0, 0, 0, 0.22)',
        '--km-shadow-cta': '0 10px 24px -8px rgba(0, 0, 0, 0.48)',
      },
    };
  }

  if (menuThemeCache.size >= MENU_THEME_CACHE_LIMIT) {
    const oldestKey = menuThemeCache.keys().next().value;
    if (oldestKey !== undefined) {
      menuThemeCache.delete(oldestKey);
    }
  }
  menuThemeCache.set(cacheKey, result);
  return result;
}
