import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';

/**
 * Core Web Vitals monitoring (LCP, INP, CLS) using Google's official web-vitals library.
 * Implements standard session windows for CLS, 98th percentile for INP,
 * first-input tracking, and reliable transmission on visibilitychange, pagehide, and bfcache restores.
 * Never captures DOM content, customer text, or sensitive inputs.
 */

export type WebVitalName = 'LCP' | 'INP' | 'CLS';
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

export interface WebVitalMetric {
  name: WebVitalName;
  value: number;
  rating: WebVitalRating;
}

export function rateWebVital(name: WebVitalName, value: number): WebVitalRating {
  switch (name) {
    case 'LCP':
      if (value <= 2500) return 'good';
      if (value <= 4000) return 'needs-improvement';
      return 'poor';
    case 'CLS':
      if (value <= 0.1) return 'good';
      if (value <= 0.25) return 'needs-improvement';
      return 'poor';
    case 'INP':
      if (value <= 200) return 'good';
      if (value <= 500) return 'needs-improvement';
      return 'poor';
  }
}

/**
 * Initializes listeners for LCP, CLS, and INP using the official web-vitals library.
 * Metrics adhere strictly to Core Web Vitals definitions. Returns a cleanup function.
 */
export function initWebVitals(emit: (metric: WebVitalMetric) => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const handleMetric = (metric: Metric) => {
    if (metric.name !== 'LCP' && metric.name !== 'INP' && metric.name !== 'CLS') {
      return;
    }
    const value = metric.name === 'CLS' ? Number(metric.value.toFixed(3)) : Math.round(metric.value);
    const rating: WebVitalRating = metric.rating || rateWebVital(metric.name, value);
    try {
      emit({ name: metric.name, value, rating });
    } catch {
      // Telemetry must never throw or affect user experience.
    }
  };

  try {
    onLCP(handleMetric);
    onCLS(handleMetric);
    onINP(handleMetric);
  } catch {
    // Unsupported environment or PerformanceObserver restriction
  }

  return () => {
    // web-vitals listeners are passive and bound to window lifecycle
  };
}

