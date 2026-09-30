import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadLocalEnvFile } from "./env.js";

loadLocalEnvFile();

const config = loadConfig();
const app = buildApp(config);

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
}
process.once("SIGINT", (signal) => void shutdown(signal));
process.once("SIGTERM", (signal) => void shutdown(signal));

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (err) {
  app.log.error(err, "failed to start server");
  process.exit(1);
}
