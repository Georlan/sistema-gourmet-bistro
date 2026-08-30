import React from 'react';
import clsx from 'clsx';
import { X, ArrowDownRight, ArrowUpRight, RefreshCw, Printer, TrendingUp, Utensils, CheckCircle2, UserCheck, UserX, ShoppingBag, Sun, Moon } from 'lucide-react';
import { KomaLogo } from '../KomaLogo';
import { LoginButton } from '../auth/LoginButton';
import type { Order, AppSettings, CaixaTurnoResumo } from '../../types';
import type { KomaTheme } from '../../config/theme';
import { deriveProductionState, getOrderItems } from '../../domain/operationalState';

export interface OperationalDrawerProps {
  portal: 'garcom' | 'caixa';
  restaurantName: string;
  activeWaiterName: string;
  waiterAvailable: boolean;
  orders: Order[];
  tableCounts: { libre: number; ocupada: number; pronto: number };
  turnoResumo: CaixaTurnoResumo | null;
  settings: AppSettings;
  theme: KomaTheme;
  onWaiterAvailabilityChange: (value: boolean) => void;
  onSettingsChange: (value: AppSettings) => void;
  onToggleTheme: () => void;
  onClose: () => void;
  onLogout: () => void;
  onSyncSalon: () => void;
}

/** Drawer UI only. App retains availability, preferences, visibility and scroll-lock state. */
export function OperationalDrawer({
  portal, restaurantName, activeWaiterName, waiterAvailable, orders, tableCounts,
  turnoResumo, settings, theme, onWaiterAvailabilityChange, onSettingsChange,
  onToggleTheme, onClose, onLogout, onSyncSalon,
}: OperationalDrawerProps) {
  return (
        <div className="fixed inset-0 z-50 flex animate-fade-in">
          <div
            id="sidebar-backdrop"
            onClick={() => onClose()}
            className="fixed inset-0 bg-black/80"
          />

          {/* Drawer content */}
          <div className="relative w-72 sm:w-80 max-w-sm bg-koma-panel border-r border-koma-border h-full flex flex-col justify-between shadow-2xl z-10 p-4 sm:p-6 text-koma-foreground overflow-y-auto animate-slide-in-left">
            <div className="space-y-6">

              {/* Header inside drawer */}
              <div className={clsx('flex', 'items-center', 'justify-between', 'pb-4', 'border-b', 'border-koma-border')}>
                <div className={clsx('flex', 'items-center', 'gap-2.5')}>
                  <KomaLogo size="md" />
                  <div>
                    <span className={clsx('font-serif', 'font-bold', 'text-base', 'text-koma-foreground', 'leading-none', 'block')}>{restaurantName}</span>
                    <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-sans font-medium block mt-0.5">Se você está com fome, Kôma</span>
                  </div>
                </div>
                <button
                  id="close-sidebar-btn"
                  onClick={() => onClose()}
                  className={clsx('p-1.5', 'rounded-lg', 'hover:bg-koma-card', 'text-koma-muted', 'hover:text-koma-foreground', 'transition-colors', 'cursor-pointer')}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Calculate real-time metrics for drawer dashboards */}
              {(() => {
                const mesasOcupadasCount = tableCounts.ocupada + tableCounts.pronto;
                const mesasLivresCount = tableCounts.libre;
                const pratosProntosCount = deriveProductionState(orders.flatMap(getOrderItems)).readyItemCount;

                const deliveryPendentesCount = orders.filter((o: any) =>
                  (o.tipo === 'DELIVERY' || o.tipo === 'BALCAO') &&
                  (o.status === 'NOVO' || o.status === 'PENDENTE' || o.status === 'AGUARDANDO_ACEITE')
                ).length;

                const totalVendasTurno = orders.reduce((acc: number, o: any) => {
                  return acc + (parseFloat(o.total) || parseFloat(o.valor_total) || 0);
                }, 0);

                const totalComandasAbertas = orders.filter((o: any) => o.status === 'ABERTA' || o.status === 'EM_ANDAMENTO' || o.status === 'OPEN').length;

                return portal === 'garcom' ? (
                  <>
                    {/* GARÇOM - MINHA CONTA & DISPONIBILIDADE */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400 font-sans">Garçom em Atendimento</h3>
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3.5 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-full flex items-center justify-center font-bold">
                            {activeWaiterName ? activeWaiterName[0] : 'G'}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-koma-foreground">{activeWaiterName || 'Garçom'}</h4>
                            <p className="text-[10px] text-koma-subtle font-sans">Atendimento • Salão Principal</p>
                          </div>
                        </div>

                        {/* Disponibilidade Toggle */}
                        <button
                          type="button"
                          onClick={() => onWaiterAvailabilityChange(!waiterAvailable)}
                          className={clsx(
                            'w-full py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between border',
                            waiterAvailable
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800/40 dark:text-emerald-300'
                              : 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800/40 dark:text-amber-300'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {waiterAvailable ? <UserCheck size={14} /> : <UserX size={14} />}
                            <span>{waiterAvailable ? 'Disponível no Salão' : 'Ocupado / Em Atendimento'}</span>
                          </div>
                          <span className={clsx('w-2 h-2 rounded-full animate-pulse', waiterAvailable ? 'bg-emerald-400' : 'bg-amber-400')} />
                        </button>

                        <LoginButton
                          variant="default"
                          iconType="logout"
                          onClick={onLogout}
                          className="w-full font-bold uppercase tracking-wider text-xs py-2.5"
                        >
                          LOGOUT / SAIR
                        </LoginButton>
                      </div>
                    </div>

                    {/* GARÇOM - RESUMO DO SALÃO EM TEMPO REAL */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400 font-sans">Status do Salão ao Vivo</h3>
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3 space-y-2">
                        <div className="flex items-center justify-between p-2.5 bg-koma-card border border-koma-border rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <Utensils size={14} className="text-emerald-700 dark:text-emerald-400" />
                            <span className="text-koma-secondary font-medium">Mesas Salão</span>
                          </div>
                          <span className="font-mono font-bold text-koma-foreground">
                            <strong className="text-emerald-700 dark:text-emerald-400">{mesasOcupadasCount}</strong> ocupadas / {mesasLivresCount} livres
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-2.5 bg-koma-card border border-koma-border rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className={pratosProntosCount > 0 ? "text-amber-700 dark:text-amber-300 animate-bounce" : "text-koma-muted"} />
                            <span className="text-koma-secondary font-medium">Pratos Prontos</span>
                          </div>
                          <span className={clsx('font-mono font-bold px-2 py-0.5 rounded-md text-[10px]', pratosProntosCount > 0 ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30' : 'text-koma-subtle bg-koma-raised')}>
                            {pratosProntosCount} p/ servir
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* GARÇOM - ATALHOS DE ATENDIMENTO */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400 font-sans">Atalhos de Atendimento</h3>
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onSyncSalon();
                          }}
                          className="w-full flex items-center justify-between p-2.5 bg-koma-card hover:bg-koma-raised border border-koma-border rounded-xl text-xs text-koma-foreground transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300 group-hover:bg-blue-500/20">
                              <RefreshCw size={14} />
                            </div>
                            <span className="font-semibold text-xs">Sincronizar Salão</span>
                          </div>
                          <span className="text-[9px] text-blue-700 dark:text-blue-300 font-mono font-bold">Ao Vivo</span>
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* CAIXA - OPERADOR & TURNO */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400 font-sans">Operador do Caixa</h3>
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3.5 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-full flex items-center justify-center font-bold">
                            {activeWaiterName ? activeWaiterName[0] : 'C'}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-koma-foreground">{activeWaiterName || 'Caixa'}</h4>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">Caixa Operacional Ativo</span>
                            </div>
                          </div>
                        </div>

                        <LoginButton
                          variant="default"
                          iconType="logout"
                          onClick={onLogout}
                          className="w-full font-bold uppercase tracking-wider text-xs py-2.5"
                        >
                          LOGOUT / SAIR
                        </LoginButton>
                      </div>
                    </div>

                    {/* CAIXA - AGENTE DE IMPRESSÃO & MONITOR (PRIORIDADE #1) */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400 font-sans">Sistema de Impressão</h3>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          window.dispatchEvent(new CustomEvent('koma-open-impressoras'));
                        }}
                        className="w-full flex items-center justify-between p-3 bg-koma-card hover:bg-koma-raised border border-koma-border rounded-2xl transition-all cursor-pointer group text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 group-hover:bg-emerald-500/20">
                            <Printer size={16} />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-koma-foreground">Agente de Impressão</h4>
                            <p className="text-[9px] text-emerald-700 dark:text-emerald-400 font-medium">Servidor Online • Pronto</p>
                          </div>
                        </div>
                        <span className="text-[9px] text-koma-subtle font-mono font-bold bg-koma-card px-2 py-1 rounded-lg border border-koma-border">0 Falhas</span>
                      </button>
                    </div>

                    {/* CAIXA - RESUMO DO TURNO EM TEMPO REAL (PRIORIDADE #2 - SINCRONIZADO COM BANCO DE DADOS) */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400 font-sans">Resumo do Turno ao Vivo</h3>
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3 space-y-2">
                        <div className="flex items-center justify-between p-2 bg-koma-card border border-koma-border rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <TrendingUp size={13} className="text-emerald-700 dark:text-emerald-400" />
                            <span className="text-koma-secondary font-medium text-[11px]">Vendas do Turno</span>
                          </div>
                          <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                            R$ {(turnoResumo?.total_vendas ?? totalVendasTurno).toFixed(2)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-2 bg-koma-card border border-koma-border rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <Utensils size={13} className="text-blue-700 dark:text-blue-300" />
                            <span className="text-koma-secondary font-medium text-[11px]">Comandas Abertas</span>
                          </div>
                          <span className="font-mono font-bold text-koma-foreground">
                            {turnoResumo?.comandas_abertas_count ?? totalComandasAbertas} ativas
                          </span>
                        </div>

                        {deliveryPendentesCount > 0 && (
                          <div className="flex items-center justify-between p-2 bg-amber-50 border border-amber-300 dark:bg-amber-950/20 dark:border-amber-800/30 rounded-xl text-xs">
                            <div className="flex items-center gap-2">
                              <ShoppingBag size={13} className="text-amber-700 dark:text-amber-300 animate-pulse" />
                              <span className="text-amber-600 dark:text-amber-300 font-medium text-[11px]">Delivery Pendente</span>
                            </div>
                            <span className="font-mono font-bold text-amber-600 dark:text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded text-[10px]">
                              {deliveryPendentesCount} p/ aceitar
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CAIXA - ATALHOS RÁPIDOS DE TESOURARIA */}
                    <div className="space-y-2.5">
                      <h3 className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400 font-sans">Operações de Tesouraria</h3>
                      <div className="bg-koma-card border border-koma-border rounded-2xl p-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            window.dispatchEvent(new CustomEvent('koma-open-suprimento'));
                          }}
                          className="w-full flex items-center justify-between p-2.5 bg-koma-card hover:bg-koma-raised border border-koma-border rounded-xl text-xs text-koma-foreground transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-500/20">
                              <ArrowDownRight size={14} />
                            </div>
                            <span className="font-semibold text-xs">Suprimento de Caixa</span>
                          </div>
                          <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-mono font-bold">+ Troco</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            window.dispatchEvent(new CustomEvent('koma-open-sangria'));
                          }}
                          className="w-full flex items-center justify-between p-2.5 bg-koma-card hover:bg-koma-raised border border-koma-border rounded-xl text-xs text-koma-foreground transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300 group-hover:bg-rose-500/20">
                              <ArrowUpRight size={14} />
                            </div>
                            <span className="font-semibold text-xs">Sangria de Segurança</span>
                          </div>
                          <span className="text-[9px] text-rose-700 dark:text-rose-300 font-mono font-bold">- Retirada</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            window.dispatchEvent(new CustomEvent('koma-sync-all'));
                          }}
                          className="w-full flex items-center justify-between p-2.5 bg-koma-card hover:bg-koma-raised border border-koma-border rounded-xl text-xs text-koma-foreground transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300 group-hover:bg-blue-500/20">
                              <RefreshCw size={14} />
                            </div>
                            <span className="font-semibold text-xs">Sincronizar Dados</span>
                          </div>
                          <span className="text-[9px] text-emerald-700 dark:text-emerald-400 font-mono font-bold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            Ao Vivo
                          </span>
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* SECTION 3: EXIBIÇÃO & PREFERÊNCIAS */}
              <div className="space-y-2.5">
                <h3 className={clsx('text-[10px]', 'uppercase', 'tracking-wider', 'font-bold', 'text-emerald-700', 'dark:text-emerald-400', 'font-sans')}>Exibição e Preferências</h3>
                <div className={clsx('bg-koma-card', 'border', 'border-koma-border', 'rounded-2xl', 'p-3.5', 'space-y-2.5')}>
                  <div className="flex items-center justify-between p-1 rounded">
                    <span className="text-xs text-koma-foreground font-medium">Tema Visual</span>
                    <button
                      type="button"
                      onClick={onToggleTheme}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-koma-panel border border-koma-border text-xs font-bold text-koma-foreground hover:bg-koma-raised transition-colors cursor-pointer"
                      title={theme === 'dark' ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro'}
                    >
                      {theme === 'dark' ? <Sun size={13} className="text-amber-400" /> : <Moon size={13} className="text-sky-500" />}
                      <span className="text-[10px] font-mono uppercase">{theme === 'dark' ? 'Escuro' : 'Claro'}</span>
                    </button>
                  </div>

                  <label className={clsx('flex', 'items-center', 'justify-between', 'text-xs', 'text-koma-foreground', 'cursor-pointer', 'p-1', 'rounded', 'hover:bg-koma-raised/40')}>
                    <span>Exibir Imagens dos Pratos</span>
                    <input
                      id="sidebar-toggle-images"
                      type="checkbox"
                      checked={settings.exibirImagens}
                      onChange={(e) => onSettingsChange({ ...settings, exibirImagens: e.target.checked })}
                      className={clsx('rounded', 'border-koma-border', 'text-emerald-500', 'focus:ring-emerald-500', 'h-4', 'w-4', 'bg-koma-card')}
                    />
                  </label>

                  <label className={clsx('flex', 'items-center', 'justify-between', 'text-xs', 'text-koma-foreground', 'cursor-pointer', 'p-1', 'rounded', 'hover:bg-koma-raised/40')}>
                    <span>Exibir Descrição dos Pratos</span>
                    <input
                      id="sidebar-toggle-descriptions"
                      type="checkbox"
                      checked={settings.exibirDescricoes}
                      onChange={(e) => onSettingsChange({ ...settings, exibirDescricoes: e.target.checked })}
                      className={clsx('rounded', 'border-koma-border', 'text-emerald-500', 'focus:ring-emerald-500', 'h-4', 'w-4', 'bg-koma-card')}
                    />
                  </label>
                </div>
              </div>

            </div>

            <div className={clsx('pt-4', 'border-t', 'border-koma-border', 'text-center', 'text-[10px]', 'text-koma-muted', 'font-sans')}>
              <p>{restaurantName}</p>
              <p className={clsx('mt-0.5', 'font-mono')}>v3.5 • Dark Engine</p>
            </div>
          </div>
        </div>
  );
}
