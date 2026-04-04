from homeassistant.const import Platform

DOMAIN = "sonos_player"
PLATFORMS = [Platform.MEDIA_PLAYER]
CONF_BASE_URL = "base_url"
CONF_API_TOKEN = "api_token"
DEFAULT_SCAN_INTERVAL_SECONDS = 5
