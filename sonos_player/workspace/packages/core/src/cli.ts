import {
  fetchGroups as getGroups,
  joinToCoordinator as joinSpeakerToCoordinator,
  makeStandalone as makeSpeakerStandalone,
} from "./sonos/client";
import { sonos } from "./sonos/service";
import { findSpeaker } from "./sonos/topology";
import type { SonosSpeaker } from "./sonos/types";

function usage() {
  console.log(`sonos-cli

Usage:
  bun run cli -- scan
  bun run cli -- groups
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
