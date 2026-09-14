import React, { useRef, useState } from 'react';
import { DEFAULT_WAITER_PERMISSIONS, patchWaiterPermissions, readWaiterPermissions, type WaiterPermissions } from './waiterPermissions';
import type { CashierNotice } from '../cashierContracts';

type Props = {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  showToast: CashierNotice;
  setCheckoutServiceTax: React.Dispatch<React.SetStateAction<boolean>>;
};

export type CashierSettingsLoadState = 'loading' | 'loaded' | 'error';

export function useCashierSettings({ apiBaseUrl, authHeaders, showToast, setCheckoutServiceTax }: Props) {
  // Estes valores só são placeholders internos até settingsLoadState=loaded.
  // Nenhuma decisão operacional deve usar defaults locais como se viessem do servidor.
  const [settingsLoadState, setSettingsLoadState] = useState<CashierSettingsLoadState>('loading');
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
    if (settingsLoadState !== 'loaded') {
      showToast('Aguarde a sincronização das configurações do caixa antes de alterar esta opção.', 'info');
      return false;
    }
    const isPrintPersonalizationUpdate = [
      'impressao_nome_restaurante',
      'impressao_nome_posicao',
      'impressao_mensagem_rodape',
      'unificar_vias_delivery',
    ].some((key) => key in updates);
    if (isPrintPersonalizationUpdate) setPrintSettingsSaveState('saving');
    setWaiterPermissions(current => patchWaiterPermissions(current, updates));
    // Atualização otimista somente depois que existe uma base autoritativa carregada.
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
  const isTestingPrinterRef = useRef(false);

  const fetchConfiguracoes = async () => {
    setSettingsLoadState((current) => current === 'loaded' ? current : 'loading');
    try {
      const res = await fetch(`${apiBaseUrl}/caixa/configuracoes`, { headers: authHeaders });
      if (!res.ok) {
        setSettingsLoadState((current) => current === 'loaded' ? current : 'error');
        return;
      }
      const data = await res.json();
      setWaiterPermissions(readWaiterPermissions(data));
      setCheckoutServiceTax(Boolean(data.taxa_servico_ativa));
      setTaxaServicoAtiva(Boolean(data.taxa_servico_ativa));
      setServiceTaxRate(Number(data.taxa_servico_padrao) || 0);
      setUnificarViasDelivery(Boolean(data.unificar_vias_delivery));
      setPrintHeader(data.impressao_nome_restaurante || 'Kôma Gourmet Bistrô');
      setPrintNamePosition(data.impressao_nome_posicao || 'cabecalho');
      setPrintFooter(data.impressao_mensagem_rodape || '');
      setSettingsLoadState('loaded');
    } catch (e) {
      console.error('Error fetching configurations', e);
      setSettingsLoadState((current) => current === 'loaded' ? current : 'error');
    }
  };

  const handleTestPrinter = async () => {
    if (isTestingPrinterRef.current) return;
    isTestingPrinterRef.current = true;
    setIsTestingPrinter(true);
    try {
      const res = await fetch(`${apiBaseUrl}/impressao/teste-extremo-cardapio`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail || 'Erro ao colocar o teste extremo na fila.');
      }
      window.dispatchEvent(new Event('koma_print_monitor_refresh'));
      showToast('Teste extremo do Cardápio Online enviado para a impressora.', 'success');
    } catch (error) {
      console.error(error);
      showToast(
        error instanceof Error ? error.message : 'Não foi possível comunicar com a fila de impressão.',
        'error',
      );
    } finally {
      isTestingPrinterRef.current = false;
      setIsTestingPrinter(false);
    }
  };

  return {
    settingsLoadState,
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
