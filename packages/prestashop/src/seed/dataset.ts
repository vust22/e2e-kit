/**
 * The deterministic seed dataset (spec §4.2).
 *
 * This file is the single source of truth. It is compiled to a JSON manifest consumed by
 * the image-build seeder, which creates the entities through PrestaShop's own object
 * model and then asserts that the resulting ids match the ids declared here. A mismatch
 * fails the image build — that is what makes the `id` fields below safe to rely on.
 *
 * Tests reference these constants, never magic numbers (spec §4.2).
 * Changing values here is a MINOR kit release and requires an image rebuild (spec §10).
 */

export interface SeedProduct {
  readonly id: number;
  readonly reference: string;
  readonly name: string;
  /** Tax-excluded price, as stored in `ps_product.price`. */
  readonly price: number;
  readonly quantity: number;
  readonly virtual: boolean;
  /** Kilograms; drives shipping-rule coverage. */
  readonly weight: number;
}

export interface SeedAddress {
  readonly alias: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly company?: string;
  readonly vatNumber?: string;
  readonly address1: string;
  readonly city: string;
  readonly postcode: string;
  readonly countryIso: string;
  readonly phone: string;
}

export interface SeedCustomer {
  readonly id: number;
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly address: SeedAddress;
}

export const SEED = {
  /** Back-office folder name baked into the image; also the `adminPath` fixtures use. */
  admin: {
    id: 1,
    folder: 'admin-e2e',
    email: 'e2e.admin@invertus.test',
    password: 'E2E_Admin_123!',
    // PrestaShop validates employee names with `isName`, which rejects digits — so these
    // cannot be "E2E" like the rest of the dataset.
    firstName: 'Erika',
    lastName: 'Administrator',
  },

  shop: {
    name: 'E2E Shop',
    /** Default domain baked at build time; the entrypoint rewrites it when needed (§4.1.8). */
    domain: 'localhost:8080',
  },

  currencies: {
    default: 'EUR',
    enabled: ['EUR', 'USD'] as const,
  },

  languages: {
    default: 'en',
    enabled: ['en', 'lt'] as const,
  },

  /** Enabled countries; everything else stays disabled so shipping stays predictable. */
  countries: ['LT', 'NL', 'DE'] as const,

  tax: {
    /** Standard EU rate applied to the seeded tax rules group. */
    standardRatePercent: 21,
    taxRulesGroupName: 'E2E EU Standard 21%',
  },

  products: {
    TSHIRT: {
      id: 1,
      reference: 'P100',
      name: 'E2E T-shirt',
      price: 19.99,
      quantity: 100,
      virtual: false,
      weight: 0.2,
    },
    MUG: {
      id: 2,
      reference: 'P200',
      name: 'E2E Mug',
      price: 9.99,
      quantity: 100,
      virtual: false,
      weight: 0.4,
    },
    EBOOK: {
      id: 3,
      reference: 'P300',
      name: 'E2E Virtual e-book',
      price: 4.99,
      quantity: 100,
      virtual: true,
      weight: 0,
    },
    OUT_OF_STOCK: {
      id: 4,
      reference: 'P400',
      name: 'E2E Out-of-stock item',
      price: 14.99,
      quantity: 0,
      virtual: false,
      weight: 0.5,
    },
    HEAVY: {
      id: 5,
      reference: 'P500',
      name: 'E2E Heavy item',
      price: 49.99,
      quantity: 100,
      virtual: false,
      weight: 10,
    },
  } satisfies Record<string, SeedProduct>,

  carrier: {
    id: 2,
    name: 'E2E Standard',
    /** Flat rate, tax excluded. */
    price: 4.99,
    delay: '2-4 business days',
  },

  customers: {
    RETAIL: {
      id: 2,
      email: 'e2e.customer@invertus.test',
      password: 'E2E_Pass_123!',
      firstName: 'Elena',
      lastName: 'Kazlauskas',
      address: {
        alias: 'Home',
        firstName: 'Elena',
        lastName: 'Kazlauskas',
        address1: 'Gedimino pr. 9',
        city: 'Vilnius',
        postcode: '01103',
        countryIso: 'LT',
        phone: '+37060000001',
      },
    },
    B2B: {
      id: 3,
      email: 'e2e.b2b@invertus.test',
      password: 'E2E_Pass_123!',
      firstName: 'Bram',
      lastName: 'de Vries',
      address: {
        alias: 'Office',
        firstName: 'Bram',
        lastName: 'de Vries',
        company: 'Invertus E2E B.V.',
        vatNumber: 'NL123456789B01',
        address1: 'Herengracht 100',
        city: 'Amsterdam',
        postcode: '1015 BS',
        countryIso: 'NL',
        phone: '+31200000001',
      },
    },
  } satisfies Record<string, SeedCustomer>,

  /** Guest checkout details used when a test does not want an account. */
  guest: {
    email: 'e2e.guest@invertus.test',
    firstName: 'Guest',
    lastName: 'Buyer',
  },
} as const;

export type SeedProductKey = keyof typeof SEED.products;
export type SeedCustomerKey = keyof typeof SEED.customers;

/** Every seeded product, in declaration order. */
export function seedProducts(): SeedProduct[] {
  return Object.values(SEED.products);
}

/** Look up a seeded product by its id, e.g. when reading an order line back. */
export function seedProductById(id: number): SeedProduct | undefined {
  return seedProducts().find((p) => p.id === id);
}

/** Default product used by flows when the caller does not name one. */
export const DEFAULT_PRODUCT = SEED.products.TSHIRT;
