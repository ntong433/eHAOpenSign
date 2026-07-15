#!/bin/sh

ENV_FILE=./build/env.js

echo "Generating runtime env file at $ENV_FILE..."

escape_js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r//g; :a;N;$!ba;s/\n/\\n/g'
}

public_url=$(printenv PUBLIC_URL)
server_url=$(printenv SERVER_URL)
react_server_url=$(printenv REACT_APP_SERVERURL)
app_id=$(printenv APP_ID)
local_auth_enabled=$(printenv REACT_APP_USE_LOCAL)

[ -n "$react_server_url" ] || react_server_url="$server_url"
[ -n "$server_url" ] || server_url="$react_server_url"
[ -n "$app_id" ] || app_id="opensign"
[ -n "$local_auth_enabled" ] || local_auth_enabled="true"

cat > "$ENV_FILE" <<EOF
window.RUNTIME_CONFIG = {
  PUBLIC_URL: "$(escape_js_string "$public_url")",
  SERVER_URL: "$(escape_js_string "$server_url")",
  REACT_APP_SERVERURL: "$(escape_js_string "$react_server_url")",
  APP_ID: "$(escape_js_string "$app_id")",
  LOCAL_AUTH_ENABLED: "$(escape_js_string "$local_auth_enabled")"
};
window.RUNTIME_ENV = window.RUNTIME_CONFIG;
EOF

exec "$@"
