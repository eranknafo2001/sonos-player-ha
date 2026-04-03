import type { SonosDevice } from "@svrooij/sonos";
import type { ZoneGroup } from "@svrooij/sonos/lib/models";

export type { ZoneGroup };

export type GroupChange = "toggle" | "all" | "none";

export type SonosSpeaker = {
  id: string;
  roomName: string;
  host: string;
  port: number;
  device: SonosDevice;
};

export type SonosSpeakerState = {
  transportState: string;
  currentTrack?: string;
  currentArtist?: string;
  currentAlbum?: string;
  position?: string;
  volume?: number;
  muted?: boolean;
  currentUri?: string;
  trackUri?: string;
  mediaDuration?: string;
  trackDuration?: string;
};

export type SonosSnapshot = {
  speakers: SonosSpeaker[];
  speakerStates: Map<string, SonosSpeakerState>;
  groups: ZoneGroup[];
};
