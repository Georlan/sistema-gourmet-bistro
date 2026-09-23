import React, { useEffect, useState } from 'react';
import { Lock, Mail, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { API_BASE_URL } from '../config/api';
import { getOperatorSession, saveOperatorSession } from '../utils/authSession';
import { authFetch, authRequestErrorMessage } from '../utils/authRequest';
import { FirstAccessOnboarding } from './onboarding/FirstAccessOnboarding';

interface CaixaAtivarPageProps {
  token?: string | null;
}

type ActivatedSession = {
  accessToken: string;
  user: Record<string, unknown>;
};

function bootstrapInvitationToken(tokenProp?: string | null): string {
  const fragmentToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token')?.trim() || '';
  // Compatibilidade temporária para convites emitidos antes da migração para fragment.
  const legacyQueryToken = new URLSearchParams(window.location.search).get('token')?.trim() || '';
  return fragmentToken || tokenProp?.trim() || legacyQueryToken;
}

function existingManagementSession(): ActivatedSession | null {
  const session = getOperatorSession('caixa');
  if (!session?.token) return null;
  const role = String(session.user?.role || session.user?.cargo || '').trim().toLowerCase();
  if (role !== 'admin' && role !== 'gerente') return null;
  return {
    accessToken: session.token,
    user: session.user as Record<string, unknown>,
  };
}

export function CaixaAtivarPage({ token }: CaixaAtivarPageProps) {
  const [tokenConvite] = useState(() => bootstrapInvitationToken(token));
  useEffect(() => {
    // A leitura do token precisa ser pura: React pode inicializar o componente
    // duas vezes antes dos efeitos, inclusive no primeiro acesso em StrictMode.
    const hasTokenInUrl = new URLSearchParams(window.location.hash.replace(/^#/, '')).has('token')
      || new URLSearchParams(window.location.search).has('token');
    if (!tokenConvite || !hasTokenInUrl) return;
    const query = new URLSearchParams(window.location.search);
    query.delete('token');
    const safeQuery = query.toString();
    const safeUrl = `${window.location.pathname}${safeQuery ? `?${safeQuery}` : ''}`;
    window.history.replaceState(null, '', safeUrl);
  }, [tokenConvite]);
  const [resumeRequested] = useState(() => new URLSearchParams(window.location.search).get('resume') === '1');
  const [resumableSession] = useState<ActivatedSession | null>(() => existingManagementSession());

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmaSenha, setConfirmaSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [activatedSession, setActivatedSession] = useState<ActivatedSession | null>(null);

  const openInitialSetup = () => {
    window.location.href = '/ativar?resume=1';
  };

  const returnToCashierLogin = () => {
    window.location.href = '/?view=caixa';
  };

  if (resumeRequested) {
    if (resumableSession) {
      return (
        <FirstAccessOnboarding
          accessToken={resumableSession.accessToken}
          user={resumableSession.user}
        />
      );
    }

    return (
      <div className="min-h-screen bg-koma-page text-koma-foreground flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-koma-card border border-koma-border rounded-3xl p-8 shadow-2xl text-center space-y-5">
          <div className="inline-flex items-center justify-center p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-amber-300">
            <AlertCircle size={30} />
          </div>
          <div>
            <h1 className="text-xl font-black">Entre novamente para continuar</h1>
            <p className="mt-2 text-sm text-koma-muted">
              A implantação inicial continua salva, mas sua sessão de administrador não está disponível nesta aba.
            </p>
          </div>
          <button
            type="button"
            onClick={returnToCashierLogin}
            className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-xs font-black uppercase tracking-wider text-zinc-950 hover:bg-emerald-400"
          >
            Ir para o login
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!tokenConvite) {
      setErrorMsg('Token de convite não encontrado no link.');
      return;
    }

    if (!email || !email.includes('@')) {
      setErrorMsg('Por favor, informe um e-mail de login válido.');
      return;
    }

    if (senha.length < 8) {
      setErrorMsg('A senha deve conter pelo menos 8 caracteres.');
      return;
    }

    if (senha !== confirmaSenha) {
      setErrorMsg('As senhas não coincidem.');
      return;
    }

    setLoading(true);

    try {
      const res = await authFetch(`${API_BASE_URL}/auth/ativar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_convite: tokenConvite,
          email: email.trim().toLowerCase(),
          senha,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Link de ativação inválido ou expirado.');
      }

      const data = await res.json().catch(() => ({}));
      const sessionUser = data.usuario || data.garcom || { role: 'operador' };
      const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
      const userRole = String(sessionUser?.role || sessionUser?.cargo || 'garcom').toLowerCase();

      setSucesso(true);

      if (accessToken) {
        saveOperatorSession(accessToken, sessionUser);
      }

      // O primeiro administrador não cai mais em um Caixa vazio sem contexto.
      // A ativação já terminou e a sessão foi persistida; daqui em diante o
      // checklist é apenas orientação e pode ser pulado a qualquer momento.
      if (accessToken && (userRole === 'admin' || userRole === 'gerente')) {
        setActivatedSession({ accessToken, user: sessionUser });
        return;
      }

      setTimeout(() => {
        if (userRole === 'garcom') {
          window.location.href = '/?view=garcom';
        } else {
          window.location.href = '/?view=caixa';
        }
      }, 1500);
    } catch (err: unknown) {
      setErrorMsg(authRequestErrorMessage(err, 'Erro ao ativar conta.'));
    } finally {
      setLoading(false);
    }
  };

  if (activatedSession) {
    return (
      <FirstAccessOnboarding
        accessToken={activatedSession.accessToken}
        user={activatedSession.user}
      />
    );
  }

  return (
    <div className="min-h-screen bg-koma-page text-koma-foreground flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md bg-koma-card border border-koma-border rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl mb-1 text-emerald-400">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-2xl font-serif font-bold text-koma-foreground tracking-tight">Ative sua Conta</h1>
          <p className="text-xs text-koma-subtle font-medium">Cadastre sua nova senha de acesso ao KÔMA</p>
        </div>

        {sucesso ? (
          <div className="p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-center space-y-3 animate-scale-in">
            <CheckCircle size={40} className="mx-auto text-emerald-400" />
            <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Conta ativada com sucesso!</h3>
            <p className="text-xs text-koma-secondary">Preparando seu painel de trabalho…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div className="space-y-2">
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2 text-rose-400 text-xs font-semibold animate-scale-in">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
                {resumableSession && (
                  <button
                    type="button"
                    onClick={openInitialSetup}
                    className="w-full rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3 text-xs font-black text-emerald-300 hover:bg-emerald-500/10"
                  >
                    Voltar para a implantação inicial
                  </button>
                )}
              </div>
            )}

            <div className="space-y-1 text-left">
              <label htmlFor="activation-email" className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">E-mail de Login</label>
              <div className="relative">
                <input
                  id="activation-email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  inputMode="email"
                  required
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-koma-page border border-koma-border rounded-xl text-koma-foreground text-xs focus:border-emerald-500 focus:outline-none transition-all"
                />
                <Mail size={14} className="absolute left-3 top-3 text-koma-muted" />
              </div>
            </div>

            <div className="space-y-1 text-left">
              <label htmlFor="activation-password" className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">Nova Senha</label>
              <div className="relative">
                <input
                  id="activation-password"
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={72}
                  placeholder="Digite sua senha..."
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-koma-page border border-koma-border rounded-xl text-koma-foreground text-xs focus:border-emerald-500 focus:outline-none transition-all"
                />
                <Lock size={14} className="absolute left-3 top-3 text-koma-muted" />
              </div>
            </div>

            <div className="space-y-1 text-left">
              <label htmlFor="activation-password-confirmation" className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">Confirme a Senha</label>
              <div className="relative">
                <input
                  id="activation-password-confirmation"
                  type="password"
                  name="confirm-password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={72}
                  placeholder="Repita sua nova senha..."
                  value={confirmaSenha}
                  onChange={(e) => setConfirmaSenha(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-koma-page border border-koma-border rounded-xl text-koma-foreground text-xs focus:border-emerald-500 focus:outline-none transition-all"
                />
                <Lock size={14} className="absolute left-3 top-3 text-koma-muted" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={clsx(
                'w-full', 'py-3', 'bg-[#10b981]', 'hover:bg-[#059669]', 'text-[#121214]',
                'font-bold', 'text-xs', 'uppercase', 'tracking-wider', 'rounded-xl',
                'transition-all', 'cursor-pointer', 'shadow-lg', 'shadow-emerald-950/20',
                loading && 'opacity-50 cursor-not-allowed',
              )}
            >
              {loading ? 'Ativando...' : 'Salvar Senha e Entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default CaixaAtivarPage;
