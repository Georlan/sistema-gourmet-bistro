import React from 'react';
import clsx from 'clsx';

interface CardapioCategoriasTabProps {
  apiCategorias: any[];
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  fetchCategorias: () => Promise<void>;
}

export function CardapioCategoriasTab({
  apiCategorias,
  apiBaseUrl,
  authHeaders,
  fetchCategorias,
}: CardapioCategoriasTabProps) {
  return (
    <div className={clsx('space-y-4', 'animate-fade-in', 'text-left')}>
      <div className={clsx('flex', 'justify-between', 'items-center')}>
        <div>
          <span className={clsx('font-serif', 'font-bold', 'text-gray-300', 'text-base', 'block')}>Categorias do Cardápio</span>
          <span className={clsx('text-[9px]', 'text-gray-500')}>{apiCategorias.length} categorias cadastradas</span>
        </div>
      </div>

      <div className={clsx('bg-[#121214]/50', 'border', 'border-[#27272A]', 'rounded-3xl', 'overflow-hidden')}>
        <div className={clsx('overflow-x-auto')}>
          <table className={clsx('w-full', 'text-left', 'border-collapse', 'font-sans', 'text-[11px]')}>
            <thead>
              <tr className={clsx('border-b', 'border-[#27272A]', 'bg-[#18181B]/50', 'text-gray-400', 'font-bold', 'uppercase', 'tracking-wider')}>
                <th className={clsx('p-4')}>Nome</th>
                <th className={clsx('p-4')}>Impressão</th>
                <th className={clsx('p-4', 'text-right')}>Ações</th>
              </tr>
            </thead>
            <tbody className={clsx('divide-y', 'divide-[#27272A]/40')}>
              {apiCategorias.map((cat) => (
                <tr key={cat.id} className={clsx('hover:bg-[#1C1C1F]/30', 'transition-colors', 'text-white')}>
                  <td className={clsx('p-4', 'font-semibold')}>{cat.nome}</td>
                  <td className={clsx('p-4')}>
                    <span className={clsx('px-2', 'py-0.5', 'text-[9px]', 'font-bold', 'rounded-md', 'border', 
                      cat.destino_impressao === 'COZINHA' 
                        ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' 
                        : cat.destino_impressao === 'BAR' 
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                          : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                    )}>
                      {cat.destino_impressao}
                    </span>
                  </td>
                  <td className={clsx('p-4', 'text-right', 'space-x-2')}>
                    <button
                      onClick={async () => {
                        const newNome = prompt('Digite o novo nome da categoria (deixe vazio para manter o atual):', cat.nome);
                        const newDestino = prompt('Digite o novo destino de impressão (COZINHA, BAR, ou NENHUM):', cat.destino_impressao);
                        if (newDestino && newDestino !== 'COZINHA' && newDestino !== 'BAR' && newDestino !== 'NENHUM') {
                          alert('Destino inválido! Deve ser COZINHA, BAR ou NENHUM.');
                          return;
                        }
                        try {
                          const res = await fetch(`${apiBaseUrl}/produtos/categorias/${cat.id}`, {
                            method: 'PUT',
                            headers: {
                              ...authHeaders,
                              'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                              nome: newNome || undefined,
                              destino_impressao: newDestino || undefined
                            })
                          });
                          if (res.ok) {
                            alert('Categoria atualizada!');
                            await fetchCategorias();
                          } else {
                            const err = await res.json();
                            alert(`Erro: ${err.detail || 'Falha ao atualizar.'}`);
                          }
                        } catch (e) {
                          console.error(e);
                          alert('Erro ao conectar ao servidor.');
                        }
                      }}
                      className="px-2.5 py-1 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 text-gray-300 hover:text-white rounded-lg transition-all cursor-pointer font-bold"
                    >
                      Editar
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm(`Deseja realmente excluir a categoria "${cat.nome}"?`)) {
                          try {
                            const res = await fetch(`${apiBaseUrl}/produtos/categorias/${cat.id}`, {
                              method: 'DELETE',
                              headers: authHeaders
                            });
                            if (res.ok) {
                              alert('Categoria excluída!');
                              await fetchCategorias();
                            } else {
                              const err = await res.json();
                              alert(`Erro: ${err.detail || 'Falha ao excluir.'}`);
                            }
                          } catch (e) {
                            console.error(e);
                            alert('Erro ao conectar ao servidor.');
                          }
                        }
                      }}
                      className="px-2.5 py-1 border border-red-900/40 hover:border-red-600/30 bg-red-950/20 hover:bg-red-900/25 text-red-400 hover:text-white rounded-lg transition-all cursor-pointer font-bold"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
