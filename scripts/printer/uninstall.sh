#!/bin/sh
# Removes the "Chalkd" printer. Run with: npm run printer:uninstall
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "This needs admin rights: run it with sudo." >&2
  exit 1
fi
serverbin=$(cups-config --serverbin 2>/dev/null || echo /usr/lib/cups)

lpadmin -x Chalkd 2>/dev/null || true
rm -f "$serverbin/backend/chalkd"
rm -rf /usr/share/ppd/chalkd
echo "Removed the Chalkd printer."
