import clsx from 'clsx';
import { Monitor, Moon, Sun, Type } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import {
  KOMA_THEME_CHANGED_EVENT,
  persistKomaTheme,
  readKomaTheme,
  type KomaTheme,
} from '../../../config/theme';

type CashierFontSize = 'padrao' | 'grande' | 'gigante';

const FONT_SIZE_CHANGED_EVENT = 'koma_font_size_changed';

function readCashierFontSize(): CashierFontSize {
  const stored = localStorage.getItem('koma_font_size');
  return stored === 'grande' || stored === 'gigante' ? stored : 'padrao';
}

export function CashierAppearanceSettings() {
  const [theme, setTheme] = useState<KomaTheme>(() => readKomaTheme());
  const [fontSize, setFontSize] = useState<CashierFontSize>(() => readCashierFontSize());

  useEffect(() => {
    const syncPreferences = () => {
      setTheme(readKomaTheme());
      setFontSize(readCashierFontSize());
    };

    window.addEventListener('storage', syncPreferences);
    window.addEventListener(KOMA_THEME_CHANGED_EVENT, syncPreferences);
    window.addEventListener(FONT_SIZE_CHANGED_EVENT, syncPreferences);

    return () => {
      window.removeEventListener('storage', syncPreferences);
      window.removeEventListener(KOMA_THEME_CHANGED_EVENT, syncPreferences);
      window.removeEventListener(FONT_SIZE_CHANGED_EVENT, syncPreferences);
    };
  }, []);

  const selectTheme = (nextTheme: KomaTheme) => {
    setTheme(persistKomaTheme(nextTheme));
  };

  const selectFontSize = (nextFontSize: CashierFontSize) => {
    localStorage.setItem('koma_font_size', nextFontSize);
    setFontSize(nextFontSize);
    window.dispatchEvent(new Event(FONT_SIZE_CHANGED_EVENT));
  };

  return (
    <section className="space-y-4" aria-labelledby="cashier-appearance-title">
      <div className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-700 dark:text-emerald-300">
            <Monitor size={18} />
          </span>
          <div className="min-w-0">
            <h3 id="cashier-appearance-title" className="text-sm font-bold text-koma-foreground">
              Aparência deste caixa
            </h3>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-koma-muted">
              Tema e tamanho do texto ficam salvos neste dispositivo. Ajuste aqui sem alterar o funcionamento do restaurante.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sun size={16} className="text-koma-secondary" />
            <div>
              <h4 className="text-xs font-bold text-koma-foreground">Tema</h4>
              <p className="text-[10px] text-koma-muted">Escolha o contraste mais confortável para o ambiente.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tema do caixa">
            {([
              { id: 'light' as const, label: 'Claro', Icon: Sun },
              { id: 'dark' as const, label: 'Escuro', Icon: Moon },
            ]).map(({ id, label, Icon }) => {
              const selected = theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectTheme(id)}
                  aria-pressed={selected}
                  className={clsx(
                    'min-h-12 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                    selected
                      ? 'border-emerald-600 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/50 dark:text-emerald-200'
                      : 'border-koma-border bg-koma-page text-koma-secondary hover:border-koma-border-strong hover:bg-koma-raised hover:text-koma-foreground',
                  )}
                >
                  <span className="flex items-center gap-2 text-xs font-bold">
                    <Icon size={15} />
                    {label}
                  </span>
                  <span className="mt-1 block text-[9px] font-medium opacity-80">
                    {id === 'light' ? 'Fundos claros e texto escuro' : 'Baixo brilho para operação contínua'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Type size={16} className="text-koma-secondary" />
            <div>
              <h4 className="text-xs font-bold text-koma-foreground">Tamanho do texto</h4>
              <p className="text-[10px] text-koma-muted">Aumente a leitura sem depender do zoom do navegador.</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Tamanho do texto do caixa">
            {([
              { id: 'padrao' as const, label: 'Padrão', preview: 'A' },
              { id: 'grande' as const, label: 'Grande', preview: 'A+' },
              { id: 'gigante' as const, label: 'Muito grande', preview: 'A++' },
            ]).map(({ id, label, preview }) => {
              const selected = fontSize === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectFontSize(id)}
                  aria-pressed={selected}
                  className={clsx(
                    'min-h-14 rounded-xl border px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                    selected
                      ? 'border-emerald-600 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/50 dark:text-emerald-200'
                      : 'border-koma-border bg-koma-page text-koma-secondary hover:border-koma-border-strong hover:bg-koma-raised hover:text-koma-foreground',
                  )}
                >
                  <span className="block text-sm font-black">{preview}</span>
                  <span className="mt-1 block text-[9px] font-bold">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-koma-border bg-koma-raised px-4 py-3 text-[10px] leading-relaxed text-koma-muted">
        O botão de tela cheia continua disponível no topo do Caixa porque é uma ação de operação rápida, não uma preferência permanente.
      </div>
    </section>
  );
}
