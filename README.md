# code-review-node

Small Node.js CLI that **clones a Git repository** (or uses a local folder) and runs an **AI code review** via **[Kiro CLI](https://kiro.dev/docs/cli/)** (AWS Kiro) in that project root. The default prompt targets **Node.js** codebases.

## Requirements

- **Node.js** 18+
- **git** on your `PATH`
- **Kiro CLI** installed and signed in — see [Kiro CLI installation](https://kiro.dev/docs/cli/installation/) and run `kiro-cli whoami` to confirm

## Install

```bash
git clone <this-repo-url>
cd code-review-node
```

### Run without a global install (recommended if `npm link` fails)

```bash
node bin/kiro-repo-review.mjs --help
node bin/kiro-repo-review.mjs owner/repo-name
```

Or via npm script (pass CLI args after `--`):

```bash
npm run review -- --help
npm run review -- expressjs/express
```

### Optional: global command (`npm link`)

```bash
npm link    # provides `kiro-repo-review` on your PATH
```

If you see **`EACCES` / permission denied** when symlinking under `/usr/local/lib/node_modules`, your global npm prefix is not writable. Prefer **`node bin/kiro-repo-review.mjs`** or **`npm run review -- …`** above, or point npm at a user-owned prefix and retry:

```bash
mkdir -p ~/.local/npm-global
npm config set prefix ~/.local/npm-global
# Add to ~/.zshrc or ~/.bashrc:
export PATH="$HOME/.local/npm-global/bin:$PATH"
```

Then open a new shell and run `npm link` again from this repo.

## Usage

```bash
kiro-repo-review [options] <repo>          # after successful npm link
kiro-repo-review --local <path> [options]
```

If you did not link globally, use `node bin/kiro-repo-review.mjs` or `npm run review --` in place of `kiro-repo-review`.

### `<repo>` forms

| Form | Example | Clones as |
|------|---------|-----------|
| `owner/name` | `expressjs/express` | `https://github.com/expressjs/express.git` |
| HTTPS URL | `https://github.com/org/repo.git` | that URL |
| SSH URL | `git@github.com:org/repo.git` | that URL |

### Examples

```bash
# Shallow clone under this package's .review-repos/, review (clone is kept)
kiro-repo-review expressjs/express

kiro-repo-review --branch main --depth 1 owner/repo

# Clone into a specific path
kiro-repo-review --dir ./work/my-review owner/repo

# Remove the default .review-repos/clone-* folder after review
kiro-repo-review --delete-clone owner/repo

# Review a repo you already have
kiro-repo-review --local ~/src/my-node-app

# Custom instructions
kiro-repo-review --prompt-file ./prompts/security.md owner/repo
```

## Options

| Option | Description |
|--------|-------------|
| `--local <path>` | Skip clone; review this directory |
| `--branch <name>` | `git clone -b <name>` |
| `--depth <n>` | Shallow clone depth (default: `1`) |
| `--dir <path>` | Clone destination (default: `.review-repos/clone-*` inside **this** repo) |
| `--delete-clone` | After Kiro exits, delete that default clone directory (no effect with `--dir`) |
| `--kiro <path>` | Kiro binary (default: `KIRO_CLI` env or `kiro-cli`) |
| `--agent <name>` | Passed through as `--agent` to Kiro |
| `--trust-all-tools` | Pass `--trust-all-tools` (default: **on**) |
| `--no-trust-all-tools` | Do not pass `--trust-all-tools` |
| `--json` | Adds `--format json` (only if your `kiro-cli` supports it) |
| `--prompt <text>` | Inline review instructions (overrides default markdown) |
| `--prompt-file <path>` | Read review instructions from any file (overrides default markdown) |
| `--output <path>` | Save the transcript markdown here (default: **`reviews/<slug>-<timestamp>.md`**) |
| `--timeout <sec>` | Send `SIGTERM` to Kiro after *N* seconds (`0` = no limit) |
| `-h`, `--help` | Show help |

## Review prompt (markdown)

The default instructions live in **`prompts/default-review.md`** in this repo. Edit that file to change what Kiro is asked to do (headings and lists are fine; the whole file is sent as the prompt text).

Override per run:

- **`--prompt-file ./other-prompt.md`** — use another file
- **`--prompt '…'`** — short inline instructions

If the default file is missing, the CLI falls back to a small built-in prompt and prints a warning.

## Review report (output markdown)

Kiro’s **stdout** and **stderr** are still shown in your terminal, and the same content is written to a **markdown report** under **`reviews/`** in this package:

- Default path: `reviews/<repo-slug>-<UTC-timestamp>.md` (slug derived from `owner/name`, clone URL, or local folder name).
- Override: **`--output /path/to/report.md`** (parent directories are created if needed).

The file includes metadata (time, path reviewed, source, exit status) plus captured output in fenced `text` blocks. **ANSI color / escape codes are stripped** in the file so Markdown renders as plain text; your terminal may still show colors while Kiro runs.

Generated **`reviews/*.md`** files are listed in **`.gitignore`** so they are not committed by default. The empty **`reviews/.gitkeep`** keeps the folder in the repo.

## How it works

1. Optionally runs `git clone` into `--dir`, or into **`.review-repos/clone-…`** next to `package.json` (that folder is **gitignored**). Clones are **kept** unless you pass **`--delete-clone`** (default path only).
2. Loads the review prompt from **`prompts/default-review.md`**, unless you pass **`--prompt`** or **`--prompt-file`**.
3. Sets `cwd` to the repository root and runs:

   `kiro-cli chat --no-interactive [--format json] [--trust-all-tools] [--agent …] "<prompt>"`

4. Sets `KIRO_LOG_NO_COLOR=1` unless you already exported it.
5. Writes the transcript to **`reviews/…`** (or **`--output`**).

Private repositories use whatever credentials your **git** setup provides (SSH agent, credential helper, etc.).

## License

MIT
