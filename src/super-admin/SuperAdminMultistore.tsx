import { useEffect, useState } from 'react';
import { superAdminFetch, superAdminErrorMessage } from './superAdminApi';

type User = { id: string; name: string; role: string; status: string };
type Network = { id: string; owner_id: number; nome: string };
type Grant = { id: string; user_id: string; target_id: number; target_user_id: string };
const root = '/api/super-admin/multistore';
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await superAdminFetch(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Não foi possível salvar os vínculos.');
  return data;
}
export function SuperAdminMultistore({ tenantId, users }: { tenantId: number; users: User[] }) {
  const [index, setIndex] = useState<{ network: Network | null; accesses: Grant[] } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [networks, setNetworks] = useState<Network[]>([]);
  const [networkId, setNetworkId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targetUsers, setTargetUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [reason, setReason] = useState('');
  const [reciprocal, setReciprocal] = useState(true);
  const managers = (list: User[]) => list.filter(user => ['admin', 'gerente'].includes(user.role) && user.status === 'ativo');
  const load = async () => setIndex(await request(`${root}/units/${tenantId}`));
  useEffect(() => { let active = true; request(`${root}/units/${tenantId}`).then(data => { if (active) setIndex(data); }).catch(err => { if (active) setError(superAdminErrorMessage(err)); }); return () => { active = false; }; }, [tenantId]);
  async function act(action: () => Promise<void>, mutation = true) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); if (mutation) setNotice('Vínculo atualizado e registrado na auditoria.'); }
    catch (err) { setError(superAdminErrorMessage(err)); }
    finally { setBusy(false); }
  }
  const inputClass = 'w-full rounded-lg border border-koma-border bg-koma-panel px-3 py-2 text-sm text-koma-foreground';
  const buttonClass = 'min-h-11 rounded-lg border border-koma-border px-3 py-2 text-sm font-bold disabled:opacity-50';
  const canSave = reason.trim().length >= 5;
  return <section className="rounded-xl border border-koma-border bg-koma-card p-4 space-y-4">
    <div><h3 className="text-sm font-bold text-koma-foreground">Rede e unidades autorizadas</h3><p className="mt-1 text-xs text-koma-secondary">O vínculo da loja à rede e o acesso de cada gestor são cadastrados separadamente. Os IDs e os dados de cada loja permanecem iguais.</p></div>
    {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-400">{notice}</p>}
    {!index && <button type="button" className={buttonClass} onClick={() => void act(load, false)}>Consultar vínculos</button>}
    {index && <>
      <p className="text-sm font-bold text-koma-foreground">{index.network ? `Rede: ${index.network.nome}` : 'Loja independente'}</p>
      <label className="block text-xs text-koma-secondary">Motivo da alteração<input value={reason} onChange={event => setReason(event.target.value)} className={inputClass} placeholder="Confirmação da propriedade e do acesso" /></label>
      <fieldset disabled={busy} className="space-y-4">
        {!index.network && <>
          <div className="space-y-2"><label className="block text-xs text-koma-secondary">Criar rede com esta loja como matriz<input value={name} onChange={event => setName(event.target.value)} className={inputClass} placeholder="Nome da rede" /></label>
            <button type="button" disabled={!canSave || name.trim().length < 2} className={buttonClass} onClick={() => void act(async () => { await request(`${root}/networks`, 'POST', { owner_id: tenantId, nome: name, reason }); })}>Criar rede</button></div>
          <div className="space-y-2"><label className="block text-xs text-koma-secondary">Vincular a uma rede existente: ID da matriz<input type="number" min="1" value={ownerId} onChange={event => { setOwnerId(event.target.value); setNetworks([]); setNetworkId(''); }} className={inputClass} /></label>
            <button type="button" disabled={!Number(ownerId)} className={buttonClass} onClick={() => void act(async () => { setNetworks(await request(`${root}/networks/${Number(ownerId)}`)); }, false)}>Consultar redes da matriz</button>
            {networks.length > 0 && <label className="block text-xs text-koma-secondary">Rede<select value={networkId} onChange={event => setNetworkId(event.target.value)} className={inputClass}><option value="">Selecione</option>{networks.map(network => <option key={network.id} value={network.id}>{network.nome}</option>)}</select></label>}
            <button type="button" disabled={!canSave || !networkId} className={buttonClass} onClick={() => void act(async () => { await request(`${root}/units/${tenantId}`, 'PUT', { owner_id: Number(ownerId), network_id: networkId, reason }); })}>Vincular esta loja à rede</button>
          </div>
        </>}
        {index.network && <>
          <label className="block text-xs text-koma-secondary">Gestor desta loja<select value={userId} onChange={event => setUserId(event.target.value)} className={inputClass}><option value="">Selecione</option>{managers(users).map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          <label className="block text-xs text-koma-secondary">ID da unidade de destino<input type="number" min="1" value={targetId} onChange={event => { setTargetId(event.target.value); setTargetUsers([]); setTargetUserId(''); }} className={inputClass} /></label>
          <button type="button" disabled={!Number(targetId) || Number(targetId) === tenantId} className={buttonClass} onClick={() => void act(async () => {
            const targetIndex = await request(`${root}/units/${Number(targetId)}`);
            if (targetIndex.network?.id !== index.network?.id) throw new Error('A unidade de destino precisa estar vinculada à mesma rede.');
            const access = await request(`/api/super-admin/access/restaurantes/${Number(targetId)}`);
            setTargetUsers(access.users || []);
          }, false)}>Consultar gestores da unidade</button>
          {targetUsers.length > 0 && <label className="block text-xs text-koma-secondary">Conta do mesmo gestor na unidade de destino<select value={targetUserId} onChange={event => setTargetUserId(event.target.value)} className={inputClass}><option value="">Selecione</option>{managers(targetUsers).map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>}
          <label className="flex items-center gap-2 text-sm text-koma-secondary"><input type="checkbox" checked={reciprocal} onChange={event => setReciprocal(event.target.checked)} />Autorizar também o retorno a esta loja</label>
          <p className="text-xs text-koma-secondary">Confirme que as duas contas pertencem à mesma pessoa antes de autorizar.</p>
          <button type="button" disabled={!canSave || !userId || !targetUserId} className={buttonClass} onClick={() => void act(async () => {
            await request(`${root}/units/${tenantId}/accesses`, 'POST', { user_id: userId, target_id: Number(targetId), target_user_id: targetUserId, reason });
            if (reciprocal) {
              try { await request(`${root}/units/${Number(targetId)}/accesses`, 'POST', { user_id: targetUserId, target_id: tenantId, target_user_id: userId, reason }); }
              catch (err) { await load(); throw new Error(`Ida autorizada; o retorno não foi salvo. ${superAdminErrorMessage(err)}`); }
            }
          })}>Autorizar troca entre unidades</button>
          <div className="space-y-2">{index.accesses.map(grant => <div key={grant.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-koma-border p-3 text-xs text-koma-secondary">
            <span>{users.find(user => user.id === grant.user_id)?.name || 'Gestor'} → Loja #{grant.target_id}</span>
            <button type="button" disabled={!canSave} className={buttonClass} onClick={() => void act(async () => { await request(`${root}/units/${tenantId}/accesses/${grant.id}`, 'DELETE', { reason }); })}>Revogar acesso de ida</button>
          </div>)}</div>
          <p className="text-xs text-koma-secondary">A revogação encerra as sessões da conta na unidade de destino. Um vínculo de retorno, se criado, é administrado na ficha daquela unidade.</p>
        </>}
      </fieldset>
    </>}
  </section>;
}
