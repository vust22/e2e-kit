import { SEED } from './dataset.js';

/**
 * The build-time contract between `dataset.ts` and the PHP seeder that runs inside the
 * image build. Keeping it as data (rather than generated SQL) is what lets the seeder use
 * PrestaShop's own object model, so the same dataset produces a correct database on both
 * PS 8 and PS 9 despite their schema differences. See DECISIONS.md D-011.
 */
export interface SeedManifest {
  version: number;
  admin: typeof SEED.admin;
  shop: typeof SEED.shop;
  currencies: { default: string; enabled: string[] };
  languages: { default: string; enabled: string[] };
  countries: string[];
  tax: typeof SEED.tax;
  products: Array<(typeof SEED.products)[keyof typeof SEED.products]>;
  carrier: typeof SEED.carrier;
  customers: Array<(typeof SEED.customers)[keyof typeof SEED.customers]>;
  guest: typeof SEED.guest;
}

/** Bump when the seeder's expected manifest shape changes (not on value edits). */
export const SEED_MANIFEST_VERSION = 1;

export function buildSeedManifest(): SeedManifest {
  return {
    version: SEED_MANIFEST_VERSION,
    admin: SEED.admin,
    shop: SEED.shop,
    currencies: {
      default: SEED.currencies.default,
      enabled: [...SEED.currencies.enabled],
    },
    languages: {
      default: SEED.languages.default,
      enabled: [...SEED.languages.enabled],
    },
    countries: [...SEED.countries],
    tax: SEED.tax,
    products: Object.values(SEED.products),
    carrier: SEED.carrier,
    customers: Object.values(SEED.customers),
    guest: SEED.guest,
  };
}

export function serialiseSeedManifest(): string {
  return `${JSON.stringify(buildSeedManifest(), null, 2)}\n`;
}
