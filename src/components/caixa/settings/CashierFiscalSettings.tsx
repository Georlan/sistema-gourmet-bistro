import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CheckCircle2,
  FileKey2,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  TestTube2,
  XCircle,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OperationalBanner } from '../../shared/OperationalBanner';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

type PreflightMode = 'foundation' | 'activation' | 'issuance';

type FiscalIssue = {
  code: string;
  message: string;
  severity: 'blocking' | 'warning' | string;
  sourceKey?: string | null;
};

type FiscalReference = {
  sourceKey: string;
  title: string;
  blocking: boolean;
  status: string;
  stale: boolean;
  checkedAt?: string | null;
  observedSnapshotId?: string | null;
  activeSnapshotId?: string | null;
  observedVersion?: string | null;
  activeVersion?: string | null;
  lastError?: string | null;
};

type ComplianceBaseline = {
  key: string;
  title: string;
  version: string;
  adoptionStatus: string;
  verifiedOn: string;
  sourceUrl: string;
};

type FiscalPreflight = {
  ready: boolean;
  mode: PreflightMode;
  jurisdictionKey?: string | null;
  profileReady: boolean;
  referencesReady: boolean;
  issues: FiscalIssue[];
  warnings: FiscalIssue[];
  references: FiscalReference[];
  complianceBaseline: ComplianceBaseline[];
};

type ReadinessPayload = {
  ready: boolean;
  status: string;
  jurisdictionKey?: string | null;
  issues?: Array<{ code: string; message: string; severity: string }>;
};

type FiscalProfile = {
  id?: number;
  status: string;
  enabled: boolean;
  countryCode?: string;
  uf?: string;
  documentModel?: string;
  environment?: 'homologacao' | 'producao' | string;
  series?: number;
  provider?: string;
  complianceBaseline?: string;
  cnpj?: string | null;
  inscricaoEstadual?: string | null;
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  crt?: string | null;
  cnaePrincipal?: string | null;
  municipioCodigoIbge?: string | null;
  enderecoFiscal?: {
    cep?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string | null;
    bairro?: string;
    municipio_nome?: string;
    municipio_codigo_ibge?: string;
    uf?: string;
  } | null;
  certificateConfigured?: boolean;
  certificateFingerprint?: string | null;
  certificateExpiresAt?: string | null;
  cscConfigured?: boolean;
  readiness?: ReadinessPayload;
};

type Municipality = {
  code: string;
  name: string;
  uf: string;
};

type FiscalProfileForm = {
  cnpj: string;
  inscricaoEstadual: string;
  razaoSocial: string;
  nomeFantasia: string;
  crt: string;
  cnaePrincipal: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipioCodigoIbge: string;
  series: string;
  environment: 'homologacao' | 'producao';
};

const EMPTY_PROFILE: FiscalProfileForm = {
  cnpj: '',
  inscricaoEstadual: '',
  razaoSocial: '',
  nomeFantasia: '',
  crt: '1',
  cnaePrincipal: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  municipioCodigoIbge: '2304400',
  series: '1',
  environment: 'homologacao',
};

function profileToForm(profile: FiscalProfile | null): FiscalProfileForm {
  if (!profile?.id) return EMPTY_PROFILE;
  return {
    cnpj: profile.cnpj ?? '',
    inscricaoEstadual: profile.inscricaoEstadual ?? '',
    razaoSocial: profile.razaoSocial ?? '',
    nomeFantasia: profile.nomeFantasia ?? '',
    crt: profile.crt ?? '1',
    cnaePrincipal: profile.cnaePrincipal ?? '',
    cep: profile.enderecoFiscal?.cep ?? '',
    logradouro: profile.enderecoFiscal?.logradouro ?? '',
    numero: profile.enderecoFiscal?.numero ?? '',
    complemento: profile.enderecoFiscal?.complemento ?? '',
    bairro: profile.enderecoFiscal?.bairro ?? '',
    municipioCodigoIbge: profile.municipioCodigoIbge ?? profile.enderecoFiscal?.municipio_codigo_ibge ?? '2304400',
    series: String(profile.series ?? 1),
    environment: profile.environment === 'producao' ? 'producao' : 'homologacao',
  };
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

function apiError(payload: any, fallback: string): string {
  const detail = payload?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail?.message) return String(detail.message);
  if (payload?.message) return String(payload.message);
  return fallback;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function shortId(value?: string | null): string {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value;
}

function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

function statusClass(ok: boolean) {
  return ok
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200';
}

export function CashierFiscalSettings({ apiBaseUrl, authHeaders }: Props) {
  const [profile, setProfile] = useState<FiscalProfile | null>(null);
  const [form, setForm] = useState<FiscalProfileForm>(EMPTY_PROFILE);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [preflight, setPreflight] = useState<FiscalPreflight | null>(null);
  const [preflightMode, setPreflightMode] = useState<PreflightMode>('foundation');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [runningPreflight, setRunningPreflight] = useState(false);
  const [changingEnabled, setChangingEnabled] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [certificatePassword, setCertificatePassword] = useState('');
  const [cscId, setCscId] = useState('');
  const [csc, setCsc] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    return fetch(`${apiBaseUrl}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        ...authHeaders,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }, [apiBaseUrl, authHeaders]);

  const loadProfile = useCallback(async () => {
    const response = await request('/api/onboarding/fiscal/profile');
    const payload = await readJson(response);
    if (!response.ok) throw new Error(apiError(payload, 'Falha ao carregar o perfil fiscal.'));
    const next = payload as FiscalProfile;
    setProfile(next);
    setForm(profileToForm(next));
    return next;
  }, [request]);

  const runPreflight = useCallback(async (mode: PreflightMode) => {
    setRunningPreflight(true);
    try {
      const response = await request(`/api/onboarding/fiscal/preflight?mode=${mode}`);
      const payload = await readJson(response);
      if (!response.ok) throw new Error(apiError(payload, 'Falha ao executar o Fiscal Preflight.'));
      setPreflight(payload as FiscalPreflight);
      setPreflightMode(mode);
      return payload as FiscalPreflight;
    } finally {
      setRunningPreflight(false);
    }
  }, [request]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const [profileResponse, municipalitiesResponse] = await Promise.all([
        request('/api/onboarding/fiscal/profile'),
        request('/api/onboarding/fiscal/municipalities?uf=CE'),
      ]);
      const profilePayload = await readJson(profileResponse);
      const municipalitiesPayload = await readJson(municipalitiesResponse);
      if (!profileResponse.ok) throw new Error(apiError(profilePayload, 'Falha ao carregar o perfil fiscal.'));
      if (!municipalitiesResponse.ok) throw new Error(apiError(municipalitiesPayload, 'Falha ao carregar municípios oficiais.'));
      const nextProfile = profilePayload as FiscalProfile;
      setProfile(nextProfile);
      setForm(profileToForm(nextProfile));
      setMunicipalities(Array.isArray(municipalitiesPayload?.items) ? municipalitiesPayload.items : []);
      await runPreflight('foundation');
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao carregar o módulo fiscal.' });
    } finally {
      setLoading(false);
    }
  }, [request, runPreflight]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const setField = (field: keyof FiscalProfileForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingProfile(true);
    setNotice(null);
    try {
      const response = await request('/api/onboarding/fiscal/profile', {
        method: 'PUT',
        body: JSON.stringify({
          cnpj: form.cnpj,
          inscricao_estadual: form.inscricaoEstadual,
          razao_social: form.razaoSocial,
          nome_fantasia: form.nomeFantasia || null,
          crt: form.crt,
          cnae_principal: form.cnaePrincipal,
          cep: form.cep,
          logradouro: form.logradouro,
          numero: form.numero,
          complemento: form.complemento || null,
          bairro: form.bairro,
          municipio_codigo_ibge: form.municipioCodigoIbge,
          uf: 'CE',
          series: Number(form.series || 1),
          environment: form.environment,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(apiError(payload, 'Não foi possível salvar o perfil fiscal.'));
      setProfile(payload as FiscalProfile);
      setForm(profileToForm(payload as FiscalProfile));
      setNotice({ type: 'success', text: 'Perfil fiscal salvo. A emissão permanece desativada até novo preflight e ativação.' });
      await runPreflight('foundation');
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao salvar perfil fiscal.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const saveCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!certificateFile) {
      setNotice({ type: 'error', text: 'Selecione o certificado A1 (.pfx ou .p12).' });
      return;
    }
    setSavingCredentials(true);
    setNotice(null);
    try {
      const certificatePfxBase64 = await fileToBase64(certificateFile);
      const response = await request('/api/onboarding/fiscal/credentials', {
        method: 'PUT',
        body: JSON.stringify({
          certificate_pfx_base64: certificatePfxBase64,
          certificate_password: certificatePassword,
          csc_id: cscId,
          csc,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(apiError(payload, 'Não foi possível armazenar as credenciais fiscais.'));
      setProfile(payload as FiscalProfile);
      setCertificateFile(null);
      setCertificatePassword('');
      setCscId('');
      setCsc('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setNotice({ type: 'success', text: 'A1 e CSC validados e armazenados cifrados. Os campos locais foram limpos.' });
      await runPreflight('activation');
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao salvar credenciais fiscais.' });
    } finally {
      setSavingCredentials(false);
    }
  };

  const toggleFiscal = async (enable: boolean) => {
    setChangingEnabled(true);
    setNotice(null);
    try {
      const response = await request(`/api/onboarding/fiscal/${enable ? 'enable' : 'disable'}`, { method: 'POST' });
      const payload = await readJson(response);
      if (!response.ok) {
        const blockedPreflight = payload?.detail?.preflight as FiscalPreflight | undefined;
        if (blockedPreflight) {
          setPreflight(blockedPreflight);
          setPreflightMode(blockedPreflight.mode);
        }
        throw new Error(apiError(payload, enable ? 'Fiscal Preflight bloqueou a ativação.' : 'Não foi possível desativar a emissão fiscal.'));
      }
      if (enable && payload?.profile) {
        setProfile(payload.profile as FiscalProfile);
        setPreflight(payload.preflight as FiscalPreflight);
        setPreflightMode('issuance');
      } else {
        setProfile(payload as FiscalProfile);
        await runPreflight('activation');
      }
      setNotice({ type: 'success', text: enable ? 'Emissão fiscal ativada após preflight verde.' : 'Emissão fiscal desativada.' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao alterar estado fiscal.' });
    } finally {
      setChangingEnabled(false);
    }
  };

  const selectedMunicipality = useMemo(
    () => municipalities.find((item) => item.code === form.municipioCodigoIbge),
    [municipalities, form.municipioCodigoIbge],
  );

  const rtcCheck = preflight?.references.find((item) => item.sourceKey === 'rfb-rtc-calculator-local');
  const activationBlockedByRtc = preflightMode !== 'foundation'
    && Boolean(rtcCheck && (rtcCheck.status !== 'current' || rtcCheck.stale || !rtcCheck.activeSnapshotId));

  if (loading) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-2xl border border-koma-border bg-koma-panel">
        <Loader2 className="animate-spin text-emerald-600" size={22} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <OperationalBanner
        id="fiscal-settings-heading"
        eyebrow="FISCAL CORE"
        title="NFC-e Ceará"
        accent="com preflight"
        description="Configure o estabelecimento, valide A1/CSC e execute os gates oficiais antes de habilitar emissão. Nenhuma referência nova vira regra ativa automaticamente."
        metrics={[
          { label: 'modelo', value: 'NFC-e 65' },
          { label: 'ambiente', value: form.environment === 'producao' ? 'Produção' : 'Homologação' },
          { label: 'emissão', value: profile?.enabled ? 'Ativada' : 'Desativada' },
        ]}
      />

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-[11px] leading-relaxed ${
          notice.type === 'success'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
            : notice.type === 'error'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-100'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100'
        }`}>
          {notice.text}
        </div>
      )}

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TestTube2 size={16} className="text-emerald-600 dark:text-emerald-300" />
              <h3 className="text-sm font-black text-koma-foreground">Teste de prontidão fiscal</h3>
            </div>
            <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-koma-muted">
              Este teste não emite uma nota. Ele prova se cadastro, credenciais e referências oficiais estão aptos para avançar ao próximo estágio.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runPreflight(preflightMode)}
            disabled={runningPreflight}
            className="inline-flex items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-[10px] font-bold text-koma-foreground disabled:opacity-50"
          >
            <RefreshCw size={12} className={runningPreflight ? 'animate-spin' : ''} />
            Revalidar agora
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Etapas do preflight fiscal">
          {([
            ['foundation', 'Base'],
            ['activation', 'Ativação'],
            ['issuance', 'Emissão'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={preflightMode === mode}
              onClick={() => void runPreflight(mode)}
              disabled={runningPreflight}
              className={`rounded-lg border px-3 py-2 text-[10px] font-bold transition-colors ${
                preflightMode === mode
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                  : 'border-koma-border bg-koma-page text-koma-muted hover:text-koma-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {preflight && (
          <>
            <div className={`mb-4 flex items-start gap-3 rounded-xl border p-3 ${statusClass(preflight.ready)}`}>
              {preflight.ready ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
              <div>
                <p className="text-[11px] font-black">{preflight.ready ? 'Preflight verde' : 'Preflight bloqueado'}</p>
                <p className="mt-1 text-[10px] leading-relaxed opacity-80">
                  Perfil: {preflight.profileReady ? 'OK' : 'pendente'} · referências críticas: {preflight.referencesReady ? 'OK' : 'pendentes'} · jurisdição: {preflight.jurisdictionKey || 'não resolvida'}
                </p>
              </div>
            </div>

            {(preflight.issues.length > 0 || preflight.warnings.length > 0) && (
              <div className="mb-4 grid gap-2 lg:grid-cols-2">
                {preflight.issues.map((issue, index) => (
                  <div key={`issue-${issue.code}-${index}`} className="rounded-xl border border-rose-500/25 bg-rose-500/8 p-3 text-rose-900 dark:text-rose-100">
                    <div className="flex items-start gap-2">
                      <XCircle size={14} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] font-black">Bloqueio · {issue.code}</p>
                        <p className="mt-1 text-[10px] leading-relaxed opacity-85">{issue.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
                {preflight.warnings.map((issue, index) => (
                  <div key={`warning-${issue.code}-${index}`} className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 text-amber-900 dark:text-amber-100">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] font-black">Atenção · {issue.code}</p>
                        <p className="mt-1 text-[10px] leading-relaxed opacity-85">{issue.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activationBlockedByRtc && (
              <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-sky-950 dark:text-sky-100">
                <p className="text-[10px] font-black">Dependência oficial pendente: Calculadora RTC</p>
                <p className="mt-1 text-[10px] leading-relaxed opacity-85">
                  O KÔMA mantém a ativação bloqueada até observar a Calculadora oficial da Reforma Tributária em execução e versioná-la. Isso é intencional: não substituímos o componente oficial por fórmulas próprias.
                </p>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-koma-border">
              <table className="w-full min-w-[720px] text-left text-[10px]">
                <thead className="bg-koma-raised text-koma-muted">
                  <tr>
                    <th className="px-3 py-2 font-bold">Fonte observada</th>
                    <th className="px-3 py-2 font-bold">Uso</th>
                    <th className="px-3 py-2 font-bold">Estado</th>
                    <th className="px-3 py-2 font-bold">Ativo</th>
                    <th className="px-3 py-2 font-bold">Observado</th>
                    <th className="px-3 py-2 font-bold">Última verificação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-koma-border">
                  {preflight.references.map((reference) => {
                    const healthy = reference.status === 'current' && !reference.stale && Boolean(reference.activeSnapshotId);
                    return (
                      <tr key={reference.sourceKey} className="bg-koma-panel text-koma-secondary">
                        <td className="px-3 py-2.5">
                          <p className="font-bold text-koma-foreground">{reference.title}</p>
                          <p className="mt-0.5 font-mono text-[9px] text-koma-muted">{reference.sourceKey}</p>
                        </td>
                        <td className="px-3 py-2.5">{reference.blocking ? 'bloqueante' : 'monitoramento'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-bold ${statusClass(healthy)}`}>
                            {healthy ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                            {reference.status}{reference.stale ? ' · stale' : ''}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono">{reference.activeVersion || '—'}<br /><span className="text-[9px] text-koma-muted">{shortId(reference.activeSnapshotId)}</span></td>
                        <td className="px-3 py-2.5 font-mono">{reference.observedVersion || '—'}<br /><span className="text-[9px] text-koma-muted">{shortId(reference.observedSnapshotId)}</span></td>
                        <td className="px-3 py-2.5">{dateLabel(reference.checkedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {preflight.complianceBaseline.length > 0 && (
              <details className="mt-3 rounded-xl border border-koma-border bg-koma-page p-3">
                <summary className="cursor-pointer text-[10px] font-bold text-koma-foreground">Baseline oficial registrada ({preflight.complianceBaseline.length})</summary>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {preflight.complianceBaseline.map((source) => (
                    <a
                      key={source.key}
                      href={source.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-koma-border bg-koma-panel p-3 text-[10px] text-koma-secondary hover:border-emerald-500/40"
                    >
                      <p className="font-bold text-koma-foreground">{source.title}</p>
                      <p className="mt-1">Versão {source.version} · verificada em {source.verifiedOn}</p>
                    </a>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </section>

      <form onSubmit={saveProfile} className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
            <ShieldCheck size={17} />
          </div>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Estabelecimento fiscal</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">Dados usados pelo emissor. Salvar qualquer alteração desativa emissão até uma nova ativação.</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-[10px] font-bold text-koma-secondary">CNPJ
            <input value={form.cnpj} onChange={(e) => setField('cnpj', e.target.value.toUpperCase())} autoCapitalize="characters" required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">IE / CGF
            <input value={form.inscricaoEstadual} onChange={(e) => setField('inscricaoEstadual', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">CRT
            <select value={form.crt} onChange={(e) => setField('crt', e.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground">
              <option value="1">1 · Simples Nacional</option>
              <option value="2">2 · Simples Nacional — excesso</option>
              <option value="3">3 · Regime Normal</option>
              <option value="4">4 · MEI</option>
            </select>
          </label>
          <label className="text-[10px] font-bold text-koma-secondary md:col-span-2">Razão social
            <input value={form.razaoSocial} onChange={(e) => setField('razaoSocial', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">Nome fantasia
            <input value={form.nomeFantasia} onChange={(e) => setField('nomeFantasia', e.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">CNAE principal
            <input value={form.cnaePrincipal} onChange={(e) => setField('cnaePrincipal', e.target.value.replace(/\D/g, '').slice(0, 7))} inputMode="numeric" required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">Ambiente
            <select value={form.environment} onChange={(e) => setField('environment', e.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground">
              <option value="homologacao">Homologação</option>
              <option value="producao">Produção</option>
            </select>
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">Série NFC-e
            <input value={form.series} onChange={(e) => setField('series', e.target.value.replace(/\D/g, ''))} inputMode="numeric" min="1" required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">CEP
            <input value={form.cep} onChange={(e) => setField('cep', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary md:col-span-2">Logradouro
            <input value={form.logradouro} onChange={(e) => setField('logradouro', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">Número
            <input value={form.numero} onChange={(e) => setField('numero', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">Complemento
            <input value={form.complemento} onChange={(e) => setField('complemento', e.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">Bairro
            <input value={form.bairro} onChange={(e) => setField('bairro', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary md:col-span-2">Município oficial IBGE
            <select value={form.municipioCodigoIbge} onChange={(e) => setField('municipioCodigoIbge', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground">
              {municipalities.map((municipality) => <option key={municipality.code} value={municipality.code}>{municipality.name} · {municipality.code}</option>)}
            </select>
          </label>
          <div className="self-end rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[10px] text-koma-muted">UF: CE · {selectedMunicipality?.name || 'município pendente'}</div>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <button type="submit" disabled={savingProfile} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[10px] font-black text-white disabled:opacity-50">
            {savingProfile ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Salvar perfil fiscal
          </button>
        </div>
      </form>

      <form onSubmit={saveCredentials} className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300"><FileKey2 size={17} /></div>
            <div>
              <h3 className="text-sm font-black text-koma-foreground">Certificado A1 e CSC</h3>
              <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-koma-muted">O arquivo é validado no backend e guardado cifrado. Senha e CSC não são devolvidos pela API nem persistidos no navegador.</p>
            </div>
          </div>
          <div className="flex gap-2 text-[9px] font-bold">
            <span className={`rounded-full border px-2 py-1 ${statusClass(Boolean(profile?.certificateConfigured))}`}>A1 {profile?.certificateConfigured ? 'configurado' : 'pendente'}</span>
            <span className={`rounded-full border px-2 py-1 ${statusClass(Boolean(profile?.cscConfigured))}`}>CSC {profile?.cscConfigured ? 'configurado' : 'pendente'}</span>
          </div>
        </div>

        {profile?.certificateConfigured && (
          <div className="mb-4 grid gap-2 rounded-xl border border-koma-border bg-koma-page p-3 text-[10px] text-koma-muted md:grid-cols-2">
            <p>Fingerprint SHA-256: <span className="font-mono text-koma-foreground">{shortId(profile.certificateFingerprint)}</span></p>
            <p>Validade: <span className="text-koma-foreground">{dateLabel(profile.certificateExpiresAt)}</span></p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-[10px] font-bold text-koma-secondary">Arquivo A1 (.pfx / .p12)
            <input ref={fileInputRef} type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e) => setCertificateFile(e.target.files?.[0] ?? null)} required className="mt-1 block w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[10px] text-koma-foreground file:mr-3 file:rounded-md file:border-0 file:bg-koma-raised file:px-2 file:py-1 file:text-[9px] file:font-bold file:text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">Senha do A1
            <input type="password" autoComplete="new-password" value={certificatePassword} onChange={(e) => setCertificatePassword(e.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">ID do CSC
            <input value={cscId} onChange={(e) => setCscId(e.target.value.slice(0, 16))} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
          <label className="text-[10px] font-bold text-koma-secondary">CSC
            <input type="password" autoComplete="new-password" value={csc} onChange={(e) => setCsc(e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-[11px] text-koma-foreground" />
          </label>
        </div>

        <p className="mt-3 text-[9px] leading-relaxed text-amber-800 dark:text-amber-200">Não cole A1, senha ou CSC em chat, ticket ou commit. Use somente este formulário autenticado no ambiente correto.</p>

        <div className="mt-4 flex items-center justify-end">
          <button type="submit" disabled={savingCredentials || !profile?.id} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[10px] font-black text-white disabled:opacity-50">
            {savingCredentials ? <Loader2 size={12} className="animate-spin" /> : <FileKey2 size={12} />}
            Validar e armazenar cifrado
          </button>
        </div>
      </form>

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${statusClass(Boolean(profile?.enabled))}`}>
              {profile?.enabled ? <BadgeCheck size={17} /> : <Ban size={17} />}
            </div>
            <div>
              <h3 className="text-sm font-black text-koma-foreground">Ativação fiscal</h3>
              <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
                {profile?.enabled
                  ? 'Emissão habilitada. O preflight de emissão continua sendo executado antes de qualquer numeração fiscal.'
                  : 'Emissão desabilitada. Para ativar, o preflight de ativação precisa estar 100% verde.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={changingEnabled || !profile?.id}
            onClick={() => void toggleFiscal(!profile?.enabled)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-black text-white disabled:opacity-50 ${profile?.enabled ? 'bg-rose-600' : 'bg-emerald-600'}`}
          >
            {changingEnabled ? <Loader2 size={12} className="animate-spin" /> : profile?.enabled ? <Ban size={12} /> : <BadgeCheck size={12} />}
            {profile?.enabled ? 'Desativar emissão' : 'Executar preflight e ativar'}
          </button>
        </div>
      </section>
    </div>
  );
}
