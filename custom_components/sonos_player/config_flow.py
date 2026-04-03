from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .api import SonosPlayerApiClient
from .const import CONF_API_TOKEN, CONF_BASE_URL, DOMAIN


class SonosPlayerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            client = SonosPlayerApiClient(self.hass, user_input[CONF_BASE_URL], user_input.get(CONF_API_TOKEN, ""))
            try:
                await client.async_healthcheck()
            except Exception:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(user_input[CONF_BASE_URL])
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title="Sonos Player", data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_BASE_URL): str,
                    vol.Optional(CONF_API_TOKEN, default=""): str,
                }
            ),
            errors=errors,
        )
