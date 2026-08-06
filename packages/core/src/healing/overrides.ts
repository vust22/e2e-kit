/**
 * Locator override map used by healing validation (spec §9.4).
 *
 * During a healing validation re-run the harness sets `E2E_HEAL_OVERRIDES` to a JSON
 * object mapping `<PageObjectClass>.<locatorName>` to a replacement locator expression.
 * The page-object base class consults this map when constructing locators, so a
 * candidate can be tried without editing source.
 *
 * The map is empty in every normal run.
 */
export type HealOverrides = Record<string, string>;

let cached: HealOverrides | null = null;

export function healOverrides(): HealOverrides {
  if (cached) return cached;
  const raw = process.env.E2E_HEAL_OVERRIDES;
  if (!raw) return (cached = {});
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cached = parsed as HealOverrides;
      return cached;
    }
  } catch {
    // A malformed override map must never silently change test behaviour.
    throw new Error('E2E_HEAL_OVERRIDES is set but is not a JSON object.');
  }
  throw new Error('E2E_HEAL_OVERRIDES is set but is not a JSON object.');
}

/** Look up an override for `<Class>.<name>`, or undefined when none applies. */
export function overrideFor(className: string, locatorName: string): string | undefined {
  return healOverrides()[`${className}.${locatorName}`];
}

/** Test-only: reset the memoised map. */
export function resetHealOverridesCache(): void {
  cached = null;
}
