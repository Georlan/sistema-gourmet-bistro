import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SUBSCRIPTION_PLANS,
  ANNUAL_DISCOUNT_RATE,
  formatCurrency,
  formatPercentage,
} from '../src/config/subscriptionPlans';

describe('Super Admin Hardening & Integrity', () => {
  it('garante que os planos de assinatura oficiais do KÔMA estão corretos', () => {
    assert.equal(SUBSCRIPTION_PLANS.length, 3);
    assert.equal(ANNUAL_DISCOUNT_RATE, 0.10);

    const pocket = SUBSCRIPTION_PLANS.find(p => p.id === 'pocket');
    assert.ok(pocket);
    assert.equal(pocket.price, 109);
    assert.equal(pocket.splitFeeRate, 0.0149);

    const pro = SUBSCRIPTION_PLANS.find(p => p.id === 'pro');
    assert.ok(pro);
    assert.equal(pro.price, 209);
    assert.equal(pro.splitFeeRate, 0.0069);

    const premium = SUBSCRIPTION_PLANS.find(p => p.id === 'premium');
    assert.ok(premium);
    assert.equal(premium.price, 309);
    assert.equal(premium.splitFeeRate, 0.0029);
  });

  it('valida que nenhum arquivo em src/super-admin/ possui precos legados ou splits hardcoded', () => {
    const dir = path.join(process.cwd(), 'src/super-admin');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));

    const forbiddenPatterns = [
      /price:\s*97\b/,
      /price:\s*197\b/,
      /price:\s*347\b/,
      /price:\s*89\b/,
      /price:\s*179\b/,
      /price:\s*269\b/,
      /1[,.]79%/,
      /0[,.]89%/,
      /0[,.]39%/,
      /\bINITIAL_TENANTS\b/,
      /\bsentry\b/i,
      /app\.koma\.com\.br/,
      /api\.koma\.com\.br/,
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      for (const pattern of forbiddenPatterns) {
        const match = content.match(pattern);
        assert.equal(
          match,
          null,
          `Arquivo ${file} contem padrao proibido: ${pattern} (encontrado: ${match?.[0]})`
        );
      }
    }
  });

  it('valida que nao ha comparacoes hardcoded por tenant.id especifico em src/super-admin', () => {
    const dir = path.join(process.cwd(), 'src/super-admin');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));

    const forbiddenTenantIdComparisons = [
      /tenant\.id\s*===\s*["']1["']/,
      /tenant\.id\s*===\s*["']2["']/,
      /tenant\.id\s*===\s*["']3["']/,
      /id\s*===\s*["']1["']\s*\|\|\s*id\s*===\s*["']3["']/,
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      for (const pattern of forbiddenTenantIdComparisons) {
        const match = content.match(pattern);
        assert.equal(
          match,
          null,
          `Arquivo ${file} contem comparacao hardcoded por tenant.id: ${pattern} (encontrado: ${match?.[0]})`
        );
      }
    }
  });

  it('valida que as abas de faturamento e overview consomem a fonte oficial de planos', () => {
    const billingPath = path.join(process.cwd(), 'src/super-admin/SuperAdminBillingTab.tsx');
    const billingContent = fs.readFileSync(billingPath, 'utf-8');
    assert.ok(
      billingContent.includes('SUBSCRIPTION_PLANS'),
      'SuperAdminBillingTab deve importar e usar SUBSCRIPTION_PLANS'
    );
    assert.ok(
      billingContent.includes('ANNUAL_DISCOUNT_RATE'),
      'SuperAdminBillingTab deve importar e usar ANNUAL_DISCOUNT_RATE'
    );

    const overviewPath = path.join(process.cwd(), 'src/super-admin/SuperAdminOverviewTab.tsx');
    const overviewContent = fs.readFileSync(overviewPath, 'utf-8');
    assert.ok(
      overviewContent.includes('SUBSCRIPTION_PLANS'),
      'SuperAdminOverviewTab deve importar e usar SUBSCRIPTION_PLANS'
    );
  });

  it('formata moedas e percentuais corretamente conforme padrao KÔMA', () => {
    assert.match(formatCurrency(109), /^R\$\s*109,00$/);
    assert.match(formatCurrency(209.5), /^R\$\s*209,50$/);
    assert.equal(formatPercentage(0.0149), '1,49%');
    assert.equal(formatPercentage(0.0069), '0,69%');
    assert.equal(formatPercentage(0.0029), '0,29%');
    assert.equal(formatPercentage(0.10), '10,00%');
  });

  it('valida fail-closed para indisponibilidade de listagem cross-tenant', () => {
    const panelPath = path.join(process.cwd(), 'src/super-admin/SuperAdminPanel.tsx');
    const panelContent = fs.readFileSync(panelPath, 'utf-8');
    assert.ok(
      panelContent.includes('tenantsAvailable'),
      'SuperAdminPanel deve rastrear explicitamente se os dados de tenants estao disponiveis'
    );
  });
});
