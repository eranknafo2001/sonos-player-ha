import type { SonosSnapshot } from "../sonos/types";

export type AppSnapshot = SonosSnapshot & {
  desiredSpeakerIds: Set<string>;
  advanceOnCoordinatorLeaveSpeakerIds: Set<string>;
};

export type MediaBrowseItem = {
  id: string;
  title: string;
  mediaContentType: string;
  mediaContentId: string;
  canPlay: boolean;
  canExpand: boolean;
  imageUrl?: string;
  uri?: string;
  artist?: string;
  album?: string;
};
