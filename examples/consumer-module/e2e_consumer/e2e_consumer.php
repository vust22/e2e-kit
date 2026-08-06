<?php
/**
 * A deliberately minimal PrestaShop module.
 *
 * It exists so that `kit-ci.yml` can exercise the kit's shared flows — install, configure,
 * checkout, back-office verification — against something that is a real module but has no
 * behaviour of its own to get in the way. If a kit change breaks a flow, it breaks here
 * first, before it reaches a consumer repo (spec §10).
 *
 * It is also the reference for what the "2-file adoption" (spec §5.1) actually looks like:
 * everything under `e2e/` is what a real module repo adds.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * The class name is not free-form: PrestaShop derives it from the directory name by
 * capitalising each underscore-separated segment and keeping the underscores
 * (`ps_checkpayment` -> `Ps_Checkpayment`). Getting it wrong makes the module loader
 * return `false`, which surfaces as a TypeError deep inside ModuleRepository.
 */
class E2e_Consumer extends Module
{
    public function __construct()
    {
        $this->name = 'e2e_consumer';
        $this->tab = 'others';
        $this->version = '1.0.0';
        $this->author = 'Invertus';
        $this->need_instance = 0;
        $this->ps_versions_compliancy = ['min' => '8.0.0', 'max' => _PS_VERSION_];
        $this->bootstrap = true;

        parent::__construct();

        $this->displayName = $this->trans('E2E Consumer', [], 'Modules.E2econsumer.Admin');
        $this->description = $this->trans(
            'Fixture module used by the Invertus E2E kit to exercise its shared flows.',
            [],
            'Modules.E2econsumer.Admin'
        );
    }

    public function install(): bool
    {
        return parent::install()
            && $this->registerHook('displayHome')
            && Configuration::updateValue('E2E_CONSUMER_LABEL', 'default label')
            && Configuration::updateValue('E2E_CONSUMER_ENABLED', '1');
    }

    public function uninstall(): bool
    {
        return Configuration::deleteByName('E2E_CONSUMER_LABEL')
            && Configuration::deleteByName('E2E_CONSUMER_ENABLED')
            && parent::uninstall();
    }

    /** The back-office configuration screen the `configure` shared suite drives. */
    public function getContent(): string
    {
        $output = '';

        if (Tools::isSubmit('submitE2eConsumer')) {
            $label = (string) Tools::getValue('E2E_CONSUMER_LABEL');
            $enabled = (string) Tools::getValue('E2E_CONSUMER_ENABLED');

            if ($label === '') {
                $output .= $this->displayError('Label must not be empty.');
            } else {
                Configuration::updateValue('E2E_CONSUMER_LABEL', $label);
                Configuration::updateValue('E2E_CONSUMER_ENABLED', $enabled);
                $output .= $this->displayConfirmation('Settings updated.');
            }
        }

        return $output . $this->renderForm();
    }

    private function renderForm(): string
    {
        $fields = [
            'form' => [
                'legend' => ['title' => 'E2E Consumer settings', 'icon' => 'icon-cogs'],
                'input' => [
                    [
                        'type' => 'text',
                        'label' => 'Label',
                        'name' => 'E2E_CONSUMER_LABEL',
                        'required' => true,
                    ],
                    [
                        'type' => 'switch',
                        'label' => 'Enabled',
                        'name' => 'E2E_CONSUMER_ENABLED',
                        'is_bool' => true,
                        'values' => [
                            ['id' => 'active_on', 'value' => 1, 'label' => 'Yes'],
                            ['id' => 'active_off', 'value' => 0, 'label' => 'No'],
                        ],
                    ],
                ],
                'submit' => ['title' => 'Save', 'name' => 'submitE2eConsumer'],
            ],
        ];

        $helper = new HelperForm();
        $helper->module = $this;
        $helper->name_controller = $this->name;
        $helper->token = Tools::getAdminTokenLite('AdminModules');
        $helper->currentIndex = AdminController::$currentIndex . '&configure=' . $this->name;
        $helper->submit_action = 'submitE2eConsumer';
        $helper->default_form_language = (int) Configuration::get('PS_LANG_DEFAULT');
        $helper->fields_value = [
            'E2E_CONSUMER_LABEL' => Configuration::get('E2E_CONSUMER_LABEL'),
            'E2E_CONSUMER_ENABLED' => Configuration::get('E2E_CONSUMER_ENABLED'),
        ];

        return $helper->generateForm([$fields]);
    }

    /** Renders a marker on the home page so a storefront-side assertion has something real. */
    public function hookDisplayHome(): string
    {
        if (!Configuration::get('E2E_CONSUMER_ENABLED')) {
            return '';
        }

        return sprintf(
            '<div data-testid="e2e-home-consumer-banner" class="e2e-consumer-banner">%s</div>',
            htmlspecialchars((string) Configuration::get('E2E_CONSUMER_LABEL'), ENT_QUOTES, 'UTF-8')
        );
    }
}
