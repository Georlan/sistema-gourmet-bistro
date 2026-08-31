import React, { useState } from 'react';
import type { CashierNotice } from '../cashierContracts';

type Props = {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: CashierNotice;
  setCheckoutServiceTax: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useCashierSettings({ apiBaseUrl, authHeaders, showToast, setCheckoutServiceTax }: Props) {
  const [taxaServicoAtiva, setTaxaServicoAtiva] = useState(true);

  const [serviceTaxRate, setServiceTaxRate] = useState(10);

  const [unificarViasDelivery, setUnificarViasDelivery] = useState(false);

  const updateConfiguracoes = async (updates: {
    taxa_servico_ativa?: boolean;
    taxa_servico_padrao?: number;
    unificar_vias_delivery?: boolean;
    impressao_nome_restaurante?: string;
    impressao_nome_posicao?: 'cabecalho' | 'rodape' | 'oculto';
    impressao_mensagem_rodape?: string;
    perm_garcom_delivery?: boolean;
    perm_garcom_editar?: boolean;
    perm_garcom_taxas?: boolean;
    perm_garcom_cancelar?: boolean;
    perm_garcom_status?: boolean;
    perm_garcom_abrir_vazia?: boolean;
    perm_garcom_print?: boolean;
    perm_garcom_fechar?: boolean;
    perm_garcom_desconto?: boolean;
    perm_garcom_acrescimo?: boolean;
    perm_garcom_pessoas?: boolean;
    perm_garcom_transferir_mesa?: boolean;
    perm_garcom_transferir_item?: boolean;
    perm_garcom_chamar?: boolean;
    perm_garcom_ociosas?: boolean;
  }) => {
    const isPrintPersonalizationUpdate = [
      'impressao_nome_restaurante',
      'impressao_nome_posicao',
      'impressao_mensagem_rodape',
      'unificar_vias_delivery',
    ].some((key) => key in updates);
    if (isPrintPersonalizationUpdate) setPrintSettingsSaveState('saving');
    // 1. Atualização Otimista Instantânea (0ms) de todos os toggles
    if (updates.taxa_servico_ativa !== undefined) {
      setCheckoutServiceTax(updates.taxa_servico_ativa);
      setTaxaServicoAtiva(updates.taxa_servico_ativa);
    }
    if (updates.taxa_servico_padrao !== undefined) setServiceTaxRate(updates.taxa_servico_padrao);
    if (updates.unificar_vias_delivery !== undefined) setUnificarViasDelivery(updates.unificar_vias_delivery);
    if (updates.impressao_nome_restaurante !== undefined) setPrintHeader(updates.impressao_nome_restaurante);
    if (updates.impressao_nome_posicao !== undefined) setPrintNamePosition(updates.impressao_nome_posicao);
    if (updates.impressao_mensagem_rodape !== undefined) setPrintFooter(updates.impressao_mensagem_rodape);
    if (updates.perm_garcom_delivery !== undefined) setPermDelivery(updates.perm_garcom_delivery);
    if (updates.perm_garcom_editar !== undefined) setPermEdit(updates.perm_garcom_editar);
    if (updates.perm_garcom_taxas !== undefined) setPermAddCharges(updates.perm_garcom_taxas);
    if (updates.perm_garcom_cancelar !== undefined) setPermCancel(updates.perm_garcom_cancelar);
    if (updates.perm_garcom_status !== undefined) setPermShowStatus(updates.perm_garcom_status);
    if (updates.perm_garcom_abrir_vazia !== undefined) setPermOpenEmpty(updates.perm_garcom_abrir_vazia);
    if (updates.perm_garcom_print !== undefined) setPermAutoPrint(updates.perm_garcom_print);
    if (updates.perm_garcom_fechar !== undefined) setPermCloseAccount(updates.perm_garcom_fechar);
    if (updates.perm_garcom_desconto !== undefined) setPermDiscount(updates.perm_garcom_desconto);
    if (updates.perm_garcom_acrescimo !== undefined) setPermSurcharge(updates.perm_garcom_acrescimo);
    if (updates.perm_garcom_pessoas !== undefined) setPermPeopleCount(updates.perm_garcom_pessoas);
    if (updates.perm_garcom_transferir_mesa !== undefined) setPermTransferTables(updates.perm_garcom_transferir_mesa);
    if (updates.perm_garcom_transferir_item !== undefined) setPermTransferItems(updates.perm_garcom_transferir_item);
    if (updates.perm_garcom_chamar !== undefined) setPermClientCall(updates.perm_garcom_chamar);
    if (updates.perm_garcom_ociosas !== undefined) setPermShowIdleTables(updates.perm_garcom_ociosas);

    try {
      const res = await fetch(`${apiBaseUrl}/caixa/configuracoes`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        await fetchConfiguracoes();
        showToast(payload?.detail || 'Não foi possível salvar esta configuração.', 'error');
        if (isPrintPersonalizationUpdate) setPrintSettingsSaveState('error');
        return false;
      }
      if (isPrintPersonalizationUpdate) setPrintSettingsSaveState('saved');
      return true;
    } catch (e) {
      console.error('Error saving configurations:', e);
      await fetchConfiguracoes();
      showToast('Falha de conexão ao salvar a configuração.', 'error');
      if (isPrintPersonalizationUpdate) setPrintSettingsSaveState('error');
      return false;
    }
  };

  const [permDelivery, setPermDelivery] = useState(true);

  const [permEdit, setPermEdit] = useState(true);

  const [permAddCharges, setPermAddCharges] = useState(false);

  const [permCancel, setPermCancel] = useState(false);

  const [permShowStatus, setPermShowStatus] = useState(true);

  const [permOpenEmpty, setPermOpenEmpty] = useState(false);

  const [permAutoPrint, setPermAutoPrint] = useState(true);

  const [permPrintClose, setPermPrintClose] = useState(false);

  const [permCloseAccount, setPermCloseAccount] = useState(false);

  const [permDiscount, setPermDiscount] = useState(false);

  const [permSurcharge, setPermSurcharge] = useState(false);

  const [permPeopleCount, setPermPeopleCount] = useState(true);

  const [permTransferTables, setPermTransferTables] = useState(true);

  const [permTransferItems, setPermTransferItems] = useState(true);

  const [permClientCall, setPermClientCall] = useState(false);

  const [permShowIdleTables, setPermShowIdleTables] = useState(true);

  const [printHeader, setPrintHeader] = useState('Kôma Gourmet Bistrô');

  const [printFooter, setPrintFooter] = useState('');

  const [printNamePosition, setPrintNamePosition] = useState<'cabecalho' | 'rodape' | 'oculto'>('cabecalho');

  const [printSettingsSaveState, setPrintSettingsSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');

  const [isTestingPrinter, setIsTestingPrinter] = useState(false);

  const fetchConfiguracoes = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/configuracoes`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setCheckoutServiceTax(data.taxa_servico_ativa);
        setTaxaServicoAtiva(data.taxa_servico_ativa);
        setServiceTaxRate(data.taxa_servico_padrao);
        setUnificarViasDelivery(data.unificar_vias_delivery);
        setPrintHeader(data.impressao_nome_restaurante || 'Kôma Gourmet Bistrô');
        setPrintNamePosition(data.impressao_nome_posicao || 'cabecalho');
        setPrintFooter(data.impressao_mensagem_rodape || '');
        setPermDelivery(data.perm_garcom_delivery);
        setPermEdit(data.perm_garcom_editar);
        setPermAddCharges(data.perm_garcom_taxas);
        setPermCancel(data.perm_garcom_cancelar);
        setPermShowStatus(data.perm_garcom_status);
        setPermOpenEmpty(data.perm_garcom_abrir_vazia);
        setPermAutoPrint(data.perm_garcom_print);
        setPermCloseAccount(data.perm_garcom_fechar);
        setPermDiscount(data.perm_garcom_desconto);
        setPermSurcharge(data.perm_garcom_acrescimo);
        setPermPeopleCount(data.perm_garcom_pessoas);
        setPermTransferTables(data.perm_garcom_transferir_mesa);
        setPermTransferItems(data.perm_garcom_transferir_item);
        setPermClientCall(data.perm_garcom_chamar);
        setPermShowIdleTables(data.perm_garcom_ociosas);
      }
    } catch (e) {
      console.error('Error fetching configurations', e);
    }
  };

  const handleTestPrinter = async () => {
    if (isTestingPrinter) return;
    setIsTestingPrinter(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/print-agents/jobs/inject`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          document_type: 'fechamento',
          destination: 'FECHAMENTO',
          source_type: 'teste_painel',
          source_id: `teste-${Date.now()}`,
          payload_text: [
            '================================',
            ...(printNamePosition === 'cabecalho' && printHeader ? [printHeader] : []),
            '================================',
            'TESTE REAL DO KÔMA PRINT',
            new Date().toLocaleString('pt-BR'),
            '================================',
            printFooter || '',
            ...(printNamePosition === 'rodape' && printHeader ? [printHeader] : []),
          ].join('\n'),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail || 'Erro ao colocar o teste na fila.');
      }
      window.dispatchEvent(new Event('koma_print_monitor_refresh'));
    } catch (error) {
      console.error(error);
      showToast(
        error instanceof Error ? error.message : 'Não foi possível comunicar com a fila de impressão.',
        'error',
      );
    } finally {
      setIsTestingPrinter(false);
    }
  };

  return {
    taxaServicoAtiva,
    setTaxaServicoAtiva,
    serviceTaxRate,
    setServiceTaxRate,
    unificarViasDelivery,
    setUnificarViasDelivery,
    updateConfiguracoes,
    permDelivery,
    setPermDelivery,
    permEdit,
    setPermEdit,
    permAddCharges,
    setPermAddCharges,
    permCancel,
    setPermCancel,
    permShowStatus,
    setPermShowStatus,
    permOpenEmpty,
    setPermOpenEmpty,
    permAutoPrint,
    setPermAutoPrint,
    permPrintClose,
    setPermPrintClose,
    permCloseAccount,
    setPermCloseAccount,
    permDiscount,
    setPermDiscount,
    permSurcharge,
    setPermSurcharge,
    permPeopleCount,
    setPermPeopleCount,
    permTransferTables,
    setPermTransferTables,
    permTransferItems,
    setPermTransferItems,
    permClientCall,
    setPermClientCall,
    permShowIdleTables,
    setPermShowIdleTables,
    printHeader,
    setPrintHeader,
    printFooter,
    setPrintFooter,
    printNamePosition,
    setPrintNamePosition,
    printSettingsSaveState,
    setPrintSettingsSaveState,
    isTestingPrinter,
    setIsTestingPrinter,
    fetchConfiguracoes,
    handleTestPrinter,
  };
}
