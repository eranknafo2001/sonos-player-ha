import { mqttState } from "../mqtt/service";
import { sonos } from "../sonos/service";
import { findManagedGroup, getGroupCoordinatorId, getGroupSpeakerIds } from "../sonos/topology";
import type { GroupChange } from "../sonos/types";
import type { AppSnapshot } from "./types";

function log(action: string, details?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  if (details && Object.keys(details).length > 0) {
    console.log(`[${timestamp}] ${action}`, details);
  } else {
    console.log(`[${timestamp}] ${action}`);
  }
}

export class AppService {
  private mqttSubscribed = false;
  private reconcileInFlight: Promise<void> | null = null;
  private backgroundRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastDesiredSpeakerIds = new Set<string>();

  async getSnapshot(reconcile = true): Promise<AppSnapshot> {
    const sonosSnapshot = await sonos.getSnapshot();
    const [desiredSpeakerIds, advanceOnCoordinatorLeaveSpeakerIds] = await Promise.all([
      mqttState.getDesiredSpeakerIds(),
      mqttState.getAdvanceOnCoordinatorLeaveSpeakerIds(),
    ]);
    const previousDesiredSpeakerIds = new Set(this.lastDesiredSpeakerIds);
    let snapshot: AppSnapshot = { ...sonosSnapshot, desiredSpeakerIds, advanceOnCoordinatorLeaveSpeakerIds };

    const previousManagedGroup = findManagedGroup(
      sonosSnapshot.speakers,
      sonosSnapshot.groups,
      sonosSnapshot.speakerStates,
      desiredSpeakerIds.size > 0 ? desiredSpeakerIds : previousDesiredSpeakerIds,
    );
    const previousCoordinatorId = getGroupCoordinatorId(previousManagedGroup);
    const shouldAdvanceOnCoordinatorLeave = Boolean(
      previousCoordinatorId &&
        advanceOnCoordinatorLeaveSpeakerIds.has(previousCoordinatorId) &&
        !desiredSpeakerIds.has(previousCoordinatorId) &&
        sonosSnapshot.speakerStates.get(previousCoordinatorId)?.transportState === "PLAYING" &&
        desiredSpeakerIds.size > 0,
    );

    if (reconcile) {
      const changed = await sonos.reconcileToDesired(snapshot, previousDesiredSpeakerIds);
      if (changed) {
        snapshot = { ...(await sonos.getSnapshot()), desiredSpeakerIds, advanceOnCoordinatorLeaveSpeakerIds };

        if (shouldAdvanceOnCoordinatorLeave) {
          const nextManagedGroup = findManagedGroup(
            snapshot.speakers,
            snapshot.groups,
            snapshot.speakerStates,
            desiredSpeakerIds,
          );
          const nextCoordinatorId = getGroupCoordinatorId(nextManagedGroup);
          if (nextCoordinatorId) {
            log("workaround:advanceOnCoordinatorLeave", { previousCoordinatorId, nextCoordinatorId });
            await sonos.next(nextCoordinatorId).catch((error) => {
              log("workaround:advanceOnCoordinatorLeave:error", {
                previousCoordinatorId,
                nextCoordinatorId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
            snapshot = { ...(await sonos.getSnapshot()), desiredSpeakerIds, advanceOnCoordinatorLeaveSpeakerIds };
          }
        }
      }
    }

    this.lastDesiredSpeakerIds = new Set(desiredSpeakerIds);

    await mqttState.publishSnapshot(snapshot).catch((error) => {
      log("mqtt:publishSnapshot:error", { error: error instanceof Error ? error.message : String(error) });
    });

    return snapshot;
  }

  async changeGroup(change: GroupChange, speakerId?: string, targetCoordinatorId?: string | null) {
    await this.ensureStarted();
    const currentDesired = await mqttState.getDesiredSpeakerIds();
    const sonosSnapshot = await sonos.getSnapshot();

    if (change === "all") {
      await mqttState.setSelectedSpeakers(sonosSnapshot.speakers.map((speaker) => speaker.id), sonosSnapshot.speakers.map((speaker) => speaker.id));
      return this.getSnapshot();
    }

    if (change === "none") {
      if (currentDesired.size > 0) {
        const managedGroup = findManagedGroup(
          sonosSnapshot.speakers,
          sonosSnapshot.groups,
          sonosSnapshot.speakerStates,
          currentDesired,
        );
        const managedIds = getGroupSpeakerIds(managedGroup);
        await Promise.all(
          sonosSnapshot.speakers
            .filter((speaker) => managedIds.has(speaker.id))
            .map((speaker) => sonos.makeSpeakerStandalone(speaker).catch(() => undefined)),
        );
      }
      await mqttState.setSelectedSpeakers([], sonosSnapshot.speakers.map((speaker) => speaker.id));
      return this.getSnapshot(false);
    }

    if (!speakerId) {
      throw new Error("Speaker id is required.");
    }

    const nextSelected = new Set(currentDesired);
    if (nextSelected.has(speakerId)) nextSelected.delete(speakerId);
    else nextSelected.add(speakerId);

    await mqttState.setSelectedSpeakers(nextSelected, sonosSnapshot.speakers.map((speaker) => speaker.id));
    return this.getSnapshot();
  }

  async startBackgroundService(refreshIntervalMs = Number(process.env.SONOS_REFRESH_INTERVAL_MS ?? 5_000)) {
    await this.ensureStarted();
    await this.getSnapshot(true);

    if (this.backgroundRefreshTimer) clearInterval(this.backgroundRefreshTimer);
    this.backgroundRefreshTimer = setInterval(() => {
      void this.getSnapshot(true).catch((error) => {
        log("background:tick:error", { error: error instanceof Error ? error.message : String(error) });
      });
    }, refreshIntervalMs);
  }

  async close() {
    if (this.backgroundRefreshTimer) {
      clearInterval(this.backgroundRefreshTimer);
      this.backgroundRefreshTimer = null;
    }
    sonos.close();
    await mqttState.close();
  }

  private async ensureStarted() {
    await mqttState.ensureConnected();
    await sonos.ensureStarted();

    if (!this.mqttSubscribed) {
      mqttState.onDesiredStateChange(() => {
        void this.reconcileFromMqtt();
      });
      this.mqttSubscribed = true;
    }
  }

  private async reconcileFromMqtt() {
    if (this.reconcileInFlight) return this.reconcileInFlight;

    this.reconcileInFlight = (async () => {
      try {
        await this.getSnapshot(true);
      } finally {
        this.reconcileInFlight = null;
      }
    })();

    return this.reconcileInFlight;
  }
}

export const app = new AppService();
