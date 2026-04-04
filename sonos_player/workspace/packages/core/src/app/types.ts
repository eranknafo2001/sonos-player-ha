import type { SonosSnapshot } from "../sonos/types";

export type AppSnapshot = SonosSnapshot & {
  desiredSpeakerIds: Set<string>;
  advanceOnCoordinatorLeaveSpeakerIds: Set<string>;
};
