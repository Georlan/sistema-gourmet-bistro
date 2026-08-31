import type { CaixaPanelProps, CashierNotice } from '../cashierContracts';
import type { useCashierAlerts } from '../realtime/useCashierAlerts';
import type { useCashierPreferences } from './useCashierPreferences';
import clsx from 'clsx';
import {
  Bell,
  ChevronRight,
  Maximize2,
  Minimize2,
  RefreshCw,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import React from 'react';
import type { Order, Table } from '../../../types';
import { LoginButton } from '../../auth/LoginButton';

type BoundaryProps = Pick<
  ReturnType<typeof useCashierPreferences>,
  'toggleFullscreen' | 'isFullscreen' | 'changeFontSize' | 'fontSize'
> &
  Pick<ReturnType<typeof useCashierAlerts>, 'soundEnabled' | 'toggleSound' | 'playOrderAlert'> &
  Pick<CaixaPanelProps, 'activeWaiterNome' | 'orders' | 'salonTables' | 'onRefreshOrders'> & {
    isOperatorDrawerOpen: boolean;
    setIsOperatorDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleLogoutOperator: () => void;
    showToast: CashierNotice;
  };

/** Operator controls consume shared display preferences and existing callbacks. */
export function CashierOperatorDrawer({
  isOperatorDrawerOpen,
  setIsOperatorDrawerOpen,
  activeWaiterNome,
  handleLogoutOperator,
  orders,
  salonTables,
  onRefreshOrders,
  showToast,
  toggleFullscreen,
  isFullscreen,
  changeFontSize,
  fontSize,
  soundEnabled,
  toggleSound,
  playOrderAlert,
}: BoundaryProps) {
  return (
    <>
      {isOperatorDrawerOpen && (
        <div className={"fixed inset-0 z-[9998] flex justify-start animate-fade-in"}>
          {/* Backdrop escuro com clique para fechar */}
          <div
            onClick={() => setIsOperatorDrawerOpen(false)}
            className={"fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity cursor-pointer"}
          />

          {/* Drawer Lateral - Modernized Shadcn Dark Theme */}
          <div
            className={"relative w-80 max-w-[85vw] h-full bg-koma-card border-r border-koma-border shadow-2xl flex flex-col justify-between z-10 overflow-y-auto p-5 text-koma-foreground font-sans"}
          >
            <div className="space-y-5">
              {/* Header do Drawer */}
              <div
                className={"flex items-center justify-between border-b border-koma-border pb-4"}
              >
                <div className={"flex items-center gap-2.5"}>
                  <div
                    className={"p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"}
                  >
                    <SlidersHorizontal size={18} />
                  </div>
                  <div>
                    <h3 className={"font-bold text-base text-koma-foreground font-serif"}>
                      Opções do Caixa
                    </h3>
                    <span className={"text-xs text-koma-subtle block"}>
                      Sessão e Preferências
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOperatorDrawerOpen(false)}
                  className={"p-1.5 text-koma-subtle hover:text-koma-foreground bg-koma-panel hover:bg-koma-raised border border-koma-border rounded-xl cursor-pointer transition-all"}
                  title="Fechar Menu"
                >
                  <X size={16} />
                </button>
              </div>

              {/* 1. SEÇÃO GARÇOM / OPERADOR EM ATENDIMENTO */}
              <div
                className={"bg-koma-panel border border-koma-border rounded-2xl p-4 space-y-3.5 shadow-md"}
              >
                <span
                  className={"text-[9px] uppercase tracking-wider text-koma-subtle font-extrabold block"}
                >
                  Garçom / Operador em Atendimento
                </span>
                <div className={"flex items-center gap-3"}>
                  <div
                    className={"h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-800 flex items-center justify-center font-bold text-koma-foreground text-lg shadow-md shrink-0 font-serif border border-emerald-500/30"}
                  >
                    {(activeWaiterNome || 'G').charAt(0).toUpperCase()}
                  </div>
                  <div className={"min-w-0 flex-1"}>
                    <strong
                      className={"font-bold text-base text-koma-foreground block truncate"}
                    >
                      {activeWaiterNome || 'Georlan'}
                    </strong>
                    <span className={"text-xs text-emerald-400 font-medium block"}>
                      Operador de Caixa / Gerência
                    </span>
                  </div>
                </div>

                <LoginButton
                  variant="default"
                  iconType="logout"
                  onClick={handleLogoutOperator}
                  className={"w-full font-bold uppercase tracking-wider text-xs py-2.5"}
                >
                  LOGOUT / TROCAR OPERADOR
                </LoginButton>
              </div>

              {/* 2. SEÇÃO STATUS DO SALÃO AO VIVO */}
              {(() => {
                const liveOccupiedMesaIds = new Set(
                  orders
                    .filter(
                      (o) =>
                        o.mesaId &&
                        Number(o.mesaId) > 0 &&
                        o.status !== 'fechada' &&
                        o.status !== 'cancelado',
                    )
                    .map((o) => Number(o.mesaId)),
                );
                const liveTotalTablesCount = salonTables && salonTables.length > 0 ? salonTables.length : 30;
                const liveOccupiedTablesCount =
                  salonTables && salonTables.length > 0
                    ? salonTables.filter((t) => {
                        const tableNum = Number(t.id || t.numero);
                        return (
                          liveOccupiedMesaIds.has(tableNum) ||
                          t.status === 'ocupada' ||
                          t.status === 'occupied' ||
                          t.status === 'fechamento'
                        );
                      }).length
                    : liveOccupiedMesaIds.size;
                const liveFreeTablesCount = Math.max(0, liveTotalTablesCount - liveOccupiedTablesCount);

                return (
                  <div
                    className={"bg-koma-panel border border-koma-border rounded-2xl p-4 space-y-3 shadow-md"}
                  >
                    <div className={"flex items-center justify-between"}>
                      <span
                        className={"text-[9px] uppercase tracking-wider text-koma-subtle font-extrabold block"}
                      >
                        Status do Salão ao Vivo
                      </span>
                      <span
                        className={"text-[9px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1"}
                      >
                        <span
                          className={"w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"}
                        />
                        Tempo Real
                      </span>
                    </div>
                    <div className={"grid grid-cols-3 gap-2"}>
                      <div
                        className={"bg-koma-card border border-koma-border p-2.5 rounded-xl text-center shadow-xs"}
                      >
                        <span className={"text-[9px] text-koma-subtle block font-medium"}>
                          LIVRES
                        </span>
                        <strong className={"text-lg font-bold text-emerald-400 font-mono"}>
                          {liveFreeTablesCount}
                        </strong>
                      </div>
                      <div
                        className={"bg-koma-card border border-koma-border p-2.5 rounded-xl text-center shadow-xs"}
                      >
                        <span className={"text-[9px] text-koma-subtle block font-medium"}>
                          OCUPADAS
                        </span>
                        <strong className={"text-lg font-bold text-amber-400 font-mono"}>
                          {liveOccupiedTablesCount}
                        </strong>
                      </div>
                      <div
                        className={"bg-koma-card border border-koma-border p-2.5 rounded-xl text-center shadow-xs"}
                      >
                        <span className={"text-[9px] text-koma-subtle block font-medium"}>
                          TOTAL
                        </span>
                        <strong className={"text-lg font-bold text-sky-400 font-mono"}>
                          {liveTotalTablesCount}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 3. SEÇÃO ATALHOS DE ATENDIMENTO */}
              <div
                className={"bg-koma-panel border border-koma-border rounded-2xl p-4 space-y-2.5 shadow-md"}
              >
                <span
                  className={"text-[9px] uppercase tracking-wider text-koma-subtle font-extrabold block"}
                >
                  Atalhos de Atendimento
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (onRefreshOrders) onRefreshOrders();
                    showToast('Salão e pedidos sincronizados em tempo real!', 'success');
                  }}
                  className={"w-full py-2.5 px-3 bg-koma-card hover:bg-koma-raised/50 border border-koma-border text-koma-secondary hover:text-koma-foreground rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between group"}
                >
                  <div className={"flex items-center gap-2"}>
                    <RefreshCw
                      size={14}
                      className={"text-emerald-400 group-hover:rotate-180 transition-transform duration-500"}
                    />
                    <span>Sincronizar Salão e Pedidos</span>
                  </div>
                  <ChevronRight
                    size={14}
                    className={"text-koma-muted group-hover:text-koma-foreground"}
                  />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    toggleFullscreen();
                    setIsOperatorDrawerOpen(false);
                  }}
                  className={"w-full py-2.5 px-3 bg-koma-card hover:bg-koma-raised/50 border border-koma-border text-koma-secondary hover:text-koma-foreground rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between group"}
                >
                  <div className={"flex items-center gap-2"}>
                    {isFullscreen ? (
                      <Minimize2 size={14} className="text-sky-400" />
                    ) : (
                      <Maximize2 size={14} className="text-sky-400" />
                    )}
                    <span>{isFullscreen ? 'Sair do Modo PDV' : 'Modo PDV Imersivo'}</span>
                  </div>
                  <ChevronRight
                    size={14}
                    className={"text-koma-muted group-hover:text-koma-foreground"}
                  />
                </button>
              </div>

              {/* 4. SEÇÃO EXIBIÇÃO E PREFERÊNCIAS */}
              <div
                className={"bg-koma-panel border border-koma-border rounded-2xl p-4 space-y-3 shadow-md"}
              >
                <span
                  className={"text-[9px] uppercase tracking-wider text-koma-subtle font-extrabold block"}
                >
                  Exibição e Preferências
                </span>

                <div className="space-y-1.5">
                  <span className={"text-xs text-koma-secondary font-medium block"}>
                    Tamanho da Fonte:
                  </span>
                  <div
                    className={"grid grid-cols-3 gap-1 bg-koma-card p-1 rounded-xl border border-koma-border"}
                  >
                    {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => changeFontSize(sz)}
                        className={`py-1 rounded-lg text-xs font-bold uppercase transition-all cursor-pointer ${
                          fontSize === sz
                            ? 'bg-emerald-500 text-zinc-950 shadow-md font-extrabold'
                            : 'text-koma-subtle hover:text-koma-foreground'
                        }`}
                      >
                        {sz === 'padrao' ? 'Padrão' : sz === 'grande' ? 'Grande' : 'Gigante'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Alertas Sonoros do Caixa */}
                <div className="pt-2 border-t border-koma-border space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {soundEnabled ? (
                        <Volume2 size={15} className="text-emerald-400" />
                      ) : (
                        <VolumeX size={15} className="text-rose-400" />
                      )}
                      <span className="text-xs text-koma-secondary font-medium">Sons e Alertas do Caixa</span>
                    </div>
                    <button
                      type="button"
                      onClick={toggleSound}
                      className={clsx(
                        'px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border',
                        soundEnabled
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20',
                      )}
                    >
                      {soundEnabled ? 'Ativado' : 'Mudo'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      playOrderAlert('test');
                      showToast('🔊 Teste de som emitido na saída do computador!', 'info');
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-koma-card hover:bg-koma-raised border border-koma-border text-xs font-bold text-koma-foreground rounded-xl transition-all cursor-pointer"
                  >
                    <Bell size={13} className="text-amber-400" />
                    <span>Testar Caixa de Som (Bip)</span>
                  </button>
                </div>
              </div>
            </div>

            {/* RODAPÉ */}
            <div className={"pt-5 border-t border-koma-border text-center space-y-1"}>
              <span className={"text-xs font-bold text-koma-subtle block font-mono"}>
                Kôma v3.5 • Dark Engine
              </span>
              <span className={"text-[10px] text-koma-muted block"}>
                Sistema PDV Gourmet Multi-Tenant
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
