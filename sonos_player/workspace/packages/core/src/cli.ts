import {
  fetchGroups as getGroups,
  fetchSpeakerState as getSpeakerState,
  joinToCoordinator as joinSpeakerToCoordinator,
  makeStandalone as makeSpeakerStandalone,
  nextSpeaker as nextTrack,
  pauseSpeaker as pause,
  playSpeaker as play,
  previousSpeaker as previousTrack,
  setSpeakerMute as setMute,
  setSpeakerVolume as setVolume,
} from "./sonos/client";
import { sonos } from "./sonos/service";
import { findSpeaker } from "./sonos/topology";
import type { SonosSpeaker } from "./sonos/types";

function usage() {
  console.log(`sonos-cli

Usage:
  bun run cli -- scan
  bun run cli -- groups
  bun run cli -- state <speaker>
  bun run cli -- play <speaker>
  bun run cli -- pause <speaker>
  bun run cli -- next <speaker>
  bun run cli -- prev <speaker>
  bun run cli -- volume <speaker> <0-100>
  bun run cli -- mute <speaker>
  bun run cli -- unmute <speaker>
  bun run cli -- join <speaker> <coordinator>
  bun run cli -- leave <speaker>

Speaker matching:
  room name, uuid, or host are accepted.

Discovery fallback:
  SONOS_HOST=192.168.1.50 bun run cli -- scan
`);
}

function printSpeakers(speakers: SonosSpeaker[]) {
  if (speakers.length === 0) {
    console.log("No Sonos speakers found.");
    return;
  }

  for (const speaker of speakers) {
    console.log(`${speaker.roomName}\t${speaker.host}:${speaker.port}\t${speaker.id}`);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || ["-h", "--help", "help"].includes(command)) {
    usage();
    return;
  }

  try {
    const speakers = (await sonos.scan()).speakers;

    switch (command) {
      case "scan": {
        printSpeakers(speakers);
        return;
      }
      case "groups": {
        const groups = await getGroups(speakers);
        if (groups.length === 0) {
          console.log("No groups found.");
          return;
        }

        for (const group of groups) {
          console.log(`Group: ${group.name}`);
          console.log(`  Coordinator: ${group.coordinator.name} (${group.coordinator.host})`);
          for (const member of group.members) {
            console.log(`  - ${member.name} (${member.host})${member.uuid === group.coordinator.uuid ? " [coordinator]" : ""}`);
          }
        }
        return;
      }
      case "state": {
        const speaker = requireSpeaker(speakers, args[0]);
        const state = await getSpeakerState(speaker);
        console.log(JSON.stringify({ speaker: speaker.roomName, ...state }, null, 2));
        return;
      }
      case "play": {
        const speaker = requireSpeaker(speakers, args[0]);
        await play(speaker);
        console.log(`Play sent to ${speaker.roomName}`);
        return;
      }
      case "pause": {
        const speaker = requireSpeaker(speakers, args[0]);
        await pause(speaker);
        console.log(`Pause sent to ${speaker.roomName}`);
        return;
      }
      case "next": {
        const speaker = requireSpeaker(speakers, args[0]);
        await nextTrack(speaker);
        console.log(`Next sent to ${speaker.roomName}`);
        return;
      }
      case "prev": {
        const speaker = requireSpeaker(speakers, args[0]);
        await previousTrack(speaker);
        console.log(`Previous sent to ${speaker.roomName}`);
        return;
      }
      case "volume": {
        const speaker = requireSpeaker(speakers, args[0]);
        const volume = Number(args[1]);
        if (Number.isNaN(volume)) {
          throw new Error("volume requires a number");
        }
        await setVolume(speaker, volume);
        console.log(`Volume set on ${speaker.roomName} to ${volume}`);
        return;
      }
      case "mute": {
        const speaker = requireSpeaker(speakers, args[0]);
        await setMute(speaker, true);
        console.log(`Muted ${speaker.roomName}`);
        return;
      }
      case "unmute": {
        const speaker = requireSpeaker(speakers, args[0]);
        await setMute(speaker, false);
        console.log(`Unmuted ${speaker.roomName}`);
        return;
      }
      case "join": {
        const speaker = requireSpeaker(speakers, args[0]);
        const coordinator = requireSpeaker(speakers, args[1]);
        await joinSpeakerToCoordinator(speaker, coordinator);
        console.log(`${speaker.roomName} joined ${coordinator.roomName}`);
        return;
      }
      case "leave": {
        const speaker = requireSpeaker(speakers, args[0]);
        await makeSpeakerStandalone(speaker);
        console.log(`${speaker.roomName} is now standalone`);
        return;
      }
      default:
        usage();
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    sonos.close();
  }
}

function requireSpeaker(speakers: SonosSpeaker[], value?: string) {
  if (!value) {
    throw new Error("speaker argument is required");
  }

  const speaker = findSpeaker(speakers, value);
  if (!speaker) {
    throw new Error(`speaker not found: ${value}`);
  }

  return speaker;
}

await main();
process.exit(0);
