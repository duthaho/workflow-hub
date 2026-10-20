import { access, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const modules = [
  "cli",
  "config",
  "contracts",
  "initialize",
  "policy",
  "providers",
  "review",
  "verification",
];

for (const name of modules) {
  const path = `dist/${name}.js`;
  await access(path);
  await import(pathToFileURL(path).href);
}

const builtFiles = await readdir("dist/packages", { recursive: true });
if (builtFiles.some((path) => path.split(/[\\/]/).includes("tests"))) {
  throw new Error("Published build must not contain workspace tests");
}

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["dist/cli.js", "--help"], {
    stdio: "ignore",
  });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`Legacy CLI smoke test failed with exit code ${code}`));
  });
});
