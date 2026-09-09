import { sha256Hex } from '../scoring/hash.ts';

// Ordered, versioned comparison contract. Observed amount is deliberately excluded.
export const BASKET_KEYS = ['currency', 'billing_unit', 'commitment_months', 'promo', 'renewal_amount', 'tax_state', 'region', 'deployment_id', 'vcpu', 'ram_gb', 'storage_gb', 'storage_type'] as const;
const aliases: Record<string, string> = { billing_unit: 'billingUnit', commitment_months: 'commitmentMonths', renewal_amount: 'renewalAmount', tax_state: 'tax', deployment_id: 'deploymentId', ram_gb: 'ramGb', storage_gb: 'storageGb', storage_type: 'storageType' };
export function priceTerms(value: unknown): Record<string, unknown> & { comparable: boolean } {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: Record<string, unknown> & { comparable: boolean } = { comparable: false };
  for (const key of ['amount', ...BASKET_KEYS]) result[key] = raw[key] ?? raw[aliases[key]!] ?? null;
  if (result.tax_state == null && typeof raw.taxIncluded === 'boolean') result.tax_state = raw.taxIncluded ? 'inclusive' : 'exclusive';
  const numbers = ['amount', 'commitment_months', 'renewal_amount', 'vcpu', 'ram_gb', 'storage_gb'];
  const complete = numbers.every(k => typeof result[k] === 'number' && Number.isFinite(result[k]) && (result[k] as number) >= 0)
    && Number.isInteger(result.commitment_months) && (result.amount as number) > 0 && (result.vcpu as number) > 0 && (result.ram_gb as number) > 0
    && ['currency', 'billing_unit', 'tax_state', 'region', 'deployment_id', 'storage_type'].every(k => typeof result[k] === 'string' && (result[k] as string).trim().length > 0)
    && typeof result.promo === 'boolean';
  result.comparable = complete && raw.comparable === true && result.promo === false
    && ['hour', 'day', 'month', 'year'].includes(result.billing_unit as string)
    && ['inclusive', 'exclusive'].includes(result.tax_state as string) && /^[A-Z]{3}$/.test(result.currency as string);
  return result;
}
export function basketFingerprint(value: unknown): string | null {
  const terms = priceTerms(value);
  // A promo still has a basket identity, but can never enter the index.
  const complete = priceTerms({ ...terms, comparable: true, promo: false }).comparable;
  if (!complete || typeof terms.promo !== 'boolean') return null;
  const encoded = '[' + BASKET_KEYS.map(key => JSON.stringify(String(terms[key]))).join(', ') + ']';
  return sha256Hex(encoded);
}
