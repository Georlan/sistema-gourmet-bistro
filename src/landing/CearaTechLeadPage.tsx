import React, { useState } from 'react';
import { CheckCircle2, Instagram, Send, Sparkles, Store, UtensilsCrossed, Phone, User, Building2 } from 'lucide-react';
import { API_BASE_URL } from '../config/api';
import { aplicarMascaraTelefoneInput } from '../utils/phonePresentation';

function KomaBrandSymbol({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="komaLeadSymbolGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#05C49D" />
          <stop offset="0.55" stopColor="#08CAA3" />
          <stop offset="1" stopColor="#14D6B0" />
        </linearGradient>
      </defs>
      <path
        d="M 556 744 L 564 753 L 648 838 L 658 844 L 666 847 L 679 849 L 786 849 L 769 830 L 644 705 L 621 683 L 619 683 L 572 727 Z M 229 444 L 229 449 L 230 453 L 232 456 L 237 461 L 241 463 L 781 463 L 787 460 L 791 456 L 793 452 L 794 447 L 793 440 L 790 435 L 785 431 L 779 429 L 244 429 L 240 430 L 236 432 L 232 436 L 230 440 Z M 450 248 L 448 250 L 442 253 L 429 262 L 417 272 L 398 292 L 388 306 L 377 325 L 368 345 L 363 360 L 362 367 L 359 374 L 358 383 L 356 385 L 311 384 L 311 381 L 318 359 L 329 336 L 341 317 L 349 307 L 364 291 L 365 291 L 373 283 L 378 279 L 396 267 L 421 255 L 443 248 L 446 248 L 447 247 Z M 509 168 L 510 170 L 508 172 L 499 176 L 493 183 L 490 189 L 488 198 L 480 197 L 481 188 L 483 183 L 487 177 L 491 173 L 499 168 L 502 167 Z M 275 395 L 275 404 L 749 404 L 749 396 L 745 375 L 743 367 L 741 364 L 740 358 L 731 336 L 729 334 L 727 328 L 717 311 L 704 293 L 698 286 L 681 269 L 670 260 L 651 247 L 637 239 L 615 229 L 600 224 L 571 217 L 565 216 L 558 216 L 554 214 L 558 205 L 559 199 L 559 191 L 557 183 L 553 174 L 551 171 L 540 160 L 528 154 L 518 152 L 508 152 L 502 153 L 496 155 L 485 161 L 476 170 L 470 181 L 468 188 L 468 203 L 472 214 L 467 216 L 454 217 L 432 222 L 413 228 L 394 236 L 384 241 L 364 253 L 347 266 L 336 276 L 319 295 L 304 316 L 290 343 L 286 353 L 280 371 Z"
        fill="url(#komaLeadSymbolGrad)"
        fillRule="evenodd"
      />
      <path
        d="M 753 497 L 609 497 L 605 500 L 565 537 L 548 554 L 533 567 L 494 604 L 473 625 L 432 663 L 425 670 L 425 814 L 427 812 L 428 812 L 448 792 L 467 775 L 559 686 L 602 646 L 720 531 Z M 271 497 L 271 848 L 340 848 L 346 847 L 355 844 L 366 838 L 376 828 L 381 820 L 384 812 L 386 803 L 387 512 L 386 497 Z"
        fill="#FDFDFD"
        fillRule="evenodd"
      />
    </svg>
  );
}

interface FormState {
  nome: string;
  whatsapp: string;
  empresa_nome: string;
  segmento: string;
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

export default function CearaTechLeadPage() {
  const [form, setForm] = useState<FormState>({
    nome: '',
    whatsapp: '',
    empresa_nome: '',
    segmento: '',
    consent: true,
  });

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
      const response = await fetch(`${API_BASE_URL}/api/leads/cearatech`, {
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
          consent_whatsapp: true,
          event_slug: 'ceara-tech-summit-2026',
          source: 'qr_impresso',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Ocorreu um erro ao enviar seus dados. Tente novamente.');
      }

      setSuccess(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setErrorMsg(err.message || 'Não foi possível conectar ao servidor. Verifique sua conexão.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-zinc-100 flex flex-col justify-between selection:bg-emerald-500 selection:text-black">
      {/* Background radial highlight */}
      <div
        className="fixed inset-0 pointer-events-none opacity-25"
        style={{
          background: 'radial-gradient(circle at 50% 15%, rgba(16, 185, 129, 0.18) 0%, transparent 60%)',
        }}
        aria-hidden="true"
      />

      {/* Top Header */}
      <header className="relative z-10 w-full max-w-xl mx-auto px-5 pt-8 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <KomaBrandSymbol className="w-8 h-8" />
          <span className="font-extrabold text-xl tracking-tight text-white">KÔMA</span>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs font-semibold tracking-wide uppercase">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>Ceará Tech Summit</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 w-full max-w-xl mx-auto px-5 py-6 flex-1 flex flex-col justify-center">
        {success ? (
          /* Success Card */
          <div className="bg-zinc-900/90 border border-emerald-500/40 rounded-3xl p-7 sm:p-9 shadow-2xl backdrop-blur-sm text-center animate-in fade-in zoom-in-95 duration-300">
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
              Obrigado pelo seu interesse! Nossa equipe entrará em contato diretamente pelo seu WhatsApp logo após o encerramento do <strong className="text-white">Ceará Tech Summit</strong>.
            </p>

            <div className="p-4 rounded-2xl bg-zinc-950/70 border border-zinc-800/80 mb-7">
              <p className="text-xs text-zinc-400 leading-normal">
                Enquanto isso, acompanhe novidades, bastidores e demonstrações da nossa plataforma em tempo real:
              </p>
            </div>

            <a
              href="https://instagram.com/komafood"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-3 w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 text-white font-bold text-base shadow-lg shadow-purple-500/20 hover:opacity-95 active:scale-[0.98] transition-all"
            >
              <Instagram className="w-5 h-5" />
              <span>Seguir @komafood no Instagram</span>
            </a>
          </div>
        ) : (
          /* Form Card */
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
            {/* Lead Title & Pitch */}
            <div className="mb-6">
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-snug mb-2">
                O sistema operacional definitivo para restaurantes.
              </h1>
              <p className="text-zinc-400 text-sm sm:text-base leading-relaxed">
                Gostou da demonstração no palco? Deixe seu contato para agendarmos uma apresentação personalizada do KÔMA para a sua operação.
              </p>
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
                    Concordo em receber uma mensagem da equipe KÔMA via WhatsApp com informações e condições do Ceará Tech Summit.
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
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-xl mx-auto px-5 py-6 text-center text-xs text-zinc-600">
        <p className="mb-1.5">
          KÔMA · Feito para quem vive a gastronomia na prática.
        </p>
        <p>
          <a
            href="https://instagram.com/komafood"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-300 transition-colors underline-offset-2 hover:underline"
          >
            @komafood
          </a>
          {' · '}
          <span>Ceará Tech Summit 2026</span>
        </p>
      </footer>
    </div>
  );
}
