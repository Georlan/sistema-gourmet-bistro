import React, { useCallback, useEffect, useState } from 'react';
import { superAdminFetch } from './superAdminApi';
import { SuperAdminHomologationReadiness } from './SuperAdminHomologationReadiness';

type Signup = {
  id: string;
  restaurant_name: string;
  responsible_name: string;
  email: string;
  phone: string;
  plan: string;
  billing_cycle: string;
  status: string;
  inactive: boolean;
  updated_at: string;
  protocol: string | null;
};

type DeliveryFailure = {
  id: string;
  status: string;
  attempts: number;
  last_error?: string;
};

type CatalogAssistanceItem = {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  filename: string;
  content_type: string;
  file_size: number;
  status: 'pending' | 'processing' | string;
  created_at: string | null;
  updated_at: string | null;
};

const labels: Record<string, string> = {
  started: 'Cadastro iniciado',
  payment_pending: 'Autorização pendente',
  payment_failed: 'Autorização recusada',
  awaiting_release: 'Aguardando liberação',
  activated: 'Acesso liberado',
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function SuperAdminSignupsTab({ globalSearch }: { globalSearch: string }) {
  const [items, setItems] = useState<Signup[]>([]);
  const [deliveryFailures, setDeliveryFailures] = useState<DeliveryFailure[]>([]);
  const [catalogRequests, setCatalogRequests] = useState<CatalogAssistanceItem[]>([]);
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');
  const [releasingProtocol, setReleasingProtocol] = useState<string | null>(null);
  const [reissuingProtocol, setReissuingProtocol] = useState<string | null>(null);
  const [catalogBusyId, setCatalogBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await superAdminFetch('/api/super-admin/signups', { signal });
      if (!response.ok) throw new Error('Não foi possível carregar as inscrições.');
      const data = await response.json();
      setItems(data.items);
      setError('');

      const deliveryResponse = await superAdminFetch('/api/super-admin/signups/deliveries', { signal });
      if (deliveryResponse.ok) {
        const deliveries = await deliveryResponse.json();
        setDeliveryFailures(
          deliveries.items.filter((item: DeliveryFailure) => item.status === 'failed' || item.last_error),
        );
      }

      const catalogResponse = await superAdminFetch('/api/super-admin/catalog-assistance', { signal });
      if (catalogResponse.ok) {
        const catalogPayload = await catalogResponse.json();
        setCatalogRequests(catalogPayload.items || []);
      }
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Falha ao carregar inscrições.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 60000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  const visible = items.filter(item => (
    filter === 'all' || (filter === 'inactive' ? item.inactive : item.status === filter)
  ) && `${item.restaurant_name} ${item.responsible_name} ${item.email} ${item.phone}`
    .toLowerCase()
    .includes(globalSearch.toLowerCase()));

  const retryDelivery = async (deliveryId: string) => {
    try {
      const response = await superAdminFetch(
        `/api/super-admin/signups/deliveries/${encodeURIComponent(deliveryId)}/retry`,
        { method: 'POST' },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reagendar.');
    }
  };

  const releaseSignup = async (protocol: string) => {
    setReleasingProtocol(protocol);
    setError('');
    setSuccessNotice('');
    try {
      const response = await superAdminFetch(
        `/api/super-admin/signups/${encodeURIComponent(protocol)}/release`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Liberação manual de inscrição confirmada pelo SuperAdmin' }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Falha ao liberar inscrição.');
      setSuccessNotice(
        `Inscrição ${protocol} liberada. Restaurante #${data.restaurant_id} entrou em implantação; os 7 dias grátis ainda não começaram.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao liberar inscrição.');
    } finally {
      setReleasingProtocol(null);
    }
  };

  const reissueActivationInvite = async (protocol: string) => {
    setReissuingProtocol(protocol);
    setError('');
    setSuccessNotice('');
    try {
      const response = await superAdminFetch(
        `/api/super-admin/signups/${encodeURIComponent(protocol)}/activation-invite`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Reemissão do convite inicial solicitada pelo SuperAdmin' }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Falha ao reemitir convite.');
      setSuccessNotice(
        `Novo convite de primeiro acesso agendado para a inscrição ${protocol}. O link anterior foi invalidado.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reemitir convite.');
    } finally {
      setReissuingProtocol(null);
    }
  };

  const markCatalogProcessing = async (item: CatalogAssistanceItem) => {
    if (item.status === 'processing') return;
    const response = await superAdminFetch(
      `/api/super-admin/catalog-assistance/${encodeURIComponent(item.restaurant_id)}/${encodeURIComponent(item.id)}/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'processing',
          reason: 'Arquivo-fonte baixado pelo SuperAdmin para preparação assistida do cardápio.',
        }),
      },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || 'Não foi possível marcar o cardápio como em preparação.');
    }
  };

  const downloadCatalogSource = async (item: CatalogAssistanceItem) => {
    setCatalogBusyId(item.id);
    setError('');
    try {
      const response = await superAdminFetch(
        `/api/super-admin/catalog-assistance/${encodeURIComponent(item.restaurant_id)}/${encodeURIComponent(item.id)}/file`,
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Não foi possível baixar o arquivo do cardápio.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      await markCatalogProcessing(item);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao baixar o cardápio.');
    } finally {
      setCatalogBusyId(null);
    }
  };

  const publishCatalogJson = async (item: CatalogAssistanceItem, file?: File) => {
    if (!file) return;
    setCatalogBusyId(item.id);
    setError('');
    setSuccessNotice('');
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!Array.isArray(parsed) && (!parsed || typeof parsed !== 'object')) {
        throw new Error('O JSON revisado deve ser uma lista de produtos ou um objeto com categories/products.');
      }
      const response = await superAdminFetch(
        `/api/super-admin/catalog-assistance/${encodeURIComponent(item.restaurant_id)}/${encodeURIComponent(item.id)}/publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalog: parsed,
            reason: 'Cardápio estruturado com apoio de IA e revisado pelo operador antes da publicação.',
            confirm: true,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível publicar o cardápio revisado.');
      setSuccessNotice(
        `Cardápio assistido publicado em ${item.restaurant_name}: ${data.products_imported} produto(s) importado(s).`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao publicar o cardápio revisado.');
    } finally {
      setCatalogBusyId(null);
    }
  };

  return <>
    <SuperAdminHomologationReadiness />

    <section className="mb-5 rounded-xl border border-zinc-800 bg-koma-surface p-5 text-koma-foreground">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Cardápios para implantação</h2>
          <p className="my-2 max-w-3xl text-sm text-koma-muted">
            O restaurante envia PDF ou foto. Baixe a fonte, use a IA para estruturar o cardápio, revise nomes e preços e publique aqui o JSON interno. O cliente não precisa lidar com JSON.
          </p>
        </div>
        <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-semibold">
          {catalogRequests.length} pendente(s)
        </span>
      </div>

      {catalogRequests.length === 0
        ? <p className="mt-4 text-sm text-koma-muted">Nenhum cardápio aguardando implantação assistida.</p>
        : <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {catalogRequests.map(item => (
              <article key={item.id} className="rounded-xl border border-zinc-800 bg-koma-page p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-bold">{item.restaurant_name}</h3>
                    <p className="mt-1 break-all text-xs text-koma-muted">{item.filename}</p>
                    <p className="mt-1 text-xs text-koma-subtle">
                      {formatFileSize(item.file_size)} · {item.status === 'processing' ? 'em preparação' : 'aguardando'}
                      {item.created_at ? ` · ${new Date(item.created_at).toLocaleString('pt-BR')}` : ''}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${item.status === 'processing' ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                    {item.status === 'processing' ? 'Em preparação' : 'Novo'}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={catalogBusyId === item.id}
                    onClick={() => void downloadCatalogSource(item)}
                    className="rounded border border-zinc-700 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    {catalogBusyId === item.id ? 'Processando…' : 'Baixar fonte'}
                  </button>
                  <label className="cursor-pointer rounded bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500">
                    Publicar JSON revisado
                    <input
                      className="sr-only"
                      type="file"
                      accept=".json,application/json"
                      disabled={catalogBusyId === item.id}
                      onChange={event => {
                        const file = event.target.files?.[0];
                        void publishCatalogJson(item, file);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-koma-subtle">
                  Antes de publicar, confira manualmente preços, nomes, categorias e itens obrigatórios. A publicação grava direto no tenant selecionado e fica auditada.
                </p>
              </article>
            ))}
          </div>}
    </section>

    <section className="rounded-xl border border-zinc-800 bg-koma-surface p-5 text-koma-foreground">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Inscrições</h2>
          <p className="my-2 text-sm text-koma-muted">Cadastros dos últimos 30 dias. Sem atividade há 24 horas indica possível desistência, não cancelamento.</p>
        </div>
        <button onClick={() => void load()} className="rounded border border-zinc-700 px-3 py-2 text-sm">Atualizar inscrições</button>
      </div>

      <div className="my-4 flex gap-3">
        <select aria-label="Situação da inscrição" className="rounded bg-koma-page p-2" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">Todas</option>
          <option value="inactive">Sem atividade há 24h</option>
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {deliveryFailures.length > 0 && <details className="my-3 text-amber-400">
        <summary>{deliveryFailures.length} envios com falha ou aguardando nova tentativa</summary>
        <p className="my-2 text-sm">Confira o painel de Homologação SaaS acima e revise as configurações de e-mail/WhatsApp antes de tentar novamente.</p>
        {deliveryFailures.map(item => <div key={item.id} className="my-2 flex flex-wrap items-center gap-3 text-xs">
          <span>{item.id} · {item.attempts} tentativas · {item.last_error}</span>
          <button className="rounded border px-2 py-1" onClick={() => void retryDelivery(item.id)}>Tentar novamente</button>
        </div>)}
      </details>}

      {successNotice && <p className="my-2 rounded border border-emerald-800 bg-emerald-950/40 p-2 text-sm text-emerald-300" role="status">{successNotice}</p>}
      {error && <p role="alert" className="text-rose-400">{error}</p>}

      {loading ? <p>Carregando…</p> : <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>{['Restaurante', 'Contato', 'Plano', 'Situação', 'Última atividade', 'Ações'].map(label => <th className="p-3" key={label}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {visible.map(item => <tr key={item.id} className="border-t border-zinc-800">
              <td className="p-3">
                {item.restaurant_name}
                <small className="block text-koma-muted">{item.protocol || 'Antes do contrato'}</small>
              </td>
              <td className="p-3">{item.responsible_name}<br />{item.email}<br />{item.phone}</td>
              <td className="p-3">{item.plan} · {item.billing_cycle}</td>
              <td className="p-3">
                {labels[item.status]}
                {item.inactive && <small className="block text-amber-400">Sem atividade há 24h</small>}
              </td>
              <td className="p-3">{new Date(item.updated_at).toLocaleString('pt-BR')}</td>
              <td className="p-3">
                {item.status === 'awaiting_release' && item.protocol
                  ? <button
                      disabled={releasingProtocol === item.protocol}
                      onClick={() => void releaseSignup(item.protocol!)}
                      className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >{releasingProtocol === item.protocol ? 'Liberando…' : 'Liberar acesso'}</button>
                  : item.status === 'activated' && item.protocol
                    ? <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-emerald-400">Liberado</span>
                        <button
                          disabled={reissuingProtocol === item.protocol}
                          onClick={() => void reissueActivationInvite(item.protocol!)}
                          className="rounded border border-zinc-700 px-2.5 py-1 text-xs font-semibold hover:border-emerald-700 disabled:opacity-50"
                        >{reissuingProtocol === item.protocol ? 'Reemitindo…' : 'Reemitir convite inicial'}</button>
                      </div>
                    : <span className="text-xs text-zinc-500">—</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
        {!visible.length && <p className="p-3">Nenhuma inscrição neste filtro.</p>}
      </div>}
    </section>
  </>;
}
