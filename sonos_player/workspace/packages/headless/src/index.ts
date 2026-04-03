import { app } from "@sonos-player/core/app/service";
import type { AppSnapshot } from "@sonos-player/core/app/types";

const API_PORT = Number(process.env.SONOS_PLAYER_API_PORT ?? process.env.PORT ?? 8099);
const API_TOKEN = process.env.SONOS_PLAYER_API_TOKEN ?? process.env.API_TOKEN ?? "";

function log(action: string, details?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  if (details && Object.keys(details).length > 0) {
    console.log(`[${timestamp}] headless:${action}`, details);
  } else {
    console.log(`[${timestamp}] headless:${action}`);
  }
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}

function normalizeSnapshot(snapshot: AppSnapshot) {
  const group = snapshot.groups.find((item) =>
    item.members.some((member) => snapshot.desiredSpeakerIds.has(member.uuid)),
  ) ?? snapshot.groups[0];
  const coordinatorId = group?.coordinator.uuid ?? null;
  const coordinator = coordinatorId
    ? snapshot.speakers.find((speaker) => speaker.id === coordinatorId)
    : undefined;
  const coordinatorState = coordinatorId ? snapshot.speakerStates.get(coordinatorId) : undefined;

  return {
    speakers: snapshot.speakers.map((speaker) => ({
      id: speaker.id,
      roomName: speaker.roomName,
      host: speaker.host,
      port: speaker.port,
      selected: snapshot.desiredSpeakerIds.has(speaker.id),
      advanceOnCoordinatorLeave: snapshot.advanceOnCoordinatorLeaveSpeakerIds.has(speaker.id),
      state: snapshot.speakerStates.get(speaker.id) ?? null,
    })),
    desiredSpeakerIds: Array.from(snapshot.desiredSpeakerIds),
    advanceOnCoordinatorLeaveSpeakerIds: Array.from(snapshot.advanceOnCoordinatorLeaveSpeakerIds),
    groups: snapshot.groups.map((groupItem) => ({
      id: groupItem.groupId,
      name: groupItem.name,
      coordinatorId: groupItem.coordinator.uuid,
      memberIds: groupItem.members.map((member) => member.uuid),
    })),
    coordinatorId,
    coordinatorRoomName: coordinator?.roomName ?? null,
    transportState: coordinatorState?.transportState ?? "IDLE",
    mediaTitle: coordinatorState?.currentTrack ?? null,
    mediaArtist: coordinatorState?.currentArtist ?? null,
    mediaAlbumName: coordinatorState?.currentAlbum ?? null,
    volumeLevel:
      typeof coordinatorState?.volume === "number"
        ? Math.max(0, Math.min(1, coordinatorState.volume / 100))
        : null,
    isVolumeMuted: coordinatorState?.muted ?? null,
  };
}

function isAuthorized(request: Request) {
  if (!API_TOKEN) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${API_TOKEN}`;
}

async function handleCommand(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  switch (action) {
    case "play":
      await app.play();
      return json({ ok: true });
    case "pause":
      await app.pause();
      return json({ ok: true });
    case "next":
      await app.next();
      return json({ ok: true });
    case "previous":
      await app.previous();
      return json({ ok: true });
    default:
      return json({ error: "Unsupported action" }, { status: 400 });
  }
}

async function handlePlayMedia(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const mediaContentType = typeof body.media_content_type === "string" ? body.media_content_type : "";
  const mediaContentId = typeof body.media_content_id === "string" ? body.media_content_id : "";
  await app.playMedia(mediaContentType, mediaContentId);
  return json({ ok: true });
}

async function handleBrowse(request: Request) {
  const url = new URL(request.url);
  const mediaContentType = url.searchParams.get("media_content_type") ?? "root";
  const mediaContentId = url.searchParams.get("media_content_id") ?? "root";
  const items = await app.browseMedia(mediaContentType, mediaContentId);
  return json({
    title: mediaContentType === "favorites" ? "Sonos Favorites" : "Sonos Player",
    media_content_type: mediaContentType,
    media_content_id: mediaContentId,
    can_play: false,
    can_expand: true,
    children: items,
  });
}

function setupSignalHandlers(server: ReturnType<typeof Bun.serve>) {
  const shutdown = async () => {
    log("shutdown:start");
    server.stop(true);
    await app.close();
    log("shutdown:done");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

try {
  await app.startBackgroundService();
  const server = Bun.serve({
    port: API_PORT,
    fetch: async (request) => {
      if (!isAuthorized(request)) return unauthorized();

      const url = new URL(request.url);
      try {
        if (request.method === "GET" && url.pathname === "/health") {
          return json({ ok: true });
        }
        if (request.method === "GET" && url.pathname === "/api/state") {
          return json(normalizeSnapshot(await app.getSnapshot(false)));
        }
        if (request.method === "GET" && url.pathname === "/api/browse") {
          return await handleBrowse(request);
        }
        if (request.method === "POST" && url.pathname === "/api/command") {
          return await handleCommand(request);
        }
        if (request.method === "POST" && url.pathname === "/api/play-media") {
          return await handlePlayMedia(request);
        }
        return json({ error: "Not found" }, { status: 404 });
      } catch (error) {
        log("api:error", { path: url.pathname, error: error instanceof Error ? error.message : String(error) });
        return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
      }
    },
  });

  setupSignalHandlers(server);
  log("service:started", { apiPort: API_PORT });
} catch (error) {
  log("startup:error", {
    error: error instanceof Error ? error.message : String(error),
  });
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
