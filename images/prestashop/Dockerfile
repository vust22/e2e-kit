# Seeded PrestaShop image (spec §4.1).
#
# The shop is installed and seeded at BUILD time so CI never runs the installer
# (Goal 2). The builder stage starts a throwaway MariaDB, installs PrestaShop against it,
# applies the seed dataset through PrestaShop's own object model, and dumps the result.
# The final stage ships the installed tree plus that dump; the entrypoint imports it into
# whatever database the compose stack provides. See DECISIONS.md D-001 and D-011.

ARG PS_BASE=prestashop/prestashop:8.2.2-8.1-apache

# ---------------------------------------------------------------------------------
# Stage 1: install + seed
# ---------------------------------------------------------------------------------
FROM ${PS_BASE} AS builder

ARG PS_MAJOR=8
ARG SHOP_DOMAIN=localhost:8080
ARG ADMIN_FOLDER=admin-e2e
ARG DB_NAME=prestashop
ARG DB_USER=prestashop
ARG DB_PASSWORD=prestashop

ENV DEBIAN_FRONTEND=noninteractive \
    PS_MAJOR=${PS_MAJOR} \
    SHOP_DOMAIN=${SHOP_DOMAIN} \
    ADMIN_FOLDER=${ADMIN_FOLDER} \
    DB_NAME=${DB_NAME} \
    DB_USER=${DB_USER} \
    DB_PASSWORD=${DB_PASSWORD}

RUN apt-get update \
 && apt-get install -y --no-install-recommends mariadb-server \
 && rm -rf /var/lib/apt/lists/*

COPY images/prestashop/seed/manifest.json /e2e/seed/manifest.json
COPY images/prestashop/seed/seed.php      /e2e/seed/seed.php
COPY images/prestashop/build/install.sh   /e2e/build/install.sh

RUN chmod +x /e2e/build/install.sh && /e2e/build/install.sh

# ---------------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------------
FROM ${PS_BASE} AS final

ARG PS_MAJOR=8
ARG ADMIN_FOLDER=admin-e2e
ARG DB_NAME=prestashop
ARG DB_USER=prestashop
ARG DB_PASSWORD=prestashop

# The release base image ships an *uninstalled* PrestaShop tree already extracted into
# /var/www/html. COPY merges rather than replaces, so without this the image would carry
# both trees — including a second, stale `admin/` back office next to ours.
RUN rm -rf /var/www/html && mkdir -p /var/www/html

# The installed shop and the seeded database dump.
COPY --from=builder /var/www/html /var/www/html
COPY --from=builder /e2e/seed/prestashop.sql /e2e/seed/prestashop.sql

# E2E CA trust (spec §4.1 item 9): lets PHP/curl/Guzzle trust mock services that present
# provider-hostname certificates inside the compose network. Generated per build; the
# private key never enters this image.
COPY images/prestashop/e2e-ca/e2e-ca.crt /usr/local/share/ca-certificates/e2e-ca.crt

COPY images/prestashop/bin/ /usr/local/bin/
COPY images/prestashop/conf/e2e.ini /usr/local/etc/php/conf.d/zz-e2e.ini
COPY images/prestashop/conf/e2e-apache.conf /etc/apache2/conf-available/e2e.conf

RUN set -eux; \
    update-ca-certificates; \
    a2enmod rewrite; \
    a2enconf e2e; \
    chmod +x /usr/local/bin/e2e-*; \
    chown -R www-data:www-data /var/www/html

ENV PS_MAJOR=${PS_MAJOR} \
    E2E_ADMIN_FOLDER=${ADMIN_FOLDER} \
    DB_SERVER=db \
    DB_PORT=3306 \
    DB_NAME=${DB_NAME} \
    DB_USER=${DB_USER} \
    DB_PASSWD=${DB_PASSWORD} \
    DB_PREFIX=ps_ \
    E2E_SHOP_DOMAIN=localhost:8080 \
    E2E_RESET_DB=0 \
    E2E_SEED_SQL=/e2e/seed/prestashop.sql

EXPOSE 80

# Spec §4.1 item 5.
HEALTHCHECK --interval=5s --timeout=5s --start-period=20s --retries=24 \
  CMD curl -fsS -o /dev/null http://127.0.0.1/index.php || exit 1

ENTRYPOINT ["/usr/local/bin/e2e-entrypoint"]
CMD ["apache2-foreground"]
