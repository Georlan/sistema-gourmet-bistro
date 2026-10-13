import { useEffect, useState } from 'react';
import { KOMA_TEXT_SIZE_EVENT, KOMA_TEXT_SCALES, normalizeKomaTextSize, persistKomaTextSize, readKomaTextSize, type KomaTextSize } from '../../../config/textSize';
import { KOMA_THEME_CHANGED_EVENT, readKomaTheme, type KomaTheme } from '../../../config/theme';

/** Owns display preferences, fullscreen and event cleanup; no operational state. */
export function useCashierPreferences() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    () => typeof document !== 'undefined' && !!document.fullscreenElement,
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      const docEl = document.documentElement as any;
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      } else if (docEl.msRequestFullscreen) {
        docEl.msRequestFullscreen();
      }
    } else {
      const doc = document as any;
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen();
      }
    }
  };

  const [fontSize, setFontSize] = useState<KomaTextSize>(readKomaTextSize);
  const changeFontSize = (size: KomaTextSize) => setFontSize(persistKomaTextSize(size));

  useEffect(() => {
    const root = document.documentElement;
    const previousScale = root.style.getPropertyValue('--koma-text-scale');
    const previousSize = root.getAttribute('data-koma-text-size');
    root.style.setProperty('--koma-text-scale', String(KOMA_TEXT_SCALES[fontSize]));
    root.setAttribute('data-koma-text-size', fontSize);
    return () => {
      if (previousScale) root.style.setProperty('--koma-text-scale', previousScale);
      else root.style.removeProperty('--koma-text-scale');
      if (previousSize) root.setAttribute('data-koma-text-size', previousSize);
      else root.removeAttribute('data-koma-text-size');
    };
  }, [fontSize]);

  const [theme, setTheme] = useState<KomaTheme>(() => readKomaTheme());

  useEffect(() => {
    const handleStorageChange = () => {
      setTheme(readKomaTheme());

      setFontSize(readKomaTextSize());
    };
    const handleTextSizeChange = (event: Event) => setFontSize(event instanceof CustomEvent ? normalizeKomaTextSize(event.detail) : readKomaTextSize());
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(KOMA_TEXT_SIZE_EVENT, handleTextSizeChange);
    window.addEventListener(KOMA_THEME_CHANGED_EVENT, handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(KOMA_TEXT_SIZE_EVENT, handleTextSizeChange);
      window.removeEventListener(KOMA_THEME_CHANGED_EVENT, handleStorageChange);
    };
  }, []);
  return {
    isFullscreen,
    setIsFullscreen,
    toggleFullscreen,
    fontSize,
    setFontSize,
    changeFontSize,
    theme,
    setTheme,
  };
}
