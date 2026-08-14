import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { ShieldCheck, RefreshCw, AlertTriangle } from 'lucide-react';

interface CargoPermissoesItem {
  slug: string;
  label: string;
  total_funcionarios: number;
  permissoes: {
    pedidos: boolean;
    caixa: boolean;
    relatorios: boolean;
    equipe: boolean;
    admin: boolean;
  };
}

interface EquipeCargosTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

const PERM_COLS: { key: keyof CargoPermissoesItem['permissoes']; label: string }[] = [
  { key: 'pedidos', label: 'Acesso a Pedidos' },
  { key: 'caixa', label: 'Acesso ao Caixa' },
  { key: 'relatorios', label: 'Acesso a Relatórios' },
  { key: 'equipe', label: 'Gestão de Equipe' },
  { key: 'admin', label: 'Administração' },
];

export const EquipeCargosTab: React.FC<EquipeCargosTabProps> = ({ apiBaseUrl, authHeaders }) => {
  const [cargos, setCargos] = useState<CargoPermissoesItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const fetchCargos = async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const res = await fetch(`${apiBaseUrl}/relatorios/cargos-permissoes`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCargos(json.cargos ?? []);
    } catch (err) {
      console.error('Erro ao carregar cargos e permissões:', err);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCargos();
  }, []);

  return (
    <div className={clsx('space-y-6', 'animate-fade-in', 'text-left')}>
      <div className={clsx('bg-koma-panel/60', 'border', 'border-koma-border', 'rounded-3xl', 'p-5', 'space-y-4')}>
        {/* Header */}
        <div className={clsx('border-b', 'border-koma-border', 'pb-3', 'flex', 'items-center', 'justify-between')}>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-emerald-700 dark:text-emerald-400" />
            <span className={clsx('font-serif', 'font-bold', 'text-sm', 'text-koma-foreground')}>Cargos e Permissões</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-koma-muted">Controle de acesso por função</span>
          </div>
        </div>

        {/* Error State */}
        {hasError && !isLoading && (
          <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-[10px]">
            <AlertTriangle size={14} />
            <span>Erro ao carregar dados. Verifique a conexão e tente novamente.</span>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="p-12 text-center text-koma-subtle text-xs animate-pulse">
            Carregando cargos e permissões...
          </div>
        )}

        {/* Table */}
        {!isLoading && !hasError && cargos.length > 0 && (
          <div className="overflow-x-auto border border-koma-border rounded-2xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-koma-raised border-b border-koma-border text-koma-muted uppercase tracking-wider font-extrabold text-[9px]">
                <tr>
                  <th className="p-3.5">Cargo</th>
                  <th className="p-3.5 text-center font-mono">Funcionários</th>
                  {PERM_COLS.map(col => (
                    <th key={col.key} className="p-3.5">{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {cargos.map(cargo => (
                  <tr key={cargo.slug} className="hover:bg-koma-raised/50 transition-colors">
                    <td className="p-3.5 font-bold text-koma-foreground">{cargo.label}</td>
                    <td className="p-3.5 text-center font-mono text-koma-foreground font-bold text-xs">
                      {cargo.total_funcionarios}
                    </td>
                    {PERM_COLS.map(col => (
                      <td key={col.key} className="p-3.5">
                        <span className={`px-2.5 py-0.5 text-[8px] font-extrabold rounded-md uppercase tracking-wider ${
                          cargo.permissoes[col.key]
                            ? 'koma-badge-success'
                            : 'koma-badge-neutral'
                        }`}>
                          {cargo.permissoes[col.key] ? 'Sim' : 'Não'}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !hasError && cargos.length === 0 && (
          <div className="p-12 text-center text-koma-muted text-xs">
            Nenhum cargo encontrado para este restaurante.
          </div>
        )}

        <p className="text-[9px] text-koma-muted pt-1">
          * Contagem de funcionários reflete os dados cadastrados no sistema. Permissões são gerenciadas
          automaticamente pelo sistema conforme o cargo atribuído.
        </p>
      </div>
    </div>
  );
};
