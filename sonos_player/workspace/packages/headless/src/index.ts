import { app } from "@sonos-player/core/app/service";

function log(action: string, details?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  if (details && Object.keys(details).length > 0) {
    console.log(`[${timestamp}] headless:${action}`, details);
  } else {
    console.log(`[${timestamp}] headless:${action}`);
  }
}

function setupSignalHandlers() {
  const shutdown = async () => {
    log("shutdown:start");
    await app.close();
    log("shutdown:done");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

setupSignalHandlers();

try {
  await app.startBackgroundService();
  log("service:started");
  await new Promise(() => {
    // keep process alive
  });
} catch (error) {
  log("startup:error", {
    error: error instanceof Error ? error.message : String(error),
  });
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
