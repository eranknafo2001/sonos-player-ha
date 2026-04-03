import { SonosManager } from "@svrooij/sonos";
import type { Track, TransportState, ZoneGroup } from "@svrooij/sonos/lib/models";
import type { SonosSpeaker, SonosSpeakerState } from "./types";

const INSTANCE_ID = 0;
const MASTER_CHANNEL = "Master";

type TrackLike = Track | string | undefined;

function readTrack(track: TrackLike) {
  if (!track || typeof track === "string") {
    return {};
  }

  return {
    currentTrack: track.Title,
    currentArtist: track.Artist,
    currentAlbum: track.Album,
  } satisfies Pick<SonosSpeakerState, "currentTrack" | "currentArtist" | "currentAlbum">;
}

export async function createManager(timeoutSeconds = Number(process.env.SONOS_DISCOVERY_TIMEOUT ?? 10)) {
  const manager = new SonosManager();
  const seedHost = process.env.SONOS_HOST || process.env.SONOS_SEED_HOST;
  const found = seedHost
    ? await manager.InitializeFromDevice(seedHost, Number(process.env.SONOS_PORT ?? 1400))
    : await manager.InitializeWithDiscovery(timeoutSeconds);

  return { manager, found };
}

export async function loadSpeakersFromManager(manager: SonosManager) {
  const speakers = await Promise.all(
    manager.Devices.map(async (device) => {
      await device.LoadDeviceData();
      const zone = await device.GetZoneAttributes().catch(() => undefined);

      return {
        id: device.Uuid,
        roomName: zone?.CurrentZoneName || device.Name || device.Uuid,
        host: device.Host,
        port: device.Port,
        device,
      } satisfies SonosSpeaker;
    }),
  );

  return speakers.sort((a, b) => a.roomName.localeCompare(b.roomName));
}

export async function discoverSpeakers(timeoutSeconds = Number(process.env.SONOS_DISCOVERY_TIMEOUT ?? 10)) {
  const { manager, found } = await createManager(timeoutSeconds);
  if (!found) {
    return { manager, speakers: [] as SonosSpeaker[] };
  }

  return {
    manager,
    speakers: await loadSpeakersFromManager(manager),
  };
}

export async function fetchSpeakerState(speaker: SonosSpeaker): Promise<SonosSpeakerState> {
  const [transport, position, media, volume, mute] = await Promise.all([
    speaker.device.AVTransportService.GetTransportInfo({ InstanceID: INSTANCE_ID }),
    speaker.device.AVTransportService.GetPositionInfo({ InstanceID: INSTANCE_ID }),
    speaker.device.AVTransportService.GetMediaInfo({ InstanceID: INSTANCE_ID }),
    speaker.device.RenderingControlService.GetVolume({ InstanceID: INSTANCE_ID, Channel: MASTER_CHANNEL }),
    speaker.device.RenderingControlService.GetMute({ InstanceID: INSTANCE_ID, Channel: MASTER_CHANNEL }),
  ]);

  return {
    transportState: transport.CurrentTransportState,
    position: position.RelTime,
    volume: volume.CurrentVolume,
    muted: mute.CurrentMute,
    currentUri: media.CurrentURI,
    mediaDuration: media.MediaDuration,
    trackUri: position.TrackURI,
    trackDuration: position.TrackDuration,
    ...readTrack(position.TrackMetaData),
  };
}

export async function fetchSpeakerStates(speakers: SonosSpeaker[]) {
  const entries = await Promise.all(
    speakers.map(async (speaker) => {
      try {
        return [speaker.id, await fetchSpeakerState(speaker)] as const;
      } catch (error) {
        return [
          speaker.id,
          {
            transportState: "ERROR",
            currentTrack: error instanceof Error ? error.message : String(error),
          } satisfies SonosSpeakerState,
        ] as const;
      }
    }),
  );

  return new Map(entries);
}

export async function fetchGroups(speakers: SonosSpeaker[]): Promise<ZoneGroup[]> {
  const anchor = speakers[0];
  if (!anchor) return [];
  return anchor.device.GetZoneGroupState();
}

export async function joinToCoordinator(speaker: SonosSpeaker, coordinator: SonosSpeaker) {
  if (speaker.id === coordinator.id) return;
  await speaker.device.JoinGroup(coordinator.roomName);
}

export async function makeStandalone(speaker: SonosSpeaker) {
  await speaker.device.AVTransportService.BecomeCoordinatorOfStandaloneGroup({ InstanceID: INSTANCE_ID });
}

export async function getSpeakerFavorites(speaker: SonosSpeaker) {
  return await speaker.device.GetFavorites();
}

export async function setSpeakerTransportUri(speaker: SonosSpeaker, trackUri: string) {
  await speaker.device.SetAVTransportURI(trackUri);
}

export async function playSpeaker(speaker: SonosSpeaker) {
  await speaker.device.Play();
}

export async function pauseSpeaker(speaker: SonosSpeaker) {
  await speaker.device.Pause();
}

export async function nextSpeaker(speaker: SonosSpeaker) {
  await speaker.device.Next();
}

export async function previousSpeaker(speaker: SonosSpeaker) {
  await speaker.device.Previous();
}

export async function setSpeakerVolume(speaker: SonosSpeaker, volume: number) {
  await speaker.device.SetVolume(Math.max(0, Math.min(100, Math.round(volume))));
}

export async function setSpeakerMute(speaker: SonosSpeaker, muted: boolean) {
  await speaker.device.RenderingControlService.SetMute({
    InstanceID: INSTANCE_ID,
    Channel: MASTER_CHANNEL,
    DesiredMute: muted,
  });
}

export function isPlaying(state?: SonosSpeakerState) {
  return state?.transportState === ("PLAYING" satisfies TransportState | string);
}
