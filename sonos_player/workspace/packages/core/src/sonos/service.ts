import type { SonosManager } from "@svrooij/sonos";
import { createManager, fetchGroups, fetchSpeakerStates, getSpeakerFavorites, loadSpeakersFromManager, makeStandalone, setSpeakerTransportUri } from "./client";
import {
  adjustSharedVolume,
  getCoordinatorForGroup,
  nextShared,
  pauseShared,
  playShared,
  previousShared,
  toggleSharedMute,
} from "./player";
import { buildSnapshot, findManagedGroup, getGroupSpeakerIds } from "./topology";
import type { SonosSnapshot, SonosSpeaker, SonosSpeakerState } from "./types";

function log(action: string, details?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  if (details && Object.keys(details).length > 0) {
    console.log(`[${timestamp}] sonos:${action}`, details);
  } else {
    console.log(`[${timestamp}] sonos:${action}`);
  }
}

export class SonosService {
  private manager: SonosManager | null = null;
  private speakers: SonosSpeaker[] = [];

  async ensureStarted() {
    if (this.manager) {
      if (this.speakers.length === 0) {
        this.speakers = await loadSpeakersFromManager(this.manager);
        log("manager:loadedSpeakers", { count: this.speakers.length });
      }
      return;
    }

    const { manager, found } = await createManager();
    this.manager = manager;
    this.speakers = found ? await loadSpeakersFromManager(manager) : [];
    log("manager:created", { found, speakers: this.speakers.length });
  }

  async getSnapshot(): Promise<SonosSnapshot> {
    log("getSnapshot:start");
    await this.ensureStarted();

    const [speakerStates, groups] = await Promise.all([
      fetchSpeakerStates(this.speakers),
      fetchGroups(this.speakers).catch(() => []),
    ]);

    const snapshot = buildSnapshot(this.speakers, speakerStates, groups);
    log("getSnapshot:done", { speakers: snapshot.speakers.length, groups: snapshot.groups.length });
    return snapshot;
  }

  async scan() {
    log("scan:start");
    await this.resetManager();
    return this.getSnapshot();
  }

  async refresh() {
    return this.getSnapshot();
  }

  async reconcileToDesired(
    snapshot: SonosSnapshot & { desiredSpeakerIds: Set<string> },
    previousDesiredSpeakerIds: Set<string> = new Set(),
  ) {
    log("reconcile:start", {
      desiredSpeakerIds: Array.from(snapshot.desiredSpeakerIds),
      previousDesiredSpeakerIds: Array.from(previousDesiredSpeakerIds),
    });

    const desiredIds = snapshot.desiredSpeakerIds;
    const referenceIds = desiredIds.size > 0 ? desiredIds : previousDesiredSpeakerIds;
    const managedGroup = findManagedGroup(
      snapshot.speakers,
      snapshot.groups,
      snapshot.speakerStates,
      referenceIds,
    );
    const managedIds = getGroupSpeakerIds(managedGroup);

    if (desiredIds.size === 0) {
      if (managedIds.size === 0) {
        log("reconcile:skip:noDesiredSpeakers");
        return false;
      }

      let changed = false;
      for (const speaker of snapshot.speakers.filter((item) => managedIds.has(item.id))) {
        changed = true;
        log("reconcile:standalone:clearAll", { speakerId: speaker.id, roomName: speaker.roomName });
        await makeStandalone(speaker).catch((error) => {
          log("reconcile:standalone:error", { speakerId: speaker.id, error: error instanceof Error ? error.message : String(error) });
        });
      }

      log("reconcile:done", { changed });
      return changed;
    }

    const coordinator = await getCoordinatorForGroup(
      snapshot.speakers,
      managedIds.size > 0 ? managedIds : desiredIds,
      snapshot.groups,
      snapshot.speakerStates,
    );

    const targetCoordinator = coordinator ?? snapshot.speakers.find((speaker) => desiredIds.has(speaker.id));
    if (!targetCoordinator) {
      log("reconcile:skip:noCoordinator");
      return false;
    }

    let changed = false;

    for (const speaker of snapshot.speakers) {
      const shouldBeGrouped = desiredIds.has(speaker.id);
      const isInManagedGroup = managedIds.has(speaker.id);

      if (shouldBeGrouped && speaker.id !== targetCoordinator.id && !isInManagedGroup) {
        changed = true;
        log("reconcile:join", { speakerId: speaker.id, coordinatorId: targetCoordinator.id });
        await speaker.device.JoinGroup(targetCoordinator.roomName).catch((error) => {
          log("reconcile:join:error", { speakerId: speaker.id, error: error instanceof Error ? error.message : String(error) });
        });
      }

      if (!shouldBeGrouped && isInManagedGroup) {
        changed = true;
        log("reconcile:standalone", { speakerId: speaker.id });
        await makeStandalone(speaker).catch((error) => {
          log("reconcile:standalone:error", { speakerId: speaker.id, error: error instanceof Error ? error.message : String(error) });
        });
      }
    }

    log("reconcile:done", { changed });
    return changed;
  }

  async play(targetCoordinatorId?: string | null) {
    return this.runOnCoordinator(playShared, targetCoordinatorId);
  }

  async pause(targetCoordinatorId?: string | null) {
    return this.runOnCoordinator(pauseShared, targetCoordinatorId);
  }

  async next(targetCoordinatorId?: string | null) {
    return this.runOnCoordinator(nextShared, targetCoordinatorId);
  }

  async previous(targetCoordinatorId?: string | null) {
    return this.runOnCoordinator(previousShared, targetCoordinatorId);
  }

  async toggleMute(targetCoordinatorId?: string | null) {
    return this.runOnCoordinator(toggleSharedMute, targetCoordinatorId);
  }

  async adjustVolume(delta: number, targetCoordinatorId?: string | null) {
    return this.runOnCoordinator((speaker, state) => adjustSharedVolume(speaker, delta, state), targetCoordinatorId);
  }

  async getFavorites(targetCoordinatorId?: string | null) {
    const speaker = await this.resolveCoordinatorSpeaker(targetCoordinatorId);
    return getSpeakerFavorites(speaker);
  }

  async playUri(trackUri: string, targetCoordinatorId?: string | null) {
    const speaker = await this.resolveCoordinatorSpeaker(targetCoordinatorId);
    await setSpeakerTransportUri(speaker, trackUri);
    await playShared(speaker);
    return this.getSnapshot();
  }

  close() {
    log("service:close");
    this.manager?.CancelSubscription();
    this.manager = null;
    this.speakers = [];
  }

  async makeSpeakerStandalone(speaker: SonosSpeaker) {
    return makeStandalone(speaker);
  }

  private async resetManager() {
    this.manager?.CancelSubscription();
    this.manager = null;
    this.speakers = [];
    await this.ensureStarted();
  }

  private async runOnCoordinator(
    action: (speaker: SonosSpeaker, state?: SonosSpeakerState) => Promise<void>,
    targetCoordinatorId?: string | null,
  ) {
    const snapshot = await this.getSnapshot();
    const coordinator = await this.resolveCoordinatorSpeaker(targetCoordinatorId, snapshot);
    await action(coordinator, snapshot.speakerStates.get(coordinator.id));
    return this.getSnapshot();
  }

  private async resolveCoordinatorSpeaker(targetCoordinatorId?: string | null, snapshot?: SonosSnapshot) {
    const currentSnapshot = snapshot ?? (await this.getSnapshot());
    const managedIds = targetCoordinatorId
      ? new Set(currentSnapshot.groups.find((group) => group.coordinator.uuid === targetCoordinatorId)?.members.map((member) => member.uuid) ?? [])
      : new Set(currentSnapshot.groups[0]?.members.map((member) => member.uuid) ?? []);

    const coordinator = await getCoordinatorForGroup(
      currentSnapshot.speakers,
      managedIds,
      currentSnapshot.groups,
      currentSnapshot.speakerStates,
    );

    if (coordinator) return coordinator;

    const fallbackSpeaker = currentSnapshot.speakers[0];
    if (!fallbackSpeaker) {
      throw new Error("No Sonos speaker available.");
    }
    return fallbackSpeaker;
  }
}

export const sonos = new SonosService();
