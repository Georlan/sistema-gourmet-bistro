import { useEffect, useRef, useState } from 'react';
import { API } from '../../../config/caixaService';
import { SystemUser } from '../../../types';
import { EquipeCargosTab } from '../../equipe/EquipeCargosTab';
import { EquipePessoasTab } from '../../equipe/EquipePessoasTab';
import { KomaSnapshotLoading } from '../../shared/KomaSnapshotLoading';
import type { CashierNotice } from '../cashierContracts';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  showToast: CashierNotice;
}

export default function CashierTeam({
  apiBaseUrl,
  authHeaders,
  activeTab,
  activeSubTab,
  setActiveSubTab,
  showToast,
}: Props) {
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const [hasSystemUsersSnapshot, setHasSystemUsersSnapshot] = useState(false);
  const [systemUsersError, setSystemUsersError] = useState<string | null>(null);
  const systemUsersRequestRef = useRef<Promise<void> | null>(null);
  const scopeKey = `${apiBaseUrl}::${authHeaders.Authorization || authHeaders.authorization || 'anonymous'}`;

  const fetchSystemUsers = (): Promise<void> => {
    if (systemUsersRequestRef.current) return systemUsersRequestRef.current;
    setSystemUsersError(null);
    const request = (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/caixa/funcionarios`, { headers: authHeaders });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('TEAM_INVALID_RESPONSE');
        setSystemUsers(data);
        setHasSystemUsersSnapshot(true);
      } catch (error) {
        console.error('Error fetching system users:', error);
        setSystemUsersError('Não foi possível carregar a equipe agora.');
      }
    })();
    systemUsersRequestRef.current = request;
    void request.finally(() => {
      if (systemUsersRequestRef.current === request) systemUsersRequestRef.current = null;
    });
    return request;
  };

  useEffect(() => {
    setSystemUsers([]);
    setHasSystemUsersSnapshot(false);
    setSystemUsersError(null);
  }, [scopeKey]);

  useEffect(() => {
    if (activeTab !== 'permissoes_cargos') return;
    const refreshTeam = () => void fetchSystemUsers();
    window.addEventListener('koma_team_updated', refreshTeam);
    return () => window.removeEventListener('koma_team_updated', refreshTeam);
  }, [activeTab, apiBaseUrl, authHeaders.Authorization]);

  useEffect(() => {
    if (activeTab === 'permissoes_cargos' && ['pessoas', 'equipe', 'convites'].includes(activeSubTab)) {
      void fetchSystemUsers();
    }
  }, [activeTab, activeSubTab, scopeKey]);

  const handleAddUser = async (payload: { nome: string; telefone: string; cargo: string }) => {
    await API.cadastrarFuncionario(payload);
    await fetchSystemUsers();
    showToast('Pessoa cadastrada e convite agendado automaticamente!');
  };

  const handleResendInvite = async (user: SystemUser) => {
    try {
      const res = await fetch(`${apiBaseUrl}/auth/usuarios/${user.id}/reenviar-convite`, {
        method: 'POST',
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        showToast(data.message || `Convite para ${user.nome} agendado automaticamente!`);
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Não foi possível reenviar o convite no momento.');
      }
    } catch (err: any) {
      console.error(err);
      showToast(err?.message || 'Erro de conexão.', 'error');
      throw err;
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Deseja realmente excluir este funcionário?')) return;
    try {
      const res = await fetch(`${apiBaseUrl}/auth/usuarios/${userId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (res.ok) {
        showToast('Funcionário removido/desativado com sucesso!');
        await fetchSystemUsers();
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Erro ao remover a pessoa.');
      }
    } catch (err: any) {
      console.error(err);
      const message = err?.message || 'Erro ao conectar com o servidor para remover a pessoa.';
      showToast(message, 'error');
      throw err;
    }
  };

  const peopleViewActive = activeTab === 'permissoes_cargos' && ['pessoas', 'equipe', 'convites'].includes(activeSubTab);

  return (
    <>
      {peopleViewActive && !hasSystemUsersSnapshot && (
        <KomaSnapshotLoading
          testId="team-snapshot-loading"
          title="Sincronizando equipe"
          description="Carregando as pessoas e convites reais antes de mostrar contagens ou primeiros passos."
          error={systemUsersError}
          errorDescription="Ainda não foi possível confirmar a equipe. O KÔMA não vai assumir que ela está vazia."
          onRetry={() => void fetchSystemUsers()}
        />
      )}
      {peopleViewActive && hasSystemUsersSnapshot && (
        <EquipePessoasTab
          users={systemUsers}
          onCreate={handleAddUser}
          onResendInvite={handleResendInvite}
          onRemove={handleDeleteUser}
        />
      )}
      {activeTab === 'permissoes_cargos' && ['cargos_permissoes', 'cargos', 'permissoes'].includes(activeSubTab) && (
        <EquipeCargosTab apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} />
      )}
    </>
  );
}
