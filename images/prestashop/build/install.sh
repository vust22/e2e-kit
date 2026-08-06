#!/bin/bash
# Build-time PrestaShop install + seed (spec §4.1 items 2-4, DECISIONS.md D-001).
#
# Runs inside the builder stage. Starts a throwaway MariaDB on the loopback interface,
# installs PrestaShop against it, applies the seed dataset, then dumps the database to
# /e2e/seed/prestashop.sql for the runtime stage to import.
set -euo pipefail

PS_ROOT=/var/www/html
# The installer runs against the loopback MariaDB in this stage. The database host the
# shop actually talks to is rewritten from $DB_SERVER on every boot by the entrypoint
# (`e2e-db-params`), so nothing about the compose topology is baked into the image.
DB_HOST_BUILD=127.0.0.1
SEED_OUT=/e2e/seed/prestashop.sql

log() { printf '\n\033[1;36m[e2e-build]\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------------------------
log "Starting throwaway MariaDB"
mkdir -p /run/mysqld /var/lib/mysql
chown -R mysql:mysql /run/mysqld /var/lib/mysql
mariadb-install-db --user=mysql --datadir=/var/lib/mysql --auth-root-authentication-method=socket >/dev/null

mysqld_safe --user=mysql --datadir=/var/lib/mysql --bind-address=127.0.0.1 --skip-name-resolve &

for i in $(seq 1 60); do
  if mysqladmin --protocol=socket ping >/dev/null 2>&1; then break; fi
  if [ "$i" = 60 ]; then echo "MariaDB failed to start" >&2; exit 1; fi
  sleep 1
done
log "MariaDB is up"

mysql --protocol=socket <<SQL
CREATE DATABASE \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'%';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# ---------------------------------------------------------------------------------
log "Placing PrestaShop source"
cp -R -T -p /tmp/data-ps/prestashop/ "${PS_ROOT}"
if [ -f /tmp/defines_custom.inc.php ]; then
  cp -p /tmp/defines_custom.inc.php "${PS_ROOT}/config/defines_custom.inc.php"
fi

chown -R www-data:www-data "${PS_ROOT}"

# overlayfs refuses to rename a directory that still lives in a lower image layer, failing
# with "Invalid cross-device link". PrestaShop 9's installer renames admin/ to a random
# name as a hardening step, so the directory has to be forced into the writable layer
# first — `cp` then `mv` does that, because the copy is created in the upper layer.
if [ -d "${PS_ROOT}/admin" ]; then
  log "Forcing admin/ into the writable image layer (overlayfs rename limitation)"
  cp -a "${PS_ROOT}/admin" "${PS_ROOT}/admin.copyup"
  rm -rf "${PS_ROOT:?}/admin"
  mv "${PS_ROOT}/admin.copyup" "${PS_ROOT}/admin"
  chown -R www-data:www-data "${PS_ROOT}/admin"
fi

# ---------------------------------------------------------------------------------
log "Reading seed manifest"
ADMIN_EMAIL=$(php -r '$m=json_decode(file_get_contents("/e2e/seed/manifest.json"),true); echo $m["admin"]["email"];')
ADMIN_PASSWORD=$(php -r '$m=json_decode(file_get_contents("/e2e/seed/manifest.json"),true); echo $m["admin"]["password"];')
ADMIN_FIRSTNAME=$(php -r '$m=json_decode(file_get_contents("/e2e/seed/manifest.json"),true); echo $m["admin"]["firstName"];')
ADMIN_LASTNAME=$(php -r '$m=json_decode(file_get_contents("/e2e/seed/manifest.json"),true); echo $m["admin"]["lastName"];')
SHOP_NAME=$(php -r '$m=json_decode(file_get_contents("/e2e/seed/manifest.json"),true); echo $m["shop"]["name"];')

log "Running the PrestaShop installer (domain=${SHOP_DOMAIN}, no demo fixtures)"
# --fixtures=0 keeps the id space clean so the seed dataset's fixed ids are achievable.
runuser -g www-data -u www-data -- php -d memory_limit=-1 "${PS_ROOT}/install/index_cli.php" \
  --domain="${SHOP_DOMAIN}" \
  --db_server="${DB_HOST_BUILD}:3306" \
  --db_name="${DB_NAME}" \
  --db_user="${DB_USER}" \
  --db_password="${DB_PASSWORD}" \
  --prefix=ps_ \
  --name="${SHOP_NAME}" \
  --firstname="${ADMIN_FIRSTNAME}" \
  --lastname="${ADMIN_LASTNAME}" \
  --email="${ADMIN_EMAIL}" \
  --password="${ADMIN_PASSWORD}" \
  --language=en \
  --country=lt \
  --all_languages=0 \
  --newsletter=0 \
  --send_email=0 \
  --ssl=0 \
  --fixtures=0

log "Removing the install folder"
rm -rf "${PS_ROOT}/install"

# The rename happens *after* the installer, for two reasons: PrestaShop 8 recreates a
# default `admin/` of its own if one is missing, and PrestaShop 9 renames it to a random
# `adminXXXXXXXX` as a hardening step. So the current name has to be discovered rather
# than assumed — it is the directory holding bootstrap.php, excluding PS 9's `admin-api`.
current_admin=""
for candidate in "${PS_ROOT}"/admin*; do
  [ -d "${candidate}" ] || continue
  [ "$(basename "${candidate}")" = 'admin-api' ] && continue
  [ -f "${candidate}/bootstrap.php" ] || continue
  current_admin="${candidate}"
  break
done

if [ -z "${current_admin}" ]; then
  echo "could not find the installed back-office directory under ${PS_ROOT}" >&2
  ls -d "${PS_ROOT}"/admin* >&2 2>/dev/null || true
  exit 1
fi

if [ "$(basename "${current_admin}")" != "${ADMIN_FOLDER}" ]; then
  log "Renaming $(basename "${current_admin}") -> ${ADMIN_FOLDER}"
  rm -rf "${PS_ROOT:?}/${ADMIN_FOLDER}"
  mv "${current_admin}" "${PS_ROOT}/${ADMIN_FOLDER}"
fi

log "Admin folders present: $(cd "${PS_ROOT}" && ls -d admin* 2>/dev/null | tr '\n' ' ')"

# ---------------------------------------------------------------------------------
log "Applying the seed dataset"
runuser -g www-data -u www-data -- php -d memory_limit=-1 /e2e/seed/seed.php /e2e/seed/manifest.json

log "Clearing cache"
runuser -g www-data -u www-data -- php -d memory_limit=-1 "${PS_ROOT}/bin/console" cache:clear --no-interaction --env=prod || true
rm -rf "${PS_ROOT}/var/cache/"* "${PS_ROOT}/cache/smarty/compile/"* "${PS_ROOT}/cache/smarty/cache/"* 2>/dev/null || true

# ---------------------------------------------------------------------------------
log "Dumping the seeded database"
mkdir -p "$(dirname "${SEED_OUT}")"
mysqldump --protocol=socket --no-tablespaces --skip-comments --single-transaction \
  --default-character-set=utf8mb4 "${DB_NAME}" > "${SEED_OUT}"
echo "Dump size: $(wc -c < "${SEED_OUT}") bytes"

log "Stopping MariaDB"
mysqladmin --protocol=socket shutdown
rm -rf /var/lib/mysql

# Safety net: nothing above should leave a default `admin/` behind, but shipping two back
# offices is the kind of thing nobody notices until a test logs into the wrong one.
# (`admin-api` on PrestaShop 9 is a different thing and is deliberately kept.)
if [ "${ADMIN_FOLDER}" != "admin" ] && [ -d "${PS_ROOT}/admin" ]; then
  log "Removing a leftover default admin folder"
  rm -rf "${PS_ROOT:?}/admin"
fi

log "Final admin folders: $(cd "${PS_ROOT}" && ls -d admin* 2>/dev/null | tr '\n' ' ')"
if [ ! -f "${PS_ROOT}/${ADMIN_FOLDER}/index.php" ]; then
  echo "back office is missing ${ADMIN_FOLDER}/index.php" >&2
  exit 1
fi

chown -R www-data:www-data "${PS_ROOT}"
log "Build-time install complete"
