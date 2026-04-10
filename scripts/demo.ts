import { spawn, type Subprocess } from "bun";

const children: Subprocess[] = [];

function prefix(name: string, stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split("\n");
      for (const line of lines) {
        if (line.trim()) {
          console.log(`[${name}] ${line}`);
        }
      }
    }
  })();
}

// Start Strimulator
const strimulator = spawn(["bun", "run", "start"], {
  cwd: import.meta.dir + "/..",
  stdout: "pipe",
  stderr: "pipe",
});
children.push(strimulator);
prefix("strimulator", strimulator.stdout);
prefix("strimulator", strimulator.stderr);

// Give Strimulator a moment to bind its port
await new Promise((r) => setTimeout(r, 500));

// Start Astro dev server
const astro = spawn(["bunx", "astro", "dev"], {
  cwd: import.meta.dir + "/../demo",
  stdout: "pipe",
  stderr: "pipe",
});
children.push(astro);
prefix("demo", astro.stdout);
prefix("demo", astro.stderr);

// Clean shutdown
function cleanup() {
  for (const child of children) {
    child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Wait for either to exit
await Promise.race([strimulator.exited, astro.exited]);
cleanup();
