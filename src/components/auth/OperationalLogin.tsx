import { PasswordRecoveryHelp } from "./PasswordRecoveryHelp";
import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { AuthPage } from './AuthPage';
import { PasswordInput } from './PasswordInput';
import { KomaLogo } from '../KomaLogo';
import type { KomaTheme } from '../../config/theme';
import { isOperationalAppHost } from '../../domain/komaHost';

export interface LoginRestaurantOption {
  id: number;
  nome: string;
}

export interface OperationalLoginProps {
  portal: 'garcom' | 'caixa' | 'unified';
  theme: KomaTheme;
  username: string;
  password: string;
  error: string;
  isLoggingIn: boolean;
  restaurantOptions?: LoginRestaurantOption[];
  restaurantId?: string;
  onRestaurantChange?: (value: string) => void;
  onToggleTheme: () => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

/** Controlled presentation; authentication, session and form state stay in the owner. */
export function OperationalLogin({
  portal, theme, username, password, error, isLoggingIn,
  restaurantOptions = [], restaurantId = '', onRestaurantChange,
  onToggleTheme, onUsernameChange, onPasswordChange, onSubmit,
}: OperationalLoginProps) {
  // app.komafood.com.br possui uma única tela de autenticação. Se o shell interno
  // perder a sessão antes de o UnifiedOperationalEntry desmontá-lo, não exponha
  // novamente os logins históricos de Caixa/Garçom nem por um frame perceptível.
  if (portal !== 'unified' && isOperationalAppHost()) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <div className="text-center">
          <div className="flex justify-center">
            <KomaLogo withText size="xl" />
          </div>
          <p className="mt-5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">
            Retornando ao acesso da equipe…
          </p>
        </div>
      </main>
    );
  }

  const portalLabel = portal === 'unified'
    ? 'Acesso da equipe'
    : portal === 'caixa'
      ? 'Painel de Gerenciamento & Caixa'
      : 'Portal do Garçom';

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    // O App legado ainda possui um fluxo interno de login que persiste aliases
    // diretamente. Depois que ele conclui com sucesso, vinculamos explicitamente
    // esta aba ao portal autenticado. Isso mantém o mesmo isolamento por aba da
    // entrada unificada e impede que um login em outra guia assuma esta navegação.
    await onSubmit(event);

    if (
      portal === 'garcom'
      && (sessionStorage.getItem('koma_waiter_token') || sessionStorage.getItem('authToken'))
    ) {
      sessionStorage.setItem('koma_active_operational_portal', 'garcom');
      sessionStorage.removeItem('koma_operational_logged_out');
    } else if (portal === 'caixa' && sessionStorage.getItem('koma_caixa_token')) {
      sessionStorage.setItem('koma_active_operational_portal', 'caixa');
      sessionStorage.removeItem('koma_operational_logged_out');
    }
  };

  return <AuthPage tools={
    <button type="button" onClick={onToggleTheme} className="k-auth-theme"
      title={theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'} aria-label="Alternar tema claro e escuro">
      {theme === 'dark' ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
      <span>{theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}</span>
    </button>
  }>
    <h1 className="k-auth-heading">{portalLabel}</h1>
    <p className="k-auth-intro">Seu e-mail da equipe e sua senha.</p>
    <form onSubmit={handleSubmit} className="k-auth-form" aria-busy={isLoggingIn}>
      {error && <p id="login-feedback" role={restaurantOptions.length ? 'status' : 'alert'}
        className={`k-auth-feedback ${restaurantOptions.length ? 'k-auth-feedback--info' : ''}`}>{error}</p>}
      <div className="k-auth-field">
        <label htmlFor="login-username" className="k-auth-label">E-mail</label>
        <input id="login-username" type="email" autoComplete="username" inputMode="email" required
          name="email" value={username} disabled={isLoggingIn} autoCapitalize="none" spellCheck={false}
          onChange={event => onUsernameChange(event.target.value)} placeholder="seu@email.com"
          className="k-auth-input" aria-describedby={error && !restaurantOptions.length ? 'login-feedback' : undefined} />
      </div>
      <div className="k-auth-field">
        <label htmlFor="login-password" className="k-auth-label">Senha</label>
        <PasswordInput id="login-password" autoComplete="current-password" required name="password"
          value={password} disabled={isLoggingIn} onChange={event => onPasswordChange(event.target.value)}
          aria-describedby={error && !restaurantOptions.length ? 'login-feedback' : undefined} />
      </div>
      <PasswordRecoveryHelp initialEmail={username} restaurantId={restaurantId} disabled={isLoggingIn} />
      {restaurantOptions.length > 0 && <div className="k-auth-field">
        <label htmlFor="login-restaurant" className="k-auth-label">Estabelecimento</label>
        <select id="login-restaurant" name="restaurante_id" required autoFocus disabled={isLoggingIn}
          value={restaurantId} onChange={event => onRestaurantChange?.(event.target.value)}
          className="k-auth-input" aria-describedby="login-restaurant-hint">
          <option value="">Selecione o estabelecimento</option>
          {restaurantOptions.map(option => <option key={option.id} value={String(option.id)}>{option.nome}</option>)}
        </select>
        <p id="login-restaurant-hint" className="k-auth-hint">Escolha onde você vai trabalhar.</p>
      </div>}
      <button type="submit" disabled={isLoggingIn || (restaurantOptions.length > 0 && !restaurantId)} className="k-auth-action">
        {isLoggingIn ? 'Autenticando...' : 'Entrar'}
      </button>
    </form>
  </AuthPage>;
}
