import { expect, type AdminPanel as CoreAdminPanel, type Page, type ShopEnvironment } from '@invertus/e2e-core';
import { AdminLoginPage } from '../pages/admin/AdminLoginPage.js';
import { AdminModulesPage } from '../pages/admin/AdminModulesPage.js';
import { AdminOrderDetailPage } from '../pages/admin/AdminOrderDetailPage.js';
import { AdminOrdersPage } from '../pages/admin/AdminOrdersPage.js';
import { ModuleConfigPage } from '../pages/admin/ModuleConfigPage.js';

/**
 * Facade over the back-office page objects, plus the two pieces of PrestaShop-specific
 * plumbing every back-office test would otherwise repeat:
 *
 * 1. **Lazy sign-in.** The fixture is documented as auto-logging-in (spec §3.3), but a
 *    storefront-only test should not pay for a back-office round trip. Sign-in therefore
 *    happens on the first back-office navigation, not at fixture creation.
 * 2. **Token handling.** Every back-office URL carries a per-controller CSRF token.
 *    Tokens are discovered from links already on the page and cached per worker; when a
 *    controller is not linked anywhere, the navigation falls through PrestaShop's
 *    "invalid security token" interstitial, which is a supported way in.
 */
export class AdminPanel implements CoreAdminPanel {
  readonly page: Page;
  readonly loginPage: AdminLoginPage;
  readonly orders: AdminOrdersPage;
  readonly orderDetail: AdminOrderDetailPage;
  readonly modules: AdminModulesPage;
  readonly moduleConfig: ModuleConfigPage;

  private signedIn = false;
  private readonly tokens = new Map<string, string>();

  constructor(page: Page, private readonly env: ShopEnvironment) {
    this.page = page;
    this.loginPage = new AdminLoginPage(page);
    this.orders = new AdminOrdersPage(page);
    this.orderDetail = new AdminOrderDetailPage(page);
    this.modules = new AdminModulesPage(page);
    this.moduleConfig = new ModuleConfigPage(page);
  }

  get adminPath(): string {
    return this.env.adminPath;
  }

  /** Ensure an authenticated back-office session exists on this page. */
  async login(): Promise<void> {
    if (this.signedIn) return;

    await this.loginPage.goto(this.adminPath);
    if (await this.loginPage.isDisplayed()) {
      await this.loginPage.signIn(this.env.adminEmail, this.env.adminPassword);
    }
    await expect(this.page.locator('#main').first()).toBeVisible();
    this.signedIn = true;
    this.rememberTokensOnPage();
  }

  /** Navigate to a back-office controller, resolving its CSRF token. */
  async goToController(controller: string, query: Record<string, string> = {}): Promise<void> {
    await this.login();

    const token = this.tokens.get(controller) ?? (await this.discoverToken(controller));
    const params = new URLSearchParams({ controller, ...query });
    if (token) params.set('token', token);

    await this.page.goto(`${this.adminPath}/index.php?${params.toString()}`);
    await this.passInvalidTokenInterstitial();
    this.rememberTokensOnPage();
  }

  /** The base admin URL for a controller, for page objects that build their own links. */
  async controllerUrl(controller: string): Promise<string> {
    await this.login();
    const token = this.tokens.get(controller) ?? (await this.discoverToken(controller));
    const params = new URLSearchParams({ controller });
    if (token) params.set('token', token);
    return `${this.adminPath}/index.php?${params.toString()}`;
  }

  /** Open the orders grid. */
  async goToOrders(): Promise<AdminOrdersPage> {
    await this.goToController('AdminOrders');
    return this.orders;
  }

  /**
   * Open the module manager.
   *
   * The Module Manager is a Symfony route (`/improve/modules/manage`) on both PS 8 and
   * PS 9. On PS 8 the legacy `?controller=AdminModules` URL redirects to it; on PS 9 it
   * renders an empty page shell with no module grid and no error. So the route is taken
   * from the sidebar link, which also carries the correct per-route CSRF token.
   */
  async goToModules(): Promise<AdminModulesPage> {
    await this.login();

    const sidebarLink = this.page
      .locator('#nav-sidebar a[href*="/improve/modules/manage"]')
      .first();

    const href = (await sidebarLink.count())
      ? await sidebarLink.getAttribute('href')
      : null;

    if (href) {
      await this.page.goto(href);
    } else {
      // No sidebar on this page (or a heavily customised back office): the legacy entry
      // point is still the best available fallback.
      await this.goToController('AdminModules');
    }

    this.rememberTokensOnPage();
    return this.modules;
  }

  /** Open a module's configuration screen. */
  async goToModuleConfig(moduleName: string): Promise<ModuleConfigPage> {
    await this.goToController('AdminModules', { configure: moduleName });
    return this.moduleConfig;
  }

  /** Open an order's detail page by numeric id. */
  async goToOrder(orderId: number): Promise<AdminOrderDetailPage> {
    await this.goToController('AdminOrders', { id_order: String(orderId), vieworder: '1' });
    return this.orderDetail;
  }

  // -------------------------------------------------------------------------------

  /** Harvest `token=` values from every admin link rendered on the current page. */
  private rememberTokensOnPage(): void {
    void this.page
      .locator('a[href*="controller="][href*="token="]')
      .evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
      .then((hrefs) => {
        for (const href of hrefs) {
          const controller = /[?&]controller=([A-Za-z]+)/.exec(href)?.[1];
          const token = /[?&]token=([A-Za-z0-9]+)/.exec(href)?.[1];
          if (controller && token && !this.tokens.has(controller)) {
            this.tokens.set(controller, token);
          }
        }
      })
      .catch(() => {
        // Token harvesting is an optimisation; the interstitial path still works.
      });
  }

  private async discoverToken(controller: string): Promise<string | undefined> {
    const href = await this.page
      .locator(`a[href*="controller=${controller}"][href*="token="]`)
      .first()
      .getAttribute('href')
      .catch(() => null);
    const token = href ? /[?&]token=([A-Za-z0-9]+)/.exec(href)?.[1] : undefined;
    if (token) this.tokens.set(controller, token);
    return token;
  }

  /**
   * PrestaShop answers a token-less admin URL with a confirmation page rather than an
   * error. Clicking through it is the documented way to reach a controller you have no
   * link to, and it hands back a valid token in the resulting URL.
   */
  private async passInvalidTokenInterstitial(): Promise<void> {
    const continueLink = this.page.locator('a[href*="token="]:visible').first();
    const isInterstitial = await this.page
      .locator('text=/invalid security token/i')
      .count()
      .catch(() => 0);
    if (!isInterstitial) return;

    await continueLink.click();
    await this.page.waitForLoadState('domcontentloaded');
  }
}
