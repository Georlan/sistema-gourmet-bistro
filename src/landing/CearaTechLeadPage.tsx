import { KOMA_LANDING_CONFIG } from "./config/landingConfig";
import React, { useState, useEffect } from 'react';
import { CheckCircle2, Instagram, Send, Store, UtensilsCrossed, Phone, User, Building2 } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { aplicarMascaraTelefoneInput } from '../utils/phonePresentation';

interface FormState {
  nome: string;
  whatsapp: string;
  empresa_nome: string;
  segmento: string;
  cidade: string;
  sistema_atual: string;
  principal_dor: string;
  interesse: string;
  consent: boolean;
}

const SEGMENTOS_SUGERIDOS = [
  'Hamburgueria',
  'Pizzaria',
  'Bar / Pub',
  'Restaurante',
  'Marmitaria',
  'Cafeteria / Doceria',
  'Outro',
];

function resolveLeadSource(): 'qr_tela' | 'qr_impresso' | 'link_direto' {
  if (typeof window === 'undefined') return 'link_direto';
  const source = new URLSearchParams(window.location.search).get('source')?.trim().toLowerCase();
  if (source === 'qr_tela' || source === 'qr_impresso') return source;
  return 'link_direto';
}

export default function CearaTechLeadPage() {
  const [form, setForm] = useState<FormState>({
    nome: '',
    whatsapp: '',
    empresa_nome: '',
    segmento: '',
    cidade: '', sistema_atual: '', principal_dor: '', interesse: '',
    consent: false,
  });

  const [signupUrl, setSignupUrl] = useState<string | null>(null);
  const [visitId] = useState(() => {
    try {
      const key = "koma-siara-visit";
      const id = sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, id); return id;
    } catch { return crypto.randomUUID(); }
  });
  useEffect(() => {
    void fetch(`${API_BASE_URL}/api/leads/siaratech/visits`, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visit_id: visitId, source: resolveLeadSource() }),
    }).catch(() => undefined);
  }, [visitId]);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const nomeLimpo = form.nome.trim();
    if (nomeLimpo.length < 2) {
      setErrorMsg('Por favor, informe seu nome completo.');
      return;
    }

    const apenasDigitos = form.whatsapp.replace(/\D/g, '');
    if (apenasDigitos.length < 10 || apenasDigitos.length > 11) {
      setErrorMsg('Informe um número de WhatsApp válido com DDD (ex.: 85 99999-9999).');
      return;
    }

    if (!form.consent) {
      setErrorMsg('É necessário concordar em receber nosso contato via WhatsApp.');
      return;
    }

    setLoading(true);

    try {
      const captureOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          nome: nomeLimpo,
          whatsapp: form.whatsapp,
          empresa_nome: form.empresa_nome.trim() || undefined,
          segmento: form.segmento.trim() || undefined,
          cidade: form.cidade.trim() || undefined,
          sistema_atual: form.sistema_atual.trim() || undefined,
          principal_dor: form.principal_dor.trim() || undefined,
          interesse: form.interesse.trim() || undefined,
          visit_id: visitId,
          consent_whatsapp: true,
          event_slug: 'ceara-tech-summit-2026',
          source: resolveLeadSource(),
        }),
      };
      let response = await fetch(`${API_BASE_URL}/api/leads/siaratech`, captureOptions);
      // Keep capture available while frontend/backend deployments roll out separately.
      if (response.status === 404) {
        response = await fetch(`${API_BASE_URL}/api/leads/cearatech`, captureOptions);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Ocorreu um erro ao enviar seus dados. Tente novamente.');
      }

      const data = await response.json();
      setSignupUrl(typeof data.signup_url === "string" && data.signup_url.startsWith("/contratar?") ? data.signup_url : null);
      setSuccess(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setErrorMsg(err.message || 'Não foi possível conectar ao servidor. Verifique sua conexão.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="siara-page min-h-screen bg-[#0a0a0c] text-zinc-100 flex flex-col justify-between selection:bg-emerald-500 selection:text-black">
      <header className="siara-header">
        <a href="/" aria-label="KÔMA — início"><img className="siara-koma-logo" src="/koma-event-wordmark.svg" alt="KÔMA" /></a>
        <img className="siara-event-logo" src="/siara-tech-summit.svg" alt="Siará Tech Summit 2026" />
      </header>
      {/* Main Container */}
      <main className="siara-capture-main">
        {success ? (
          /* Success Card */
          <div className="siara-success text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto mb-5 shadow-inner">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <span className="inline-block text-xs font-mono font-bold uppercase tracking-widest text-emerald-400 mb-2">
              Confirmação
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-3 tracking-tight">
              Contato recebido ✓
            </h1>
            <p className="text-zinc-300 text-sm sm:text-base leading-relaxed max-w-md mx-auto mb-7">
              Obrigado pelo seu interesse! Nossa equipe entrará em contato diretamente pelo seu WhatsApp logo após o encerramento do <strong className="text-white">Siará Tech Summit</strong>.
            </p>

            <div className="p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800/80 mb-7">
              <p className="text-xs text-zinc-400 leading-normal">
                Se preferir, fale comigo agora pelo WhatsApp. Você também pode acompanhar novidades e demonstrações no Instagram:
              </p>
            </div>

            <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer" className="mb-4 inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-6 py-4 text-base font-bold text-black hover:bg-emerald-400">
              <Phone className="w-5 h-5" />
              Falar com Georlan no WhatsApp
            </a>
            {signupUrl && <a href={signupUrl} className="mb-4 flex w-full justify-center rounded-xl bg-emerald-500 p-4 font-bold text-black">Ver planos do KÔMA</a>}
            <a
              href="https://instagram.com/georlanjunior"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-3 w-full py-4 px-6 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-base  hover:opacity-95 active:scale-[0.98] transition-all"
            >
              <Instagram className="w-5 h-5" />
              <span>Seguir @georlanjunior no Instagram</span>
            </a>
          </div>
        ) : (
          /* Form Card */
          <div className="siara-capture-grid">
          <section className="siara-pitch">
            <p className="siara-eyebrow">PARA QUEM VIVE A GASTRONOMIA</p>
            <h1>MAIS<br /><span>CONTROLE.</span><br />MENOS<br />CORRERIA.</h1>
            <p className="siara-pitch-description">Pedidos, cozinha e caixa juntos. Conheça o KÔMA na sua operação.</p>
            <div className="siara-pitch-note"><span>DO SIARÁ PARA O SEU RESTAURANTE</span><p>A conversa começa aqui.<br />O próximo passo é no seu WhatsApp.</p></div>
          </section>
          <div className="siara-form-panel">
            {/* Lead Title & Pitch */}
            <div className="mb-6">
              <p className="siara-eyebrow">VAMOS CONVERSAR?</p>
              <h2 className="siara-form-heading">Sua operação tem<br />um próximo passo.</h2>
              <p className="siara-form-description">Deixe seu nome e WhatsApp. A gente conversa depois do evento, sem compromisso.</p>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="mb-6 p-4 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-rose-200 text-sm leading-snug"
              >
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Nome */}
              <div>
                <label htmlFor="lead-nome" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                  Seu Nome *
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                  <input
                    id="lead-nome"
                    type="text"
                    required
                    maxLength={120}
                    placeholder="Como podemos chamar você?"
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-zinc-950/80 border border-zinc-800 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>
              </div>

              {/* WhatsApp */}
              <div>
                <label htmlFor="lead-whatsapp" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                  WhatsApp com DDD *
                </label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                  <input
                    id="lead-whatsapp"
                    type="tel"
                    required
                    placeholder="(85) 99999-9999"
                    value={form.whatsapp}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        whatsapp: aplicarMascaraTelefoneInput(e.target.value),
                      })
                    }
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-zinc-950/80 border border-zinc-800 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono transition-colors"
                  />
                </div>
              </div>

              {/* Nome do Estabelecimento (Opcional) */}
              <div>
                <label htmlFor="lead-empresa" className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                  Nome do Restaurante / Estabelecimento <span className="text-zinc-500 font-normal">(opcional)</span>
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                  <input
                    id="lead-empresa"
                    type="text"
                    maxLength={120}
                    placeholder="Ex.: D8 Burger, Pizzaria Central…"
                    value={form.empresa_nome}
                    onChange={(e) => setForm({ ...form, empresa_nome: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-zinc-950/80 border border-zinc-800 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>
              </div>

              {/* Segmento / Nicho (Chips) */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  Tipo de Operação <span className="text-zinc-500 font-normal">(opcional)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {SEGMENTOS_SUGERIDOS.map((s) => {
                    const isSelected = form.segmento === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setForm({ ...form, segmento: isSelected ? '' : s })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          isSelected
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                            : 'bg-zinc-950/60 border-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>

              <details className="rounded-xl border border-zinc-800 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-emerald-300">Conte um pouco da sua operação (opcional)</summary>
                <div className="mt-4 space-y-3">
                  {([['cidade', 'Cidade', 120], ['sistema_atual', 'Qual sistema você usa hoje?', 120], ['principal_dor', 'Qual é sua maior dor de cabeça?', 2000], ['interesse', 'O que gostaria de melhorar?', 2000]] as const).map(([key, label, max]) => (
                    <label key={key} className="block text-sm text-zinc-300">{label}
                      <input value={form[key]} maxLength={max} onChange={e => setForm({ ...form, [key]: e.target.value })} className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-white focus:border-emerald-500" />
                    </label>
                  ))}
                </div>
              </details>

              {/* Consentimento LGPD */}
              <div className="pt-2">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.consent}
                    onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                    className="mt-0.5 w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 focus:ring-offset-transparent cursor-pointer"
                  />
                  <span className="text-xs text-zinc-400 leading-snug">
                    Aceito receber contato da equipe KÔMA pelo WhatsApp sobre o produto e a apresentação do Siará Tech Summit. Posso pedir para não receber novas mensagens a qualquer momento.
                  </span>
                </label>
              </div>

              {/* Submit Button */}
              <div className="pt-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-black font-extrabold text-sm sm:text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>QUERO CONHECER O KÔMA</span>
                      <Send className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Quick Pillars */}
            <div className="mt-8 pt-6 border-t border-zinc-800/80 grid grid-cols-2 gap-3 text-left">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-zinc-800/60 flex items-center justify-center text-emerald-400 shrink-0">
                  <Store className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs text-zinc-300 font-medium">PDV e Caixa ágil</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-zinc-800/60 flex items-center justify-center text-emerald-400 shrink-0">
                  <UtensilsCrossed className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs text-zinc-300 font-medium">Cardápio digital</span>
              </div>
            </div>
          </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-xl mx-auto px-5 py-6 text-center text-xs text-zinc-600">
        <p className="mb-1.5">
          KÔMA · Feito para quem vive a gastronomia na prática.
        </p>
        <p>
          <a
            href="https://instagram.com/georlanjunior"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-300 transition-colors underline-offset-2 hover:underline"
          >
            @georlanjunior
          </a>
          {' · '}
          <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Falar com Georlan no WhatsApp</a>
          {' · '}
          <span>Siará Tech Summit 2026</span>
        </p>
      </footer>
    </div>
  );
}
