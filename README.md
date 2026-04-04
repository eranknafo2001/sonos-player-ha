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

### 4. Create a template media player that follows the coordinator

The add-on publishes a `sensor.sonos_player_group_coordinator` entity whose state is the room name of the current managed-group coordinator (e.g. `LivingRoom`).

You can create a **template variable** in Home Assistant that resolves to the correct Sonos `media_player` entity, so your dashboard always controls the active coordinator.

#### Helper template sensor

Add this to your `configuration.yaml`:

```yaml
template:
  - sensor:
      - name: "Sonos Player Active Entity"
        unique_id: sonos_player_active_entity
        state: >
          {% set room = states('sensor.sonos_player_group_coordinator') | lower | replace(' ', '_') %}
          {% if room and room != 'none' and room != 'unknown' %}
            media_player.{{ room }}
          {% else %}
            none
          {% endif %}
```

This produces an entity like `sensor.sonos_player_active_entity` whose state is:
- `media_player.livingroom` when LivingRoom is the coordinator
- `media_player.treatment` when Treatment is the coordinator
- `none` when no group is active

Adjust the template if your Sonos entity IDs use a different naming pattern (e.g. `media_player.sonos_livingroom`). You can check the exact entity IDs in **Settings → Devices & Services → Sonos**.

#### Dashboard: show the active coordinator player

Use a **conditional card** or **custom:mini-media-player** with a template entity.

Simplest approach with a standard media control card:

```yaml
type: media-control
entity: media_player.livingroom
```

To make it dynamic, use a **Markdown card** or **custom:mini-media-player** with a template, or use the **custom:state-switch** card from HACS:

```yaml
type: custom:state-switch
entity: sensor.sonos_player_active_entity
states:
  media_player.livingroom:
    type: media-control
    entity: media_player.livingroom
  media_player.treatment:
    type: media-control
    entity: media_player.treatment
  media_player.shower:
    type: media-control
    entity: media_player.shower
default:
  type: markdown
  content: "No active Sonos group"
```

Alternatively, if you have [custom:mini-media-player](https://github.com/kalkih/mini-media-player) installed:

```yaml
type: custom:mini-media-player
entity: media_player.livingroom
group: true
hide:
  power: true
```

Replace the entity with whichever speaker is most commonly the coordinator, or duplicate cards and use conditional visibility based on `sensor.sonos_player_active_entity`.

#### Dashboard: conditional card per coordinator

You can also use built-in conditional cards:

```yaml
type: conditional
conditions:
  - entity: sensor.sonos_player_active_entity
    state: media_player.livingroom
card:
  type: media-control
  entity: media_player.livingroom
```

Add one conditional card per possible coordinator speaker. Only the active one will be shown.

## Notes

- speaker discovery/control only works when this machine can reach your Sonos network
- the headless service is the real app; the TUI is for inspection/debugging
- OpenTUI is isolated to the TUI package
- Home Assistant discovery is published through MQTT device discovery at `homeassistant/device/sonos-player/config`, and the app also clears common legacy per-entity discovery topics to avoid duplicates after upgrades
- the native HA Sonos integration provides full media_player entities with browsing, playback, and grouping support; no custom integration is needed
- this repo keeps the Home Assistant add-on source under `packages/ha-addon`, and CI publishes a generated distribution repo to `eranknafo2001/sonos-player-ha`
