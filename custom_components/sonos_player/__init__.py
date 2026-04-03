from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .api import SonosPlayerApiClient
from .const import CONF_API_TOKEN, CONF_BASE_URL, DOMAIN, PLATFORMS


aSYNC_CLIENT_KEY = "client"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    client = SonosPlayerApiClient(
        hass,
        entry.data[CONF_BASE_URL],
        entry.data.get(CONF_API_TOKEN, ""),
    )
    hass.data[DOMAIN][entry.entry_id] = {"client": client}
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok
