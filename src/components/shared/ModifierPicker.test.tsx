import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CatalogModifierGroup } from '../../catalog/catalog';
import ModifierPicker from './ModifierPicker';

const groups: CatalogModifierGroup[] = [
  {
    id: 'recommended',
    nome: 'Carnes e Proteínas',
    min_selecoes: 0,
    max_selecoes: 4,
    tipo: 'opcional',
    recomendado: true,
    opcoes: [{ id: 'bacon', grupo_id: 'recommended', nome: 'Bacon', preco_adicional: 4, ativo: true }],
  },
  {
    id: 'general',
    nome: 'Pães',
    min_selecoes: 0,
    max_selecoes: 2,
    tipo: 'opcional',
    recomendado: false,
    opcoes: [{ id: 'bread', grupo_id: 'general', nome: 'Pão Brioche', preco_adicional: 3, ativo: true }],
  },
];

describe('ModifierPicker', () => {
  it('prioriza recomendados e deixa o catálogo geral acessível', () => {
    render(<ModifierPicker groups={groups} selectedIds={[]} onToggle={vi.fn()} />);

    expect(screen.getByText('Bacon')).toBeInTheDocument();
    expect(screen.queryByText('Pão Brioche')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ver todos os adicionais/i }));
    expect(screen.getByText('Pão Brioche')).toBeInTheDocument();
  });

  it('busca adicionais fora das recomendações sem exigir expandir a lista', () => {
    render(<ModifierPicker groups={groups} selectedIds={[]} onToggle={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Buscar adicional...'), { target: { value: 'brioche' } });
    expect(screen.getByText('Pão Brioche')).toBeInTheDocument();
  });

  it('mostra todo o catálogo quando não existe recomendação para o produto', () => {
    render(
      <ModifierPicker
        groups={groups.map((group) => ({ ...group, recomendado: false }))}
        selectedIds={[]}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText('Bacon')).toBeInTheDocument();
    expect(screen.getByText('Pão Brioche')).toBeInTheDocument();
  });
});