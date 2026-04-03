import type { ZoneGroup } from "@svrooij/sonos/lib/models";
import { isPlaying } from "./client";
import type { SonosSnapshot, SonosSpeaker, SonosSpeakerState } from "./types";

export function findSpeaker(speakers: SonosSpeaker[], value: string) {
  const needle = value.trim().toLowerCase();
  return speakers.find(
    (speaker) =>
      speaker.id.toLowerCase() === needle ||
      speaker.host.toLowerCase() === needle ||
      speaker.roomName.toLowerCase() === needle,
  );
}

export function findSpeakerGroup(groups: ZoneGroup[], speakerId: string) {
  return groups.find((group) => group.members.some((member) => member.uuid === speakerId));
}

export function findGroupByCoordinatorId(groups: ZoneGroup[], coordinatorId?: string | null) {
  if (!coordinatorId) return undefined;
  return groups.find((group) => group.coordinator.uuid === coordinatorId);
}

export function findCoordinatorInGroups(speakers: SonosSpeaker[], groups: ZoneGroup[], memberIds: Set<string>) {
  const rankedGroups = groups
    .map((group) => ({
      group,
      overlap: group.members.filter((member) => memberIds.has(member.uuid)).length,
    }))
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);

  const selectedGroup = rankedGroups[0]?.group;
  if (!selectedGroup) return undefined;
  return speakers.find((speaker) => speaker.id === selectedGroup.coordinator.uuid);
}

export function findPlayingCoordinator(speakers: SonosSpeaker[], states: Map<string, SonosSpeakerState>) {
  return speakers.find((speaker) => isPlaying(states.get(speaker.id)));
}

export function findActiveGroup(
  speakers: SonosSpeaker[],
  groups: ZoneGroup[],
  states: Map<string, SonosSpeakerState>,
  preferredCoordinatorId?: string | null,
) {
  const preferredGroup = findGroupByCoordinatorId(groups, preferredCoordinatorId);
  if (preferredGroup) {
    return preferredGroup;
  }

  const playingCoordinator = findPlayingCoordinator(speakers, states);
  if (playingCoordinator) {
    return findSpeakerGroup(groups, playingCoordinator.id);
  }

  return [...groups].sort((a, b) => b.members.length - a.members.length)[0];
}

export function getGroupSpeakerIds(group?: ZoneGroup) {
  return new Set(group?.members.map((member) => member.uuid) ?? []);
}

export function getGroupCoordinatorId(group?: ZoneGroup) {
  return group?.coordinator.uuid ?? null;
}

export function findManagedGroup(
  speakers: SonosSpeaker[],
  groups: ZoneGroup[],
  states: Map<string, SonosSpeakerState>,
  desiredSpeakerIds: Set<string>,
) {
  if (desiredSpeakerIds.size > 0) {
    const rankedGroups = groups
      .map((group) => ({
        group,
        overlap: group.members.filter((member) => desiredSpeakerIds.has(member.uuid)).length,
        playing: isPlaying(states.get(group.coordinator.uuid)),
      }))
      .filter((item) => item.overlap > 0)
      .sort((a, b) => Number(b.playing) - Number(a.playing) || b.overlap - a.overlap);

    const managed = rankedGroups[0]?.group;
    if (managed) return managed;
  }

  return findActiveGroup(speakers, groups, states);
}

export function buildSnapshot(
  speakers: SonosSpeaker[],
  speakerStates: Map<string, SonosSpeakerState>,
  groups: ZoneGroup[],
): SonosSnapshot {
  return {
    speakers,
    speakerStates,
    groups,
  };
}
