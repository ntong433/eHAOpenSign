#!/bin/sh
set -eu

server_url=${SERVER_URL:-http://localhost:8085/app}
app_id=${APP_ID:-opensign}

printf 'Local administrator username or email: '
IFS= read -r username
printf 'Password: '
stty -echo
IFS= read -r password
stty echo
printf '\n'
trap 'stty echo 2>/dev/null || true' EXIT INT TERM

curl -i -sS -G "$server_url/login" \
  -H "X-Parse-Application-Id: $app_id" \
  --data-urlencode "username=$username" \
  --data-urlencode "password=$password"

unset password
