// Dev script that runs both the client bundler (watch) and the server (watch)
// using Bun.spawn so `bun run dev` manages both.

import { generateBuildInfo } from './scripts/build-info.ts';

const { id: buildId, timestamp: buildTimestamp } = await generateBuildInfo({ tag: 'dev', quiet: true });
console.log(`PFXP dev build: ${buildId} (${buildTimestamp})`);

// Reset index.html to un-hashed asset paths for dev each time
await Bun.spawn({
  cmd: ["bun", "run", "scripts/postbuild.ts"],
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, RESET: "1" },
}).exited;

const client = Bun.spawn({
  cmd: ["bun", "build", "src/client/app.ts", "--outdir=public/assets", "--minify", "--target=browser", "--sourcemap=external", "--watch", "--splitting"],
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
