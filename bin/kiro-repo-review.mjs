#!/usr/bin/env node
/**
 * Clone a Git repository (or use a local path) and ask Kiro CLI to review it.
 * Requires: git on PATH, kiro-cli installed and logged in (https://kiro.dev/docs/cli/).
 */

import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Parent folder for default clones: `<this package>/.review-repos/` (gitignored). */
const DEFAULT_CLONES_PARENT = join(PACKAGE_ROOT, ".review-repos");

/** Saved review transcripts (markdown). */
const REVIEWS_DIR = join(PACKAGE_ROOT, "reviews");

/** Default review instructions (edit this file; committed with the repo). */
const DEFAULT_PROMPT_FILE = join(PACKAGE_ROOT, "prompts", "default-review.md");

/** Used only if `prompts/default-review.md` is missing (e.g. broken install). */
const FALLBACK_PROMPT = `You are reviewing a Node.js project in the current working directory (repository root).

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
  --dir <path>         Clone into this directory (default: .review-repos/ under this package)
  --delete-clone       After review, remove the clone (only when using default .review-repos/ path)
  --kiro <path>        kiro-cli binary (default: env KIRO_CLI or "kiro-cli")
  --agent <name>       Pass --agent to Kiro
  --trust-all-tools    Pass --trust-all-tools (default: on)
  --no-trust-all-tools Disable --trust-all-tools
  --json               Pass --format json (only if your kiro-cli supports it)
  --prompt <text>      Review instructions (overrides default markdown file)
  --prompt-file <path> Read review instructions from a file (overrides default markdown file)
  --output <path>      Write report markdown here (default: reviews/<slug>-<timestamp>.md in this package)
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

function sanitizeReportSlug(s) {
  const t = s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return t.slice(0, 96) || "review";
}

/** Short label + filesystem slug for the report filename. */
function reportIdentity(repoArg, cloneUrl, localPath) {
  if (localPath) {
    const base = basename(localPath.replace(/[/\\]+$/, "")) || "local";
    return {
      sourceLabel: `local: ${localPath}`,
      slug: sanitizeReportSlug(base),
    };
  }
  const arg = repoArg?.trim() ?? "";
  if (/^[\w.-]+\/[\w.-]+$/.test(arg)) {
    return { sourceLabel: arg, slug: sanitizeReportSlug(arg.replace(/\//g, "-")) };
  }
  try {
    const normalized = cloneUrl.replace(/^git@([^:]+):(.+)$/, "https://$1/$2");
    const u = new URL(normalized);
    const pathPart = u.pathname.replace(/^\//, "").replace(/\.git$/i, "");
    return {
      sourceLabel: cloneUrl,
      slug: sanitizeReportSlug(pathPart.replace(/\//g, "-")),
    };
  } catch {
    return { sourceLabel: cloneUrl, slug: "review" };
  }
}

function fsSafeTimestamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function escapeMdTableCell(s) {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Strip ANSI/VT escape sequences (colors, etc.) for markdown reports.
 * Terminal output is unchanged; only the saved file is cleaned.
 * Uses small valid ES regexes (CSI + OSC + 2-byte ESC); avoids the strip-ansi
 * mega-pattern, which can throw when built via `new RegExp(string, "g")` in JS.
 */
function stripAnsi(s) {
  if (!s) return s;
  return (
    s
      // CSI: ESC [ params + intermediate + final byte (@–~)
      .replace(/\u001b\[[\d:;<=>?]*[ -/]*[@-~]/g, "")
      // OSC: ESC ] … BEL or ST (ESC + 0x5C — use \x5c so `/` does not end the regex literal)
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\x5c)/g, "")
      // ESC + single letter / symbol (e.g. 7-bit NEL, etc.)
      .replace(/\u001b[@-_]/g, "")
      // 8-bit C1 alternative to ESC [
      .replace(/\u009b\[[\d:;<=>?]*[ -/]*[@-~]/g, "")
  );
}

function fencedTextBlock(s) {
  const normalized = s.replace(/\r\n/g, "\n");
  return `\`\`\`text\n${normalized}\n\`\`\`\n`;
}

function buildReportMarkdown({
  reviewedPath,
  sourceLabel,
  exitCode,
  signal,
  stdout,
  stderr,
}) {
  const when = new Date().toISOString();
  const exitBits =
    signal != null ? `signal ${signal}` : exitCode != null ? `code ${exitCode}` : "unknown";
  let body = `# Code review report

| Field | Value |
|-------|-------|
| Generated (UTC) | ${when} |
| Reviewed path | \`${escapeMdTableCell(reviewedPath)}\` |
| Source | ${escapeMdTableCell(sourceLabel)} |
| Kiro exit | ${escapeMdTableCell(exitBits)} |

## Standard output

`;
  body += stdout.trim() ? fencedTextBlock(stdout) : "_(_empty_)_\n\n";
  if (stderr.trim()) {
    body += "## Standard error\n\n";
    body += fencedTextBlock(stderr);
  }
  return body;
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

async function makeDefaultCloneDir() {
  await mkdir(DEFAULT_CLONES_PARENT, { recursive: true });
  return mkdtemp(join(DEFAULT_CLONES_PARENT, "clone-"));
}

async function resolveReviewPrompt(values) {
  if (values["prompt-file"]) {
    return readFile(values["prompt-file"], "utf8");
  }
  if (values.prompt) {
    return values.prompt;
  }
  if (await pathExists(DEFAULT_PROMPT_FILE)) {
    return readFile(DEFAULT_PROMPT_FILE, "utf8");
  }
  console.error(
    `Warning: missing ${DEFAULT_PROMPT_FILE}; using built-in fallback prompt.\n`,
  );
  return FALLBACK_PROMPT;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      local: { type: "string" },
      branch: { type: "string" },
      depth: { type: "string", default: "1" },
      dir: { type: "string" },
      "delete-clone": { type: "boolean", default: false },
      kiro: { type: "string" },
      agent: { type: "string" },
      "trust-all-tools": { type: "boolean", default: true },
      "no-trust-all-tools": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      prompt: { type: "string" },
      "prompt-file": { type: "string" },
      output: { type: "string" },
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
  let repoArg = null;
  let cloneUrl = null;

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
    repoArg = positionals[0];
    if (!repoArg) {
      console.error("Missing repository. Pass owner/name, a git URL, or use --local.\n");
      usage();
      process.exit(1);
    }
    cloneUrl = toCloneUrl(repoArg);
    const depth = values.depth.trim();
    const depthNum = parseInt(depth, 10);
    if (!/^\d+$/.test(depth) || !Number.isFinite(depthNum) || depthNum < 1) {
      console.error("Invalid --depth: use a positive integer.");
      process.exit(1);
    }

    repoDir = values.dir?.trim() || (await makeDefaultCloneDir());
    if (!values.dir && values["delete-clone"]) cleanupDir = repoDir;

    const cloneArgs = ["clone", `--depth=${depth}`];
    if (values.branch?.trim()) {
      cloneArgs.push("-b", values.branch.trim());
    }
    cloneArgs.push(cloneUrl, repoDir);

    console.error(`Cloning into ${repoDir} …`);
    await run("git", cloneArgs, { env: process.env });
  }

  const prompt = await resolveReviewPrompt(values);

  const kiroArgs = ["chat", "--no-interactive"];
  if (values.json) kiroArgs.push("--format", "json");
  if (trustAllTools) kiroArgs.push("--trust-all-tools");
  if (values.agent?.trim()) kiroArgs.push("--agent", values.agent.trim());
  kiroArgs.push(prompt);

  const env = {
    ...process.env,
    KIRO_LOG_NO_COLOR: process.env.KIRO_LOG_NO_COLOR || "1",
    // Hint for CLIs that follow https://no-color.org/ (Kiro may still emit some CSI codes).
    NO_COLOR: process.env.NO_COLOR || "1",
  };

  const { sourceLabel, slug } = values.local
    ? reportIdentity(null, null, repoDir)
    : reportIdentity(repoArg, cloneUrl, null);

  console.error(`Running Kiro in ${repoDir} …`);
  const stdoutChunks = [];
  const stderrChunks = [];

  const child = spawn(kiroBin, kiroArgs, {
    cwd: repoDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdoutChunks.push(chunk);
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderrChunks.push(chunk);
    process.stderr.write(chunk);
  });

  let timeoutId;
  if (timeoutSec > 0) {
    timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutSec * 1000);
  }

  const { code: kiroExitCode, signal: kiroSignal } = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  if (timeoutId) clearTimeout(timeoutId);

  const reportPath = values.output?.trim()
    ? values.output.trim()
    : join(REVIEWS_DIR, `${slug}-${fsSafeTimestamp()}.md`);
  await mkdir(dirname(reportPath), { recursive: true });
  const reportMd = buildReportMarkdown({
    reviewedPath: repoDir,
    sourceLabel,
    exitCode: kiroExitCode,
    signal: kiroSignal,
    stdout: stripAnsi(stdoutChunks.join("")),
    stderr: stripAnsi(stderrChunks.join("")),
  });
  await writeFile(reportPath, reportMd, "utf8");
  console.error(`Wrote review report: ${reportPath}`);

  if (cleanupDir) {
    await rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
  }

  process.exit(kiroSignal ? 1 : (kiroExitCode ?? 1));
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
