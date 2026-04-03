import mqtt, { type MqttClient } from "mqtt";
import type { AppSnapshot } from "../app/types";
import {
  findManagedGroup,
  getGroupCoordinatorId,
  getGroupSpeakerIds,
} from "../sonos/topology";

const MQTT_URL = process.env.MQTT_URL ?? "mqtt://192.168.1.25:1883";
const MQTT_DISCOVERY_PREFIX = process.env.MQTT_DISCOVERY_PREFIX ?? "homeassistant";
const DESIRED_PREFIX = "sonos-player/desired/speakers";
const WORKAROUND_PREFIX = "sonos-player/desired/workarounds/advance-on-coordinator-leave";
const STATE_PREFIX = "sonos-player/state";
const DISCOVERY_DEVICE_ID = "sonos-player";

function log(action: string, details?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  if (details && Object.keys(details).length > 0) {
    console.log(`[${timestamp}] mqtt:${action}`, details);
  } else {
    console.log(`[${timestamp}] mqtt:${action}`);
  }
}

function desiredTopic(speakerId: string) {
  return `${DESIRED_PREFIX}/${speakerId}`;
}

function speakerStateTopic(speakerId: string) {
  return `${STATE_PREFIX}/speakers/${speakerId}`;
}

function workaroundTopic(speakerId: string) {
  return `${WORKAROUND_PREFIX}/${speakerId}`;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export class MqttStateService {
  private client: MqttClient | null = null;
  private desiredSpeakerIds = new Set<string>();
  private advanceOnCoordinatorLeaveSpeakerIds = new Set<string>();
  private desiredStateListeners = new Set<() => void>();
  private discoveryPublished = false;
  private discoveredSpeakerIds = new Set<string>();
  private legacyDiscoveryPurged = false;

  async ensureConnected(): Promise<void> {
    if (this.client?.connected) return;

    log("connect:start", { url: MQTT_URL, username: process.env.MQTT_USER ?? null });
    const client = await mqtt.connectAsync(MQTT_URL, {
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASSWORD,
      reconnectPeriod: 2_000,
    });

    client.on("message", (topic, payload) => {
      const value = payload.toString().trim().toLowerCase();

      if (topic.startsWith(`${DESIRED_PREFIX}/`)) {
        const speakerId = topic.slice(`${DESIRED_PREFIX}/`.length);
        log("message:desired", { topic, speakerId, value });
        if (value === "true" || value === "1") {
          this.desiredSpeakerIds.add(speakerId);
        } else {
          this.desiredSpeakerIds.delete(speakerId);
        }
        for (const listener of this.desiredStateListeners) listener();
        return;
      }

      if (topic.startsWith(`${WORKAROUND_PREFIX}/`)) {
        const speakerId = topic.slice(`${WORKAROUND_PREFIX}/`.length);
        log("message:workaround", { topic, speakerId, value });
        if (value === "true" || value === "1") {
          this.advanceOnCoordinatorLeaveSpeakerIds.add(speakerId);
        } else {
          this.advanceOnCoordinatorLeaveSpeakerIds.delete(speakerId);
        }
        for (const listener of this.desiredStateListeners) listener();
        return;
      }
    });

    client.on("reconnect", () => {
      log("connect:reconnect");
      this.discoveryPublished = false;
      this.legacyDiscoveryPurged = false;
    });

    client.on("close", () => {
      log("connect:close");
      this.discoveryPublished = false;
      this.legacyDiscoveryPurged = false;
    });

    await Promise.all([
      client.subscribeAsync(`${DESIRED_PREFIX}/#`),
      client.subscribeAsync(`${WORKAROUND_PREFIX}/#`),
    ]);
    this.client = client;
    log("connect:success", { subscribedTopics: [`${DESIRED_PREFIX}/#`, `${WORKAROUND_PREFIX}/#`] });
  }

  onDesiredStateChange(listener: () => void) {
    this.desiredStateListeners.add(listener);
    return () => this.desiredStateListeners.delete(listener);
  }

  async getDesiredSpeakerIds(): Promise<Set<string>> {
    await this.ensureConnected();
    return new Set(this.desiredSpeakerIds);
  }

  async getAdvanceOnCoordinatorLeaveSpeakerIds(): Promise<Set<string>> {
    await this.ensureConnected();
    return new Set(this.advanceOnCoordinatorLeaveSpeakerIds);
  }

  async setSpeakerSelected(
    speakerId: string,
    selected: boolean,
  ): Promise<void> {
    await this.ensureConnected();
    log("desired:set", { speakerId, selected });
    await this.publish(
      desiredTopic(speakerId),
      selected ? "true" : "false",
      true,
    );
    if (selected) {
      this.desiredSpeakerIds.add(speakerId);
    } else {
      this.desiredSpeakerIds.delete(speakerId);
    }
  }

  async setAdvanceOnCoordinatorLeave(speakerId: string, enabled: boolean): Promise<void> {
    await this.ensureConnected();
    log("workaround:set", { speakerId, enabled });
    await this.publish(workaroundTopic(speakerId), enabled ? "true" : "false", true);
    if (enabled) {
      this.advanceOnCoordinatorLeaveSpeakerIds.add(speakerId);
    } else {
      this.advanceOnCoordinatorLeaveSpeakerIds.delete(speakerId);
    }
  }

  async setSelectedSpeakers(
    speakerIds: Iterable<string>,
    allSpeakerIds?: Iterable<string>,
  ): Promise<void> {
    const next = new Set(speakerIds);
    const all = new Set(allSpeakerIds ?? [...this.desiredSpeakerIds, ...next]);

    await Promise.all(
      Array.from(all).map((speakerId) =>
        this.setSpeakerSelected(speakerId, next.has(speakerId)),
      ),
    );
  }

  async publishSnapshot(snapshot: AppSnapshot): Promise<void> {
    await this.ensureConnected();
    await this.publishDiscovery(snapshot);

    const managedGroup = findManagedGroup(
      snapshot.speakers,
      snapshot.groups,
      snapshot.speakerStates,
      snapshot.desiredSpeakerIds,
    );
    const managedGroupSpeakerIds = getGroupSpeakerIds(managedGroup);
    const coordinatorId = getGroupCoordinatorId(managedGroup);

    log("publish:state:group", {
      desiredSpeakerIds: Array.from(snapshot.desiredSpeakerIds),
      actualSpeakerIds: Array.from(managedGroupSpeakerIds),
      coordinatorId,
    });
    const coordinatorSpeaker = coordinatorId
      ? snapshot.speakers.find((speaker) => speaker.id === coordinatorId)
      : undefined;

    await this.publish(
      `${STATE_PREFIX}/group`,
      JSON.stringify({
        desiredSpeakerIds: Array.from(snapshot.desiredSpeakerIds),
        actualSpeakerIds: Array.from(managedGroupSpeakerIds),
        coordinatorId,
        coordinatorRoomName: coordinatorSpeaker?.roomName ?? null,
        groupId: managedGroup?.groupId ?? null,
        groupName: managedGroup?.name ?? null,
      }),
      true,
    );

    await Promise.all(
      snapshot.speakers.map((speaker) => {
        log("publish:state:speaker", {
          speakerId: speaker.id,
          roomName: speaker.roomName,
          selected: snapshot.desiredSpeakerIds.has(speaker.id),
          actuallyGrouped: managedGroupSpeakerIds.has(speaker.id),
        });
        return this.publish(
          speakerStateTopic(speaker.id),
          JSON.stringify({
            roomName: speaker.roomName,
            host: speaker.host,
            port: speaker.port,
            selected: snapshot.desiredSpeakerIds.has(speaker.id),
            actuallyGrouped: managedGroupSpeakerIds.has(speaker.id),
            isCoordinator: coordinatorId === speaker.id,
            advanceOnCoordinatorLeave: snapshot.advanceOnCoordinatorLeaveSpeakerIds.has(speaker.id),
            ...snapshot.speakerStates.get(speaker.id),
          }),
          true,
        );
      }),
    );
  }

  private async publishDiscovery(snapshot: AppSnapshot): Promise<void> {
    const currentSpeakerIds = new Set(snapshot.speakers.map((speaker) => speaker.id));

    if (!this.legacyDiscoveryPurged) {
      await this.purgeLegacyDiscovery(snapshot);
      this.legacyDiscoveryPurged = true;
    }

    if (this.discoveryPublished && this.sameSpeakerIds(currentSpeakerIds, this.discoveredSpeakerIds)) {
      return;
    }

    const topic = `${MQTT_DISCOVERY_PREFIX}/device/${DISCOVERY_DEVICE_ID}/config`;
    const cmps: Record<string, Record<string, unknown>> = {};

    for (const speaker of snapshot.speakers) {
      cmps[`speaker_${speaker.id}`] = {
        p: "switch",
        unique_id: `sonos_player_speaker_${speaker.id}`,
        object_id: `sonos_player_${speaker.id}`,
        name: speaker.roomName,
        command_topic: desiredTopic(speaker.id),
        state_topic: speakerStateTopic(speaker.id),
        payload_on: "true",
        payload_off: "false",
        state_on: true,
        state_off: false,
        value_template: "{{ value_json.selected }}",
      };

      cmps[`advance_on_leave_${speaker.id}`] = {
        p: "switch",
        unique_id: `sonos_player_advance_on_leave_${speaker.id}`,
        object_id: `sonos_player_advance_on_leave_${speaker.id}`,
        name: `${speaker.roomName} advance on coordinator leave`,
        command_topic: workaroundTopic(speaker.id),
        state_topic: speakerStateTopic(speaker.id),
        payload_on: "true",
        payload_off: "false",
        state_on: true,
        state_off: false,
        value_template: "{{ value_json.advanceOnCoordinatorLeave }}",
        entity_category: "config",
      };
    }

    cmps.group_coordinator = {
      p: "sensor",
      unique_id: "sonos_player_group_coordinator",
      object_id: "sonos_player_group_coordinator",
      name: "Group coordinator",
      state_topic: `${STATE_PREFIX}/group`,
      value_template: "{{ value_json.coordinatorRoomName if value_json.coordinatorRoomName is not none else 'none' }}",
      json_attributes_topic: `${STATE_PREFIX}/group`,
      entity_category: "diagnostic",
    };

    const payload = {
      dev: {
        ids: DISCOVERY_DEVICE_ID,
        name: "Sonos Player",
        mf: "Custom",
        mdl: "Sonos Group Manager",
      },
      o: {
        name: "sonos-player",
      },
      cmps,
      state_topic: `${STATE_PREFIX}/group`,
      qos: 0,
    };

    log("publish:discovery", { topic, speakers: snapshot.speakers.length });
    await this.publish(topic, JSON.stringify(payload), true);

    for (const removedSpeakerId of this.discoveredSpeakerIds) {
      if (!currentSpeakerIds.has(removedSpeakerId)) {
        await this.clearLegacySpeakerDiscovery(removedSpeakerId);
      }
    }

    this.discoveredSpeakerIds = currentSpeakerIds;
    this.discoveryPublished = true;
  }

  private async purgeLegacyDiscovery(snapshot: AppSnapshot) {
    log("publish:discovery:purgeLegacy:start");

    const deviceTopics = [
      `${MQTT_DISCOVERY_PREFIX}/device/${DISCOVERY_DEVICE_ID}/config`,
      `${MQTT_DISCOVERY_PREFIX}/device/sonos_player/config`,
    ];

    for (const topic of deviceTopics) {
      if (topic === `${MQTT_DISCOVERY_PREFIX}/device/${DISCOVERY_DEVICE_ID}/config`) continue;
      log("publish:discovery:clearLegacyDevice", { topic });
      await this.publish(topic, "", true);
    }

    await Promise.all(snapshot.speakers.map((speaker) => this.clearLegacySpeakerDiscovery(speaker.id, speaker.roomName)));
    log("publish:discovery:purgeLegacy:done");
  }

  private async clearLegacySpeakerDiscovery(speakerId: string, roomName?: string) {
    const roomSlug = roomName ? slugify(roomName) : null;
    const ids = [speakerId, `speaker_${speakerId}`, `sonos_player_${speakerId}`, `sonos_player_speaker_${speakerId}`];
    const names = roomSlug ? [roomSlug, `speaker_${roomSlug}`, `sonos_player_${roomSlug}`] : [];
    const tokens = [...ids, ...names];

    const topicSet = new Set<string>();
    for (const token of tokens) {
      topicSet.add(`${MQTT_DISCOVERY_PREFIX}/switch/sonos-player/${token}/config`);
      topicSet.add(`${MQTT_DISCOVERY_PREFIX}/switch/sonos_player/${token}/config`);
      topicSet.add(`${MQTT_DISCOVERY_PREFIX}/switch/${token}/config`);
      topicSet.add(`${MQTT_DISCOVERY_PREFIX}/switch/sonos-player_${token}/config`);
      topicSet.add(`${MQTT_DISCOVERY_PREFIX}/switch/sonos_player_${token}/config`);
    }

    await Promise.all(
      Array.from(topicSet).map(async (topic) => {
        log("publish:discovery:clearLegacy", { topic, speakerId, roomName: roomName ?? null });
        await this.publish(topic, "", true);
      }),
    );
  }

  private sameSpeakerIds(a: Set<string>, b: Set<string>) {
    if (a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  async close() {
    const client = this.client;
    this.client = null;
    await client?.endAsync(true);
  }

  private async publish(
    topic: string,
    message: string,
    retain = false,
  ): Promise<void> {
    const client = this.client;
    if (!client) {
      throw new Error("MQTT client is not connected.");
    }

    await client.publishAsync(topic, message, { retain });
  }
}

export const mqttState = new MqttStateService();
