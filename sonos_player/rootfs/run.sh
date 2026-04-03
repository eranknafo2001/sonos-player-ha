#!/bin/sh
set -eu

OPTIONS_FILE=/data/options.json

json_get() {
  jq -r "$1 // empty" "$OPTIONS_FILE"
}

export SONOS_HOST="$(json_get '.sonos_host')"
export SONOS_PORT="$(json_get '.sonos_port')"
export SONOS_DISCOVERY_TIMEOUT="$(json_get '.sonos_discovery_timeout')"
export MQTT_URL="$(json_get '.mqtt_url')"
export MQTT_USER="$(json_get '.mqtt_user')"
export MQTT_PASSWORD="$(json_get '.mqtt_password')"
export MQTT_DISCOVERY_PREFIX="$(json_get '.mqtt_discovery_prefix')"
export SONOS_PLAYER_API_PORT="$(json_get '.api_port')"
export SONOS_PLAYER_API_TOKEN="$(json_get '.api_token')"

exec bun /app/packages/headless/src/index.ts
