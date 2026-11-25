#!/usr/bin/env bash
# One-time: send mail through Gmail with an app password (https://myaccount.google.com/apppasswords).
# The password is typed here, never shown, and stored root-only in /etc/postfix/sasl_passwd.
set -euo pipefail
read -rp "Gmail address to send from and to: " addr
read -rsp "Gmail app password (16 letters, spaces OK): " pw; echo
pw=${pw// /}
[ ${#pw} -eq 16 ] || { echo "That is not 16 letters; nothing changed."; exit 1; }
dpkg -s libsasl2-modules >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y -q libsasl2-modules
umask 077
printf '[smtp.gmail.com]:587 %s:%s\n' "$addr" "$pw" >/etc/postfix/sasl_passwd
postmap /etc/postfix/sasl_passwd
postconf -e 'relayhost = [smtp.gmail.com]:587' 'smtp_sasl_auth_enable = yes' \
  'smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd' 'smtp_sasl_security_options = noanonymous' \
  'smtp_tls_security_level = encrypt' 'smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt'
systemctl restart postfix
install -d -m 700 /etc/oscar-nightly
touch /etc/oscar-nightly/config; chmod 600 /etc/oscar-nightly/config
grep -v '^EMAIL_' /etc/oscar-nightly/config >/etc/oscar-nightly/config.new || true
printf 'EMAIL_TO=%s\nEMAIL_FROM=%s\n' "$addr" "$addr" >>/etc/oscar-nightly/config.new
mv /etc/oscar-nightly/config.new /etc/oscar-nightly/config
/usr/local/sbin/oscar-nightly-upstream --test-email
echo "Check your inbox in a minute. If nothing arrives: journalctl -u postfix -n 30"
