# sonos-player

A local Sonos controller built with Bun, `@svrooij/sonos`, MQTT, and a separate OpenTUI debug app.

## Workspace layout

- `packages/core` — Sonos control, MQTT integration, shared app logic, CLI
- `packages/headless` — headless service entrypoint
- `packages/tui` — debug OpenTUI app
- `packages/ha-addon` — Home Assistant add-on source (Dockerfile, config.yaml, run.sh)
- `scripts/export-ha.ts` — exports publishable HA repo to `dist/ha-publish`

## Development environment

This project includes a Nix flake so you do not need to install tools system-wide.

```bash
nix develop
bun install
```

## Run

Headless service:

```bash
bun start
```

Debug TUI:

```bash
bun tui
```

CLI:

```bash
bun cli -- scan
bun cli -- groups
bun cli -- state "Living Room"
bun cli -- join "Treatment Room" "Living Room"
bun cli -- leave "Treatment Room"
```

If Sonos multicast discovery does not work on your machine/network, seed the app with one known speaker IP:

```bash
SONOS_HOST=192.168.1.50 bun start
```

Optional:

```bash
SONOS_DISCOVERY_TIMEOUT=15 bun start
```

A root `.env` file is included with the supported variables. Each package script explicitly loads `../../.env`, so both root commands and package-local commands use the same repo-root env file.

MQTT connection can be configured with environment variables:

```bash
MQTT_URL=mqtt://192.168.1.25:1883
MQTT_USER=your-user
MQTT_PASSWORD=your-password
```

## TUI keys

- `↑/↓` or `j/k`: move between speakers
- `space`: add/remove the focused speaker from the managed group
- `a`: include all speakers in the managed group
- `x`: remove all speakers from the managed group
- `r`: refresh state
- `p`: play the target group
- `s`: pause the target group
- `n`: next track
- `b`: previous track
- `m`: mute/unmute the target group
- `+` / `-`: adjust volume by 5
- `g`: pin target group to the focused speaker's current group
- `u`: unpin target group
- `q` or `esc`: quit

## Home Assistant setup

This repo is now the **source repo**.

The publishable Home Assistant repo is:

- `https://github.com/eranknafo2001/sonos-player-ha`

It is generated from this repo by CI using:

- `bun run export:ha`

Quick add link:

- Add-on repo: `https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Feranknafo2001%2Fsonos-player-ha`

### 1. Install the add-on on HAOS

Add the published repository URL to the Home Assistant add-on store repositories list, then install the add-on:

- `sonos_player`

Repository quick link:

- `https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Feranknafo2001%2Fsonos-player-ha`

Configure it with values like:

```yaml
sonos_host: 192.168.1.236
sonos_port: 1400
sonos_discovery_timeout: 10
mqtt_url: mqtt://core-mosquitto:1883
mqtt_user: your-user
mqtt_password: your-password
mqtt_discovery_prefix: homeassistant
api_port: 8099
api_token: ""
```

Then start the add-on.

### 2. Use the native Sonos integration for playback

The official Home Assistant Sonos integration already provides full `media_player` entities per speaker with:

- play/pause/next/previous
- volume/mute
- media browsing (Sonos Favorites, music library, Spotify, etc.)
- play media
- grouping via `media_player.join` / `media_player.unjoin`

Use the native Sonos `media_player` entities for playback and media selection.
Use this add-on's MQTT switches to control which speakers are in the managed group.

### 3. What you will get

#### MQTT-discovered entities
Via MQTT discovery, you should get:

- per-speaker group membership switches
- per-speaker workaround switches
- coordinator sensor

## Notes

- speaker discovery/control only works when this machine can reach your Sonos network
- the headless service is the real app; the TUI is for inspection/debugging
- OpenTUI is isolated to the TUI package
- Home Assistant discovery is published through MQTT device discovery at `homeassistant/device/sonos-player/config`, and the app also clears common legacy per-entity discovery topics to avoid duplicates after upgrades
- the native HA Sonos integration provides full media_player entities with browsing, playback, and grouping support; no custom integration is needed
- this repo keeps the Home Assistant add-on source under `packages/ha-addon`, and CI publishes a generated distribution repo to `eranknafo2001/sonos-player-ha`
