import React, { useState } from 'react';
import { Lock, Mail, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { API_BASE_URL } from '../config/api';
import { saveOperatorSession } from '../utils/authSession';

interface CaixaAtivarPageProps {
  token?: string | null;
}

export function CaixaAtivarPage({ token }: CaixaAtivarPageProps) {
  const tokenConvite = token || new URLSearchParams(window.location.search).get('token') || '';
  
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmaSenha, setConfirmaSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

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
      const res = await fetch(`${API_BASE_URL}/auth/ativar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_convite: tokenConvite,
          email: email.trim().toLowerCase(),
          senha: senha
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Link de ativação inválido ou expirado.');
      }

      const data = await res.json().catch(() => ({}));
      setSucesso(true);

      // Armazenar a sessão do operador com validade de 24 horas
      if (data.access_token) {
        saveOperatorSession(data.access_token, data.usuario || { role: 'operador' });
      }

      const userRole = (data.usuario?.role || data.usuario?.cargo || data.garcom?.role || 'garcom').toLowerCase();

      // Redirecionamento reativo direto após 1.5s
      setTimeout(() => {
        if (userRole === 'garcom') {
          window.location.href = '/?view=garcom';
        } else {
          window.location.href = '/?view=caixa';
        }
      }, 1500);

    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao ativar conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={clsx('min-h-screen', 'bg-koma-page', 'text-koma-foreground', 'flex', 'items-center', 'justify-center', 'p-4', 'font-sans')}>
      <div className={clsx('w-full', 'max-w-md', 'bg-koma-card', 'border', 'border-koma-border', 'rounded-3xl', 'p-8', 'shadow-2xl', 'space-y-6')}>
        
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl mb-1 text-emerald-400">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-2xl font-serif font-bold text-koma-foreground tracking-tight">Ative sua Conta</h1>
          <p className="text-xs text-koma-subtle font-medium">Cadastre sua nova senha de acesso ao Kôma Bistrô</p>
        </div>

        {sucesso ? (
          <div className="p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-center space-y-3 animate-scale-in">
            <CheckCircle size={40} className="mx-auto text-emerald-400" />
            <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Conta Ativada com Sucesso!</h3>
            <p className="text-xs text-koma-secondary">Você será redirecionado automaticamente para o seu painel de trabalho...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            
            {errorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2 text-rose-400 text-xs font-semibold animate-scale-in">
                <AlertCircle size={16} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="space-y-1 text-left">
              <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">E-mail de Login</label>
              <div className="relative">
                <input
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
              <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">Nova Senha</label>
              <div className="relative">
                <input
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
              <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">Confirme a Senha</label>
              <div className="relative">
                <input
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
                loading && 'opacity-50 cursor-not-allowed'
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
