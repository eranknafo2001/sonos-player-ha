from __future__ import annotations

from typing import Any

from aiohttp import ClientError
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession


class SonosPlayerApiClient:
    def __init__(self, hass: HomeAssistant, base_url: str, api_token: str) -> None:
        self.hass = hass
        self.base_url = base_url.rstrip("/")
        self.api_token = api_token
        self._session = async_get_clientsession(hass)

    def _headers(self) -> dict[str, str]:
        if not self.api_token:
            return {}
        return {"Authorization": f"Bearer {self.api_token}"}

    async def _request(self, method: str, path: str, json_payload: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        try:
            async with self._session.request(method, url, headers=self._headers(), json=json_payload) as response:
                response.raise_for_status()
                if response.content_type == "application/json":
                    return await response.json()
                return await response.text()
        except ClientError as err:
            raise RuntimeError(f"Request failed for {url}: {err}") from err

    async def async_healthcheck(self) -> None:
        await self._request("GET", "/health")

    async def async_get_state(self) -> dict[str, Any]:
        return await self._request("GET", "/api/state")

    async def async_command(self, action: str) -> None:
        await self._request("POST", "/api/command", {"action": action})

    async def async_browse_media(self, media_content_type: str = "root", media_content_id: str = "root") -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/api/browse?media_content_type={media_content_type}&media_content_id={media_content_id}",
        )

    async def async_play_media(self, media_content_type: str, media_content_id: str) -> None:
        await self._request(
            "POST",
            "/api/play-media",
            {
                "media_content_type": media_content_type,
                "media_content_id": media_content_id,
            },
        )
