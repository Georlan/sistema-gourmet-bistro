import { useState } from 'react';
import type { useCashierInventoryData } from './useCashierInventoryData';

type BoundaryProps = Pick<ReturnType<typeof useCashierInventoryData>, 'refreshInventory'> & {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
};

/** Owns supplier drafts and mutations; inventory consumes one shared refresh callback. */
export function useCashierSupplierEditor({ apiBaseUrl, authHeaders, refreshInventory }: BoundaryProps) {
  const [showNewDistModal, setShowNewDistModal] = useState(false);

  const [showEditDistModal, setShowEditDistModal] = useState(false);

  const [selectedDist, setSelectedDist] = useState<any>(null);

  const [distFormNomeFantasia, setDistFormNomeFantasia] = useState('');

  const [distFormRazaoSocial, setDistFormRazaoSocial] = useState('');

  const [distFormCnpj, setDistFormCnpj] = useState('');

  const [distFormLeadTime, setDistFormLeadTime] = useState<number>(3);

  const handleSaveDistribuidor = async (isNew: boolean) => {
    try {
      const url = isNew
        ? `${apiBaseUrl}/estoque/distribuidores`
        : `${apiBaseUrl}/estoque/distribuidores/${selectedDist.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const body: any = {
        nome_fantasia: distFormNomeFantasia,
        razao_social: distFormRazaoSocial || null,
        cnpj: distFormCnpj || null,
        lead_time_dias: Number(distFormLeadTime),
      };

      const res = await fetch(url, {
        method,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        alert(isNew ? 'Distribuidor cadastrado com sucesso!' : 'Distribuidor atualizado com sucesso!');
        setShowNewDistModal(false);
        setShowEditDistModal(false);
        void refreshInventory('distribuidores');
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao salvar distribuidor.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão ao salvar distribuidor.');
    }
  };

  const handleDeleteDistribuidor = async (distId: string) => {
    if (!confirm('Deseja realmente excluir este distribuidor?')) return;
    try {
      const res = await fetch(`${apiBaseUrl}/estoque/distribuidores/${distId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (res.ok) {
        alert('Distribuidor excluído com sucesso!');
        void refreshInventory('distribuidores');
      } else {
        const err = await res.json();
        alert(err.detail || 'Erro ao excluir distribuidor.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro de conexão.');
    }
  };
  return {
    showNewDistModal,
    setShowNewDistModal,
    showEditDistModal,
    setShowEditDistModal,
    selectedDist,
    setSelectedDist,
    distFormNomeFantasia,
    setDistFormNomeFantasia,
    distFormRazaoSocial,
    setDistFormRazaoSocial,
    distFormCnpj,
    setDistFormCnpj,
    distFormLeadTime,
    setDistFormLeadTime,
    handleSaveDistribuidor,
    handleDeleteDistribuidor,
  };
}
