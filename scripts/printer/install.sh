#!/bin/sh
# Adds the "Chalkd" printer: anything printed to it opens as a new board in
# Chalkd. Run once with: npm run printer:install (asks for your password).
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "This needs admin rights: run it with sudo." >&2
  exit 1
fi
here=$(dirname "$0")
serverbin=$(cups-config --serverbin 2>/dev/null || echo /usr/lib/cups)

# Root-owned and not world-executable, so CUPS runs it as root (it then
# writes each job as the user who printed it).
install -D -m 0700 -o root -g root "$here/chalkd-backend" "$serverbin/backend/chalkd"
install -D -m 0644 -o root -g root "$here/chalkd.ppd" /usr/share/ppd/chalkd/chalkd.ppd

# lpadmin warns that printer drivers are deprecated; that's expected.
lpadmin -p Chalkd -E -v chalkd:/ -P /usr/share/ppd/chalkd/chalkd.ppd \
  -D "Chalkd whiteboard" -L "Opens as a new board in Chalkd" \
  -o printer-is-shared=false

echo
echo "Added the Chalkd printer. Print to it from any app and the pages"
echo "open as a new board (or the next time you start Chalkd)."
