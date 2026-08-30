import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { KomaLogo } from '../KomaLogo';
import type { KomaTheme } from '../../config/theme';

export interface OperationalLoginProps {
  portal: 'garcom' | 'caixa';
  theme: KomaTheme;
  username: string;
  password: string;
  error: string;
  isLoggingIn: boolean;
  onToggleTheme: () => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

/** Controlled presentation; authentication, session and form state stay in App. */
export function OperationalLogin({
  portal, theme, username, password, error, isLoggingIn,
  onToggleTheme, onUsernameChange, onPasswordChange, onSubmit,
}: OperationalLoginProps) {
  return (
      <div className="min-h-screen bg-koma-page relative flex items-center justify-center p-4">
        {/* Quick theme switcher button on login screen */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20">
          <button
            type="button"
            onClick={onToggleTheme}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-koma-card border border-koma-border text-koma-secondary hover:text-koma-foreground hover:bg-koma-raised transition-all text-xs font-bold shadow-md cursor-pointer"
            title={theme === 'dark' ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro'}
            aria-label="Alternar tema claro e escuro"
          >
            {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-sky-500" />}
            <span className="hidden sm:inline">{theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}</span>
          </button>
        </div>

        <div className="w-full max-w-sm bg-koma-card border border-emerald-500/10 rounded-2xl p-6 sm:p-8 shadow-2xl animate-scale-in">
          {/* Logo / Header */}
          <div className="text-center space-y-3 mb-7">
            <div className="flex justify-center">
    <KomaLogo withText size="xl" />
  </div>
  <div className="space-y-1">
              <span className="text-[10px] font-sans font-semibold tracking-wide text-emerald-700 dark:text-emerald-400 block">
                Se você está com fome, Kôma
              </span>
            </div>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase tracking-widest font-sans font-bold bg-emerald-500/10 px-3 py-1 rounded-full w-fit mx-auto border border-emerald-500/15">
              {portal === 'caixa' ? "Painel de Gerenciamento & Caixa" : "Portal do Garçom"}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-xs text-red-800 dark:bg-red-950/40 dark:border-red-900/50 dark:text-red-300 text-center animate-shake">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="login-username" className="text-[10px] text-koma-subtle font-bold uppercase tracking-wider block">E-MAIL</label>
              <input
                id="login-username"
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                required
                value={username}
                onChange={(e) => onUsernameChange(e.target.value)}
                placeholder="seu@email.com"
                className="w-full bg-koma-panel text-koma-foreground border border-koma-border/40 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 placeholder-gray-600"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-[10px] text-koma-subtle font-bold uppercase tracking-wider block">Senha</label>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                placeholder="••••••"
                className="w-full bg-koma-panel text-koma-foreground border border-koma-border/40 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500/50 placeholder-gray-600"
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold uppercase tracking-wider shadow-lg cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 border border-emerald-500/20"
            >
              {isLoggingIn ? "Autenticando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
  );
}
