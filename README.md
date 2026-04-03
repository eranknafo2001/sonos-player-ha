# sonos-player

A local Sonos controller built with Bun, `@svrooij/sonos`, MQTT, and a separate OpenTUI debug app.

## Workspace layout

- `packages/core` — Sonos control, MQTT integration, shared app logic, CLI
- `packages/headless` — headless service entrypoint + HTTP API
- `packages/tui` — debug OpenTUI app
- `packages/ha-addon` — source package for the Home Assistant add-on
- `packages/ha-integration` — source package for the Home Assistant custom integration
- `sonos_player` — publishable HAOS add-on path at repo root
- `custom_components/sonos_player` — publishable HACS/manual integration path at repo root

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

This repository now supports both Home Assistant distribution paths from the repo root:

- **HA add-on repository** via root `repository.yaml`
- **HACS custom integration** via root `hacs.json`

Publishable root paths:

- `sonos_player/` — HAOS add-on
- `custom_components/sonos_player/` — HACS/manual custom integration

Quick add links:

- HACS custom repo: `https://my.home-assistant.io/redirect/hacs_repository/?owner=eranknafo2001&repository=sonos-player&category=integration`
- Add-on repo: `https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Feranknafo2001%2Fsonos-player`

You need both if you want the full HA experience.

### 1. Install the add-on on HAOS

Add this repository URL to the Home Assistant add-on store repositories list, then install the add-on:

- `sonos_player`

Repository quick link:

- `https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Feranknafo2001%2Fsonos-player`

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

The backend exposes an HTTP API on port `8099`.

Health check example:

```txt
http://homeassistant.local:8099/health
```

Expected response:

```json
{"ok":true}
```

### 2. Install the custom integration

#### HACS
Add this repository as a custom repository in HACS and install:

- `Sonos Player`

Repository quick link:

- `https://my.home-assistant.io/redirect/hacs_repository/?owner=eranknafo2001&repository=sonos-player&category=integration`

This uses the root integration path:

- `custom_components/sonos_player`

#### Manual install
Copy:

- `custom_components/sonos_player`

into your Home Assistant config directory:

- `config/custom_components/sonos_player`

Then restart Home Assistant.

### 3. Add the integration in Home Assistant

In Home Assistant:

- go to **Settings → Devices & Services**
- click **Add Integration**
- search for **Sonos Player**

Enter:

- **Base URL** — for example `http://homeassistant.local:8099`
- **API token** — if configured in the add-on

### 4. What you will get

#### MQTT-discovered entities
Via MQTT discovery, you should get:

- per-speaker group membership switches
- per-speaker workaround switches
- coordinator sensor

#### Custom integration entity
Via the custom integration, you should get:

- one real `media_player` named **Managed group**

Current custom integration features:

- play
- pause
- next
- previous
- browse media
- play media

Current media browsing support:

- Sonos Favorites

## Notes

- speaker discovery/control only works when this machine can reach your Sonos network
- the headless service is the real app; the TUI is for inspection/debugging
- OpenTUI is isolated to the TUI package
- Home Assistant discovery is published through MQTT device discovery at `homeassistant/device/sonos-player/config`, and the app also clears common legacy per-entity discovery topics to avoid duplicates after upgrades
- the custom Home Assistant integration uses the headless HTTP API to provide a real `media_player` with Sonos Favorites browsing
- this repo now includes both the root-level HA add-on repository metadata and the root-level HACS metadata so one GitHub repository can be used for both distribution paths
- the root `sonos_player/` add-on folder is self-contained for Home Assistant add-on builds and includes its own copied workspace files needed by the Docker build
