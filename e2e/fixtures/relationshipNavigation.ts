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
  const sidebarChild = page.locator('.cashier-sidebar:visible .cashier-nav-child')
    .filter({ hasText: labels[destination] });
  // React can switch sections after the navigation click. Wait for the active,
  // rendered presentation instead of branching on an instantaneous isVisible().
  try {
    await expect.poll(async () => {
      if (await horizontal.isVisible()) return horizontal.getAttribute('aria-current');
      if (await sidebarChild.isVisible()) return sidebarChild.getAttribute('aria-current');
      return null;
    }, { message: `Esperando destino ativo do Relacionamento: ${destination}` }).toBe('page');
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      activeTab: sessionStorage.getItem('koma_active_tab'),
      activeSubTab: sessionStorage.getItem('koma_active_subtab'),
      relationshipLast: sessionStorage.getItem('koma_relationship_last_subtab'),
      benefitLast: sessionStorage.getItem('koma_relationship_last_benefit'),
      selected: Array.from(document.querySelectorAll('[aria-current="page"]')).map(el => el.textContent?.trim().slice(0, 35)),
      horizontalCount: document.querySelectorAll('.cashier-subnav__button').length,
      horizontalNav: document.querySelector('.cashier-subnav')?.getAttribute('class'),
      documentLabel: document.querySelector('main')?.textContent?.trim().slice(0, 110),
    }));
    console.log('[relationship-navigation-selection-failure]', JSON.stringify(snapshot));
    throw error;
  }
  if (requested === 'fidelidade' || requested === 'cupons') {
    await expect(page.getByRole('tab', { name: requested === 'fidelidade' ? 'Fidelidade' : 'Cupons', exact: true }))
      .toHaveAttribute('aria-selected', 'true');
  }
}
