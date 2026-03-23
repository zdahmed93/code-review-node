#!/usr/bin/env node
/**
 * Clone a Git repository (or use a local path) and ask Kiro CLI to review it.
 * Requires: git on PATH, kiro-cli installed and logged in (https://kiro.dev/docs/cli/).
 */

import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const DEFAULT_PROMPT = `You are reviewing a Node.js project in the current working directory (repository root).

Perform a structured code review. Cover, when relevant:
- Correctness and edge cases
- Security (secrets, injection, auth, unsafe dependencies)
- Performance and scalability
- Maintainability, structure, and test coverage
- Node-specific concerns (async error handling, event listeners, native addons, ESM/CJS)

Use tools to inspect the codebase as needed. Be specific: reference files and symbols.
If something cannot be determined from the repo, say what is missing.

End with a short prioritized list of actionable items.`;

function usage() {
  const name = "kiro-repo-review";
  console.error(`Usage:
  ${name} [options] <repo>
  ${name} --local <path> [options]

<repo> may be:
  owner/name              → https://github.com/owner/name.git
  https://github.com/...  full clone URL
  git@github.com:...      SSH URL

Options:
  --local <path>       Review an existing directory (skip clone)
  --branch <name>      Clone this branch (-b)
  --depth <n>          Shallow clone depth (default: 1)
  --dir <path>         Clone into this directory (default: temp under TMPDIR)
  --keep               Do not delete the clone directory on exit (ignored with --local)
  --kiro <path>        kiro-cli binary (default: env KIRO_CLI or "kiro-cli")
  --agent <name>       Pass --agent to Kiro
  --trust-all-tools    Pass --trust-all-tools (default: on)
  --no-trust-all-tools Disable --trust-all-tools
  --json               Pass --format json (only if your kiro-cli supports it)
  --prompt <text>      Review instructions (overrides default)
  --prompt-file <path> Read review instructions from file
  --timeout <sec>      Send SIGTERM to Kiro after N seconds (0 = no limit)
  -h, --help           Show this help
`);
}

function toCloneUrl(repo) {
  const trimmed = repo.trim();
  if (!trimmed) throw new Error("Repository is empty.");
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed) && !trimmed.includes("://")) {
    return `https://github.com/${trimmed}.git`;
  }
  return trimmed;
}

function run(cmd, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) reject(new Error(`${cmd} killed (${signal})`));
      else if (code !== 0) reject(new Error(`${cmd} exited with code ${code}`));
      else resolve();
    });
  });
}

async function pathExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      local: { type: "string" },
      branch: { type: "string" },
      depth: { type: "string", default: "1" },
      dir: { type: "string" },
      keep: { type: "boolean", default: false },
      kiro: { type: "string" },
      agent: { type: "string" },
      "trust-all-tools": { type: "boolean", default: true },
      "no-trust-all-tools": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      prompt: { type: "string" },
      "prompt-file": { type: "string" },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    usage();
    process.exit(0);
  }

  const trustAllTools = values["no-trust-all-tools"] ? false : values["trust-all-tools"];
  const kiroBin = values.kiro?.trim() || process.env.KIRO_CLI?.trim() || "kiro-cli";
  const timeoutSec = values.timeout !== undefined ? parseInt(values.timeout, 10) : 0;
  if (values.timeout !== undefined && (!Number.isFinite(timeoutSec) || timeoutSec < 0)) {
    console.error("Invalid --timeout: use a non-negative integer (seconds).");
    process.exit(1);
  }

  let repoDir;
  let cleanupDir = null;

  if (values.local) {
    repoDir = values.local.trim();
    if (!repoDir) {
      console.error("--local requires a path.");
      process.exit(1);
    }
    if (!(await pathExists(repoDir))) {
      console.error(`Not found: ${repoDir}`);
      process.exit(1);
    }
  } else {
    const repoArg = positionals[0];
    if (!repoArg) {
      console.error("Missing repository. Pass owner/name, a git URL, or use --local.\n");
      usage();
      process.exit(1);
    }
    const cloneUrl = toCloneUrl(repoArg);
    const depth = values.depth.trim();
    const depthNum = parseInt(depth, 10);
    if (!/^\d+$/.test(depth) || !Number.isFinite(depthNum) || depthNum < 1) {
      console.error("Invalid --depth: use a positive integer.");
      process.exit(1);
    }

    repoDir =
      values.dir?.trim() ||
      (await mkdtemp(join(tmpdir(), "kiro-repo-review-")));
    if (!values.dir) cleanupDir = values.keep ? null : repoDir;

    const cloneArgs = ["clone", `--depth=${depth}`];
    if (values.branch?.trim()) {
      cloneArgs.push("-b", values.branch.trim());
    }
    cloneArgs.push(cloneUrl, repoDir);

    console.error(`Cloning into ${repoDir} …`);
    await run("git", cloneArgs, { env: process.env });
  }

  let prompt = DEFAULT_PROMPT;
  if (values["prompt-file"]) {
    prompt = await readFile(values["prompt-file"], "utf8");
  } else if (values.prompt) {
    prompt = values.prompt;
  }

  const kiroArgs = ["chat", "--no-interactive"];
  if (values.json) kiroArgs.push("--format", "json");
  if (trustAllTools) kiroArgs.push("--trust-all-tools");
  if (values.agent?.trim()) kiroArgs.push("--agent", values.agent.trim());
  kiroArgs.push(prompt);

  const env = {
    ...process.env,
    KIRO_LOG_NO_COLOR: process.env.KIRO_LOG_NO_COLOR || "1",
  };

  console.error(`Running Kiro in ${repoDir} …`);
  const child = spawn(kiroBin, kiroArgs, {
    cwd: repoDir,
    env,
    stdio: "inherit",
  });

  let timeoutId;
  if (timeoutSec > 0) {
    timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutSec * 1000);
  }

  const exitCode = await new Promise((resolve) => {
    child.on("close", resolve);
  });
  if (timeoutId) clearTimeout(timeoutId);

  if (cleanupDir) {
    await rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
  }

  process.exit(exitCode ?? 1);
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
