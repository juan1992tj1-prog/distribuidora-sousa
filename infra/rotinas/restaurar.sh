#!/bin/sh
# Restaura um backup. ATENÇÃO: substitui o banco atual.
# Uso: docker compose exec rotinas /rotinas/restaurar.sh /backups/diario/distribuidora-AAAA-MM-DD.dump.gpg
set -eu
[ -f "${1:-}" ] || { echo "Informe o arquivo .dump.gpg"; exit 1; }
echo "Isso vai SUBSTITUIR o banco atual por $1. Digite RESTAURAR para continuar:"
read -r ok
[ "$ok" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }
gpg --batch --quiet --passphrase "$BACKUP_SENHA" -d "$1" | pg_restore --clean --if-exists --no-owner -d "$PGDATABASE"
echo "Restaurado. Reinicie o app: docker compose restart app"
