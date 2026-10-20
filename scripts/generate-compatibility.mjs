import { chmod, writeFile } from "node:fs/promises";

const compatibilityModules = {
  config: "./packages/cli/src/config.js",
  contracts: "./packages/core/src/contracts.js",
  initialize: "./packages/cli/src/initialize.js",
  policy: "./packages/core/src/policy.js",
  providers: "./packages/providers/src/providers.js",
  review: "./packages/cli/src/review.js",
  verification: "./packages/cli/src/verification.js",
};

for (const [name, target] of Object.entries(compatibilityModules)) {
  await writeFile(`dist/${name}.js`, `export * from ${JSON.stringify(target)};\n`);
  await writeFile(`dist/${name}.d.ts`, `export * from ${JSON.stringify(target)};\n`);
}

const cli = `#!/usr/bin/env node
export * from "./packages/cli/src/cli.js";
import { isDirectExecution, runCli } from "./packages/cli/src/cli.js";
if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
`;
await writeFile("dist/cli.js", cli);
await writeFile(
  "dist/cli.d.ts",
  'export * from "./packages/cli/src/cli.js";\n',
);
await chmod("dist/cli.js", 0o755);
