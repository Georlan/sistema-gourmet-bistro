// Generated deployment asset: edit only the repository-root product-contract.json.
import { readFileSync, writeFileSync } from 'node:fs';
const canonical = new URL('../product-contract.json', import.meta.url);
const bundled = new URL('../backend/product-contract.json', import.meta.url);
const content = readFileSync(canonical);
if (process.argv.includes('--check')) {
  if (!content.equals(readFileSync(bundled))) {
    throw new Error('Backend product contract is stale; run npm run sync:product-contract.');
  }
} else {
  writeFileSync(bundled, content);
}
