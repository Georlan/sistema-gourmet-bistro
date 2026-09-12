import React, { useState } from 'react';
import { API_BASE_URL } from '../../config/api';
type Product = { id: string; nome: string; preco: number; categoria_id: string; descricao?: string };
export function CatalogImport({ accessToken, onImported }: { accessToken: string; onImported: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<unknown[] | undefined>();
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const readFile = async (file?: File) => {
    setProducts([]); setCategories(undefined); setConfirmed(false); setNotice('');
    if (!file) return;
    if (file.size > 2_000_000) { setNotice('O arquivo deve ter até 2 MB.'); return; }
    try {
      const value = JSON.parse(await file.text());
      const rows = Array.isArray(value) ? value : value.products || value.produtos;
      if (!Array.isArray(rows) || !rows.length || rows.length > 2000) throw new Error('O arquivo deve conter de 1 a 2000 produtos.');
      const parsed = rows.map((row: Product) => {
        if (!row || typeof row.id !== 'string' || !row.id.trim() || typeof row.nome !== 'string' || !row.nome.trim() || typeof row.categoria_id !== 'string' || !row.categoria_id.trim() || typeof row.preco !== 'number' || !Number.isFinite(row.preco) || row.preco < 0) throw new Error('Cada produto precisa de id, nome, preco numérico e categoria_id.');
        return row;
      });
      if (new Set(parsed.map(row => row.id)).size !== parsed.length) throw new Error('Há IDs duplicados. Revise o arquivo.');
      const importedCategories = Array.isArray(value) ? undefined : value.categories || value.categorias;
      if (importedCategories !== undefined && !Array.isArray(importedCategories)) throw new Error('Categorias devem ser uma lista.');
      setCategories(importedCategories);
      setProducts(parsed);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível ler o arquivo JSON.'); }
  };
  const publish = async () => {
    setBusy(true); setNotice('');
    try {
      const response = await fetch(`${API_BASE_URL}/produtos/importar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ products, mode, ...(categories ? { categories } : {}) }) });
      if (!response.ok) throw new Error('Não foi possível importar. Confira o arquivo e tente novamente.');
      setProducts([]); setConfirmed(false); setNotice('Cardápio publicado. Caixa, garçom e cardápio online recebem a atualização.'); onImported();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Falha ao importar.'); }
    finally { setBusy(false); }
  };
  return <section className="mt-6 rounded-2xl border border-koma-border p-4">
    <h2 className="font-bold">Importar cardápio</h2><p className="my-2 text-sm text-koma-muted">Envie um arquivo JSON de produtos e confira os preços antes de publicar. Complementos e escolhas obrigatórias devem ser configurados no catálogo.</p>
    <details className="my-3 text-sm"><summary>Ver exemplo de arquivo</summary><pre className="overflow-x-auto p-2">{'[{"id":"prato-1","nome":"Prato do dia","preco":25.90,"categoria_id":"cat-pratos"}]'}</pre></details>
    <input aria-label="Arquivo do cardápio" type="file" accept=".json,application/json" disabled={busy} onChange={event => void readFile(event.target.files?.[0])} />
    {products.length > 0 && <><p className="mt-3">{products.length} produtos prontos para revisão.</p><div className="my-3 max-h-64 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Produto</th><th>Preço</th><th>Categoria</th></tr></thead><tbody>{products.map(p => <tr key={p.id}><td>{p.nome}</td><td>{p.preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td>{p.categoria_id}</td></tr>)}</tbody></table></div>
    <select aria-label="Modo da importação" className="my-3 rounded bg-koma-page p-2" value={mode} disabled={busy} onChange={event => { setMode(event.target.value as 'merge' | 'replace'); setConfirmed(false); }}><option value="merge">Adicionar e atualizar por ID</option><option value="replace">Substituir cardápio e inativar produtos ausentes</option></select>
    <label className="block text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> Conferi nomes e preços{mode === 'replace' ? ' e autorizo inativar os produtos ausentes neste arquivo' : ''}.</label>
    <button className="mt-3 rounded-xl bg-emerald-500 px-4 py-2 text-zinc-950 disabled:opacity-50" disabled={!confirmed || busy} onClick={() => void publish()}>{busy ? 'Publicando…' : 'Publicar cardápio'}</button></>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
  </section>;
}
