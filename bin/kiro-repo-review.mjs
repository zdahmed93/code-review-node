#!/usr/bin/env node
/**
 * Clone a Git repository (or use a local path) and run an AI review via Bedrock.
 * Requires: git on PATH and AWS credentials with bedrock:InvokeModel permissions.
 */

import "dotenv/config";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ChatBedrockConverse } from "@langchain/aws";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Parent folder for default clones: `<this package>/.review-repos/` (gitignored). */
const DEFAULT_CLONES_PARENT = join(PACKAGE_ROOT, ".review-repos");

/** Saved review transcripts (markdown). */
const REVIEWS_DIR = join(PACKAGE_ROOT, "reviews");

/** Default review instructions (edit this file; committed with the repo). */
const DEFAULT_PROMPT_FILE = join(PACKAGE_ROOT, "prompts", "default-review.md");
const DEFAULT_BEDROCK_MODEL = "anthropic.claude-3-5-sonnet-20240620-v1:0";
const DEFAULT_AWS_REGION = process.env.AWS_REGION || "eu-west-1";

const TEXT_FILE_EXTENSIONS = new Set([
  ".md", ".txt", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".yml", ".yaml",
  ".xml", ".html", ".css", ".scss", ".sh", ".py", ".java", ".go", ".rs", ".rb", ".php",
  ".cs", ".sql", ".toml", ".ini", ".env", ".dockerfile", ".gradle", ".properties",
]);

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
  --bedrock-model <id> Bedrock model id (default: ${DEFAULT_BEDROCK_MODEL})
  --aws-region <name>  AWS region for Bedrock (default: ${DEFAULT_AWS_REGION})
  --max-files <n>      Max tracked files to include in context (default: 120)
  --max-context-chars  Max total chars sent as code context (default: 180000)
  --prompt <text>      Review instructions (overrides default markdown file)
  --prompt-file <path> Read review instructions from a file (overrides default markdown file)
  --output <path>      Write report markdown here (default: reviews/<slug>-<timestamp>.md in this package)
  --github-pr          After review, commit the report in the reviewed repo and open a new PR (GitHub only)
  --github-token <t>   PAT for --github-pr (default: env GITHUB_TOKEN); needs repo push + pull_requests
  --pr-base <branch>   PR target branch (default: GitHub default branch for the repo)
  --pr-title <text>    PR title (default: automated code review title)
  --pr-file <path>     Path for the report inside the repo (default: docs/code-reviews/<slug>-<ts>.md)
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
| Model status | ${escapeMdTableCell(exitBits)} |

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

function runCapture(cmd, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (c) => {
      stdout += c;
    });
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

function parseGithubOwnerRepoFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const normalized = trimmed.replace(/^git@github\.com:/i, "https://github.com/");
  try {
    const u = new URL(normalized);
    if (u.hostname.toLowerCase() !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/i, ""),
    };
  } catch {
    return null;
  }
}

async function resolveGithubRepo(repoDir, cloneUrl) {
  if (cloneUrl) {
    const fromClone = parseGithubOwnerRepoFromUrl(cloneUrl);
    if (fromClone) return fromClone;
  }
  const cap = await runCapture("git", ["remote", "get-url", "origin"], { cwd: repoDir });
  if (cap.code !== 0) return null;
  return parseGithubOwnerRepoFromUrl(cap.stdout.trim());
}

async function githubApi(method, path, token, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text };
  }
  if (!res.ok) {
    const msg = json?.message || text || res.statusText;
    throw new Error(`GitHub API ${method} ${path}: ${res.status} ${msg}`);
  }
  return json;
}

function sanitizeGitBranchName(s) {
  const t = s.replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "");
  const without = t.replace(/^\/+|\/+$/g, "").replace(/\/\/+/g, "/");
  return without.slice(0, 200) || "code-review";
}

function formatGitPushFailureMessage(combined, owner, repo, branchSlug, repoDir) {
  const base = `git push failed: ${combined || "(no stderr)"}`;
  if (!/403|401|denied|Permission|unable to access/i.test(combined)) {
    return base;
  }
  return `${base}

Why: GitHub accepted the token but refused to push to ${owner}/${repo} (wrong/expired token, read-only scopes, or SSO not authorized).

Try:
  • Classic PAT: enable the "repo" scope (not only "public_read").
  • Fine-grained PAT: grant this repository; set Contents + Pull requests to Read and write.
  • Org-owned repo: Developer settings → your token → Authorize SSO for that organization.
  • If GITHUB_TOKEN is set by CI or another tool, it may be read-only — use --github-token with a personal PAT.

Your review commit exists only locally. After fixing the token, push that branch, e.g.:
  cd ${repoDir}
  git push "https://x-access-token:<YOUR_PAT>@github.com/${owner}/${repo}.git" "HEAD:refs/heads/${branchSlug}"
`;
}

/**
 * Commit report inside repoDir, push branch, open PR. Requires push access to github.com/{owner}/{repo}.
 */
async function createGithubPullRequestForReview({
  repoDir,
  cloneUrl,
  reportMd,
  slug,
  token,
  prBase,
  prTitle,
  prFileInRepo,
}) {
  const gitDir = await runCapture("git", ["rev-parse", "--git-dir"], { cwd: repoDir });
  if (gitDir.code !== 0) {
    throw new Error("--github-pr needs a git repository (clone a repo or use a git working tree).");
  }

  const gh = await resolveGithubRepo(repoDir, cloneUrl);
  if (!gh) {
    throw new Error(
      "--github-pr only works for github.com repositories (clone URL or git remote origin).",
    );
  }

  const { owner, repo } = gh;
  const repoMeta = await githubApi("GET", `/repos/${owner}/${repo}`, token);
  const baseBranch = (prBase?.trim() || repoMeta.default_branch || "main").trim();

  const branchSlug = sanitizeGitBranchName(`code-review/${slug}-${fsSafeTimestamp()}`);
  const fileRel = prFileInRepo.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const absFile = join(repoDir, fileRel);
  await mkdir(dirname(absFile), { recursive: true });
  await writeFile(absFile, reportMd, "utf8");

  const gitName = process.env.KIRO_REVIEW_GIT_NAME || "code-review-bot";
  const gitEmail = process.env.KIRO_REVIEW_GIT_EMAIL || "code-review-bot@users.noreply.github.com";
  await run("git", ["-C", repoDir, "config", "user.name", gitName], { env: process.env });
  await run("git", ["-C", repoDir, "config", "user.email", gitEmail], { env: process.env });

  await run("git", ["-C", repoDir, "checkout", "-b", branchSlug], { env: process.env });
  await run("git", ["-C", repoDir, "add", "--", fileRel], { env: process.env });
  await run(
    "git",
    ["-C", repoDir, "commit", "-m", `docs: add automated code review report\n\n${fileRel}`],
    { env: process.env },
  );

  const authedPushUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`;
  const pushResult = await runCapture(
    "git",
    ["-C", repoDir, "push", authedPushUrl, `HEAD:refs/heads/${branchSlug}`],
    { env: process.env },
  );
  if (pushResult.code !== 0) {
    const combined = `${pushResult.stderr}\n${pushResult.stdout}`.trim();
    throw new Error(formatGitPushFailureMessage(combined, owner, repo, branchSlug, repoDir));
  }

  const title =
    prTitle?.trim() ||
    `chore: automated code review report (${new Date().toISOString().slice(0, 10)})`;
  const maxBody = 60000;
  const intro = `Automated code review (LangChain + Bedrock).\n\n**Report file:** \`${fileRel}\`\n\n---\n\n`;
  let body = intro + reportMd;
  if (body.length > maxBody) {
    body =
      intro +
      "_Full report is in the committed file above; body truncated for GitHub limits._\n\n" +
      reportMd.slice(0, maxBody - intro.length - 200) +
      "\n\n…";
  }

  const pr = await githubApi("POST", `/repos/${owner}/${repo}/pulls`, token, {
    title,
    head: branchSlug,
    base: baseBranch,
    body,
  });

  console.error(`Opened pull request: ${pr.html_url}`);
  return pr.html_url;
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

function shouldIncludeTextFile(file) {
  const lowered = file.toLowerCase();
  const ext = lowered.includes(".") ? lowered.slice(lowered.lastIndexOf(".")) : "";
  if (TEXT_FILE_EXTENSIONS.has(ext)) return true;
  if (lowered.endsWith("dockerfile")) return true;
  return false;
}

async function collectRepoContext(repoDir, maxFiles, maxContextChars) {
  const listed = await runCapture("git", ["-C", repoDir, "ls-files"], { env: process.env });
  let files = [];
  if (listed.code === 0) {
    files = listed.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  if (files.length === 0) {
    const fsList = await runCapture("ls", ["-la"], { cwd: repoDir, env: process.env });
    return `No git index detected. Directory listing:\n${fsList.stdout || "(empty)"}`;
  }

  const picked = files.filter(shouldIncludeTextFile).slice(0, Math.max(1, maxFiles));
  let remaining = Math.max(2000, maxContextChars);
  let out = `Repository files sampled: ${picked.length}/${files.length}\n\n`;

  for (const rel of picked) {
    if (remaining <= 0) break;
    const abs = join(repoDir, rel);
    let content = "";
    try {
      content = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    const fileBudget = Math.min(12000, remaining);
    const clipped = content.length > fileBudget ? `${content.slice(0, fileBudget)}\n\n...[truncated]` : content;
    out += `--- FILE: ${rel} ---\n${clipped}\n\n`;
    remaining -= clipped.length + rel.length + 20;
  }
  return out;
}

function normalizeModelTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return part.text ?? "";
        return "";
      })
      .join("\n")
      .trim();
  }
  return String(content ?? "");
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
      "bedrock-model": { type: "string" },
      "aws-region": { type: "string" },
      "max-files": { type: "string", default: "120" },
      "max-context-chars": { type: "string", default: "180000" },
      prompt: { type: "string" },
      "prompt-file": { type: "string" },
      output: { type: "string" },
      "github-pr": { type: "boolean", default: false },
      "github-token": { type: "string" },
      "pr-base": { type: "string" },
      "pr-title": { type: "string" },
      "pr-file": { type: "string" },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    usage();
    process.exit(0);
  }

  const bedrockModel = values["bedrock-model"]?.trim() || process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL;
  const awsRegion = values["aws-region"]?.trim() || process.env.AWS_REGION || DEFAULT_AWS_REGION;
  const maxFiles = parseInt(values["max-files"], 10);
  const maxContextChars = parseInt(values["max-context-chars"], 10);
  const timeoutSec = values.timeout !== undefined ? parseInt(values.timeout, 10) : 0;
  if (values.timeout !== undefined && (!Number.isFinite(timeoutSec) || timeoutSec < 0)) {
    console.error("Invalid --timeout: use a non-negative integer (seconds).");
    process.exit(1);
  }
  if (!Number.isFinite(maxFiles) || maxFiles < 1) {
    console.error("Invalid --max-files: use a positive integer.");
    process.exit(1);
  }
  if (!Number.isFinite(maxContextChars) || maxContextChars < 5000) {
    console.error("Invalid --max-context-chars: use an integer >= 5000.");
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

  const { sourceLabel, slug } = values.local
    ? reportIdentity(null, null, repoDir)
    : reportIdentity(repoArg, cloneUrl, null);

  console.error(`Collecting repository context in ${repoDir} …`);
  const repoContext = await collectRepoContext(repoDir, maxFiles, maxContextChars);
  console.error(`Running Bedrock model ${bedrockModel} (${awsRegion}) …`);

  let modelText = "";
  let modelErr = "";
  let modelExitCode = 0;
  let timedOut = false;
  const llm = new ChatBedrockConverse({
    model: bedrockModel,
    region: awsRegion,
    temperature: 0,
    maxTokens: 4096,
  });
  try {
    const task = llm.invoke([
      ["system", "You are a senior software reviewer. Output markdown only."],
      [
        "human",
        `Review this repository.\n\nReview instructions:\n${prompt}\n\nRepository snapshot:\n${repoContext}`,
      ],
    ]);
    const response = timeoutSec > 0
      ? await Promise.race([
          task,
          new Promise((_, reject) =>
            setTimeout(() => {
              timedOut = true;
              reject(new Error(`Timed out after ${timeoutSec}s`));
            }, timeoutSec * 1000),
          ),
        ])
      : await task;
    modelText = normalizeModelTextContent(response.content);
    process.stdout.write(`${modelText}\n`);
  } catch (err) {
    modelExitCode = 1;
    modelErr = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${modelErr}\n`);
  }

  const reportPath = values.output?.trim()
    ? values.output.trim()
    : join(REVIEWS_DIR, `${slug}-${fsSafeTimestamp()}.md`);
  await mkdir(dirname(reportPath), { recursive: true });
  const reportMd = buildReportMarkdown({
    reviewedPath: repoDir,
    sourceLabel,
    exitCode: modelExitCode,
    signal: timedOut ? "SIGTERM" : null,
    stdout: stripAnsi(modelText),
    stderr: stripAnsi(modelErr),
  });
  await writeFile(reportPath, reportMd, "utf8");
  console.error(`Wrote review report: ${reportPath}`);

  let exitCode = timedOut ? 1 : modelExitCode;
  let prCreated = false;

  if (values["github-pr"]) {
    const token = values["github-token"]?.trim() || process.env.GITHUB_TOKEN?.trim();
    if (!token) {
      console.error("Missing GitHub token: set GITHUB_TOKEN or pass --github-token (needs repo push).");
      exitCode = 1;
    } else {
      const prFileInRepo =
        values["pr-file"]?.trim().replace(/\\/g, "/") ||
        `docs/code-reviews/${slug}-${fsSafeTimestamp()}.md`;
      try {
        await createGithubPullRequestForReview({
          repoDir,
          cloneUrl,
          reportMd,
          slug,
          token,
          prBase: values["pr-base"],
          prTitle: values["pr-title"],
          prFileInRepo,
        });
        prCreated = true;
      } catch (e) {
        console.error(e instanceof Error ? e.message : e);
        exitCode = 1;
      }
    }
  }

  // If PR creation succeeded, keep run green even if model call failed in this pass.
  if (values["github-pr"] && prCreated && exitCode !== 0) {
    console.error(
      `Warning: model invocation failed with code ${exitCode}, but PR was created successfully; returning success.`,
    );
    exitCode = 0;
  }

  if (cleanupDir) {
    await rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
  }

  process.exit(exitCode);
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
