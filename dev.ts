// Dev script that runs the Quasar/Vite client build in watch mode and the Bun
// server in watch mode so production exercises the same static asset path.

import { generateBuildInfo } from './scripts/build-info.ts';

const { id: buildId, timestamp: buildTimestamp } = await generateBuildInfo({ tag: 'dev', quiet: true });
console.log(`PFXP dev build: ${buildId} (${buildTimestamp})`);

// Produce a complete first build before the server starts serving public/.
const initialBuild = Bun.spawn({
  cmd: ["bun", "run", "vite", "build", "--mode", "development"],
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, BUILD_ID: buildId },
});

if (await initialBuild.exited !== 0) {
  process.exit(1);
}

const client = Bun.spawn({
  cmd: ["bun", "run", "vite", "build", "--watch", "--mode", "development"],
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, BUILD_ID: buildId },
});

const server = Bun.spawn({
  cmd: ["bun", "--watch", "run", "index.ts"],
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, BUILD_ID: buildId },
});

function shutdown() {
  try { server.kill(); } catch {}
  try { client.kill(); } catch {}
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

// Keep the process alive; child processes output to terminal
await new Promise(() => {});
