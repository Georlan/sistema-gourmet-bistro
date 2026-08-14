import React, { useState, useEffect } from 'react';
import { Phone, MapPin, CheckCircle2, RefreshCw, Navigation, AlertCircle, ShoppingBag, Truck, ExternalLink } from 'lucide-react';
import clsx from 'clsx';
import { API_BASE_URL } from '../config/api';
import { formatWhatsAppPhone } from '../config/whatsappUtils';

interface EntregaItem {
  id: string;
  numero_pedido: number | null;
  cliente_nome: string;
  delivery_telefone: string | null;
  delivery_endereco: string | null;
  delivery_taxa: number;
  delivery_status: string;
  total: number;
  valor_pago: number;
  valor_a_cobrar: number;
  itens_resumo: string;
  criado_em: string | null;
}

interface MotoboyProfile {
  id: number;
  nome: string;
  telefone: string;
}

export function MotoboyPwaPage() {
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [motoboy, setMotoboy] = useState<MotoboyProfile | null>(null);
  const [entregas, setEntregas] = useState<EntregaItem[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = searchParams.get('token');
    if (tokenFromUrl) {
      setToken(tokenFromUrl);
      carregarDadosPainel(tokenFromUrl);
    } else {
      setLoading(false);
      setErrorMsg('Token de acesso não fornecido na URL. Utilize o link enviado pelo caixa do restaurante.');
    }
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const carregarDadosPainel = async (authToken: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/motoboys/painel-entregador?token=${encodeURIComponent(authToken)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Falha ao carregar painel do entregador');
      }
      const data = await res.json();
      setMotoboy(data.motoboy);
      setEntregas(data.entregas || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao carregar entregas');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmarEntrega = async (comandaId: string) => {
    if (!token) return;
    setConfirmingId(comandaId);
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/motoboys/pedidos/${comandaId}/confirmar-entrega?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Falha ao confirmar entrega');
      }
      showToast('Entrega confirmada com sucesso! 🛵💨', 'success');
      // Remove da lista otimistamente
      setEntregas(prev => prev.filter(e => e.id !== comandaId));
    } catch (err: any) {
      showToast(err.message || 'Erro ao confirmar entrega', 'error');
    } finally {
      setConfirmingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-koma-page text-koma-foreground flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mb-4" />
        <p className="text-koma-subtle text-sm font-medium">Carregando painel do entregador...</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="min-h-screen bg-koma-page text-koma-foreground flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mb-4 text-red-400">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-bold mb-2">Link Invalido ou Expirado</h2>
        <p className="text-koma-subtle text-xs max-w-sm mb-6 leading-relaxed">{errorMsg}</p>
        {token && (
          <button
            onClick={() => carregarDadosPainel(token)}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Tentar Novamente
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-koma-page text-koma-foreground font-sans pb-12 select-none">
      {/* Toast Notification */}
      {toast && (
        <div className={clsx(
          'fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold flex items-center gap-2 transition-all',
          toast.type === 'success' ? 'bg-emerald-950 border-emerald-500/30 text-emerald-300' : 'bg-red-950 border-red-500/30 text-red-300'
        )}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.message}
        </div>
      )}

      {/* Header Sticky */}
      <header className="sticky top-0 z-40 bg-[#121214]/90 backdrop-blur-md border-b border-koma-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-400 font-bold">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-koma-foreground flex items-center gap-1.5">
              KÔMA Entregas
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-normal">PWA</span>
            </h1>
            <p className="text-[11px] text-koma-subtle">Olá, <span className="text-koma-foreground font-semibold">{motoboy?.nome || 'Entregador'}</span></p>
          </div>
        </div>

        <button
          onClick={() => token && carregarDadosPainel(token)}
          className="p-2.5 bg-koma-card hover:bg-[#27272A] border border-koma-border rounded-xl text-koma-secondary transition-colors active:scale-95"
          title="Atualizar Pedidos"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      {/* Main Container */}
      <main className="max-w-md mx-auto p-4 space-y-4">
        {/* Status Bar */}
        <div className="flex items-center justify-between bg-koma-card border border-koma-border rounded-2xl p-3 text-xs">
          <span className="text-koma-subtle">Entregas Pendentes:</span>
          <span className="font-mono font-bold bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full text-xs border border-emerald-500/30">
            {entregas.length} {entregas.length === 1 ? 'pedido' : 'pedidos'}
          </span>
        </div>

        {entregas.length === 0 ? (
          <div className="bg-koma-card border border-koma-border rounded-2xl p-8 text-center space-y-3 mt-6">
            <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-bold text-koma-foreground">Tudo Entregue!</h3>
            <p className="text-koma-subtle text-xs leading-relaxed">Você não tem entregas pendentes no momento. Clique no botão de atualizar acima para checar novos pedidos.</p>
          </div>
        ) : (
          entregas.map((entrega) => {
            const cleanTel = formatWhatsAppPhone(entrega.delivery_telefone);
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(entrega.delivery_endereco || '')}`;
            const waUrl = cleanTel ? `https://wa.me/${cleanTel}?text=${encodeURIComponent(`Olá ${entrega.cliente_nome}! Sou o entregador do *Kôma* a caminho com seu pedido #${entrega.numero_pedido || entrega.id}! 🎉`)}` : null;
            const telUrl = cleanTel ? `tel:${cleanTel}` : null;

            return (
              <div key={entrega.id} className="bg-koma-card border border-koma-border rounded-2xl p-4 space-y-3.5 shadow-lg relative overflow-hidden">
                {/* Visual Accent bar */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-500" />

                {/* Card Header */}
                <div className="flex items-start justify-between border-b border-koma-border pb-3">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400 block mb-0.5">
                      Pedido #{entrega.numero_pedido || entrega.id.slice(-6)}
                    </span>
                    <h2 className="text-sm font-bold text-koma-foreground">{entrega.cliente_nome}</h2>
                  </div>
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                    {entrega.delivery_status === 'transito' ? 'Em Trânsito' : 'Pronto'}
                  </span>
                </div>

                {/* Address Section */}
                <div className="bg-koma-card border border-koma-border rounded-xl p-3 space-y-2 text-xs">
                  <div className="flex items-start gap-2 text-koma-secondary">
                    <MapPin className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span className="leading-relaxed font-medium">{entrega.delivery_endereco || 'Endereço não especificado'}</span>
                  </div>
                  
                  {entrega.delivery_endereco && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors pt-1"
                    >
                      <Navigation className="w-3.5 h-3.5" /> Abrir no Google Maps / Waze <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {/* Items Summary */}
                <div className="bg-[#18181B]/60 rounded-xl p-2.5 text-xs text-koma-subtle border border-[#27272A]/50">
                  <div className="flex items-center gap-1.5 font-semibold text-koma-secondary mb-1 text-[11px]">
                    <ShoppingBag className="w-3.5 h-3.5 text-amber-400" /> Itens do Pedido:
                  </div>
                  <p className="text-[11px] font-mono leading-relaxed text-koma-secondary">{entrega.itens_resumo || 'Nenhum item discriminado'}</p>
                </div>

                {/* Financial Summary */}
                <div className="bg-koma-card border border-koma-border rounded-xl p-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] text-koma-subtle block uppercase font-medium">Valor a Cobrar</span>
                    {entrega.valor_a_cobrar > 0 ? (
                      <span className="text-base font-extrabold text-emerald-400 font-mono">
                        R$ {entrega.valor_a_cobrar.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded border border-teal-500/20">
                        Já Pago via App
                      </span>
                    )}
                  </div>
                  <div className="text-right text-[11px] text-koma-subtle">
                    <div>Total: R$ {entrega.total.toFixed(2)}</div>
                    <div>Taxa: R$ {entrega.delivery_taxa.toFixed(2)}</div>
                  </div>
                </div>

                {/* Quick Action Buttons (Call / WhatsApp) */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {telUrl ? (
                    <a
                      href={telUrl}
                      className="py-2 px-3 bg-koma-card hover:bg-[#27272A] border border-koma-border text-gray-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5 text-emerald-400" /> Ligar para Cliente
                    </a>
                  ) : (
                    <button disabled className="py-2 px-3 bg-koma-card text-gray-600 text-xs font-bold rounded-xl cursor-not-allowed">
                      Sem Telefone
                    </button>
                  )}

                  {waUrl ? (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2 px-3 bg-[#10b981]/15 hover:bg-[#10b981]/25 border border-[#10b981]/30 text-emerald-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                    >
                      WhatsApp
                    </a>
                  ) : (
                    <button disabled className="py-2 px-3 bg-koma-card text-gray-600 text-xs font-bold rounded-xl cursor-not-allowed">
                      Sem WhatsApp
                    </button>
                  )}
                </div>

                {/* Confirm Delivery Button */}
                <button
                  type="button"
                  disabled={confirmingId === entrega.id}
                  onClick={() => handleConfirmarEntrega(entrega.id)}
                  className={clsx(
                    'w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer active:scale-[0.98]',
                    confirmingId === entrega.id && 'animate-pulse'
                  )}
                >
                  {confirmingId === entrega.id ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Confirmando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" /> Confirmar Entrega Realizada
                    </>
                  )}
                </button>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
