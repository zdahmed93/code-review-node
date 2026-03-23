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
# Shallow clone, review, then delete temp directory
kiro-repo-review expressjs/express

kiro-repo-review --branch main --depth 1 owner/repo

# Keep clone on disk
kiro-repo-review --keep --dir ./work/my-review owner/repo

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
| `--dir <path>` | Clone destination (default: temp under system temp dir) |
| `--keep` | Do not delete the clone when using a temp dir |
| `--kiro <path>` | Kiro binary (default: `KIRO_CLI` env or `kiro-cli`) |
| `--agent <name>` | Passed through as `--agent` to Kiro |
| `--trust-all-tools` | Pass `--trust-all-tools` (default: **on**) |
| `--no-trust-all-tools` | Do not pass `--trust-all-tools` |
| `--json` | Adds `--format json` (only if your `kiro-cli` supports it) |
| `--prompt <text>` | Replace the default review prompt |
| `--prompt-file <path>` | Read the review prompt from a file |
| `--timeout <sec>` | Send `SIGTERM` to Kiro after *N* seconds (`0` = no limit) |
| `-h`, `--help` | Show help |

## How it works

1. Optionally runs `git clone` into `--dir` or a temporary directory.
2. Sets `cwd` to the repository root and runs:

   `kiro-cli chat --no-interactive [--format json] [--trust-all-tools] [--agent …] "<prompt>"`

3. Sets `KIRO_LOG_NO_COLOR=1` unless you already exported it.

Private repositories use whatever credentials your **git** setup provides (SSH agent, credential helper, etc.).

## License

MIT
