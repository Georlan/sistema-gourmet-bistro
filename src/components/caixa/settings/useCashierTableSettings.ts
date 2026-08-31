import React, { useState } from 'react';
import { projectCashierSalonTables } from '../../../domain/cashierOrderProjection';
import { Table } from '../../../types';
import type { CaixaPanelProps, CashierNotice } from '../cashierContracts';

type BoundaryProps = {
  onUpdateMesa: CaixaPanelProps['onUpdateMesa'];
  onDeleteMesa: CaixaPanelProps['onDeleteMesa'];
  salonTableCards: ReturnType<typeof projectCashierSalonTables>;
  salonTables: Table[];
  onCreateMesa: (id: number, capacidade: number, nome?: string) => Promise<void>;
  showToast: CashierNotice;
};

/** Owns table forms and mutation state; remains mounted when settings tabs change. */
export function useCashierTableSettings({
  onUpdateMesa,
  onDeleteMesa,
  salonTableCards,
  salonTables,
  onCreateMesa,
  showToast,
}: BoundaryProps) {
  const [showAddMesaModal, setShowAddMesaModal] = useState(false);

  const [newMesaId, setNewMesaId] = useState('');

  const [newMesaCap, setNewMesaCap] = useState('4');

  const [newMesaNome, setNewMesaNome] = useState('');

  const [editingTable, setEditingTable] = useState<Table | null>(null);

  const [editTableCap, setEditTableCap] = useState('');

  const [editTableNome, setEditTableNome] = useState('');

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const [tableMutation, setTableMutation] = useState<'create' | 'update' | 'delete' | null>(null);

  const [tableFormError, setTableFormError] = useState('');

  const editingTableRuntime = editingTable
    ? salonTableCards.find((card) => card.table.id === editingTable.id)
    : undefined;

  const handleAddMesaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tableMutation) return;
    const mesaId = Number.parseInt(newMesaId, 10);
    const capacidade = Number.parseInt(newMesaCap, 10);
    if (!Number.isFinite(mesaId) || mesaId <= 0) {
      setTableFormError('Informe um número de mesa maior que zero.');
      return;
    }
    if (!Number.isFinite(capacidade) || capacidade <= 0) {
      setTableFormError('Informe uma capacidade maior que zero.');
      return;
    }
    if (salonTables.some((table) => table.id === mesaId)) {
      setTableFormError(`A Mesa ${mesaId} já existe no salão.`);
      return;
    }

    try {
      setTableMutation('create');
      setTableFormError('');
      await onCreateMesa(mesaId, capacidade, newMesaNome.trim() || undefined);
      setShowAddMesaModal(false);
      setNewMesaId('');
      setNewMesaCap('4');
      setNewMesaNome('');
      showToast(`Mesa ${mesaId} adicionada ao salão.`, 'success');
    } catch (err: any) {
      setTableFormError(err?.message || 'Não foi possível criar a mesa. Tente novamente.');
    } finally {
      setTableMutation(null);
    }
  };
  const handleUpdateMesaSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingTable || tableMutation) return;
    const capacity = Number.parseInt(editTableCap, 10);
    if (!Number.isFinite(capacity) || capacity <= 0) {
      setTableFormError('Informe uma capacidade maior que zero.');
      return;
    }
    try {
      setTableMutation('update');
      setTableFormError('');
      await onUpdateMesa(editingTable.id, capacity, editTableNome.trim() || `Mesa ${editingTable.id}`);
      showToast(`Mesa ${editingTable.id} atualizada.`, 'success');
      setEditingTable(null);
    } catch (err: any) {
      setTableFormError(err?.message || 'Não foi possível atualizar a mesa.');
    } finally {
      setTableMutation(null);
    }
  };
  const handleDeleteMesa = async () => {
    if (!editingTable || tableMutation) return;
    try {
      setTableMutation('delete');
      setTableFormError('');
      await onDeleteMesa(editingTable.id);
      showToast(`Mesa ${editingTable.id} removida do salão.`, 'success');
      setEditingTable(null);
      setIsConfirmingDelete(false);
    } catch (err: any) {
      setTableFormError(err?.message || 'Não foi possível remover a mesa.');
      setIsConfirmingDelete(false);
    } finally {
      setTableMutation(null);
    }
  };
  return {
    handleDeleteMesa,
    handleUpdateMesaSubmit,
    showAddMesaModal,
    setShowAddMesaModal,
    newMesaId,
    setNewMesaId,
    newMesaCap,
    setNewMesaCap,
    newMesaNome,
    setNewMesaNome,
    editingTable,
    setEditingTable,
    editTableCap,
    setEditTableCap,
    editTableNome,
    setEditTableNome,
    isConfirmingDelete,
    setIsConfirmingDelete,
    tableMutation,
    setTableMutation,
    tableFormError,
    setTableFormError,
    editingTableRuntime,
    handleAddMesaSubmit,
  };
}
