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
| `--github-pr` | After the review, commit the report into the **reviewed** GitHub repo and open a **new pull request** |
| `--github-token <t>` | GitHub PAT for `--github-pr` (default: **`GITHUB_TOKEN`** env) |
| `--pr-base <branch>` | PR base branch (default: repo’s **default branch** from the API) |
| `--pr-title <text>` | PR title (default: dated “automated code review report” title) |
| `--pr-file <path>` | Path inside the reviewed repo for the markdown file (default: **`docs/code-reviews/<slug>-<timestamp>.md`**) |
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

## Open a pull request on the reviewed repo (`--github-pr`)

For **github.com** repositories only: after Kiro finishes, the tool can **add the report as a new file** on a branch `code-review/<slug>-<timestamp>`, **push** it (HTTPS with your token), and **open a PR** against the default branch (or `--pr-base`).

```bash
export GITHUB_TOKEN=ghp_...   # classic PAT: repo scope; or fine-grained: Contents + Pull requests write
kiro-repo-review --github-pr owner/repo-name
```

With **`--local`**, `origin` must point at **github.com** so the owner/repo can be resolved.

**Requirements**

- Token must allow **push** to the target repo (your repo, org repo with permission, or a bot user).
- This does **not** open a PR on a fork when you only have fork access; you need push rights to the **same** repo you cloned (or adjust the workflow yourself).
- Commits use **`user.name` / `user.email`** from **`KIRO_REVIEW_GIT_NAME`** and **`KIRO_REVIEW_GIT_EMAIL`** in the environment, or defaults `code-review-bot` / `code-review-bot@users.noreply.github.com` (local config inside the clone only).

**Note:** If Kiro modified other files in the working tree, only the review markdown file is **staged**; other changes stay unstaged. The PR body repeats the report text (truncated if it exceeds GitHub’s size limit); the full text is always in the committed file.

### `Permission denied` / `403` on `git push`

The message `Permission to owner/repo.git denied to <user>` means GitHub recognized your account but **refused the push**. Typical causes:

| Cause | What to do |
|--------|------------|
| PAT is **read-only** | Fine-grained: set **Contents** and **Pull requests** to **Read and write** for that repo. Classic: enable **`repo`** (not only metadata). |
| **Organization** + SSO | **Settings → Developer settings →** your token → **Configure SSO** / authorize the org. |
| Wrong env token | **`GITHUB_TOKEN`** may be set by another app or CI to a limited token. Use **`--github-token`** with a personal PAT you created for this. |
| No write access | You must be allowed to push to **that** repository (collaborator or owner). |

If push fails, the tool still leaves a **local commit** on `code-review/...` inside the clone; the CLI error suggests a manual `git push` command you can run after fixing the token.

## How it works

1. Optionally runs `git clone` into `--dir`, or into **`.review-repos/clone-…`** next to `package.json` (that folder is **gitignored**). Clones are **kept** unless you pass **`--delete-clone`** (default path only).
2. Loads the review prompt from **`prompts/default-review.md`**, unless you pass **`--prompt`** or **`--prompt-file`**.
3. Sets `cwd` to the repository root and runs:

   `kiro-cli chat --no-interactive [--format json] [--trust-all-tools] [--agent …] "<prompt>"`

4. Sets `KIRO_LOG_NO_COLOR=1` unless you already exported it.
5. Writes the transcript to **`reviews/…`** (or **`--output`**).
6. With **`--github-pr`**, commits that report into the reviewed clone, pushes a branch, and calls the **GitHub REST API** to open a pull request (needs **`GITHUB_TOKEN`** or **`--github-token`**).

Private repositories use whatever credentials your **git** setup provides (SSH agent, credential helper, etc.). **`--github-pr`** push uses the token over HTTPS (not your SSH agent).

## Docker

Build (needs network to download the Kiro CLI installer):

```bash
docker build -t code-review-node .
```

Run (pass CLI args after the image name):

```bash
docker run --rm code-review-node --help
docker run --rm code-review-node owner/repo-name
```

Persist **`reviews/`** on the host and reuse **Kiro login data** from your machine (typical paths: Linux/macOS `~/.kiro`; the CLI binary is already in the image):

```bash
docker run --rm \
  -v "$HOME/.kiro:/root/.kiro:ro" \
  -v "$(pwd)/reviews-out:/app/reviews" \
  code-review-node owner/repo-name
```

Use **read/write** on `~/.kiro` if the CLI must refresh tokens (`:rw` instead of `:ro`).

Private Git repos via SSH (mount keys; tighten permissions on the host):

```bash
docker run --rm \
  -v "$HOME/.ssh:/root/.ssh:ro" \
  -v "$HOME/.kiro:/root/.kiro:ro" \
  -v "$(pwd)/reviews-out:/app/reviews" \
  code-review-node git@github.com:org/private-repo.git
```

If the image build fails at the Kiro install step (architecture, air‑gapped build, etc.), install Kiro inside a running container interactively or switch to a host install and run Node without Docker.

## Running on AWS EC2 (example)

These steps assume an **Ubuntu 22.04/24.04** or **Amazon Linux 2023** instance with outbound HTTPS (clone + Kiro).

### 1. Install Docker on the instance

**Ubuntu**

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME:-$VERSION}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io
sudo usermod -aG docker "$USER"
# Log out and back in so `docker` works without sudo
```

**Amazon Linux 2023**

```bash
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
# Log out and back in
```

### 2. Put the app on the server

```bash
git clone <your-fork-or-repo-url> code-review-node
cd code-review-node
docker build -t code-review-node .
```

### 3. Kiro authentication on a headless server

The Kiro CLI must be **logged in** before `--no-interactive` reviews work. Practical options:

- **Copy credentials from your laptop** (after `kiro-cli login` locally): copy the `~/.kiro` directory to the instance (e.g. `scp -r ~/.kiro ec2-user@<host>:~/.kiro`), then mount it read-only or read-write as in the Docker examples above.
- **Run a one-off interactive login** on the instance (the image entrypoint is the review CLI, so override it):  
  `docker run -it --rm --entrypoint bash -v "$HOME/.kiro:/root/.kiro" code-review-node -lc 'kiro-cli login && kiro-cli whoami'`

Check [Kiro CLI authentication](https://kiro.dev/docs/cli/) for the current recommended flow.

### 4. Example review run on EC2

```bash
mkdir -p ~/reviews-out
docker run --rm \
  -v "$HOME/.kiro:/root/.kiro:ro" \
  -v "$HOME/reviews-out:/app/reviews" \
  code-review-node expressjs/express
ls ~/reviews-out
```

### 5. Security notes for production use

- Restrict **security groups** (SSH from known IPs only).
- Prefer **IAM instance roles** for AWS API access where applicable; Kiro may still need its own subscription/login.
- Do not bake **SSH private keys** or **`~/.kiro`** into the image; mount at runtime or use a secrets manager.
- For **private GitHub** repos, use a **deploy key** or **PAT** with minimal scope; mount `~/.ssh` or configure `git credential` in a mounted volume.

## License

MIT
