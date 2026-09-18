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
    assert.equal(pocket.price, 0);
    assert.equal(pocket.splitFeeRate, 0.0179);

    const pro = SUBSCRIPTION_PLANS.find(p => p.id === 'pro');
    assert.ok(pro);
    assert.equal(pro.price, 129);
    assert.equal(pro.splitFeeRate, 0.005);

    const premium = SUBSCRIPTION_PLANS.find(p => p.id === 'premium');
    assert.ok(premium);
    assert.equal(premium.price, 249);
    assert.equal(premium.splitFeeRate, 0.002);
  });

  it('impede regressao para hardcodes, Sentry, Asaas e tenants ficticios', () => {
    const dir = path.join(process.cwd(), 'src/super-admin');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));
    const forbiddenPatterns = [
      /price:\s*97\b/,
      /price:\s*197\b/,
      /price:\s*347\b/,
      /price:\s*89\b/,
      /price:\s*179\b/,
      /price:\s*269\b/,
      /0[,.]89%/,
      /0[,.]39%/,
      /\bINITIAL_TENANTS\b/,
      /\bsentry\b/i,
      /\basaas\b/i,
      /app\.koma\.com\.br/,
      /api\.koma\.com\.br/,
      /Reconciliar e Confirmar/i,
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      for (const pattern of forbiddenPatterns) {
        assert.equal(
          content.match(pattern),
          null,
          `Arquivo ${file} contem padrao proibido: ${pattern}`
        );
      }
    }
  });

  it('nao permite comparacoes hardcoded por tenant.id especifico', () => {
    const dir = path.join(process.cwd(), 'src/super-admin');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));
    const forbidden = [
      /tenant\.id\s*===\s*["']1["']/,
      /tenant\.id\s*===\s*["']2["']/,
      /tenant\.id\s*===\s*["']3["']/,
    ];
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      for (const pattern of forbidden) assert.equal(content.match(pattern), null);
    }
  });

  it('usa a fonte oficial compartilhada de planos', () => {
    for (const file of [
      'SuperAdminBillingTab.tsx',
      'SuperAdminOverviewTab.tsx',
      'SuperAdminTenantsTab.tsx',
      'SuperAdminPaymentsTab.tsx',
    ]) {
      const content = fs.readFileSync(path.join(process.cwd(), 'src/super-admin', file), 'utf-8');
      assert.ok(content.includes('SUBSCRIPTION_PLANS'), `${file} deve usar SUBSCRIPTION_PLANS`);
    }
  });

  it('formata moedas e percentuais conforme padrão KÔMA', () => {
    assert.match(formatCurrency(109), /^R\$\s*109,00$/);
    assert.match(formatCurrency(209.5), /^R\$\s*209,50$/);
    assert.equal(formatPercentage(0.0179), '1,79%');
    assert.equal(formatPercentage(0.005), '0,50%');
    assert.equal(formatPercentage(0.002), '0,20%');
    assert.equal(formatPercentage(0.10), '10,00%');
  });

  it('rotula o catálogo do Super Admin como oferta, não como contrato do tenant', () => {
    const billing = fs.readFileSync(
      path.join(process.cwd(), 'src/super-admin/SuperAdminBillingTab.tsx'),
      'utf-8'
    );
    const overview = fs.readFileSync(
      path.join(process.cwd(), 'src/super-admin/SuperAdminOverviewTab.tsx'),
      'utf-8'
    );
    const payments = fs.readFileSync(
      path.join(process.cwd(), 'src/super-admin/SuperAdminPaymentsTab.tsx'),
      'utf-8'
    );
    assert.ok(billing.includes('Catálogo vigente para novas contratações'));
    assert.ok(billing.includes('não é receita recebida'));
    assert.ok(billing.includes('não representa os contratos dos tenants'));
    assert.ok(overview.includes('Catálogo de split'));
    assert.ok(overview.includes('Oferta vigente para novos aceites'));
    assert.ok(payments.includes('A taxa efetiva de cada restaurante vem do contrato vinculado'));
  });

  it('separa plano de recursos de termos comerciais contratados', () => {
    const tenantsTab = fs.readFileSync(
      path.join(process.cwd(), 'src/super-admin/SuperAdminTenantsTab.tsx'),
      'utf-8'
    );
    assert.equal(tenantsTab.includes('plan: editPlan'), false);
    assert.equal(tenantsTab.includes('Comercial Oficial'), false);
    assert.ok(tenantsTab.includes('Autoridade comercial'));
    assert.ok(tenantsTab.includes('termos comerciais congelados deste tenant'));
    assert.ok(tenantsTab.includes('Mudança de plano não é permitida por esta edição genérica'));
  });

  it('mantem fail-closed para a disponibilidade cross-tenant', () => {
    const panelContent = fs.readFileSync(
      path.join(process.cwd(), 'src/super-admin/SuperAdminPanel.tsx'),
      'utf-8'
    );
    assert.ok(panelContent.includes('tenantsAvailable'));
    assert.ok(panelContent.includes('setTenantsAvailable(false)'));
  });
});
