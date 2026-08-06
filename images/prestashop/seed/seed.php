<?php
/**
 * Applies the seed dataset (spec §4.2) through PrestaShop's own object model.
 *
 * Runs once, at image build time, immediately after the CLI installer. Every entity it
 * creates is checked against the id declared in `packages/prestashop/src/seed/dataset.ts`
 * (delivered here as manifest.json); a mismatch aborts the build. That check is what makes
 * `SEED.products.TSHIRT.id === 1` a fact rather than an assumption. See DECISIONS.md D-011.
 */

declare(strict_types=1);

const PS_ROOT = '/var/www/html';

$manifestPath = $argv[1] ?? '/e2e/seed/manifest.json';

// PrestaShop's CLI bootstrap expects a web-ish environment.
$_SERVER['HTTP_HOST'] = 'localhost';
$_SERVER['SERVER_NAME'] = 'localhost';
$_SERVER['SERVER_PORT'] = '80';
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['HTTPS'] = '';

require_once PS_ROOT . '/config/config.inc.php';

// ---------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------

function say(string $message): void
{
    fwrite(STDOUT, "\033[1;35m[seed]\033[0m {$message}\n");
}

function fail(string $message): never
{
    fwrite(STDERR, "\033[1;31m[seed] FAILED\033[0m {$message}\n");
    exit(1);
}

/** Abort the build when a created entity did not get the id the dataset promises. */
function assertId(string $what, int $expected, int $actual): void
{
    if ($expected !== $actual) {
        fail(
            "{$what} was created with id {$actual}, but dataset.ts declares {$expected}. "
            . 'Either fix the dataset or fix the seeding order — tests rely on these ids.'
        );
    }
    say("{$what} -> id {$actual} (as declared)");
}

/** Same value for every installed language. */
function forAllLanguages(string $value): array
{
    $out = [];
    foreach (Language::getLanguages(false) as $lang) {
        $out[(int) $lang['id_lang']] = $value;
    }

    return $out;
}

function slugify(string $value): string
{
    $slug = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', $value) ?? '', '-'));

    return $slug === '' ? 'item' : $slug;
}

function db(): Db
{
    return Db::getInstance();
}

// ---------------------------------------------------------------------------------
$manifest = json_decode((string) file_get_contents($manifestPath), true, 512, JSON_THROW_ON_ERROR);
say('Manifest version ' . $manifest['version']);

$defaultLangId = (int) Configuration::get('PS_LANG_DEFAULT');
$defaultShopId = (int) Configuration::get('PS_SHOP_DEFAULT');
Shop::setContext(Shop::CONTEXT_SHOP, $defaultShopId);
Context::getContext()->shop = new Shop($defaultShopId);
Context::getContext()->language = new Language($defaultLangId);
Context::getContext()->country = new Country((int) Configuration::get('PS_COUNTRY_DEFAULT'));
Context::getContext()->currency = new Currency((int) Configuration::get('PS_CURRENCY_DEFAULT'));

// ---------------------------------------------------------------------------------
say('Disabling modules that reach out to the network or add non-determinism');
/*
 * These phone home (marketplace catalogue, onboarding, gamification), which makes runs
 * slow, flaky and dependent on the internet — the opposite of Design principle 3.
 *
 * They are disabled at the database level rather than uninstalled through the module API.
 * Calling `$module->uninstall()` boots the module's own code, and on PrestaShop 9 `ps_mbo`
 * fatals during a bare CLI bootstrap ("Call to a member function hasListeners() on null")
 * because it expects a dispatcher that only exists in an HTTP request. Dropping the rows
 * achieves what we actually want — the module never runs — identically on 8 and 9.
 */
$disableModules = [
    'ps_mbo',
    'psaddonsconnect',
    'gamification',
    'welcome',
    'ps_checkout',
    'blockreassurance',
    'psgdpr',
    'statsforecast',
];

$disabled = [];
foreach ($disableModules as $moduleName) {
    $moduleId = (int) db()->getValue(
        'SELECT id_module FROM `' . _DB_PREFIX_ . "module` WHERE name = '" . pSQL($moduleName) . "'"
    );
    if (!$moduleId) {
        continue;
    }
    db()->execute('UPDATE `' . _DB_PREFIX_ . "module` SET active = 0 WHERE id_module = {$moduleId}");
    db()->execute('DELETE FROM `' . _DB_PREFIX_ . "hook_module` WHERE id_module = {$moduleId}");
    $disabled[] = $moduleName;
}
say($disabled ? 'disabled: ' . implode(', ', $disabled) : 'nothing to disable');

// ---------------------------------------------------------------------------------
say('Languages');
// Translation packs are deliberately NOT downloaded: an image build must not depend on
// prestashop.com being reachable (Design principle 3). The extra language exists so
// multi-language code paths are exercised; its strings fall back to English.
// See DECISIONS.md D-012.
foreach ($manifest['languages']['enabled'] as $iso) {
    if ($iso === $manifest['languages']['default']) {
        continue;
    }
    $existingId = (int) Language::getIdByIso($iso);
    if ($existingId) {
        // The installer's localization pack for the chosen country often brings the
        // language in already; say so rather than silently doing nothing.
        say("language {$iso} already installed (id {$existingId})");
        continue;
    }
    $language = new Language();
    $language->name = strtoupper($iso);
    $language->active = true;
    $language->iso_code = $iso;
    $language->locale = $iso . '-' . strtoupper($iso);
    $language->language_code = $iso;
    $language->date_format_lite = 'Y-m-d';
    $language->date_format_full = 'Y-m-d H:i:s';
    $language->is_rtl = false;
    if (!$language->add()) {
        fail("could not create language {$iso}");
    }
    say("created language {$iso} (id {$language->id})");
}

// ---------------------------------------------------------------------------------
say('Currencies');
foreach ($manifest['currencies']['enabled'] as $iso) {
    if (Currency::getIdByIsoCode($iso)) {
        continue;
    }
    $currency = new Currency();
    $currency->name = $iso;
    $currency->iso_code = $iso;
    $currency->active = true;
    $currency->deleted = false;
    $currency->conversion_rate = 1.0;
    $currency->precision = 2;
    if (!$currency->add()) {
        fail("could not create currency {$iso}");
    }
    $currency->associateTo([$defaultShopId]);
    say("created currency {$iso} (id {$currency->id})");
}
$defaultCurrencyId = (int) Currency::getIdByIsoCode($manifest['currencies']['default']);
if (!$defaultCurrencyId) {
    fail('default currency ' . $manifest['currencies']['default'] . ' is not installed');
}
Configuration::updateValue('PS_CURRENCY_DEFAULT', $defaultCurrencyId);

// ---------------------------------------------------------------------------------
say('Countries');
db()->execute('UPDATE `' . _DB_PREFIX_ . 'country` SET active = 0');
$countryIds = [];
foreach ($manifest['countries'] as $iso) {
    $id = (int) Country::getByIso($iso);
    if (!$id) {
        fail("country {$iso} is not present in the PrestaShop country table");
    }
    db()->execute('UPDATE `' . _DB_PREFIX_ . 'country` SET active = 1 WHERE id_country = ' . $id);
    $countryIds[$iso] = $id;
}
say('enabled: ' . implode(', ', array_keys($countryIds)));

// ---------------------------------------------------------------------------------
say('Tax rules');
$taxRatePercent = (float) $manifest['tax']['standardRatePercent'];
$tax = new Tax();
$tax->rate = $taxRatePercent;
$tax->active = true;
$tax->name = forAllLanguages(sprintf('E2E %s%%', rtrim(rtrim(number_format($taxRatePercent, 3, '.', ''), '0'), '.')));
if (!$tax->add()) {
    fail('could not create the tax rate');
}

$taxRulesGroup = new TaxRulesGroup();
$taxRulesGroup->name = $manifest['tax']['taxRulesGroupName'];
$taxRulesGroup->active = true;
if (!$taxRulesGroup->add()) {
    fail('could not create the tax rules group');
}

foreach ($countryIds as $iso => $countryId) {
    $rule = new TaxRule();
    $rule->id_tax_rules_group = (int) $taxRulesGroup->id;
    $rule->id_country = $countryId;
    $rule->id_state = 0;
    $rule->id_tax = (int) $tax->id;
    $rule->behavior = 0;
    if (!$rule->add()) {
        fail("could not create the tax rule for {$iso}");
    }
}
$taxRulesGroupId = (int) $taxRulesGroup->id;
say("tax rules group id {$taxRulesGroupId} at {$taxRatePercent}%");

// ---------------------------------------------------------------------------------
say('Carrier');
$carrier = new Carrier();
$carrier->name = $manifest['carrier']['name'];
$carrier->active = true;
$carrier->deleted = false;
$carrier->is_module = false;
$carrier->shipping_external = false;
$carrier->need_range = true;
$carrier->range_behavior = 0;                       // apply the highest range when out of range
$carrier->shipping_handling = false;
$carrier->shipping_method = Carrier::SHIPPING_METHOD_WEIGHT;
$carrier->is_free = false;
$carrier->grade = 1;
$carrier->delay = forAllLanguages($manifest['carrier']['delay']);
$carrier->max_width = 0;
$carrier->max_height = 0;
$carrier->max_depth = 0;
$carrier->max_weight = 0;
if (!$carrier->add()) {
    fail('could not create the carrier');
}
assertId('carrier ' . $manifest['carrier']['name'], (int) $manifest['carrier']['id'], (int) $carrier->id);

$zoneIds = array_map(static fn (array $z): int => (int) $z['id_zone'], Zone::getZones(true));
foreach ($zoneIds as $zoneId) {
    $carrier->addZone($zoneId);
}

$rangeWeight = new RangeWeight();
$rangeWeight->id_carrier = (int) $carrier->id;
$rangeWeight->delimiter1 = 0;
$rangeWeight->delimiter2 = 10000;
if (!$rangeWeight->add()) {
    fail('could not create the carrier weight range');
}

$priceList = [];
foreach ($zoneIds as $zoneId) {
    $priceList[] = [
        'id_range_price' => null,
        'id_range_weight' => (int) $rangeWeight->id,
        'id_carrier' => (int) $carrier->id,
        'id_zone' => $zoneId,
        'price' => (float) $manifest['carrier']['price'],
    ];
}
$carrier->addDeliveryPrice($priceList);
$carrier->setGroups(array_map(static fn (array $g): int => (int) $g['id_group'], Group::getGroups($defaultLangId)));

Configuration::updateValue('PS_CARRIER_DEFAULT', (int) $carrier->id);
say('carrier configured as default at ' . $manifest['carrier']['price']);

/**
 * Associate every payment module with every carrier.
 *
 * `Hook::exec('paymentOptions')` filters payment modules by the cart's carrier, joining
 * `ps_module_carrier` on `id_reference` (classes/Hook.php). Our carrier is created after
 * the bundled payment modules were installed, so nothing is associated with it — and the
 * symptom is not "check payment is missing" but "Unfortunately, there is no payment method
 * available", with no error anywhere. Worth knowing about: it will bite any future seed
 * change that adds a carrier.
 */
function associatePaymentModulesWithAllCarriers(int $shopId): int
{
    $modules = db()->executeS(
        'SELECT DISTINCT hm.`id_module`
         FROM `' . _DB_PREFIX_ . 'hook_module` hm
         INNER JOIN `' . _DB_PREFIX_ . 'hook` h ON h.`id_hook` = hm.`id_hook`
         WHERE h.`name` IN ("paymentOptions", "displayPayment", "displayPaymentEU")'
    ) ?: [];

    $carriers = db()->executeS(
        'SELECT DISTINCT `id_reference` FROM `' . _DB_PREFIX_ . 'carrier` WHERE `deleted` = 0'
    ) ?: [];

    $inserted = 0;
    foreach ($modules as $module) {
        foreach ($carriers as $carrierRow) {
            db()->execute(
                'INSERT IGNORE INTO `' . _DB_PREFIX_ . 'module_carrier`
                 (`id_module`, `id_shop`, `id_reference`)
                 VALUES (' . (int) $module['id_module'] . ', ' . $shopId . ', ' . (int) $carrierRow['id_reference'] . ')'
            );
            ++$inserted;
        }
    }

    return $inserted;
}

$associations = associatePaymentModulesWithAllCarriers($defaultShopId);
say("associated payment modules with carriers ({$associations} pairs)");

// ---------------------------------------------------------------------------------
say('Products');
$homeCategoryId = (int) Configuration::get('PS_HOME_CATEGORY');
foreach ($manifest['products'] as $spec) {
    $product = new Product();
    $product->name = forAllLanguages($spec['name']);
    $product->link_rewrite = forAllLanguages(slugify($spec['name']));
    $product->description_short = forAllLanguages('Seeded E2E fixture product.');
    $product->reference = $spec['reference'];
    $product->price = (float) $spec['price'];
    $product->id_tax_rules_group = $taxRulesGroupId;
    $product->weight = (float) $spec['weight'];
    $product->is_virtual = (bool) $spec['virtual'];
    $product->active = true;
    $product->visibility = 'both';
    $product->available_for_order = true;
    $product->show_price = true;
    $product->indexed = true;
    $product->id_category_default = $homeCategoryId;
    $product->minimal_quantity = 1;
    // Out-of-stock behaviour: 0 = deny orders. P400 exists precisely to exercise it.
    $product->out_of_stock = 0;
    if (!$product->add()) {
        fail("could not create product {$spec['reference']}");
    }
    assertId("product {$spec['reference']}", (int) $spec['id'], (int) $product->id);

    $product->addToCategories([$homeCategoryId]);
    StockAvailable::setQuantity((int) $product->id, 0, (int) $spec['quantity']);
    StockAvailable::setProductOutOfStock((int) $product->id, 0);
}

// ---------------------------------------------------------------------------------
say('Customers and addresses');
$crypto = new PrestaShop\PrestaShop\Core\Crypto\Hashing();
foreach ($manifest['customers'] as $spec) {
    $customer = new Customer();
    $customer->firstname = $spec['firstName'];
    $customer->lastname = $spec['lastName'];
    $customer->email = $spec['email'];
    $customer->passwd = $crypto->hash($spec['password'], _COOKIE_KEY_);
    $customer->active = true;
    $customer->newsletter = false;
    $customer->optin = false;
    $customer->id_default_group = (int) Configuration::get('PS_CUSTOMER_GROUP');
    if (!$customer->add()) {
        fail("could not create customer {$spec['email']}");
    }
    assertId("customer {$spec['email']}", (int) $spec['id'], (int) $customer->id);

    $addressSpec = $spec['address'];
    $countryIso = $addressSpec['countryIso'];
    if (!isset($countryIds[$countryIso])) {
        fail("customer {$spec['email']} has an address in {$countryIso}, which is not an enabled country");
    }

    $address = new Address();
    $address->id_customer = (int) $customer->id;
    $address->id_country = $countryIds[$countryIso];
    $address->alias = $addressSpec['alias'];
    $address->firstname = $addressSpec['firstName'];
    $address->lastname = $addressSpec['lastName'];
    $address->address1 = $addressSpec['address1'];
    $address->city = $addressSpec['city'];
    $address->postcode = $addressSpec['postcode'];
    $address->phone = $addressSpec['phone'];
    if (!empty($addressSpec['company'])) {
        $address->company = $addressSpec['company'];
    }
    if (!empty($addressSpec['vatNumber'])) {
        $address->vat_number = $addressSpec['vatNumber'];
    }
    if (!$address->add()) {
        fail("could not create the address for {$spec['email']}");
    }
    say("address for {$spec['email']} in {$addressSpec['city']} (id {$address->id})");
}

// ---------------------------------------------------------------------------------
say('Shop configuration');
$configuration = [
    // Spec §4.1 item 4.
    'PS_REWRITING_SETTINGS' => 1,
    'PS_SSL_ENABLED' => 0,
    'PS_SSL_ENABLED_EVERYWHERE' => 0,
    // Determinism: never send mail, never call out.
    'PS_MAIL_METHOD' => 3,
    // Checkout behaviour tests rely on.
    'PS_GUEST_CHECKOUT_ENABLED' => 1,
    'PS_ORDER_PROCESS_TYPE' => 0,
    'PS_ALLOW_MULTISHIPPING' => 0,
    'PS_STOCK_MANAGEMENT' => 1,
    'PS_CATALOG_MODE' => 0,
    'PS_SHOP_ENABLE' => 1,
    // No cookie/consent overlays in front of the checkout.
    'PS_COOKIE_CHECKIP' => 0,
    // Keep the BO fast and free of tips overlays.
    'PS_SHOW_NEW_ORDERS' => 0,
    'PS_SHOW_NEW_CUSTOMERS' => 0,
    'PS_SHOW_NEW_MESSAGES' => 0,
    // ps_checkpayment refuses to render a payment option unless both of these are set.
    // The seeded shop therefore ships it *configured* but disabled (D-010), so a test
    // that wants a PSP-free checkout only has to flip the active flag.
    'CHEQUE_NAME' => 'E2E Shop',
    'CHEQUE_ADDRESS' => 'Gedimino pr. 9, 01103 Vilnius, Lithuania',
];
foreach ($configuration as $key => $value) {
    Configuration::updateValue($key, $value);
}

// Spec §4.1 item 4 vs §12 Phase 1 DoD — see DECISIONS.md D-010: the module stays
// installed so tests can enable it on demand, but it is disabled by default so it never
// pollutes the payment-option list of the module actually under test.
if (Module::isInstalled('ps_checkpayment')) {
    db()->execute("UPDATE `" . _DB_PREFIX_ . "module` SET active = 0 WHERE name = 'ps_checkpayment'");
    say('ps_checkpayment installed but disabled');
}

Tools::generateHtaccess();
Configuration::updateGlobalValue('PS_SHOP_DOMAIN', $manifest['shop']['domain']);
Configuration::updateGlobalValue('PS_SHOP_DOMAIN_SSL', $manifest['shop']['domain']);

say('Seed complete');
