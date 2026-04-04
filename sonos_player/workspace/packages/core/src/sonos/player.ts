import {
  fetchSpeakerState,
  nextSpeaker,
} from "./client";
import { findCoordinatorInGroups, findPlayingCoordinator } from "./topology";
import type { SonosSpeaker, SonosSpeakerState } from "./types";
import type { ZoneGroup } from "@svrooij/sonos/lib/models";

export async function getCoordinatorForGroup(
  speakers: SonosSpeaker[],
  activeGroupSpeakerIds: Set<string>,
  groups: ZoneGroup[],
  speakerStates: Map<string, SonosSpeakerState>,
) {
  if (activeGroupSpeakerIds.size === 0) return undefined;

  const actual = findCoordinatorInGroups(speakers, groups, activeGroupSpeakerIds);
  if (actual) {
    return actual;
  }

  const groupSpeakers = speakers.filter((speaker) => activeGroupSpeakerIds.has(speaker.id));
  const playing = findPlayingCoordinator(groupSpeakers, speakerStates);
  if (playing) return playing;

  const refreshed = await Promise.all(
    groupSpeakers.map(async (speaker) => ({ speaker, state: await fetchSpeakerState(speaker).catch(() => undefined) })),
  );

  return refreshed.find((item) => item.state?.transportState === "PLAYING")?.speaker ?? groupSpeakers[0];
}

export async function nextShared(speaker: SonosSpeaker) {
  await nextSpeaker(speaker);
}
