#!/usr/bin/env bash
# One-time setup for an isolated Linux VM. Existing GitHub jobs remain enabled.
set -euo pipefail
if [[ "$(id -u)" -eq 0 ]]; then
  echo "Refusing root installation. Use a dedicated non-root automation account." >&2
  exit 1
fi
script_dir="$(cd "$(dirname "$0")" && pwd)"
script="$script_dir/offhost_engineer.py"
python3 "$script" --preflight
mkdir -p "$HOME/.local/share/omv-offhost"
chmod 700 "$HOME/.local/share/omv-offhost"
existing="$(crontab -l 2>/dev/null || true)"
clean="$(printf '%s\n' "$existing" | sed '/^# OmegaVault offhost BEGIN$/,/^# OmegaVault offhost END$/d')"
{
  printf '%s\n' "$clean"
  echo '# OmegaVault offhost BEGIN'
  # The minute component is invariant across AZ and UTC timezones.
  echo "PATH=$PATH"
  echo "7,27,47 * * * * /usr/bin/python3 '$script' --once >> '$HOME/.local/share/omv-offhost/cron.log' 2>&1"
  echo '# OmegaVault offhost END'
} | crontab -
echo "Installed cron schedule :07/:27/:47, with process lock and issue #3 receipts."
echo "Existing hosted GitHub Action schedules have NOT been disabled."
echo "For proof, execute: python3 '$script' --once"
