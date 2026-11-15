import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, Lock, ShieldCheck } from 'lucide-react';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../brand/komaBrand';
import { API_BASE_URL } from '../config/api';
import {
  LEGAL_SOURCE_BLOB_SHA,
  LEGAL_SOURCE_COMMIT,
  contractLegalBundle,
} from './legalEvidence';
import { LEGAL_VERSION } from './legalContent';
import { isValidCpf, taxIdKind } from './taxId';

type InvitePreview = {
  restaurantId: string;
  restaurantName: string;
  plan: string;
  billingCycle: 'mensal' | 'anual' | string;
  expiresAt: string;
};

type AcceptedResult = {
  protocol: string;
  acceptedAt: string;
  restaurantId: string;
  restaurantName: string;
  plan: string;
  billingCycle: string;
  message: string;
};

export function ContractInviteAcceptPage({ token }: { token: string | null }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [contractingPartyName, setContractingPartyName] = useState('');
  const [contractingPartyTaxId, setContractingPartyTaxId] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [representativeName, setRepresentativeName] = useState('');
  const [representativeTaxId, setRepresentativeTaxId] = useState('');
  const [representativeRole, setRepresentativeRole] = useState('Proprietário');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [powersDeclared, setPowersDeclared] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [accepted, setAccepted] = useState<AcceptedResult | null>(null);

  const bundle = useMemo(() => contractLegalBundle(), []);
  const legalDocs = useMemo(
    () => [
      { key: 'terms', doc: bundle.terms },
      { key: 'commercial', doc: bundle.commercial },
      { key: 'dpa', doc: bundle.dpa },
      { key: 'privacy', doc: bundle.privacy },
    ],
    [bundle],
  );

  useEffect(() => {
    const cleanToken = (token || '').trim();
    if (!cleanToken) {
      setLoadError('Link de aceite inválido ou ausente.');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void fetch(`${API_BASE_URL}/api/contracts/invite?token=${encodeURIComponent(cleanToken)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.detail || 'Não foi possível validar este link de aceite.');
        }
        const loaded = data as InvitePreview;
        setPreview(loaded);
        setRestaurantName((current) => current || loaded.restaurantName || '');
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setLoadError(err instanceof Error ? err.message : 'Falha ao carregar o convite contratual.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [token]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview || !token || submitting) return;

    setSubmitError('');
    if (!taxIdKind(contractingPartyTaxId)) {
      setSubmitError('Informe um CPF ou CNPJ válido para o contratante.');
      return;
    }
    if (!isValidCpf(representativeTaxId)) {
      setSubmitError('Informe um CPF válido para o representante legal.');
      return;
    }
    if (!powersDeclared) {
      setSubmitError('Confirme que possui poderes para aceitar os termos em nome do restaurante.');
      return;
    }

    setSubmitting(true);
    try {
      const requestId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : '00000000-0000-4000-8000-000000000000';

      const response = await fetch(`${API_BASE_URL}/api/contracts/invite/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          request_id: requestId,
          contracting_party_name: contractingPartyName.trim(),
          contracting_party_tax_id: contractingPartyTaxId.trim(),
          restaurant_name: restaurantName.trim(),
          representative_name: representativeName.trim(),
          representative_tax_id: representativeTaxId.trim(),
          representative_role: representativeRole.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          powers_declared: true,
          legal_version: LEGAL_VERSION,
          legal_source_commit: LEGAL_SOURCE_COMMIT,
          legal_source_blob_sha: LEGAL_SOURCE_BLOB_SHA,
          documents: bundle,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Não foi possível registrar o aceite.');
      }
      setAccepted(data as AcceptedResult);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro ao registrar aceite contratual.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-koma-page text-koma-foreground px-4 py-8">
      <div className="mx-auto max-w-xl space-y-6">
        <header className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" className="h-7 w-auto" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-koma-card px-3 py-1 text-[11px] font-semibold text-koma-muted">
            <Lock className="h-3.5 w-3.5 text-koma-accent" />
            Link único de aceite
          </span>
        </header>

        {loading && (
          <div className="rounded-2xl border border-zinc-800 bg-koma-card p-6 text-sm text-koma-muted">
            Validando link de aceite contratual…
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-2xl border border-rose-800/60 bg-rose-950/30 p-6 text-sm text-rose-200" role="alert">
            <p className="font-bold">Link indisponível</p>
            <p className="mt-1 text-xs text-rose-300">{loadError}</p>
          </div>
        )}

        {!loading && !loadError && accepted && (
          <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/25 p-6 space-y-3">
            <div className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
              <h1 className="text-lg font-bold">Contrato aceito e vinculado</h1>
            </div>
            <p className="text-sm text-koma-foreground">{accepted.message}</p>
            <div className="rounded-xl border border-zinc-800 bg-koma-page p-4 text-xs space-y-1">
              <p><strong>Protocolo:</strong> <span className="font-mono">{accepted.protocol}</span></p>
              <p><strong>Restaurante:</strong> {accepted.restaurantName}</p>
              <p><strong>Plano / Ciclo:</strong> {accepted.plan.toUpperCase()} · {accepted.billingCycle}</p>
            </div>
            <p className="text-xs text-koma-muted">
              Você já pode fechar esta página. A operação do restaurante já está vinculada no painel KÔMA.
            </p>
          </div>
        )}

        {!loading && !loadError && preview && !accepted && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <section className="rounded-2xl border border-zinc-800 bg-koma-card p-5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-koma-accent">
                <ShieldCheck className="h-4 w-4" />
                Aceite eletrônico KÔMA
              </div>
              <h1 className="text-xl font-bold">{preview.restaurantName}</h1>
              <p className="text-xs text-koma-muted">
                Plano <strong className="text-koma-foreground">{preview.plan.toUpperCase()}</strong> · Ciclo{' '}
                <strong className="text-koma-foreground">{preview.billingCycle}</strong> · Válido até{' '}
                {new Date(preview.expiresAt).toLocaleString('pt-BR')}
              </p>
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-koma-card p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <FileText className="h-4 w-4 text-koma-accent" />
                Documentos do contrato (v{LEGAL_VERSION})
              </div>
              <p className="text-xs text-koma-muted">
                Leia os termos abaixo antes de confirmar o aceite.
              </p>
              <div className="space-y-2">
                {legalDocs.map(({ key, doc }) => (
                  <details key={key} className="rounded-xl border border-zinc-800 bg-koma-page p-3">
                    <summary className="cursor-pointer text-xs font-bold text-koma-foreground">
                      {doc.title}
                    </summary>
                    <div className="mt-3 max-h-56 overflow-y-auto space-y-2 pr-1 text-xs text-koma-muted">
                      {doc.sections.map((section, idx) => (
                        <div key={idx}>
                          <p className="font-semibold text-koma-foreground">{section.title}</p>
                          {section.paragraphs?.map((paragraph, pIdx) => (
                            <p key={pIdx} className="mt-1 leading-relaxed">{paragraph}</p>
                          ))}
                          {section.bullets && section.bullets.length > 0 && (
                            <ul className="mt-1 list-disc pl-4 space-y-0.5">
                              {section.bullets.map((bullet, bIdx) => (
                                <li key={bIdx}>{bullet}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-koma-card p-5 space-y-3">
              <h2 className="text-sm font-bold">Dados para o comprovante</h2>
              <div className="grid gap-3">
                <label className="block text-xs text-koma-muted">
                  Nome ou Razão Social do contratante
                  <input
                    required
                    value={contractingPartyName}
                    onChange={(e) => setContractingPartyName(e.target.value)}
                    placeholder="Ex.: JE Lanches Ltda ou Nome Completo"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-sm text-koma-foreground"
                  />
                </label>
                <label className="block text-xs text-koma-muted">
                  CPF ou CNPJ do contratante
                  <input
                    required
                    value={contractingPartyTaxId}
                    onChange={(e) => setContractingPartyTaxId(e.target.value)}
                    placeholder="Somente números ou formatado"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-sm text-koma-foreground"
                  />
                </label>
                <label className="block text-xs text-koma-muted">
                  Nome do restaurante
                  <input
                    required
                    value={restaurantName}
                    onChange={(e) => setRestaurantName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-sm text-koma-foreground"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-koma-muted">
                    Nome do representante
                    <input
                      required
                      value={representativeName}
                      onChange={(e) => setRepresentativeName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-sm text-koma-foreground"
                    />
                  </label>
                  <label className="block text-xs text-koma-muted">
                    CPF do representante
                    <input
                      required
                      value={representativeTaxId}
                      onChange={(e) => setRepresentativeTaxId(e.target.value)}
                      placeholder="000.000.000-00"
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-sm text-koma-foreground"
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs text-koma-muted">
                    Cargo
                    <input
                      required
                      value={representativeRole}
                      onChange={(e) => setRepresentativeRole(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-sm text-koma-foreground"
                    />
                  </label>
                  <label className="block text-xs text-koma-muted sm:col-span-2">
                    E-mail
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="contato@restaurante.com.br"
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-sm text-koma-foreground"
                    />
                  </label>
                </div>
                <label className="block text-xs text-koma-muted">
                  WhatsApp / Telefone
                  <input
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(81) 99999-0000"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-sm text-koma-foreground"
                  />
                </label>
              </div>

              <label className="mt-3 flex items-start gap-2.5 text-xs text-koma-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={powersDeclared}
                  onChange={(e) => setPowersDeclared(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-emerald-500"
                />
                <span>
                  Declaro ter poderes para representar o restaurante e aceito integralmente os Termos de Uso, Condições Comerciais, DPA e Política de Privacidade.
                </span>
              </label>

              {submitError && (
                <p className="text-xs font-semibold text-rose-400" role="alert">
                  {submitError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-zinc-950 disabled:opacity-50"
              >
                {submitting ? 'Registrando aceite…' : 'Aceitar contrato e vincular restaurante'}
              </button>
            </section>
          </form>
        )}
      </div>
    </div>
  );
}
