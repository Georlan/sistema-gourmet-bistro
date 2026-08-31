import React, { useState } from 'react';
import { DEFAULT_WAITER_PERMISSIONS, patchWaiterPermissions, readWaiterPermissions, type WaiterPermissions } from './waiterPermissions';
import type { CashierNotice } from '../cashierContracts';

type Props = {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: CashierNotice;
  setCheckoutServiceTax: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useCashierSettings({ apiBaseUrl, authHeaders, showToast, setCheckoutServiceTax }: Props) {
  const [waiterPermissions, setWaiterPermissions] = useState(DEFAULT_WAITER_PERMISSIONS);
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
  } & Partial<WaiterPermissions>) => {
    const isPrintPersonalizationUpdate = [
      'impressao_nome_restaurante',
      'impressao_nome_posicao',
      'impressao_mensagem_rodape',
      'unificar_vias_delivery',
    ].some((key) => key in updates);
    if (isPrintPersonalizationUpdate) setPrintSettingsSaveState('saving');
    setWaiterPermissions(current => patchWaiterPermissions(current, updates));
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
        setWaiterPermissions(readWaiterPermissions(data));
        setCheckoutServiceTax(data.taxa_servico_ativa);
        setTaxaServicoAtiva(data.taxa_servico_ativa);
        setServiceTaxRate(data.taxa_servico_padrao);
        setUnificarViasDelivery(data.unificar_vias_delivery);
        setPrintHeader(data.impressao_nome_restaurante || 'Kôma Gourmet Bistrô');
        setPrintNamePosition(data.impressao_nome_posicao || 'cabecalho');
        setPrintFooter(data.impressao_mensagem_rodape || '');
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
    waiterPermissions,
    taxaServicoAtiva,
    setTaxaServicoAtiva,
    serviceTaxRate,
    setServiceTaxRate,
    unificarViasDelivery,
    setUnificarViasDelivery,
    updateConfiguracoes,
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
