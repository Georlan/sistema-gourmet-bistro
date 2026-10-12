import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';
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
import { CashierFiscalProducts } from './CashierFiscalProducts';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

type FiscalStep = 'profile' | 'credentials' | 'review';

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
  crt: '',
  cnaePrincipal: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  municipioCodigoIbge: '',
  series: '1',
  environment: 'homologacao',
};

function profileToForm(profile: FiscalProfile | null): FiscalProfileForm {
  if (!profile?.id) return { ...EMPTY_PROFILE };
  return {
    cnpj: profile.cnpj ?? '',
    inscricaoEstadual: profile.inscricaoEstadual ?? '',
    razaoSocial: profile.razaoSocial ?? '',
    nomeFantasia: profile.nomeFantasia ?? '',
    crt: profile.crt ?? '',
    cnaePrincipal: profile.cnaePrincipal ?? '',
    cep: profile.enderecoFiscal?.cep ?? '',
    logradouro: profile.enderecoFiscal?.logradouro ?? '',
    numero: profile.enderecoFiscal?.numero ?? '',
    complemento: profile.enderecoFiscal?.complemento ?? '',
    bairro: profile.enderecoFiscal?.bairro ?? '',
    municipioCodigoIbge: profile.municipioCodigoIbge ?? profile.enderecoFiscal?.municipio_codigo_ibge ?? '',
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
  const [activeStep, setActiveStep] = useState<FiscalStep>('profile');
  const [profile, setProfile] = useState<FiscalProfile | null>(null);
  const [form, setForm] = useState<FiscalProfileForm>({ ...EMPTY_PROFILE });
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [preflight, setPreflight] = useState<FiscalPreflight | null>(null);
  const [preflightMode, setPreflightMode] = useState<PreflightMode>('foundation');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [runningPreflight, setRunningPreflight] = useState(false);
  const [changingEnabled, setChangingEnabled] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [editingCredentials, setEditingCredentials] = useState(false);
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

  const runPreflight = useCallback(async (mode: PreflightMode) => {
    setRunningPreflight(true);
    try {
      const response = await request(`/api/onboarding/fiscal/preflight?mode=${mode}`);
      const payload = await readJson(response);
      if (!response.ok) throw new Error(apiError(payload, 'Falha ao executar o Fiscal Preflight.'));
      setPreflight(payload as FiscalPreflight);
      setPreflightMode(mode);
      return payload as FiscalPreflight;
    } catch (error) {
      setPreflight(null);
      throw error;
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
      setActiveStep(nextProfile.id ? (nextProfile.certificateConfigured && nextProfile.cscConfigured ? 'review' : 'credentials') : 'profile');
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

  const profileFormReady = useMemo(() => Boolean(
    form.cnpj.trim()
    && form.inscricaoEstadual.trim()
    && form.razaoSocial.trim()
    && form.crt
    && /^\d{7}$/.test(form.cnaePrincipal)
    && form.cep.trim()
    && form.logradouro.trim()
    && form.numero.trim()
    && form.bairro.trim()
    && form.municipioCodigoIbge
    && Number(form.series) >= 1
  ), [form]);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.crt) {
      setNotice({ type: 'error', text: 'Selecione explicitamente o CRT cadastrado do estabelecimento.' });
      return;
    }
    if (!form.municipioCodigoIbge) {
      setNotice({ type: 'error', text: 'Selecione explicitamente o município fiscal na lista oficial do IBGE.' });
      return;
    }
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
      setNotice({ type: 'success', text: 'Dados da empresa salvos. Agora confira o certificado e o código de segurança.' });
      setActiveStep('credentials');
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
      setEditingCredentials(false);
      setCertificateFile(null);
      setCertificatePassword('');
      setCscId('');
      setCsc('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setNotice({ type: 'success', text: 'Certificado e código de segurança salvos com proteção. Confira as pendências na próxima etapa.' });
      setActiveStep('review');
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
      setNotice({ type: 'success', text: enable ? 'Preparação fiscal habilitada. Esta ação não emite uma nota.' : 'Preparação fiscal desabilitada.' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Falha ao alterar estado fiscal.' });
    } finally {
      setChangingEnabled(false);
    }
  };

  const checkReadiness = async (mode: PreflightMode) => {
    setNotice(null);
    try {
      await runPreflight(mode);
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Não foi possível conferir a configuração. Tente novamente.' });
    }
  };

  const selectedMunicipality = useMemo(
    () => municipalities.find((item) => item.code === form.municipioCodigoIbge),
    [municipalities, form.municipioCodigoIbge],
  );

  const rtcCheck = preflight?.references.find((item) => item.sourceKey === 'rfb-rtc-calculator-local');
  const activationBlockedByRtc = preflightMode !== 'foundation'
    && Boolean(rtcCheck && (rtcCheck.status !== 'current' || rtcCheck.stale || !rtcCheck.activeSnapshotId));

  const credentialsConfigured = Boolean(profile?.certificateConfigured && profile?.cscConfigured);
  const certificateExpiry = profile?.certificateExpiresAt ? Date.parse(profile.certificateExpiresAt) : NaN;
  const certificateExpired = Number.isFinite(certificateExpiry) && certificateExpiry <= Date.now();
  const nextStep: FiscalStep = !profile?.id ? 'profile' : !credentialsConfigured || certificateExpired ? 'credentials' : 'review';
  const nextAction = {
    profile: ['Comece pelos dados da empresa', 'Use o cadastro oficial e confirme o regime tributário com o responsável fiscal.', 'Preencher cadastro'],
    credentials: [certificateExpired ? 'Atualize o certificado vencido' : 'Confira o certificado e o CSC', 'Use as credenciais do restaurante e do ambiente escolhido.', 'Conferir credenciais'],
    review: ['Confira as pendências', 'Revise o cadastro e as verificações do sistema antes da etapa de integração.', 'Revisar pendências'],
  }[nextStep];

  if (loading) {
    return (
      <div role="status" aria-label="Carregando configuração fiscal" className="flex min-h-56 items-center justify-center rounded-2xl border border-koma-border bg-koma-panel">
        <Loader2 className="animate-spin text-emerald-600" size={22} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <CashierFiscalProducts apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-koma-foreground">Configuração fiscal</h1>
          <p className="mt-1 text-sm text-koma-muted">Prepare os dados do restaurante para a emissão de notas no Ceará.</p>
        </div>
        <span className="rounded-full border border-koma-border bg-koma-raised px-3 py-1.5 text-xs font-bold text-koma-secondary">
          {profile?.environment === 'producao' ? 'Ambiente de produção' : 'Ambiente de testes'}
        </span>
      </header>

      <section aria-label="Resumo fiscal do restaurante" className="rounded-xl border border-koma-border bg-koma-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-koma-foreground">{profile?.razaoSocial || 'Cadastro do restaurante'}</h2>
            <p className="mt-1 text-xs text-koma-muted">{profile?.id ? `Série NFC-e ${profile.series ?? 'não informada'} · Ceará` : 'Dados fiscais ainda não salvos'}</p>
          </div>
          <span className="rounded-full border border-amber-500/30 px-2 py-1 text-xs font-bold text-amber-900 dark:text-amber-200">Emissão em preparação</span>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-xs">
          <div><dt className="text-koma-muted">Cadastro da empresa</dt><dd className="mt-1 font-bold text-koma-foreground">{profile?.id ? 'Salvo' : 'Pendente'}</dd></div>
          <div><dt className="text-koma-muted">Certificado A1</dt><dd className="mt-1 font-bold text-koma-foreground">{certificateExpired ? 'Vencido — precisa atualizar' : profile?.certificateConfigured ? 'Armazenado' : 'Pendente'}</dd></div>
          <div><dt className="text-koma-muted">Código de segurança (CSC)</dt><dd className="mt-1 font-bold text-koma-foreground">{profile?.cscConfigured ? 'Armazenado com proteção' : 'Pendente'}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-koma-border pt-4">
          <div><p className="text-sm font-bold text-koma-foreground">{nextAction[0]}</p><p className="mt-1 text-xs text-koma-muted">{nextAction[1]}</p></div>
          <button type="button" onClick={() => setActiveStep(nextStep)} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white">{nextAction[2]}</button>
        </div>
      </section>

      <nav aria-label="Etapas da configuração fiscal" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {([
          ['profile', '1', 'Dados da empresa', Boolean(profile?.id), 'Preencha o cadastro fiscal'],
          ['credentials', '2', 'Certificado e segurança', credentialsConfigured && !certificateExpired, 'Informe A1 e CSC'],
          ['review', '3', 'Conferência', Boolean(preflight?.ready), 'Veja o que falta para avançar'],
        ] as const).map(([step, number, label, complete, description]) => (
          <button key={step} type="button" aria-current={activeStep === step ? 'step' : undefined}
            aria-controls={`fiscal-step-${step}`} onClick={() => setActiveStep(step)}
            className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${activeStep === step ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-koma-border bg-koma-panel hover:bg-koma-raised'}`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-koma-border text-sm font-bold text-koma-foreground">{complete ? <CheckCircle2 size={16} /> : number}</span>
            <span><span className="block text-sm font-bold text-koma-foreground">{label}</span><span className="mt-0.5 block text-xs text-koma-muted">{complete ? 'Etapa configurada' : description}</span></span>
          </button>
        ))}
      </nav>

      {notice && (
        <div role={notice.type === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${
          notice.type === 'success'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
            : notice.type === 'error'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-100'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100'
        }`}>
          {notice.text}
        </div>
      )}

      <form id="fiscal-step-profile" hidden={activeStep !== 'profile'} onSubmit={saveProfile} className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300">
            <ShieldCheck size={17} />
          </div>
          <div>
            <h3 className="text-sm font-black text-koma-foreground">Dados da empresa</h3>
            <p className="mt-1 text-xs leading-relaxed text-koma-muted">Use os dados do cadastro oficial. Campos sem indicação de opcional são obrigatórios. Alterações salvas desabilitam a preparação fiscal anterior.</p>
          </div>
        </div>

        {!profile?.id && (
          <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
            O regime tributário (CRT) e o município não são inferidos nem pré-selecionados pelo KÔMA. Confirme essas informações com o responsável fiscal.
          </div>
        )}

        <fieldset>
          <legend className="mb-3 text-sm font-bold text-koma-foreground">Identificação e tributação</legend>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-xs font-bold text-koma-secondary">CNPJ
            <input value={form.cnpj} onChange={(e) => setField('cnpj', e.target.value.toUpperCase())} autoCapitalize="characters" required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary">Inscrição estadual (IE / CGF)
            <input value={form.inscricaoEstadual} onChange={(e) => setField('inscricaoEstadual', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary">Regime tributário (CRT)
            <select value={form.crt} onChange={(e) => setField('crt', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground">
              <option value="" disabled>Selecione o CRT cadastrado</option>
              <option value="1">1 · Simples Nacional</option>
              <option value="2">2 · Simples Nacional — excesso</option>
              <option value="3">3 · Regime Normal</option>
              <option value="4">4 · MEI</option>
            </select>
          </label>
          <label className="text-xs font-bold text-koma-secondary md:col-span-2">Razão social
            <input value={form.razaoSocial} onChange={(e) => setField('razaoSocial', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary">Nome fantasia (opcional)
            <input value={form.nomeFantasia} onChange={(e) => setField('nomeFantasia', e.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary">CNAE principal
            <input value={form.cnaePrincipal} onChange={(e) => setField('cnaePrincipal', e.target.value.replace(/\D/g, '').slice(0, 7))} inputMode="numeric" required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
        </div>
        </fieldset>
        <fieldset className="mt-5">
          <legend className="mb-3 text-sm font-bold text-koma-foreground">Endereço fiscal</legend>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-xs font-bold text-koma-secondary">CEP
            <input value={form.cep} onChange={(e) => setField('cep', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary md:col-span-2">Rua ou avenida
            <input value={form.logradouro} onChange={(e) => setField('logradouro', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary">Número
            <input value={form.numero} onChange={(e) => setField('numero', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary">Complemento (opcional)
            <input value={form.complemento} onChange={(e) => setField('complemento', e.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary">Bairro
            <input value={form.bairro} onChange={(e) => setField('bairro', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary md:col-span-2">Município fiscal
            <select value={form.municipioCodigoIbge} onChange={(e) => setField('municipioCodigoIbge', e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground">
              <option value="" disabled>Selecione o município fiscal</option>
              {municipalities.map((municipality) => <option key={municipality.code} value={municipality.code}>{municipality.name} · {municipality.code}</option>)}
            </select>
          </label>
          <div className="self-end rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-xs text-koma-muted">UF: CE · {selectedMunicipality?.name || 'município pendente'}</div>
        </div>

        </fieldset>
        <details className="mt-5 rounded-xl border border-koma-border bg-koma-page p-3">
          <summary className="cursor-pointer text-sm font-bold text-koma-foreground">Ambiente e série da nota</summary>
          <p className="mt-2 text-xs text-koma-muted">Use o ambiente do seu certificado e CSC. Confirme a série com o responsável fiscal antes de alterar.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold text-koma-secondary">Ambiente de emissão
            <select value={form.environment} onChange={(e) => setField('environment', e.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground">
              <option value="homologacao">Testes (homologação)</option>
              <option value="producao">Produção</option>
            </select>
          </label>
          <label className="text-xs font-bold text-koma-secondary">Série NFC-e
            <input value={form.series} onChange={(e) => setField('series', e.target.value.replace(/\D/g, ''))} inputMode="numeric" min="1" required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          </div>
        </details>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-relaxed text-koma-muted">
            Preencha os campos obrigatórios para continuar. Confirme o enquadramento com o responsável fiscal.
          </p>
          <button type="submit" disabled={savingProfile || !profileFormReady} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
            {savingProfile ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Salvar e continuar
          </button>
        </div>
      </form>

      <form id="fiscal-step-credentials" hidden={activeStep !== 'credentials'} onSubmit={saveCredentials} className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-raised text-emerald-600 dark:text-emerald-300"><FileKey2 size={17} /></div>
            <div>
              <h3 className="text-sm font-black text-koma-foreground">Certificado e código de segurança</h3>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-koma-muted">O certificado A1 identifica a empresa. O CSC é o código de segurança da NFC-e fornecido pela SEFAZ. Os dados são guardados com proteção.</p>
            </div>
          </div>
          <div className="flex gap-2 text-xs font-bold">
            <span className={`rounded-full border px-2 py-1 ${statusClass(Boolean(profile?.certificateConfigured))}`}>A1 {profile?.certificateConfigured ? 'configurado' : 'pendente'}</span>
            <span className={`rounded-full border px-2 py-1 ${statusClass(Boolean(profile?.cscConfigured))}`}>CSC {profile?.cscConfigured ? 'configurado' : 'pendente'}</span>
          </div>
        </div>

        {!profile?.id && <p className="mb-4 text-sm text-koma-muted">Salve os dados da empresa na etapa 1 antes de enviar o certificado.</p>}
        {profile?.certificateConfigured && (
          <div className="mb-4 grid gap-2 rounded-xl border border-koma-border bg-koma-page p-3 text-xs text-koma-muted md:grid-cols-2">
            <p>Identificação do certificado: <span className="font-mono text-koma-foreground">{shortId(profile.certificateFingerprint)}</span></p>
            <p>Validade: <span className="text-koma-foreground">{dateLabel(profile.certificateExpiresAt)}</span></p>
          </div>
        )}

        {credentialsConfigured && !editingCredentials && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-koma-border bg-koma-page p-4">
            <div><p className="text-sm font-bold text-koma-foreground">Credenciais já armazenadas</p><p className="mt-1 text-xs text-koma-muted">Não é necessário enviar novamente para conferir a configuração.</p></div>
            <button type="button" onClick={() => setEditingCredentials(true)} className="rounded-lg border border-koma-border px-3 py-2 text-sm font-bold text-koma-foreground">Substituir certificado e CSC</button>
          </div>
        )}
        <div hidden={credentialsConfigured && !editingCredentials}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold text-koma-secondary">Certificado A1 (.pfx / .p12)
            <input ref={fileInputRef} type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e) => setCertificateFile(e.target.files?.[0] ?? null)} required className="mt-1 block w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-xs text-koma-foreground file:mr-3 file:rounded-md file:border-0 file:bg-koma-raised file:px-2 file:py-1 file:text-xs file:font-bold file:text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary">Senha do certificado (se houver)
            <input type="password" autoComplete="new-password" value={certificatePassword} onChange={(e) => setCertificatePassword(e.target.value)} className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary">Identificador do CSC
            <input value={cscId} onChange={(e) => setCscId(e.target.value.slice(0, 16))} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
          <label className="text-xs font-bold text-koma-secondary">Código de segurança (CSC)
            <input type="password" autoComplete="new-password" value={csc} onChange={(e) => setCsc(e.target.value)} required className="mt-1 w-full rounded-lg border border-koma-border bg-koma-page px-3 py-2 text-sm text-koma-foreground" />
          </label>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">Envie o certificado e o código do ambiente escolhido. Nunca compartilhe a senha ou o CSC por mensagens.</p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setActiveStep('profile')} className="rounded-lg border border-koma-border px-3 py-2 text-sm font-bold text-koma-secondary">Voltar aos dados da empresa</button>
          <button type="submit" disabled={savingCredentials || !profile?.id} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">
            {savingCredentials ? <Loader2 size={12} className="animate-spin" /> : <FileKey2 size={12} />}
            Salvar e conferir
          </button>
        </div>
        </div>
        {credentialsConfigured && !editingCredentials && (
          <div className="mt-4 flex justify-end"><button type="button" onClick={() => setActiveStep('review')} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white">Continuar para conferência</button></div>
        )}
      </form>

      <section id="fiscal-step-review" hidden={activeStep !== 'review'} className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TestTube2 size={16} className="text-emerald-600 dark:text-emerald-300" />
              <h3 className="text-sm font-black text-koma-foreground">Conferir configuração</h3>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-koma-muted">
              Esta conferência não emite uma nota. Ela identifica dados pendentes e verificações necessárias para preparar o restaurante.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void checkReadiness(preflightMode)}
            disabled={runningPreflight}
            className="inline-flex items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-xs font-bold text-koma-foreground disabled:opacity-50"
          >
            <RefreshCw size={12} className={runningPreflight ? 'animate-spin' : ''} />
            Conferir novamente
          </button>
        </div>

        {preflight && (
          <>
            <div className={`mb-4 flex items-start gap-3 rounded-xl border p-3 ${statusClass(preflight.ready)}`}>
              {preflight.ready ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
              <div>
                <p className="text-sm font-black">{preflight.ready ? 'Conferência concluída' : 'Há pendências na configuração'}</p>
                <p className="mt-1 text-xs leading-relaxed opacity-80">
                  Cadastro: {preflight.profileReady ? 'conferido' : 'pendente'} · verificações do sistema: {preflight.referencesReady ? 'conferidas' : 'pendentes'}. Esta etapa não comprova emissão autorizada.
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
                        <p className="text-xs font-black">{issue.sourceKey ? 'Verificação do sistema pendente' : 'Dados do restaurante pendentes'}</p>
                        <p className="mt-1 text-xs leading-relaxed opacity-85">{issue.message}</p>
                        {!issue.sourceKey && <button type="button" onClick={() => setActiveStep(/certificate|csc/.test(issue.code) ? 'credentials' : 'profile')} className="mt-2 rounded-lg border border-current px-2 py-1 text-xs font-bold">{/certificate|csc/.test(issue.code) ? 'Revisar credenciais' : 'Revisar cadastro'}</button>}
                        {issue.sourceKey && <p className="mt-2 text-xs">Esta verificação precisa ser revisada pela equipe do KÔMA.</p>}
                      </div>
                    </div>
                  </div>
                ))}
                {preflight.warnings.map((issue, index) => (
                  <div key={`warning-${issue.code}-${index}`} className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 text-amber-900 dark:text-amber-100">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-black">Aviso para revisão</p>
                        <p className="mt-1 text-xs leading-relaxed opacity-85">{issue.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <details className="rounded-xl border border-koma-border bg-koma-page p-3">
              <summary className="cursor-pointer text-xs font-bold text-koma-foreground">Detalhes técnicos e fontes oficiais</summary>
              <div className="mt-4 space-y-3">
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
                      onClick={() => void checkReadiness(mode)}
                      disabled={runningPreflight}
                      className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                        preflightMode === mode
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                          : 'border-koma-border bg-koma-page text-koma-muted hover:text-koma-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

            {activationBlockedByRtc && (
              <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-sky-950 dark:text-sky-100">
                <p className="text-xs font-black">Dependência oficial pendente: Calculadora RTC</p>
                <p className="mt-1 text-xs leading-relaxed opacity-85">
                  Esta verificação depende de uma configuração técnica do KÔMA. Peça à equipe responsável para revisar a disponibilidade e a regra aplicável ao restaurante.
                </p>
              </div>
            )}

            {preflight.references.length > 0 && <div className="overflow-x-auto rounded-xl border border-koma-border">
              <table className="w-full min-w-[720px] text-left text-xs">
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
                          <p className="mt-0.5 font-mono text-xs text-koma-muted">{reference.sourceKey}</p>
                        </td>
                        <td className="px-3 py-2.5">{reference.blocking ? 'bloqueante' : 'monitoramento'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 font-bold ${statusClass(healthy)}`}>
                            {healthy ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                            {({ current: 'Atualizada', changed: 'Revisão necessária', error: 'Falha na consulta', missing: 'Pendente' } as Record<string, string>)[reference.status] || 'Revisão necessária'}{reference.stale ? ' · checagem vencida' : ''}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono">{reference.activeVersion || '—'}<br /><span className="text-xs text-koma-muted">{shortId(reference.activeSnapshotId)}</span></td>
                        <td className="px-3 py-2.5 font-mono">{reference.observedVersion || '—'}<br /><span className="text-xs text-koma-muted">{shortId(reference.observedSnapshotId)}</span></td>
                        <td className="px-3 py-2.5">{dateLabel(reference.checkedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}

            {preflight.complianceBaseline.length > 0 && (
              <details className="mt-3 rounded-xl border border-koma-border bg-koma-page p-3">
                <summary className="cursor-pointer text-xs font-bold text-koma-foreground">Referências oficiais registradas ({preflight.complianceBaseline.length})</summary>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {preflight.complianceBaseline.map((source) => (
                    <a
                      key={source.key}
                      href={source.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-koma-border bg-koma-panel p-3 text-xs text-koma-secondary hover:border-emerald-500/40"
                    >
                      <p className="font-bold text-koma-foreground">{source.title}</p>
                      <p className="mt-1">Versão {source.version} · verificada em {source.verifiedOn}</p>
                    </a>
                  ))}
                </div>
              </details>
            )}
              </div>
            </details>
          </>
        )}
      </section>

      <details className="rounded-xl border border-koma-border bg-koma-panel p-4">
        <summary className="cursor-pointer text-sm font-bold text-koma-foreground">Como vamos chegar à emissão de notas</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-koma-secondary">
          <li>Preparar cadastro, certificado e código de segurança — disponível nesta tela.</li>
          <li>Conferir a tributação dos produtos com o responsável fiscal.</li>
          <li>Integrar notas e pagamentos, testar autorização e recuperação de falhas.</li>
          <li>Disponibilizar notas, XMLs e fechamento para o contador.</li>
        </ol>
        <p className="mt-3 text-xs text-koma-muted">As etapas 2 a 4 ainda não estão disponíveis nesta configuração. Cadastro salvo e pagamento recebido não significam nota autorizada.</p>
        <p className="mt-3 text-sm font-bold text-koma-foreground">Já emite notas em outro sistema?</p>
        <p className="mt-1 text-sm text-koma-secondary">Continue usando o emissor atual até a integração do KÔMA estar validada. A migração deve conferir série e numeração com o responsável fiscal para evitar duplicidade.</p>
      </details>

      <details hidden={activeStep !== 'review'} className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5">
        <summary className="cursor-pointer text-sm font-bold text-koma-foreground">Controles da preparação fiscal</summary>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${statusClass(Boolean(profile?.enabled))}`}>
              {profile?.enabled ? <BadgeCheck size={17} /> : <Ban size={17} />}
            </div>
            <div>
              <h3 className="text-sm font-black text-koma-foreground">Preparação fiscal</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-koma-muted">
                {profile?.enabled
                  ? 'Configuração habilitada para as verificações internas. A integração da emissão continua em preparação; este status não significa nota autorizada pela SEFAZ.'
                  : 'Habilite a configuração somente após resolver as pendências. Esta ação não emite uma nota nem comprova integração dos pagamentos.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={changingEnabled || !profile?.id}
            onClick={() => void toggleFiscal(!profile?.enabled)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black text-white disabled:opacity-50 ${profile?.enabled ? 'bg-rose-600' : 'bg-emerald-600'}`}
          >
            {changingEnabled ? <Loader2 size={12} className="animate-spin" /> : profile?.enabled ? <Ban size={12} /> : <BadgeCheck size={12} />}
            {profile?.enabled ? 'Desabilitar configuração' : 'Conferir e habilitar configuração'}
          </button>
        </div>
      </details>
    </div>
  );
}
