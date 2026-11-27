import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CalendarClock, FileUp, Plus, RefreshCw, ShoppingBag, Trash2 } from 'lucide-react';
import type {
  B8LoteEstoque,
  B8PedidoCompra,
  B8PerdaEstoque,
  B8XmlPreviewResponse,
} from '../../contracts/b8Contracts';
import type { Distribuidor, Insumo } from '../../types';
import { snapshotFetch as fetch } from '../../utils/snapshotFetch';

interface EstoqueLotesPerdasTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  insumos: Insumo[];
  distribuidores: Distribuidor[];
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  onChanged: () => void;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function EstoqueLotesPerdasTab({
  apiBaseUrl,
  authHeaders,
  insumos,
  distribuidores,
  showToast,
  onChanged,
}: EstoqueLotesPerdasTabProps) {
  const [lotes, setLotes] = useState<B8LoteEstoque[]>([]);
  const [compras, setCompras] = useState<B8PedidoCompra[]>([]);
  const [perdas, setPerdas] = useState<B8PerdaEstoque[]>([]);
  const [loading, setLoading] = useState(true);

  // Perda detalhada
  const [perdaInsumoId, setPerdaInsumoId] = useState(insumos[0]?.id || '');
  const [perdaQtd, setPerdaQtd] = useState('');
  const [perdaCategoria, setPerdaCategoria] = useState('vencimento');
  const [perdaObs, setPerdaObs] = useState('');

  // Pedido de compra
  const [compraDistribuidorId, setCompraDistribuidorId] = useState(distribuidores[0]?.id || '');
  const [compraInsumoId, setCompraInsumoId] = useState(insumos[0]?.id || '');
  const [compraQtd, setCompraQtd] = useState('');
  const [compraFator, setCompraFator] = useState('1');
  const [compraCusto, setCompraCusto] = useState('');
  const [gerarCpRecebimento, setGerarCpRecebimento] = useState(true);

  // Recebimento parcial/total modal inline
  const [recebimentoTarget, setRecebimentoTarget] = useState<B8PedidoCompra | null>(null);
  const [recebimentoQtds, setRecebimentoQtds] = useState<Record<number, string>>({});
  const [recebimentoVenc, setRecebimentoVenc] = useState(todayIso);

  // Conferência XML NF-e De-Para
  const xmlInputRef = useRef<HTMLInputElement | null>(null);
  const [xmlPreview, setXmlPreview] = useState<B8XmlPreviewResponse | null>(null);
  const [xmlMappings, setXmlMappings] = useState<Array<{ insumo_id: string; fator_conversao: string; data_validade: string }>>([]);
  const [xmlGerarCp, setXmlGerarCp] = useState(true);
  const [xmlVencCp, setXmlVencCp] = useState(todayIso);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [lRes, cRes, pRes] = await Promise.all([
        fetch(`${apiBaseUrl}/b8/supply/lotes`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/b8/supply/pedidos-compra`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/b8/supply/perdas`, { headers: authHeaders }),
      ]);
      if (lRes.ok) {
        const list = await lRes.json();
        setLotes(Array.isArray(list) ? list : []);
      }
      if (cRes.ok) {
        const list = await cRes.json();
        setCompras(Array.isArray(list) ? list : []);
      }
      if (pRes.ok) {
        const list = await pRes.json();
        setPerdas(Array.isArray(list) ? list : []);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!perdaInsumoId && insumos[0]?.id) setPerdaInsumoId(insumos[0].id);
    if (!compraInsumoId && insumos[0]?.id) setCompraInsumoId(insumos[0].id);
    if (!compraDistribuidorId && distribuidores[0]?.id) setCompraDistribuidorId(distribuidores[0].id);
  }, [compraDistribuidorId, compraInsumoId, distribuidores, insumos, perdaInsumoId]);

  const handleRegistrarPerda = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtd = Number(perdaQtd);
    if (!perdaInsumoId || !qtd || qtd <= 0) {
      showToast('Informe ingrediente e quantidade válida para perda.', 'warning');
      return;
    }
    const res = await fetch(`${apiBaseUrl}/b8/supply/perdas`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insumo_id: perdaInsumoId,
        quantidade: qtd,
        categoria_perda: perdaCategoria,
        observacao: perdaObs.trim(),
      }),
    });
    if (res.ok) {
      setPerdaQtd('');
      setPerdaObs('');
      showToast('Perda registrada no controle FEFO.', 'success');
      await loadData();
      onChanged();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Erro ao registrar perda.', 'error');
    }
  };

  const handleCriarCompra = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtd = Number(compraQtd);
    const fator = Number(compraFator) || 1;
    const custo = Number(compraCusto);
    if (!compraDistribuidorId || !compraInsumoId || !qtd || qtd <= 0 || custo < 0) {
      showToast('Selecione fornecedor, ingrediente, quantidade e custo unitário.', 'warning');
      return;
    }
    const res = await fetch(`${apiBaseUrl}/b8/supply/pedidos-compra`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distribuidor_id: compraDistribuidorId,
        data_emissao: todayIso(),
        itens: [
          {
            insumo_id: compraInsumoId,
            quantidade_pedida: qtd,
            fator_conversao: fator,
            preco_unitario_previsto: custo,
          },
        ],
      }),
    });
    if (res.ok) {
      setCompraQtd('');
      setCompraCusto('');
      showToast('Pedido de compra registrado.', 'success');
      await loadData();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Erro ao criar pedido de compra.', 'error');
    }
  };

  const openRecebimento = (pc: B8PedidoCompra) => {
    setRecebimentoTarget(pc);
    const map: Record<number, string> = {};
    for (const item of pc.itens) {
      const restante = Math.max(0, item.quantidade_pedida - item.quantidade_recebida);
      map[item.id] = restante > 0 ? String(restante) : '0';
    }
    setRecebimentoQtds(map);
    setRecebimentoVenc(todayIso());
  };

  const handleConfirmRecebimento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recebimentoTarget) return;
    const recebimentos = recebimentoTarget.itens
      .map((item) => ({
        item_id: item.id,
        quantidade_recebida: Number(recebimentoQtds[item.id] || 0),
        preco_unitario_recebido: item.preco_unitario_previsto,
      }))
      .filter((r) => r.quantidade_recebida > 0);
    if (recebimentos.length === 0) {
      showToast('Informe ao menos uma quantidade positiva recebida.', 'warning');
      return;
    }
    const res = await fetch(`${apiBaseUrl}/b8/supply/pedidos-compra/${recebimentoTarget.id}/receber`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recebimentos,
        gerar_conta_pagar: gerarCpRecebimento,
        data_vencimento_financeiro: gerarCpRecebimento ? recebimentoVenc : null,
      }),
    });
    if (res.ok) {
      setRecebimentoTarget(null);
      showToast('Recebimento registrado com entrada de lotes FEFO.', 'success');
      await loadData();
      onChanged();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Erro ao receber pedido de compra.', 'error');
    }
  };

  const handleXmlFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${apiBaseUrl}/b8/supply/xml/preview`, {
      method: 'POST',
      headers: authHeaders,
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Falha ao ler XML NF-e.', 'error');
      return;
    }
    const preview: B8XmlPreviewResponse = await res.json();
    setXmlPreview(preview);
    setXmlMappings(
      preview.itens.map((it) => ({
        insumo_id: it.insumo_id || insumos[0]?.id || '',
        fator_conversao: String(it.fator_conversao || 1),
        data_validade: '',
      })),
    );
  };

  const handleConfirmXml = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!xmlPreview) return;
    if (xmlPreview.duplicada) {
      showToast('Esta NF-e já foi importada anteriormente.', 'error');
      return;
    }
    const res = await fetch(`${apiBaseUrl}/b8/supply/xml/confirmar`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chave_acesso: xmlPreview.chave_acesso,
        numero_nota: xmlPreview.numero_nota,
        fornecedor_nome: xmlPreview.fornecedor_nome,
        fornecedor_cnpj: xmlPreview.fornecedor_cnpj,
        data_emissao: xmlPreview.data_emissao,
        gerar_conta_pagar: xmlGerarCp,
        data_vencimento_financeiro: xmlGerarCp ? xmlVencCp : null,
        itens: xmlPreview.itens.map((it, idx) => ({
          codigo_fornecedor: it.codigo_fornecedor,
          descricao_fornecedor: it.descricao_fornecedor,
          unidade_compra: it.unidade_compra,
          insumo_id: xmlMappings[idx]?.insumo_id || '',
          quantidade_compra: it.quantidade_compra,
          fator_conversao: Number(xmlMappings[idx]?.fator_conversao || 1),
          valor_unitario_compra: it.valor_unitario_compra,
          data_validade: xmlMappings[idx]?.data_validade || null,
        })),
      }),
    });
    if (res.ok) {
      setXmlPreview(null);
      showToast('XML NF-e confirmado com de-para e lotes FEFO.', 'success');
      await loadData();
      onChanged();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Erro ao confirmar XML NF-e.', 'error');
    }
  };

  const today = todayIso();

  return (
    <div className="space-y-4 text-left animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-koma-foreground">Compras, XML De-Para, Lotes FEFO e Perdas</h3>
          <p className="text-[11px] text-koma-muted">Consumo automático priorizando menor validade (FEFO), recebimento parcial/total e rastreio de perdas.</p>
        </div>
        <div className="flex gap-2">
          <input ref={xmlInputRef} type="file" accept=".xml,text/xml,application/xml" onChange={(e) => void handleXmlFileChange(e)} className="hidden" />
          <button type="button" onClick={() => xmlInputRef.current?.click()} className="koma-btn-secondary">
            <FileUp size={14} /> Conferir XML NF-e (De-Para)
          </button>
          <button type="button" onClick={() => void loadData()} disabled={loading} className="koma-btn-secondary">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {xmlPreview && (
        <form onSubmit={handleConfirmXml} className="space-y-3 rounded-2xl border border-emerald-500/40 bg-koma-panel p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong className="text-koma-foreground">NF-e {xmlPreview.numero_nota} · {xmlPreview.fornecedor_nome}</strong>
              <span className="ml-2 font-mono text-koma-muted">Total {currency.format(xmlPreview.valor_total)}</span>
              {xmlPreview.duplicada && <span className="ml-2 font-bold text-rose-600 dark:text-rose-300">(XML duplicado — bloqueado)</span>}
            </div>
            <button type="button" onClick={() => setXmlPreview(null)} className="text-koma-muted hover:text-koma-foreground">Fechar</button>
          </div>
          <div className="space-y-2">
            {xmlPreview.itens.map((it, idx) => (
              <div key={`${it.codigo_fornecedor}-${idx}`} className="grid gap-2 rounded-xl border border-koma-border bg-koma-raised/30 p-2.5 sm:grid-cols-4 sm:items-center">
                <div>
                  <strong className="block text-koma-foreground">{it.descricao_fornecedor}</strong>
                  <span className="text-[10px] text-koma-muted">{it.quantidade_compra} {it.unidade_compra} · {currency.format(it.valor_unitario_compra)}</span>
                </div>
                <select
                  value={xmlMappings[idx]?.insumo_id || ''}
                  onChange={(e) => setXmlMappings((cur) => cur.map((m, i) => i === idx ? { ...m, insumo_id: e.target.value } : m))}
                  className="koma-toolbar__select"
                >
                  <option value="">Selecione o insumo…</option>
                  {insumos.map((ins) => <option key={ins.id} value={ins.id}>{ins.nome} ({ins.unidade_medida})</option>)}
                </select>
                <label className="flex items-center gap-1.5">
                  <span className="text-[10px] text-koma-muted">Fator:</span>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={xmlMappings[idx]?.fator_conversao || '1'}
                    onChange={(e) => setXmlMappings((cur) => cur.map((m, i) => i === idx ? { ...m, fator_conversao: e.target.value } : m))}
                    className="min-h-8 w-24 rounded-lg border border-koma-border bg-koma-input px-2 font-mono text-xs text-koma-foreground"
                  />
                </label>
                <input
                  type="date"
                  value={xmlMappings[idx]?.data_validade || ''}
                  onChange={(e) => setXmlMappings((cur) => cur.map((m, i) => i === idx ? { ...m, data_validade: e.target.value } : m))}
                  aria-label="Validade do lote"
                  className="min-h-8 rounded-lg border border-koma-border bg-koma-input px-2 text-xs text-koma-foreground"
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-koma-foreground">
              <input type="checkbox" checked={xmlGerarCp} onChange={(e) => setXmlGerarCp(e.target.checked)} />
              Gerar Conta a Pagar
              {xmlGerarCp && <input type="date" value={xmlVencCp} onChange={(e) => setXmlVencCp(e.target.value)} className="min-h-8 rounded-lg border border-koma-border bg-koma-input px-2 text-xs text-koma-foreground" />}
            </label>
            <button type="submit" disabled={xmlPreview.duplicada} className="koma-btn-success">Confirmar entrada XML</button>
          </div>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={handleRegistrarPerda} className="space-y-3 rounded-2xl border border-koma-border bg-koma-panel p-4">
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-koma-foreground">
            <Trash2 size={14} className="text-rose-600 dark:text-rose-300" /> Registrar perda detalhada
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={perdaInsumoId} onChange={(e) => setPerdaInsumoId(e.target.value)} className="koma-toolbar__select">
              {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.unidade_medida})</option>)}
            </select>
            <input type="number" step="0.001" min="0.001" placeholder="Quantidade" value={perdaQtd} onChange={(e) => setPerdaQtd(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
            <select value={perdaCategoria} onChange={(e) => setPerdaCategoria(e.target.value)} className="koma-toolbar__select">
              <option value="vencimento">Vencimento</option>
              <option value="avaria">Avaria / Queda</option>
              <option value="erro_preparo">Erro de preparo</option>
              <option value="sobra_buffet">Sobra descartada</option>
              <option value="outro">Outro</option>
            </select>
            <input placeholder="Observação" value={perdaObs} onChange={(e) => setPerdaObs(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
          </div>
          <button type="submit" className="koma-btn-secondary">Registrar perda</button>
        </form>

        <form onSubmit={handleCriarCompra} className="space-y-3 rounded-2xl border border-koma-border bg-koma-panel p-4">
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-koma-foreground">
            <ShoppingBag size={14} className="text-emerald-600 dark:text-emerald-300" /> Novo pedido de compra
          </h4>
          {distribuidores.length === 0 ? (
            <p className="text-xs text-koma-muted">Cadastre um fornecedor na aba Fornecedores para emitir pedidos de compra.</p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <select value={compraDistribuidorId} onChange={(e) => setCompraDistribuidorId(e.target.value)} className="koma-toolbar__select">
                  {distribuidores.map((d) => <option key={d.id} value={d.id}>{d.nome_fantasia}</option>)}
                </select>
                <select value={compraInsumoId} onChange={(e) => setCompraInsumoId(e.target.value)} className="koma-toolbar__select">
                  {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome} ({i.unidade_medida})</option>)}
                </select>
                <div className="flex gap-2">
                  <input type="number" step="0.001" min="0.001" placeholder="Qtd" value={compraQtd} onChange={(e) => setCompraQtd(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
                  <input type="number" step="0.01" min="0.01" placeholder="Fator" value={compraFator} onChange={(e) => setCompraFator(e.target.value)} className="min-h-9 w-20 rounded-xl border border-koma-border bg-koma-input px-2 font-mono text-xs text-koma-foreground" />
                </div>
                <input type="number" step="0.01" min="0" placeholder="Preço unit. (R$)" value={compraCusto} onChange={(e) => setCompraCusto(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
              </div>
              <button type="submit" className="koma-btn-success"><Plus size={14} /> Criar pedido</button>
            </>
          )}
        </form>
      </div>

      {recebimentoTarget && (
        <form onSubmit={handleConfirmRecebimento} className="space-y-3 rounded-2xl border border-emerald-500/40 bg-koma-panel p-4 text-xs">
          <div className="flex items-center justify-between">
            <strong className="text-koma-foreground">Receber Pedido #{recebimentoTarget.numero_pedido || recebimentoTarget.id.slice(-6)}</strong>
            <button type="button" onClick={() => setRecebimentoTarget(null)} className="text-koma-muted hover:text-koma-foreground">Fechar</button>
          </div>
          <div className="space-y-2">
            {recebimentoTarget.itens.map((item) => {
              const ins = insumos.find((i) => i.id === item.insumo_id);
              return (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-koma-border bg-koma-raised/30 px-3 py-2">
                  <span>{ins?.nome || item.insumo_id} · Pedido {item.quantidade_pedida} · Já recebido {item.quantidade_recebida}</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={recebimentoQtds[item.id] || '0'}
                    onChange={(e) => setRecebimentoQtds((cur) => ({ ...cur, [item.id]: e.target.value }))}
                    className="min-h-8 w-28 rounded-lg border border-koma-border bg-koma-input px-2 font-mono text-xs text-koma-foreground"
                  />
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-koma-foreground">
              <input type="checkbox" checked={gerarCpRecebimento} onChange={(e) => setGerarCpRecebimento(e.target.checked)} />
              Gerar Conta a Pagar
              {gerarCpRecebimento && <input type="date" value={recebimentoVenc} onChange={(e) => setRecebimentoVenc(e.target.value)} className="min-h-8 rounded-lg border border-koma-border bg-koma-input px-2 text-xs text-koma-foreground" />}
            </label>
            <button type="submit" className="koma-btn-success">Confirmar recebimento</button>
          </div>
        </form>
      )}

      {compras.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
          <header className="border-b border-koma-border bg-koma-raised/40 px-4 py-2.5 text-xs font-bold uppercase text-koma-foreground">
            Pedidos de Compra
          </header>
          <div className="divide-y divide-koma-border text-xs">
            {compras.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div>
                  <strong className="text-koma-foreground">{c.fornecedor_nome || 'Fornecedor'}</strong>
                  <span className="ml-2 text-koma-muted">Status: <strong>{c.status}</strong> · {c.data_emissao}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-semibold text-koma-foreground">{currency.format(c.valor_total_previsto)}</span>
                  {c.status !== 'recebido' && c.status !== 'cancelado' && (
                    <button type="button" onClick={() => openRecebimento(c)} className="koma-btn-success">
                      Receber
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
        <header className="border-b border-koma-border bg-koma-raised/40 px-4 py-2.5 text-xs font-bold uppercase text-koma-foreground">
          Lotes ativos em estoque (ordem FEFO)
        </header>
        {lotes.length === 0 ? (
          <p className="p-6 text-center text-xs text-koma-muted">Nenhum lote ativo com saldo positivo.</p>
        ) : (
          <div className="divide-y divide-koma-border text-xs">
            {lotes.map((lote) => {
              const vencido = Boolean(lote.data_validade && lote.data_validade < today);
              return (
                <div key={lote.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div>
                    <strong className="text-koma-foreground">{lote.insumo_nome || lote.insumo_id}</strong>
                    <span className="ml-2 text-[11px] text-koma-muted">Lote {lote.codigo_lote || lote.id.slice(-6)} · {lote.origem_tipo}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {lote.data_validade && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          vencido
                            ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                            : 'bg-koma-raised text-koma-muted'
                        }`}
                      >
                        {vencido ? <AlertCircle size={11} /> : <CalendarClock size={11} />}
                        Val. {lote.data_validade}
                      </span>
                    )}
                    <span className="font-mono font-semibold text-koma-foreground">
                      {lote.quantidade_disponivel} un · {currency.format(lote.custo_unitario)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {perdas.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
          <header className="border-b border-koma-border bg-koma-raised/40 px-4 py-2.5 text-xs font-bold uppercase text-koma-foreground">
            Histórico de Perdas
          </header>
          <div className="divide-y divide-koma-border text-xs">
            {perdas.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <strong className="text-koma-foreground">{p.insumo_nome || p.insumo_id}</strong>
                  <span className="ml-2 text-koma-muted">{p.categoria_perda} · {p.observacao}</span>
                </div>
                <span className="font-mono text-koma-foreground">
                  {p.quantidade} un {p.custo_estimado !== null ? `(${currency.format(p.custo_estimado)})` : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
