import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

// Read-only. Use --ref <commit> for historical source; historical invocations
// intentionally omit bundle metrics because dist belongs to the current build.
const refIndex = process.argv.indexOf('--ref');
const ref = refIndex >= 0 ? process.argv[refIndex + 1] : null;
if (refIndex >= 0 && !ref) throw new Error('--ref requires a git revision');
const revision = execFileSync('git', ['rev-parse', '--verify', ref || 'HEAD'], { encoding: 'utf8' }).trim();
const read = file => {
  if (!ref) return existsSync(file) ? readFileSync(file, 'utf8') : null;
  try { return execFileSync('git', ['show', revision + ':' + file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
};
const root = 'src/components/CaixaPanel.tsx';
const ownerBase = 'src/components/caixa/';
const ownerPaths = [
  'cashierContracts.ts', 'checkout/useCheckoutController.ts', 'checkout/CheckoutDialog.tsx',
  'orders/useCashierOrders.ts', 'smartpos/useCashierSmartPos.ts', 'shift/useCashShift.ts',
  'realtime/useCashierAlerts.ts', 'realtime/useCashierClock.ts', 'realtime/useCashierRealtime.ts',
  'catalog/useCashierCatalog.ts', 'catalog/CashierCatalog.tsx',
  'customers/useCashierCustomers.ts', 'customers/CashierCustomers.tsx',
  'settings/useCashierSettings.ts', 'settings/CashierSettings.tsx',
  'settings/useCashierTableSettings.ts', 'settings/CashierPrintingSettings.tsx',
  'settings/CashierServiceTaxSettings.tsx', 'settings/CashierWaiterSettings.tsx',
  'settings/CashierTableSettings.tsx', 'settings/CashierTableDialogs.tsx',
  'inventory/CashierInventory.tsx', 'inventory/useCashierInventoryData.ts',
  'inventory/useCashierInventoryOperations.ts', 'inventory/useCashierIngredientEditor.ts',
  'inventory/useCashierSupplierEditor.ts', 'inventory/CashierIngredientDialogs.tsx',
  'inventory/CashierStockAdjustmentDialog.tsx', 'inventory/CashierSupplierDialogs.tsx',
  'navigation/useCashierNavigation.ts', 'navigation/useCashierPreferences.ts',
  'navigation/cashierNavigation.ts', 'navigation/CashierDesktopSidebar.tsx',
  'navigation/CashierMobileSidebar.tsx', 'navigation/CashierOperatorDrawer.tsx',
  'salao/useCashierSalonProjection.ts', 'kitchen/CashierKitchen.tsx',
  'orders/CashierCouriers.tsx', 'orders/CashierCancelConsumptionDialog.tsx',
  'shift/CashierOpenShiftDialog.tsx', 'online-menu/CashierOnlineMenu.tsx',
  'team/CashierTeam.tsx', 'reports/CashierReports.tsx',
  'pdv/useCashierPdv.ts', 'pdv/usePdvCategoryNavigation.ts', 'pdv/CashierPdvView.tsx',
  'loading/DeferredCashierSection.tsx', 'kitchen/KitchenTimer.tsx',
].map(file => ownerBase + file);
const domainPaths = [
  'tableConsumption.ts', 'operationalTime.ts', 'catalogPresentation.ts', 'search.ts',
].map(file => 'src/domain/' + file);
const stats = file => {
  const text = read(file);
  if (text === null) return null;
  const syntax = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const calls = {};
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(syntax).replace(/^React\./, '');
      if (['useState', 'useEffect', 'fetch', 'operationalFetch'].includes(name)) calls[name] = (calls[name] || 0) + 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  return { file, lines: (text.match(/\n/g) || []).length, bytes: Buffer.byteLength(text), calls };
};
const files = [root, 'src/App.tsx', 'src/domain.ts', 'AGENTS.md', '.agents/AGENTS.md',
  'src/components/app/operationalContracts.ts',
  'src/components/app/data/useOperationalTables.ts',
  'src/components/app/data/useOperationalCatalog.ts',
  'src/components/app/data/useOperationalOrders.ts',
  'src/components/app/drafts/useOperationalDrafts.ts',
  ...ownerPaths, ...domainPaths].map(stats).filter(Boolean);
const taskEntries = {
  checkout: read(ownerBase + 'checkout/useCheckoutController.ts') === null ? [root] : [
    ownerBase + 'checkout/useCheckoutController.ts', ownerBase + 'checkout/CheckoutDialog.tsx',
    ownerBase + 'smartpos/useCashierSmartPos.ts', ownerBase + 'cashierContracts.ts',
  ],
  orders: read(ownerBase + 'orders/useCashierOrders.ts') === null ? [root] : [
    ownerBase + 'orders/useCashierOrders.ts', ownerBase + 'cashierContracts.ts',
  ],
};
const initialReadingPackages = Object.fromEntries(Object.entries(taskEntries).map(([task, entries]) => {
  // Equal contract dependencies in both snapshots; these are initial reading
  // packages, not a claim that all transitive context or real token usage shrank.
  const measured = [...entries, 'src/types.ts', ownerBase + 'orders/cashierWorkspaceTypes.ts'].map(stats).filter(Boolean);
  return [task, { files: measured.map(file => file.file),
    lines: measured.reduce((sum, file) => sum + file.lines, 0),
    bytes: measured.reduce((sum, file) => sum + file.bytes, 0) }];
}));
const assets = 'dist/assets';
const bundle = !ref && existsSync(assets) ? readdirSync(assets).filter(file => file.endsWith('.js')).map(file => {
  const contents = readFileSync(path.join(assets, file));
  return { file, minifiedBytes: contents.length, gzipBytes: gzipSync(contents).length };
}).sort((a, b) => b.minifiedBytes - a.minifiedBytes) : null;
console.log(JSON.stringify({
  revision, source: ref ? 'git snapshot' : 'working tree (may include uncommitted edits)',
  method: 'LOC = newline count (wc -l), bytes = UTF-8. Reading packages are entry points + contracts, not transitive closure or measured tokens.',
  files, initialReadingPackages,
  bundle: bundle ? { source: 'existing dist; run npm run build first', largest: bundle.slice(0, 8),
    over500kB: bundle.filter(file => file.minifiedBytes > 500_000) } : null,
}, null, 2));
