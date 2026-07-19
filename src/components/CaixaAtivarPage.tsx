import React, { useState } from 'react';
import { Lock, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { API_BASE_URL } from '../config/api';

interface CaixaAtivarPageProps {
  token?: string | null;
}

export function CaixaAtivarPage({ token }: CaixaAtivarPageProps) {
  const tokenConvite = token || new URLSearchParams(window.location.search).get('token') || '';
  
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

    if (senha.length < 3) {
      setErrorMsg('A senha deve conter pelo menos 3 caracteres.');
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
          senha: senha
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Link de ativação inválido ou expirado.');
      }

      const data = await res.json();
      setSucesso(true);

      // Armazenar o token de acesso
      if (data.access_token) {
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('koma_caixa_token', data.access_token);
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
    <div className={clsx('min-h-screen', 'bg-[#09090B]', 'text-white', 'flex', 'items-center', 'justify-center', 'p-4', 'font-sans')}>
      <div className={clsx('w-full', 'max-w-md', 'bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-3xl', 'p-8', 'shadow-2xl', 'space-y-6')}>
        
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl mb-1 text-emerald-400">
            <ShieldCheck size={32} />
          </div>
          <h1 className="text-2xl font-serif font-bold text-white tracking-tight">Ative sua Conta</h1>
          <p className="text-xs text-gray-400 font-medium">Cadastre sua nova senha de acesso ao Kôma Bistrô</p>
        </div>

        {sucesso ? (
          <div className="p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-center space-y-3 animate-scale-in">
            <CheckCircle size={40} className="mx-auto text-emerald-400" />
            <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Conta Ativada com Sucesso!</h3>
            <p className="text-xs text-gray-300">Você será redirecionado automaticamente para o seu painel de trabalho...</p>
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
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Nova Senha</label>
              <div className="relative">
                <input
                  type="password"
                  required
                  placeholder="Digite sua senha..."
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-[#09090B] border border-[#27272A] rounded-xl text-white text-xs focus:border-emerald-500 focus:outline-none transition-all"
                />
                <Lock size={14} className="absolute left-3 top-3 text-gray-500" />
              </div>
            </div>

            <div className="space-y-1 text-left">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Confirme a Senha</label>
              <div className="relative">
                <input
                  type="password"
                  required
                  placeholder="Repita sua nova senha..."
                  value={confirmaSenha}
                  onChange={(e) => setConfirmaSenha(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-[#09090B] border border-[#27272A] rounded-xl text-white text-xs focus:border-emerald-500 focus:outline-none transition-all"
                />
                <Lock size={14} className="absolute left-3 top-3 text-gray-500" />
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
