from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from homeassistant.components.media_player import (
    BrowseMedia,
    MediaPlayerDeviceClass,
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
    MediaType,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, CoordinatorEntity

from .api import SonosPlayerApiClient
from .const import DEFAULT_SCAN_INTERVAL_SECONDS, DOMAIN

_LOGGER = logging.getLogger(__name__)

SUPPORTED_FEATURES = (
    MediaPlayerEntityFeature.PLAY
    | MediaPlayerEntityFeature.PAUSE
    | MediaPlayerEntityFeature.NEXT_TRACK
    | MediaPlayerEntityFeature.PREVIOUS_TRACK
    | MediaPlayerEntityFeature.BROWSE_MEDIA
    | MediaPlayerEntityFeature.PLAY_MEDIA
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    client: SonosPlayerApiClient = hass.data[DOMAIN][entry.entry_id]["client"]
    coordinator = DataUpdateCoordinator[
        dict[str, Any]
    ](
        hass,
        logger=_LOGGER,
        name="sonos_player",
        update_method=client.async_get_state,
        update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL_SECONDS),
    )
    await coordinator.async_config_entry_first_refresh()
    async_add_entities([SonosPlayerMediaEntity(entry, client, coordinator)])


class SonosPlayerMediaEntity(CoordinatorEntity[DataUpdateCoordinator[dict[str, Any]]], MediaPlayerEntity):
    _attr_has_entity_name = True
    _attr_name = "Managed group"
    _attr_device_class = MediaPlayerDeviceClass.SPEAKER
    _attr_supported_features = SUPPORTED_FEATURES

    def __init__(
        self,
        entry: ConfigEntry,
        client: SonosPlayerApiClient,
        coordinator: DataUpdateCoordinator[dict[str, Any]],
    ) -> None:
        super().__init__(coordinator)
        self._client = client
        self._attr_unique_id = "sonos_player_managed_group"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, "sonos-player")},
            "name": "Sonos Player",
            "manufacturer": "Custom",
            "model": "Sonos Group Manager",
        }

    @property
    def state(self) -> MediaPlayerState:
        value = str(self.coordinator.data.get("transportState", "IDLE")).upper()
        if value == "PLAYING":
            return MediaPlayerState.PLAYING
        if value == "PAUSED_PLAYBACK":
            return MediaPlayerState.PAUSED
        return MediaPlayerState.IDLE

    @property
    def media_title(self) -> str | None:
        return self.coordinator.data.get("mediaTitle")

    @property
    def media_artist(self) -> str | None:
        return self.coordinator.data.get("mediaArtist")

    @property
    def media_album_name(self) -> str | None:
        return self.coordinator.data.get("mediaAlbumName")

    @property
    def volume_level(self) -> float | None:
        return self.coordinator.data.get("volumeLevel")

    @property
    def is_volume_muted(self) -> bool | None:
        return self.coordinator.data.get("isVolumeMuted")

    @property
    def source(self) -> str | None:
        return self.coordinator.data.get("coordinatorRoomName")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "coordinator_id": self.coordinator.data.get("coordinatorId"),
            "coordinator_room_name": self.coordinator.data.get("coordinatorRoomName"),
            "desired_speaker_ids": self.coordinator.data.get("desiredSpeakerIds", []),
        }

    async def async_media_play(self) -> None:
        await self._client.async_command("play")
        await self.coordinator.async_request_refresh()

    async def async_media_pause(self) -> None:
        await self._client.async_command("pause")
        await self.coordinator.async_request_refresh()

    async def async_media_next_track(self) -> None:
        await self._client.async_command("next")
        await self.coordinator.async_request_refresh()

    async def async_media_previous_track(self) -> None:
        await self._client.async_command("previous")
        await self.coordinator.async_request_refresh()

    async def async_play_media(self, media_type: MediaType | str, media_id: str, **kwargs: Any) -> None:
        await self._client.async_play_media(str(media_type), media_id)
        await self.coordinator.async_request_refresh()

    async def async_browse_media(
        self,
        media_content_type: str | None = None,
        media_content_id: str | None = None,
    ) -> BrowseMedia:
        payload = await self._client.async_browse_media(media_content_type or "root", media_content_id or "root")
        return self._build_browse(payload)

    def _build_browse(self, payload: dict[str, Any]) -> BrowseMedia:
        return BrowseMedia(
            title=payload.get("title", "Sonos Player"),
            media_class="directory",
            media_content_id=payload.get("media_content_id", "root"),
            media_content_type=payload.get("media_content_type", "root"),
            can_play=payload.get("can_play", False),
            can_expand=payload.get("can_expand", True),
            children=[self._build_item(item) for item in payload.get("children", [])],
        )

    def _build_item(self, item: dict[str, Any]) -> BrowseMedia:
        return BrowseMedia(
            title=item.get("title", "Item"),
            media_class="music",
            media_content_id=item.get("media_content_id", ""),
            media_content_type=item.get("media_content_type", ""),
            can_play=item.get("canPlay", False),
            can_expand=item.get("canExpand", False),
            thumbnail=item.get("imageUrl"),
        )
