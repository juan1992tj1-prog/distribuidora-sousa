#!/bin/sh
# Backup diário: dump do banco → criptografado → pasta local → nuvem (se configurada).
# Retenção: 7 diários, 4 semanais (domingo), 12 mensais (dia 1).
set -eu
DATA=$(date +%Y-%m-%d)
DIR=/backups
mkdir -p "$DIR/diario" "$DIR/semanal" "$DIR/mensal"
ARQ="$DIR/diario/distribuidora-$DATA.dump.gpg"

pg_dump --format=custom --no-owner | gpg --batch --yes --symmetric --cipher-algo AES256 \
  --passphrase "$BACKUP_SENHA" -o "$ARQ"

# confere se o arquivo abre (backup que não restaura não é backup)
gpg --batch --quiet --passphrase "$BACKUP_SENHA" -d "$ARQ" | pg_restore --list > /dev/null

[ "$(date +%u)" = "7" ] && cp "$ARQ" "$DIR/semanal/"
[ "$(date +%d)" = "01" ] && cp "$ARQ" "$DIR/mensal/"

ls -1t "$DIR/diario"/*.gpg  | tail -n +8  | xargs -r rm -f
ls -1t "$DIR/semanal"/*.gpg 2>/dev/null | tail -n +5  | xargs -r rm -f
ls -1t "$DIR/mensal"/*.gpg  2>/dev/null | tail -n +13 | xargs -r rm -f

if [ -n "${RCLONE_DESTINO:-}" ]; then
  rclone --config /config/rclone/rclone.conf sync "$DIR" "$RCLONE_DESTINO" && echo "Backup enviado para a nuvem."
fi
echo "Backup OK: $ARQ ($(du -h "$ARQ" | cut -f1))"
