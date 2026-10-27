/**
 * Bounded, selective Web Vitals monitoring (LCP, INP, CLS) using standard PerformanceObserver.
 * Never captures DOM content, customer text, or sensitive inputs.
 * Emits at most one metric per type per document load to protect egress and volume budgets.
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
 * Initializes listeners for LCP, CLS, and INP without external dependencies.
 * Each metric is reported at most once. Returns a cleanup function.
 */
export function initWebVitals(emit: (metric: WebVitalMetric) => void): () => void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return () => {};
  }

  const reported = new Set<WebVitalName>();
  const observers: PerformanceObserver[] = [];

  const safeEmit = (name: WebVitalName, rawValue: number) => {
    if (reported.has(name)) return;
    reported.add(name);
    const value = name === 'CLS' ? Number(rawValue.toFixed(3)) : Math.round(rawValue);
    const rating = rateWebVital(name, value);
    try {
      emit({ name, value, rating });
    } catch {
      // Telemetry must never throw or affect user experience.
    }
  };

  // 1. LCP (Largest Contentful Paint)
  try {
    let largestEntry: PerformanceEntry | null = null;
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      if (entries.length > 0) {
        largestEntry = entries[entries.length - 1];
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    observers.push(lcpObserver);

    // LCP is finalized when the user interacts or the page unloads
    const finalizeLcp = () => {
      if (largestEntry && !reported.has('LCP')) {
        safeEmit('LCP', largestEntry.startTime);
      }
    };
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') finalizeLcp();
    }, { once: true });
    window.addEventListener('pagehide', finalizeLcp, { once: true });
  } catch {
    // Unsupported entry type in current browser
  }

  // 2. CLS (Cumulative Layout Shift)
  try {
    let clsScore = 0;
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const layoutShift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!layoutShift.hadRecentInput && typeof layoutShift.value === 'number') {
          clsScore += layoutShift.value;
        }
      }
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
    observers.push(clsObserver);

    const finalizeCls = () => {
      if (!reported.has('CLS')) {
        safeEmit('CLS', clsScore);
      }
    };
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') finalizeCls();
    }, { once: true });
    window.addEventListener('pagehide', finalizeCls, { once: true });
  } catch {
    // Unsupported entry type
  }

  // 3. INP (Interaction to Next Paint)
  try {
    let maxInteractionDuration = 0;
    const inpObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const eventEntry = entry as PerformanceEntry & { duration?: number; interactionId?: number };
        if (eventEntry.interactionId && typeof eventEntry.duration === 'number') {
          if (eventEntry.duration > maxInteractionDuration) {
            maxInteractionDuration = eventEntry.duration;
          }
        }
      }
    });
    inpObserver.observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    observers.push(inpObserver);

    const finalizeInp = () => {
      if (maxInteractionDuration > 0 && !reported.has('INP')) {
        safeEmit('INP', maxInteractionDuration);
      }
    };
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') finalizeInp();
    }, { once: true });
    window.addEventListener('pagehide', finalizeInp, { once: true });
  } catch {
    // Unsupported entry type
  }

  return () => {
    for (const obs of observers) {
      try {
        obs.disconnect();
      } catch {
        // Disconnect silently
      }
    }
  };
}
