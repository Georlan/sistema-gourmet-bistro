import React, { useRef, useState } from 'react';
import { projectCashierSalonTables } from '../../../domain/cashierSalonProjection';
import { previewTableRange } from '../../../domain/tableRange';
import { Table } from '../../../types';
import type { CaixaPanelProps, CashierNotice } from '../cashierContracts';

type BoundaryProps = {
  onUpdateMesa: CaixaPanelProps['onUpdateMesa'];
  onDeleteMesa: CaixaPanelProps['onDeleteMesa'];
  salonTableCards: ReturnType<typeof projectCashierSalonTables>;
  salonTables: Table[];
  onCreateMesa: (id: number, capacidade: number, nome?: string) => Promise<void>;
  onCreateMesas?: CaixaPanelProps['onCreateMesas'];
  showToast: CashierNotice;
};

/** Owns table forms and mutation state; remains mounted when settings tabs change. */
export function useCashierTableSettings({
  onUpdateMesa,
  onDeleteMesa,
  salonTableCards,
  salonTables,
  onCreateMesa,
  onCreateMesas,
  showToast,
}: BoundaryProps) {
  const [showAddMesaModal, setShowAddMesaModal] = useState(false);

  const [mesaCreateMode, setMesaCreateMode] = useState<'single' | 'batch'>('single');
  const [mesaRangeFirst, setMesaRangeFirst] = useState('');
  const [mesaRangeLast, setMesaRangeLast] = useState('');
  const createInFlight = useRef(false);

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

  const rangePreview = previewTableRange(mesaRangeFirst, mesaRangeLast, newMesaCap, salonTables.map(table => table.id));
  const suggestedFirst = String(Math.max(0, ...salonTables.map(table => table.id)) + 1);

  const handleAddMesaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tableMutation || createInFlight.current) return;
    if (mesaCreateMode === 'batch') {
      if (!onCreateMesas) { setTableFormError('O cadastro em lote não está disponível.'); return; }
      if (rangePreview.error || !rangePreview.ids.length) { setTableFormError(rangePreview.error || 'Todas as mesas desse intervalo já existem.'); return; }
      createInFlight.current = true;
      setTableMutation('create');
      setTableFormError('');
      try {
        const result = await onCreateMesas(Number(mesaRangeFirst), Number(mesaRangeLast), Number(newMesaCap));
        setShowAddMesaModal(false);
        setMesaCreateMode('single');
        setMesaRangeFirst('');
        setMesaRangeLast('');
        showToast(result.created_ids.length ? `${result.created_ids.length} mesas adicionadas. As existentes foram preservadas.` : 'As mesas desse intervalo já estavam cadastradas. Nenhuma mesa foi alterada.', 'success');
      } catch (error: any) {
        setTableFormError(error?.message || 'Não foi possível adicionar as mesas. Tente novamente.');
      } finally {
        createInFlight.current = false;
        setTableMutation(null);
      }
      return;
    }
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
    mesaCreateMode, setMesaCreateMode, mesaRangeFirst, setMesaRangeFirst, mesaRangeLast, setMesaRangeLast, rangePreview, suggestedFirst, batchAvailable: Boolean(onCreateMesas),
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
