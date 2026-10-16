import { expect, type Page } from '@playwright/test';

export type RelationshipDestination = 'oportunidades' | 'clientes' | 'campanhas' | 'beneficios' | 'resultados' | 'fidelidade' | 'cupons';

const labels: Record<Exclude<RelationshipDestination, 'fidelidade' | 'cupons'>, string> = {
  oportunidades: 'Hoje',
  clientes: 'Clientes',
  campanhas: 'Campanhas',
  beneficios: 'Benefícios',
  resultados: 'Resultados',
};

export async function navigateRelationship(page: Page, requested: RelationshipDestination): Promise<void> {
  const destination = requested === 'fidelidade' || requested === 'cupons' ? 'beneficios' : requested;
  const horizontal = page.locator(`#clientes-subtab-${destination}:visible`);
  if (await horizontal.isVisible()) {
    await horizontal.click();
  } else {
    await page.locator('.cashier-sidebar:visible .cashier-nav-child')
      .filter({ hasText: labels[destination] }).click();
  }
  if (requested === 'fidelidade' || requested === 'cupons') {
    await page.getByRole('tab', { name: requested === 'fidelidade' ? 'Fidelidade' : 'Cupons', exact: true }).click();
  }
}

export async function expectRelationshipSelected(page: Page, requested: RelationshipDestination): Promise<void> {
  const destination = requested === 'fidelidade' || requested === 'cupons' ? 'beneficios' : requested;
  const horizontal = page.locator(`#clientes-subtab-${destination}:visible`);
  if (await horizontal.isVisible()) {
    await expect(horizontal).toHaveAttribute('aria-current', 'page');
  } else {
    await expect(page.locator('.cashier-sidebar:visible .cashier-nav-child')
      .filter({ hasText: labels[destination] })).toHaveAttribute('aria-current', 'page');
  }
  if (requested === 'fidelidade' || requested === 'cupons') {
    await expect(page.getByRole('tab', { name: requested === 'fidelidade' ? 'Fidelidade' : 'Cupons', exact: true }))
      .toHaveAttribute('aria-selected', 'true');
  }
}
