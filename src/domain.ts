// Compatibility exports for existing consumers. New code imports the responsible module directly.
export { getTableTotal, groupItemsByCustomer, getCustomerSubtotals } from './domain/tableConsumption';
export { normalizeOperationalTimestamp, formatElapsedTime } from './domain/operationalTime';
export { obterNomeCategoria, getIngredientObservationPresets, getProductPresets } from './domain/catalogPresentation';
export { normalizeText, levenshteinDistance, smartSearchMatch } from './domain/search';
