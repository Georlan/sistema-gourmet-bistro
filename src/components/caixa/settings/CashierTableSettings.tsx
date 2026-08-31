
import { Edit3, Plus, Users } from 'lucide-react';
import { Table } from '../../../types';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { useCashierTableSettings } from './useCashierTableSettings';
type BoundaryProps = Pick<
  ReturnType<typeof useCashierTableSettings>,
  | 'setTableFormError'
  | 'setShowAddMesaModal'
  | 'setEditingTable'
  | 'setEditTableCap'
  | 'setEditTableNome'
  | 'setIsConfirmingDelete'
> & {
  printingSettingsTab: 'impressao' | 'mesas' | 'garcom' | 'taxa';
  salonTables: Table[];
};

/** Table configuration presentation; form state remains owned by useCashierTableSettings. */
export function CashierTableSettings({
  printingSettingsTab,
  salonTables,
  setTableFormError,
  setShowAddMesaModal,
  setEditingTable,
  setEditTableCap,
  setEditTableNome,
  setIsConfirmingDelete,
}: BoundaryProps) {
  return (
    <>
      {printingSettingsTab === 'mesas' && (
        <OperationalBanner
          id="salon-tables-title"
          eyebrow="CONFIGURAÇÕES / SALÃO"
          title="Mesas"
          accent="prontas para receber"
          description="Capacidade e identificação do salão sem misturar configuração com comandas abertas."
          metrics={[
            { label: 'mesas cadastradas', value: salonTables.length },
            {
              label: 'lugares disponíveis',
              value: salonTables.reduce((total, table) => total + (table.capacidade || 4), 0),
            },
            {
              label: 'nomes personalizados',
              value: salonTables.filter((table) => Boolean(table.nome?.trim())).length,
            },
          ]}
        />
      )}
      {printingSettingsTab === 'mesas' && (
        <section
          className={"overflow-hidden rounded-[22px] border border-koma-border bg-koma-panel"}
        >
          <header
            className={"flex flex-col gap-3 border-b border-koma-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"}
          >
            <div>
              <h3 className={"text-sm font-bold text-koma-foreground"}>Configuração das mesas</h3>
              <p className={"mt-1 text-[10px] text-koma-muted"}>
                Cadastre, nomeie e defina a capacidade. A ocupação continua sendo controlada pelas comandas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTableFormError('');
                setShowAddMesaModal(true);
              }}
              className={"inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-[#10b981] px-4 text-[9px] font-extrabold uppercase tracking-wider text-[#07110e] transition-colors hover:bg-[#35c99a]"}
            >
              <Plus size={13} /> Adicionar mesa
            </button>
          </header>

          {salonTables.length === 0 ? (
            <div
              className={"flex min-h-48 flex-col items-center justify-center px-5 text-center"}
            >
              <Users size={22} className="text-koma-muted" />
              <strong className={"mt-3 text-xs text-koma-secondary"}>
                Nenhuma mesa cadastrada
              </strong>
              <span className={"mt-1 text-[10px] text-koma-muted"}>
                Adicione a primeira mesa para liberar a operação do salão.
              </span>
            </div>
          ) : (
            <div
              className={"grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"}
            >
              {[...salonTables]
                .sort((a, b) => a.id - b.id)
                .map((table) => (
                  <article
                    key={table.id}
                    className={"flex items-center justify-between gap-3 rounded-2xl border border-[#292e2c] bg-koma-card p-3.5"}
                  >
                    <div className="min-w-0">
                      <span
                        className={"block font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-koma-muted"}
                      >
                        Mesa {table.id}
                      </span>
                      <strong
                        className={"mt-0.5 block truncate text-xs text-koma-foreground"}
                      >
                        {table.nome || `Mesa ${table.id}`}
                      </strong>
                      <span
                        className={"mt-1 flex items-center gap-1 text-[9px] text-koma-muted"}
                      >
                        <Users size={10} /> {table.capacidade || 4} lugares
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTable(table);
                        setEditTableCap(String(table.capacidade || 4));
                        setEditTableNome(table.nome || '');
                        setIsConfirmingDelete(false);
                        setTableFormError('');
                      }}
                      aria-label={`Editar Mesa ${table.id}`}
                      className={"rounded-lg border border-koma-border-subtle bg-white/[0.025] p-2 text-koma-muted transition-colors hover:border-emerald-500/30 hover:text-emerald-800 dark:text-emerald-300"}
                    >
                      <Edit3 size={13} />
                    </button>
                  </article>
                ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
