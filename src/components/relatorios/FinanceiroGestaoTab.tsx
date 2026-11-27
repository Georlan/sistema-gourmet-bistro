import { useCallback, useEffect, useState } from 'react';
import { Check, Plus, RefreshCw, Repeat, Wallet, XCircle } from 'lucide-react';
import type {
  B8ContaPagar,
  B8ContaPagarParcela,
  B8ContaReceber,
  B8FinanceSetup,
  B8Movimentacao,
  B8Recorrencia,
} from '../../contracts/b8Contracts';
import { snapshotFetch as fetch } from '../../utils/snapshotFetch';

interface FinanceiroGestaoTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function FinanceiroGestaoTab({ apiBaseUrl, authHeaders, showToast }: FinanceiroGestaoTabProps) {
  const [setup, setSetup] = useState<B8FinanceSetup | null>(null);
  const [pagar, setPagar] = useState<B8ContaPagar[]>([]);
  const [receber, setReceber] = useState<B8ContaReceber[]>([]);
  const [recorrencias, setRecorrencias] = useState<B8Recorrencia[]>([]);
  const [movimentacoes, setMovimentacoes] = useState<B8Movimentacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [subMode, setSubMode] = useState<'pagar' | 'receber' | 'recorrencias' | 'movimentacoes' | 'cadastros'>('pagar');

  // Form Conta a Pagar / Receber
  const [descricao, setDescricao] = useState('');
  const [contraparte, setContraparte] = useState('');
  const [valor, setValor] = useState('');
  const [dataEmissao, setDataEmissao] = useState(todayIso);
  const [dataCompetencia, setDataCompetencia] = useState(todayIso);
  const [vencimento, setVencimento] = useState(todayIso);
  const [categoriaId, setCategoriaId] = useState('');
  const [parcelas, setParcelas] = useState('1');
  const [submitting, setSubmitting] = useState(false);

  // Baixa explícita (CP ou CR) — nunca seleciona conta silenciosamente
  const [baixaTarget, setBaixaTarget] = useState<
    | { kind: 'pagar'; cp: B8ContaPagar; parcela: B8ContaPagarParcela; idempotencyKey: string }
    | { kind: 'receber'; cr: B8ContaReceber; idempotencyKey: string }
    | null
  >(null);
  const [baixaContaId, setBaixaContaId] = useState('');
  const [baixaData, setBaixaData] = useState(todayIso);
  const [baixaValor, setBaixaValor] = useState('');
  const [baixaJurosTaxa, setBaixaJurosTaxa] = useState('0');
  const [baixaDesconto, setBaixaDesconto] = useState('0');
  const [baixaForma, setBaixaForma] = useState('pix');

  // Recorrência
  const [recDia, setRecDia] = useState('10');
  const [recCompetencia, setRecCompetencia] = useState(() => todayIso().slice(0, 7));

  // Movimentação manual
  const [movContaId, setMovContaId] = useState('');
  const [movDestinoId, setMovDestinoId] = useState('');
  const [movTipo, setMovTipo] = useState('aporte');
  const [movValor, setMovValor] = useState('');
  const [movData, setMovData] = useState(todayIso);
  const [movDesc, setMovDesc] = useState('');

  // Nova Categoria / Conta Financeira
  const [catNome, setCatNome] = useState('');
  const [catTipo, setCatTipo] = useState('despesa_variavel');
  const [contaNome, setContaNome] = useState('');
  const [contaTipo, setContaTipo] = useState('conta_bancaria');
  const [contaSaldoInicial, setContaSaldoInicial] = useState('0');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes, rRes, recRes, mRes] = await Promise.all([
        fetch(`${apiBaseUrl}/b8/financeiro/setup`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/b8/financeiro/contas-pagar`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/b8/financeiro/contas-receber`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/b8/financeiro/recorrencias`, { headers: authHeaders }),
        fetch(`${apiBaseUrl}/b8/financeiro/movimentacoes`, { headers: authHeaders }),
      ]);
      if (sRes.ok) {
        const sData: B8FinanceSetup = await sRes.json();
        setSetup(sData);
        if (!categoriaId && sData.categorias.length > 0) {
          setCategoriaId(sData.categorias[0].id);
        }
      }
      if (pRes.ok) {
        const list = await pRes.json();
        setPagar(Array.isArray(list) ? list : []);
      }
      if (rRes.ok) {
        const list = await rRes.json();
        setReceber(Array.isArray(list) ? list : []);
      }
      if (recRes.ok) {
        const list = await recRes.json();
        setRecorrencias(Array.isArray(list) ? list : []);
      }
      if (mRes.ok) {
        const list = await mRes.json();
        setMovimentacoes(Array.isArray(list) ? list : []);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authHeaders, categoriaId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateTitulo = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericVal = Number(valor.replace(',', '.'));
    if (!descricao.trim() || !contraparte.trim() || !categoriaId || !numericVal || numericVal <= 0) {
      showToast('Preencha descrição, favorecido/cliente, categoria e valor válido.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const isPagar = subMode === 'pagar';
      const endpoint = isPagar ? '/b8/financeiro/contas-pagar' : '/b8/financeiro/contas-receber';
      const payload = isPagar
        ? {
            categoria_id: categoriaId,
            favorecido_nome: contraparte.trim(),
            descricao: descricao.trim(),
            valor_original: numericVal,
            data_emissao: dataEmissao,
            data_competencia: dataCompetencia,
            primeiro_vencimento: vencimento,
            total_parcelas: Math.max(1, Number(parcelas) || 1),
          }
        : {
            categoria_id: categoriaId,
            contraparte_nome: contraparte.trim(),
            descricao: descricao.trim(),
            valor_previsto: numericVal,
            data_competencia: dataCompetencia,
            data_vencimento: vencimento,
            origem_tipo: 'manual',
          };
      const res = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Erro ao lançar título.');
      }
      setDescricao('');
      setContraparte('');
      setValor('');
      showToast(isPagar ? 'Conta a pagar registrada.' : 'Conta a receber registrada.', 'success');
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openBaixaPagar = (cp: B8ContaPagar, parcela: B8ContaPagarParcela) => {
    setBaixaTarget({
      kind: 'pagar',
      cp,
      parcela,
      idempotencyKey: `ui-cp-${parcela.id}-${crypto.randomUUID()}`,
    });
    setBaixaContaId('');
    setBaixaData(todayIso());
    setBaixaValor(String(parcela.saldo_aberto));
    setBaixaJurosTaxa('0');
    setBaixaDesconto('0');
    setBaixaForma('pix');
  };

  const openBaixaReceber = (cr: B8ContaReceber) => {
    setBaixaTarget({
      kind: 'receber',
      cr,
      idempotencyKey: `ui-cr-${cr.id}-${crypto.randomUUID()}`,
    });
    setBaixaContaId('');
    setBaixaData(todayIso());
    setBaixaValor(String(cr.saldo_aberto));
    setBaixaJurosTaxa('0');
    setBaixaDesconto('0');
    setBaixaForma('pix');
  };

  const handleConfirmBaixa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baixaTarget) return;
    if (!baixaContaId) {
      showToast('Selecione explicitamente a conta financeira da movimentação.', 'warning');
      return;
    }
    const v = Number(baixaValor.replace(',', '.'));
    if (!v || v <= 0) {
      showToast('Informe um valor válido para a baixa.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const url =
        baixaTarget.kind === 'pagar'
          ? `${apiBaseUrl}/b8/financeiro/contas-pagar/parcelas/${baixaTarget.parcela.id}/baixar`
          : `${apiBaseUrl}/b8/financeiro/contas-receber/${baixaTarget.cr.id}/baixar`;
      const body =
        baixaTarget.kind === 'pagar'
          ? {
              conta_financeira_id: baixaContaId,
              valor_principal: v,
              data_pagamento: baixaData,
              juros: Number(baixaJurosTaxa) || 0,
              desconto: Number(baixaDesconto) || 0,
              forma_pagamento: baixaForma,
              idempotency_key: baixaTarget.idempotencyKey,
            }
          : {
              conta_financeira_id: baixaContaId,
              valor_recebido: v,
              data_recebimento: baixaData,
              taxa_descontada: Number(baixaJurosTaxa) || 0,
              forma_recebimento: baixaForma,
              idempotency_key: baixaTarget.idempotencyKey,
            };
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Falha ao registrar baixa financeira.');
      }
      setBaixaTarget(null);
      showToast('Baixa registrada no fluxo de caixa.', 'success');
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro na baixa financeira.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelarPagar = async (cp: B8ContaPagar) => {
    const res = await fetch(`${apiBaseUrl}/b8/financeiro/contas-pagar/${cp.id}/cancelar`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Cancelado pelo operador' }),
    });
    if (res.ok) {
      showToast('Conta a pagar cancelada com estorno auditável.', 'success');
      await loadAll();
    } else {
      showToast('Falha ao cancelar conta a pagar.', 'error');
    }
  };

  const handleCancelarReceber = async (cr: B8ContaReceber) => {
    const res = await fetch(`${apiBaseUrl}/b8/financeiro/contas-receber/${cr.id}/cancelar`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Cancelado pelo operador' }),
    });
    if (res.ok) {
      showToast('Conta a receber cancelada com estorno auditável.', 'success');
      await loadAll();
    } else {
      showToast('Falha ao cancelar conta a receber.', 'error');
    }
  };

  const handleCriarRecorrencia = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(valor.replace(',', '.'));
    if (!descricao.trim() || !contraparte.trim() || !categoriaId || !val || val <= 0) {
      showToast('Preencha descrição, favorecido, categoria e valor previsto.', 'warning');
      return;
    }
    const res = await fetch(`${apiBaseUrl}/b8/financeiro/recorrencias`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoria_id: categoriaId,
        favorecido_nome: contraparte.trim(),
        descricao: descricao.trim(),
        valor_previsto: val,
        dia_vencimento: Math.min(31, Math.max(1, Number(recDia) || 10)),
        periodicidade: 'mensal',
      }),
    });
    if (res.ok) {
      setDescricao('');
      setContraparte('');
      setValor('');
      showToast('Recorrência cadastrada.', 'success');
      await loadAll();
    } else {
      showToast('Erro ao criar recorrência.', 'error');
    }
  };

  const handleGerarCompetencia = async () => {
    const res = await fetch(`${apiBaseUrl}/b8/financeiro/recorrencias/gerar?competencia=${encodeURIComponent(recCompetencia)}`, {
      method: 'POST',
      headers: authHeaders,
    });
    if (res.ok) {
      const body = await res.json();
      showToast(`Competência ${body.competencia}: ${body.geradas_count} conta(s) gerada(s).`, 'success');
      await loadAll();
    } else {
      showToast('Erro ao gerar competência.', 'error');
    }
  };

  const handleCriarMovimentacao = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(movValor.replace(',', '.'));
    if (!movContaId || !movDesc.trim() || !val || val <= 0) {
      showToast('Selecione conta, descrição e valor válido.', 'warning');
      return;
    }
    const res = await fetch(`${apiBaseUrl}/b8/financeiro/movimentacoes`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conta_financeira_id: movContaId,
        conta_destino_id: movTipo === 'transferencia' ? movDestinoId || null : null,
        tipo: movTipo,
        valor: val,
        data_movimento: movData,
        descricao: movDesc.trim(),
        categoria_id: categoriaId || null,
      }),
    });
    if (res.ok) {
      setMovValor('');
      setMovDesc('');
      showToast('Movimentação financeira registrada.', 'success');
      await loadAll();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || 'Erro ao lançar movimentação.', 'error');
    }
  };

  const handleCriarCategoria = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catNome.trim()) return;
    const res = await fetch(`${apiBaseUrl}/b8/financeiro/categorias`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: catNome.trim(), tipo: catTipo }),
    });
    if (res.ok) {
      setCatNome('');
      showToast('Categoria criada.', 'success');
      await loadAll();
    } else {
      showToast('Erro ao criar categoria.', 'error');
    }
  };

  const handleCriarConta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contaNome.trim()) return;
    const res = await fetch(`${apiBaseUrl}/b8/financeiro/contas`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: contaNome.trim(),
        tipo: contaTipo,
        saldo_inicial: Number(contaSaldoInicial) || 0,
        data_saldo_inicial: todayIso(),
      }),
    });
    if (res.ok) {
      setContaNome('');
      setContaSaldoInicial('0');
      showToast('Conta financeira criada.', 'success');
      await loadAll();
    } else {
      showToast('Erro ao criar conta financeira.', 'error');
    }
  };

  const handleInicializarSetup = async () => {
    const res = await fetch(`${apiBaseUrl}/b8/financeiro/setup/inicializar`, {
      method: 'POST',
      headers: authHeaders,
    });
    if (res.ok) {
      const sData: B8FinanceSetup = await res.json();
      setSetup(sData);
      if (sData.categorias.length > 0) setCategoriaId(sData.categorias[0].id);
      showToast('Plano de contas e contas padrão inicializados.', 'success');
    } else {
      showToast('Não foi possível inicializar o plano de contas.', 'error');
    }
  };

  return (
    <div className="space-y-4 text-left animate-fade-in">
      {setup && setup.categorias.length === 0 && setup.contas.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs">
          <div>
            <strong className="block text-koma-foreground">Financeiro gerencial ainda não inicializado</strong>
            <span className="text-koma-muted">Provisione as categorias padrão e contas financeiras para começar a lançar títulos.</span>
          </div>
          <button type="button" onClick={() => void handleInicializarSetup()} className="koma-btn-success">
            <Plus size={14} /> Inicializar plano de contas padrão
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSubMode('pagar')} className={subMode === 'pagar' ? 'koma-btn-success' : 'koma-btn-secondary'}>
            Contas a Pagar ({pagar.filter((i) => !['pago', 'cancelado'].includes(i.status)).length})
          </button>
          <button type="button" onClick={() => setSubMode('receber')} className={subMode === 'receber' ? 'koma-btn-success' : 'koma-btn-secondary'}>
            Contas a Receber ({receber.filter((i) => !['recebido', 'cancelado'].includes(i.status)).length})
          </button>
          <button type="button" onClick={() => setSubMode('recorrencias')} className={subMode === 'recorrencias' ? 'koma-btn-success' : 'koma-btn-secondary'}>
            <Repeat size={13} /> Recorrências
          </button>
          <button type="button" onClick={() => setSubMode('movimentacoes')} className={subMode === 'movimentacoes' ? 'koma-btn-success' : 'koma-btn-secondary'}>
            <Wallet size={13} /> Movimentações
          </button>
          <button type="button" onClick={() => setSubMode('cadastros')} className={subMode === 'cadastros' ? 'koma-btn-success' : 'koma-btn-secondary'}>
            Categorias & Contas
          </button>
        </div>
        <button type="button" onClick={() => void loadAll()} disabled={loading} className="koma-btn-secondary">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {baixaTarget && setup && (
        <form onSubmit={handleConfirmBaixa} className="space-y-3 rounded-2xl border border-emerald-500/40 bg-koma-panel p-4">
          <div className="flex items-center justify-between">
            <strong className="text-xs font-bold text-koma-foreground">
              {baixaTarget.kind === 'pagar'
                ? `Confirmar pagamento: ${baixaTarget.cp.descricao} (Parcela ${baixaTarget.parcela.numero_parcela})`
                : `Confirmar recebimento: ${baixaTarget.cr.descricao}`}
            </strong>
            <button type="button" onClick={() => setBaixaTarget(null)} className="text-xs text-koma-muted hover:text-koma-foreground">
              Fechar
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Conta financeira *</span>
              <select value={baixaContaId} onChange={(e) => setBaixaContaId(e.target.value)} className="koma-toolbar__select w-full" required>
                <option value="">Selecione a conta…</option>
                {setup.contas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Data efetiva *</span>
              <input type="date" value={baixaData} onChange={(e) => setBaixaData(e.target.value)} required className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Valor (parcial ou total)</span>
              <input type="number" step="0.01" min="0.01" value={baixaValor} onChange={(e) => setBaixaValor(e.target.value)} required className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">{baixaTarget.kind === 'pagar' ? 'Juros (R$)' : 'Taxa descontada'}</span>
              <input type="number" step="0.01" min="0" value={baixaJurosTaxa} onChange={(e) => setBaixaJurosTaxa(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
            </label>
            {baixaTarget.kind === 'pagar' && (
              <label>
                <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Desconto (R$)</span>
                <input type="number" step="0.01" min="0" value={baixaDesconto} onChange={(e) => setBaixaDesconto(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
              </label>
            )}
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Forma</span>
              <select value={baixaForma} onChange={(e) => setBaixaForma(e.target.value)} className="koma-toolbar__select w-full">
                <option value="pix">Pix</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="transferencia">Transferência</option>
                <option value="boleto">Boleto</option>
                <option value="cartao">Cartão</option>
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setBaixaTarget(null)} className="koma-btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="koma-btn-success"><Check size={14} /> Confirmar baixa</button>
          </div>
        </form>
      )}

      {(subMode === 'pagar' || subMode === 'receber') && (
        <>
          <form onSubmit={handleCreateTitulo} className="grid gap-3 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:grid-cols-2 lg:grid-cols-4 sm:items-end">
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Descrição *</span>
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={subMode === 'pagar' ? 'Ex.: Aluguel' : 'Ex.: Evento'} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">{subMode === 'pagar' ? 'Favorecido *' : 'Cliente / Origem *'}</span>
              <input value={contraparte} onChange={(e) => setContraparte(e.target.value)} placeholder={subMode === 'pagar' ? 'Fornecedor ou locador' : 'Contraparte'} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Categoria *</span>
              <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="koma-toolbar__select w-full">
                {setup?.categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Valor (R$) *</span>
              <input type="number" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
            </label>
            {subMode === 'pagar' && (
              <label>
                <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Emissão</span>
                <input type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
              </label>
            )}
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Competência (DRE)</span>
              <input type="date" value={dataCompetencia} onChange={(e) => setDataCompetencia(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">{subMode === 'pagar' ? '1º Vencimento' : 'Vencimento'}</span>
              <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            </label>
            {subMode === 'pagar' && (
              <label>
                <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Parcelas</span>
                <input type="number" min="1" max="60" value={parcelas} onChange={(e) => setParcelas(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
              </label>
            )}
            <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
              <button type="submit" disabled={submitting} className="koma-btn-success">
                <Plus size={14} /> {subMode === 'pagar' ? 'Lançar conta a pagar' : 'Lançar conta a receber'}
              </button>
            </div>
          </form>

          <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
            {subMode === 'pagar' ? (
              pagar.length === 0 ? (
                <p className="p-6 text-center text-xs text-koma-muted">Nenhuma conta a pagar registrada.</p>
              ) : (
                <div className="divide-y divide-koma-border text-xs">
                  {pagar.map((cp) => (
                    <div key={cp.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <strong className="text-koma-foreground">{cp.descricao}</strong>
                          <p className="text-[11px] text-koma-muted">
                            {cp.favorecido_nome} · Competência {cp.data_competencia} · Total {currency.format(cp.valor_original)} · Status: <strong>{cp.status}</strong>
                          </p>
                        </div>
                        {cp.status !== 'cancelado' && (
                          <button type="button" onClick={() => void handleCancelarPagar(cp)} className="koma-btn-secondary">
                            <XCircle size={13} /> Cancelar
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {cp.parcelas.map((p) => (
                          <div key={p.id} className="flex items-center gap-2 rounded-xl border border-koma-border bg-koma-raised/30 px-2.5 py-1.5 text-[11px]">
                            <span>P{p.numero_parcela}/{cp.total_parcelas} · Venc. {p.data_vencimento}</span>
                            <strong className="font-mono text-koma-foreground">{currency.format(p.saldo_aberto)}</strong>
                            {p.saldo_aberto > 0 && cp.status !== 'cancelado' && (
                              <button type="button" onClick={() => openBaixaPagar(cp, p)} className="koma-btn-success">
                                <Check size={12} /> Pagar
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : receber.length === 0 ? (
              <p className="p-6 text-center text-xs text-koma-muted">Nenhuma conta a receber registrada.</p>
            ) : (
              <div className="divide-y divide-koma-border text-xs">
                {receber.map((cr) => (
                  <div key={cr.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <strong className="text-koma-foreground">{cr.descricao}</strong>
                      <p className="text-[11px] text-koma-muted">
                        {cr.contraparte_nome} · Venc. {cr.data_vencimento} · {cr.tipo_confirmacao} · Status: <strong>{cr.status}</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right font-mono">
                        <strong className="block text-koma-foreground">{currency.format(cr.saldo_aberto)}</strong>
                        <span className="text-[10px] text-koma-muted">Previsto {currency.format(cr.valor_previsto)}</span>
                      </div>
                      {cr.saldo_aberto > 0 && cr.status !== 'cancelado' && (
                        <button type="button" onClick={() => openBaixaReceber(cr)} className="koma-btn-success">
                          <Check size={13} /> Receber
                        </button>
                      )}
                      {cr.status !== 'cancelado' && (
                        <button type="button" onClick={() => void handleCancelarReceber(cr)} className="koma-btn-secondary">
                          <XCircle size={13} /> Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {subMode === 'recorrencias' && (
        <div className="space-y-4">
          <form onSubmit={handleCriarRecorrencia} className="grid gap-3 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:grid-cols-2 lg:grid-cols-5 sm:items-end">
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Descrição *</span>
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Aluguel mensal" className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Favorecido *</span>
              <input value={contraparte} onChange={(e) => setContraparte(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Categoria *</span>
              <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="koma-toolbar__select w-full">
                {setup?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Valor / Dia venc.</span>
              <div className="flex gap-2">
                <input type="number" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor" className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
                <input type="number" min="1" max="31" value={recDia} onChange={(e) => setRecDia(e.target.value)} className="min-h-9 w-16 rounded-xl border border-koma-border bg-koma-input px-2 font-mono text-xs text-koma-foreground" />
              </div>
            </label>
            <button type="submit" className="koma-btn-success"><Plus size={14} /> Criar recorrência</button>
          </form>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-koma-border bg-koma-panel p-4 text-xs">
            <strong className="text-koma-foreground">Gerar títulos da competência (YYYY-MM):</strong>
            <input type="month" value={recCompetencia} onChange={(e) => setRecCompetencia(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            <button type="button" onClick={() => void handleGerarCompetencia()} className="koma-btn-secondary">Gerar sem duplicidade</button>
          </div>

          <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel divide-y divide-koma-border text-xs">
            {recorrencias.length === 0 ? (
              <p className="p-6 text-center text-koma-muted">Nenhuma recorrência cadastrada.</p>
            ) : recorrencias.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <strong className="text-koma-foreground">{r.descricao}</strong>
                  <span className="ml-2 text-koma-muted">{r.favorecido_nome} · Dia {r.dia_vencimento} · Última: {r.ultima_competencia_gerada || 'nunca'}</span>
                </div>
                <strong className="font-mono text-koma-foreground">{currency.format(r.valor_previsto)}</strong>
              </div>
            ))}
          </section>
        </div>
      )}

      {subMode === 'movimentacoes' && (
        <div className="space-y-4">
          <form onSubmit={handleCriarMovimentacao} className="grid gap-3 rounded-2xl border border-koma-border bg-koma-panel p-4 sm:grid-cols-2 lg:grid-cols-6 sm:items-end">
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Tipo</span>
              <select value={movTipo} onChange={(e) => setMovTipo(e.target.value)} className="koma-toolbar__select w-full">
                <option value="aporte">Aporte</option>
                <option value="retirada">Retirada</option>
                <option value="entrada">Entrada</option>
                <option value="saida">Saída avulsa</option>
                <option value="transferencia">Transferência</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Conta origem *</span>
              <select value={movContaId} onChange={(e) => setMovContaId(e.target.value)} className="koma-toolbar__select w-full">
                <option value="">Selecione…</option>
                {setup?.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            {movTipo === 'transferencia' && (
              <label>
                <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Conta destino *</span>
                <select value={movDestinoId} onChange={(e) => setMovDestinoId(e.target.value)} className="koma-toolbar__select w-full">
                  <option value="">Selecione…</option>
                  {setup?.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </label>
            )}
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Valor (R$)</span>
              <input type="number" step="0.01" min="0.01" value={movValor} onChange={(e) => setMovValor(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Data</span>
              <input type="date" value={movData} onChange={(e) => setMovData(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-koma-muted">Descrição</span>
              <input value={movDesc} onChange={(e) => setMovDesc(e.target.value)} className="min-h-9 w-full rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
            </label>
            <div className="sm:col-span-2 lg:col-span-6 flex justify-end">
              <button type="submit" className="koma-btn-success"><Plus size={14} /> Registrar movimentação</button>
            </div>
          </form>

          <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel divide-y divide-koma-border text-xs">
            {movimentacoes.length === 0 ? (
              <p className="p-6 text-center text-koma-muted">Nenhuma movimentação registrada.</p>
            ) : movimentacoes.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <strong className="text-koma-foreground">{m.descricao}</strong>
                  <span className="ml-2 text-koma-muted">{m.data_movimento} · {m.tipo} ({m.origem_tipo})</span>
                </div>
                <strong className="font-mono text-koma-foreground">{currency.format(m.valor)}</strong>
              </div>
            ))}
          </section>
        </div>
      )}

      {subMode === 'cadastros' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={handleCriarCategoria} className="space-y-3 rounded-2xl border border-koma-border bg-koma-panel p-4">
            <h4 className="text-xs font-bold uppercase text-koma-foreground">Nova Categoria Financeira</h4>
            <div className="flex gap-2">
              <input placeholder="Nome da categoria" value={catNome} onChange={(e) => setCatNome(e.target.value)} className="min-h-9 flex-1 rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
              <select value={catTipo} onChange={(e) => setCatTipo(e.target.value)} className="koma-toolbar__select">
                <option value="despesa_fixa">Despesa Fixa</option>
                <option value="despesa_variavel">Despesa Variável</option>
                <option value="receita_extra">Receita Extra</option>
                <option value="tributo">Tributo</option>
              </select>
            </div>
            <button type="submit" className="koma-btn-success"><Plus size={14} /> Adicionar categoria</button>
          </form>

          <form onSubmit={handleCriarConta} className="space-y-3 rounded-2xl border border-koma-border bg-koma-panel p-4">
            <h4 className="text-xs font-bold uppercase text-koma-foreground">Nova Conta Financeira</h4>
            <div className="grid gap-2 sm:grid-cols-3">
              <input placeholder="Nome (ex.: Banco Inter)" value={contaNome} onChange={(e) => setContaNome(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 text-xs text-koma-foreground" />
              <select value={contaTipo} onChange={(e) => setContaTipo(e.target.value)} className="koma-toolbar__select">
                <option value="conta_bancaria">Conta Bancária</option>
                <option value="caixa_operacional">Caixa Operacional</option>
                <option value="carteira_digital">Carteira Digital</option>
              </select>
              <input type="number" step="0.01" placeholder="Saldo inicial" value={contaSaldoInicial} onChange={(e) => setContaSaldoInicial(e.target.value)} className="min-h-9 rounded-xl border border-koma-border bg-koma-input px-3 font-mono text-xs text-koma-foreground" />
            </div>
            <button type="submit" className="koma-btn-success"><Plus size={14} /> Adicionar conta</button>
          </form>
        </div>
      )}
    </div>
  );
}
