# code-review-node

CLI Node.js qui **clone un repository Git** (ou utilise un dossier local) et lance une **revue de code IA** via **[Kiro CLI](https://kiro.dev/docs/cli/)** (AWS Kiro) depuis la racine du projet. Le prompt par defaut cible les codebases **Node.js**.

## Prerequis

- **Node.js** 18+
- **git** on your `PATH`
- **Kiro CLI** installed and signed in — see [Kiro CLI installation](https://kiro.dev/docs/cli/installation/) and run `kiro-cli whoami` to confirm

## Installation

```bash
git clone <this-repo-url>
cd code-review-node
```

### Execution sans installation globale (recommande si `npm link` echoue)

```bash
node bin/kiro-repo-review.mjs --help
node bin/kiro-repo-review.mjs owner/repo-name
```

Ou via script npm (passer les arguments apres `--`) :

```bash
npm run review -- --help
npm run review -- expressjs/express
```

### Optionnel : commande globale (`npm link`)

```bash
npm link    # provides `kiro-repo-review` on your PATH
```

Si tu vois **`EACCES` / permission denied** lors du symlink sous `/usr/local/lib/node_modules`, ton prefix npm global n'est pas inscriptible. Prefere **`node bin/kiro-repo-review.mjs`** ou **`npm run review -- …`**, ou configure un prefix npm possede par ton utilisateur puis reessaie :

```bash
mkdir -p ~/.local/npm-global
npm config set prefix ~/.local/npm-global
# Add to ~/.zshrc or ~/.bashrc:
export PATH="$HOME/.local/npm-global/bin:$PATH"
```

Ensuite, ouvre un nouveau shell et relance `npm link` depuis ce repo.

## Utilisation

```bash
kiro-repo-review [options] <repo>          # after successful npm link
kiro-repo-review --local <path> [options]
```

Si tu n'as pas fait de lien global, utilise `node bin/kiro-repo-review.mjs` ou `npm run review --` a la place de `kiro-repo-review`.

### Formats `<repo>`

| Form | Example | Clones as |
|------|---------|-----------|
| `owner/name` | `expressjs/express` | `https://github.com/expressjs/express.git` |
| HTTPS URL | `https://github.com/org/repo.git` | that URL |
| SSH URL | `git@github.com:org/repo.git` | that URL |

### Exemples

```bash
# Clone shallow dans .review-repos/ de ce package, puis revue (le clone est conserve)
kiro-repo-review expressjs/express

kiro-repo-review --branch main --depth 1 owner/repo

# Cloner vers un chemin specifique
kiro-repo-review --dir ./work/my-review owner/repo

# Supprimer le dossier .review-repos/clone-* par defaut apres la revue
kiro-repo-review --delete-clone owner/repo

# Revoir un repo deja clone localement
kiro-repo-review --local ~/src/my-node-app

# Instructions personnalisees
kiro-repo-review --prompt-file ./prompts/security.md owner/repo
```

## Options

| Option | Description |
|--------|-------------|
| `--local <path>` | Ne pas cloner ; analyser ce dossier |
| `--branch <name>` | `git clone -b <name>` |
| `--depth <n>` | Profondeur de clone shallow (defaut : `1`) |
| `--dir <path>` | Dossier de destination du clone (defaut : `.review-repos/clone-*` dans **ce** repo) |
| `--delete-clone` | Apres Kiro, supprime le clone par defaut (sans effet avec `--dir`) |
| `--kiro <path>` | Binaire Kiro (defaut : env `KIRO_CLI` ou `kiro-cli`) |
| `--agent <name>` | Passe tel quel a Kiro via `--agent` |
| `--trust-all-tools` | Active `--trust-all-tools` (defaut : **on**) |
| `--no-trust-all-tools` | Desactive `--trust-all-tools` |
| `--json` | Ajoute `--format json` (si ta version de `kiro-cli` le supporte) |
| `--prompt <text>` | Instructions inline (prioritaires sur le markdown par defaut) |
| `--prompt-file <path>` | Lit les instructions depuis un fichier (prioritaire sur le markdown par defaut) |
| `--output <path>` | Ecrit ici le rapport markdown (defaut : **`reviews/<slug>-<timestamp>.md`**) |
| `--github-pr` | Apres la revue, commit le rapport dans le repo GitHub analyse et ouvre une **nouvelle pull request** |
| `--github-token <t>` | PAT GitHub pour `--github-pr` (defaut : env **`GITHUB_TOKEN`**) |
| `--pr-base <branch>` | Branche de base de la PR (defaut : branche par defaut du repo via API) |
| `--pr-title <text>` | Titre de PR (defaut : titre date de rapport automatique) |
| `--pr-file <path>` | Chemin dans le repo analyse pour le fichier markdown (defaut : **`docs/code-reviews/<slug>-<timestamp>.md`**) |
| `--timeout <sec>` | Envoie `SIGTERM` a Kiro apres *N* secondes (`0` = illimite) |
| `-h`, `--help` | Affiche l'aide |

## Prompt de revue (markdown)

Les instructions par defaut sont dans **`prompts/default-review.md`**. Modifie ce fichier pour changer la demande envoyee a Kiro (titres et listes acceptes ; le fichier complet est envoye comme prompt).

Surcharges possibles par execution :

- **`--prompt-file ./other-prompt.md`** — utilise un autre fichier
- **`--prompt '…'`** — instructions courtes inline

Si le fichier par defaut manque, la CLI utilise un prompt de secours integre et affiche un avertissement.

## Rapport de revue (sortie markdown)

Les sorties **stdout** et **stderr** de Kiro restent visibles dans le terminal, et le meme contenu est ecrit dans un **rapport markdown** sous **`reviews/`** :

- Chemin par defaut : `reviews/<repo-slug>-<UTC-timestamp>.md` (slug derive de `owner/name`, URL de clone, ou nom de dossier local).
- Surcharge : **`--output /path/to/report.md`** (les dossiers parents sont crees si besoin).

Le fichier contient des metadonnees (date, chemin analyse, source, code de sortie) et les sorties capturees dans des blocs `text`. Les codes ANSI sont retires dans le fichier pour un rendu propre ; le terminal peut rester colore pendant l'execution.

Les fichiers generes **`reviews/*.md`** sont ignores via **`.gitignore`** et ne sont donc pas commit par defaut. Le fichier vide **`reviews/.gitkeep`** conserve le dossier dans le repo.

## Ouvrir une pull request sur le repo analyse (`--github-pr`)

Pour les repositories **github.com** uniquement : apres execution de Kiro, l'outil peut **ajouter le rapport comme nouveau fichier** sur une branche `code-review/<slug>-<timestamp>`, le **push** (HTTPS avec ton token), puis **ouvrir une PR** vers la branche par defaut (ou `--pr-base`).

```bash
export GITHUB_TOKEN=ghp_...   # classic PAT: repo scope; or fine-grained: Contents + Pull requests write
kiro-repo-review --github-pr owner/repo-name
```

Avec **`--local`**, le remote `origin` doit pointer vers **github.com** pour resoudre owner/repo.

**Prerequis**

- Le token doit autoriser le **push** sur le repo analyse (ton repo, repo d'organisation avec droits, ou compte bot).
- Ce mode n'ouvre pas de PR via fork si tu n'as que des droits fork ; il faut des droits push sur le **meme** repo clone (ou adapter le workflow).
- Les commits utilisent **`user.name` / `user.email`** depuis **`KIRO_REVIEW_GIT_NAME`** et **`KIRO_REVIEW_GIT_EMAIL`**, ou les valeurs par defaut `code-review-bot` / `code-review-bot@users.noreply.github.com` (config locale dans le clone).

**Note :** Si Kiro modifie d'autres fichiers, seul le fichier markdown de revue est **stage** ; le reste reste non stage. Le corps de PR reprend le rapport (tronque si trop long) ; le texte complet reste dans le fichier commit.

### `Permission denied` / `403` sur `git push`

Le message `Permission to owner/repo.git denied to <user>` signifie que GitHub reconnait ton compte mais **refuse le push**. Causes frequentes :

| Cause | Action |
|--------|------------|
| PAT en **read-only** | Fine-grained : mettre **Contents** et **Pull requests** en **Read and write**. Classic : activer **`repo`**. |
| **Organization** + SSO | **Settings → Developer settings →** your token → **Configure SSO** / authorize the org. |
| Mauvais token env | **`GITHUB_TOKEN`** peut etre surchage par un token limite. Utiliser **`--github-token`** avec un PAT personnel. |
| Pas de droit write | Tu dois avoir le droit de push sur **ce** repository (collaborateur/proprietaire). |

Si le push echoue, l'outil laisse quand meme un **commit local** sur `code-review/...` dans le clone ; l'erreur propose une commande `git push` manuelle a relancer apres correction du token.

## Fonctionnement

1. Optionally runs `git clone` into `--dir`, or into **`.review-repos/clone-…`** next to `package.json` (that folder is **gitignored**). Clones are **kept** unless you pass **`--delete-clone`** (default path only).
2. Loads the review prompt from **`prompts/default-review.md`**, unless you pass **`--prompt`** or **`--prompt-file`**.
3. Sets `cwd` to the repository root and runs:

   `kiro-cli chat --no-interactive [--format json] [--trust-all-tools] [--agent …] "<prompt>"`

4. Sets `KIRO_LOG_NO_COLOR=1` unless you already exported it.
5. Writes the transcript to **`reviews/…`** (or **`--output`**).
6. With **`--github-pr`**, commits that report into the reviewed clone, pushes a branch, and calls the **GitHub REST API** to open a pull request (needs **`GITHUB_TOKEN`** or **`--github-token`**).

Les repositories prives utilisent les credentials de ta configuration **git** (agent SSH, credential helper, etc.). Le push **`--github-pr`** utilise le token en HTTPS (pas l'agent SSH).

## Automation (GitHub Actions)

Un workflow est fourni: `./.github/workflows/auto-review.yml`.

### Guides

- `./SELF_HOSTED_RUNNER_GUIDE.md` - Configuration du runner self-hosted local
- `./STEPS.md` - Guide pas-a-pas complet (local + GitHub + repo externe)

Ce workflow permet de lancer le review sur **des repos externes** (pas seulement ce projet).

### Triggers supportés

1. **Manuel (`workflow_dispatch`)** avec input `target_repo=owner/repo`
2. **Tag push** au format: `review-owner__repo`
   - exemple: `review-zdahmed93__java-kata-example`
3. **Commit message** contenant: `[review:owner/repo]`
   - exemple: `feat: trigger review [review:zdahmed93/java-kata-example]`
4. **Cross-repo event** via `repository_dispatch` (`event_type: run-external-review`)

### Ce que fait le job

1. utilise un runner **self-hosted** (ta machine locale / ton serveur)
2. vérifie `kiro-cli` + session (`kiro-cli whoami`) sur ce runner
3. exécute `kiro-repo-review owner/repo --github-pr`
4. ouvre une PR dans le **repo ciblé** avec le rapport dans `docs/code-reviews/`

Secrets à créer dans GitHub (repo → Settings → Secrets and variables → Actions):

- `REVIEW_GITHUB_TOKEN`: PAT avec droits write (Contents + Pull requests) sur les repos à reviewer

### Important: auth Kiro sur self-hosted runner

Le workflow est configuré pour tourner sur `runs-on: [self-hosted]`.
Tu dois installer Kiro CLI et faire le login **directement sur la machine runner**:

```bash
kiro-cli login
kiro-cli whoami
```

Si `whoami` échoue dans le job, reconnecte Kiro sur la machine runner puis relance.

Exemples de déclenchement:

```bash
# 1) workflow_dispatch depuis UI GitHub
# target_repo: zdahmed93/java-kata-example

# 2) tag trigger
git tag review-zdahmed93__java-kata-example
git push origin review-zdahmed93__java-kata-example

# 3) commit trigger
git commit -m "chore: launch automated review [review:zdahmed93/java-kata-example]"
git push
```

### Déclencher depuis le repo cible (recommandé)

Dans chaque repo que tu veux reviewer, ajoute un workflow qui appelle l'orchestrateur via `repository_dispatch`:

```yaml
name: Trigger External Review

on:
  workflow_dispatch:
  push:
    branches: [ main ]

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch review request to orchestrator
        env:
          ORCH_OWNER: your-user-or-org
          ORCH_REPO: code-review-node
          ORCH_PAT: ${{ secrets.ORCH_PAT }}
          TARGET_REPO: ${{ github.repository }}
        run: |
          test -n "$ORCH_PAT"
          curl -sS -X POST \
            -H "Accept: application/vnd.github+json" \
            -H "Authorization: Bearer $ORCH_PAT" \
            https://api.github.com/repos/$ORCH_OWNER/$ORCH_REPO/dispatches \
            -d @- <<JSON
          {
            "event_type": "run-external-review",
            "client_payload": {
              "target_repo": "$TARGET_REPO",
              "pr_base": "main"
            }
          }
          JSON
```

Dans le repo cible, crée le secret `ORCH_PAT` (PAT qui a le droit de déclencher les workflows / dispatch events sur le repo orchestrateur).

> Note: le workflow est actuellement **pinné** sur `runs-on: [self-hosted, macOS]`. Si tes labels runner sont différents, adapte cette ligne.

## Docker

Build (acces reseau requis pour telecharger l'installateur Kiro CLI) :

```bash
docker build -t code-review-node .
```

Execution (passer les arguments apres le nom de l'image) :

```bash
docker run --rm code-review-node --help
docker run --rm code-review-node owner/repo-name
```

Persister **`reviews/`** sur l'hote et reutiliser les donnees de login Kiro de la machine (souvent `~/.kiro` sur Linux/macOS ; le binaire est deja dans l'image) :

```bash
docker run --rm \
  -v "$HOME/.kiro:/root/.kiro:ro" \
  -v "$(pwd)/reviews-out:/app/reviews" \
  code-review-node owner/repo-name
```

Utiliser **read/write** sur `~/.kiro` si la CLI doit rafraichir les tokens (`:rw` au lieu de `:ro`).

Repos Git prives via SSH (monter les cles ; durcir les permissions cote hote) :

```bash
docker run --rm \
  -v "$HOME/.ssh:/root/.ssh:ro" \
  -v "$HOME/.kiro:/root/.kiro:ro" \
  -v "$(pwd)/reviews-out:/app/reviews" \
  code-review-node git@github.com:org/private-repo.git
```

Si le build de l'image echoue a l'installation Kiro (archi, air-gapped, etc.), installer Kiro dans un conteneur en interactif ou basculer sur une execution Node sans Docker.

## Execution sur AWS EC2 (exemple)

Ces etapes supposent une instance **Ubuntu 22.04/24.04** ou **Amazon Linux 2023** avec sortie HTTPS (clone + Kiro).

### 1. Installer Docker sur l'instance

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

### 2. Deployer l'application sur le serveur

```bash
git clone <your-fork-or-repo-url> code-review-node
cd code-review-node
docker build -t code-review-node .
```

### 3. Authentification Kiro sur serveur headless

La CLI Kiro doit etre **connectee** avant que `--no-interactive` fonctionne. Options pratiques :

- **Copier les credentials depuis ton poste** (apres `kiro-cli login` local): copier `~/.kiro` vers l'instance (ex: `scp -r ~/.kiro ec2-user@<host>:~/.kiro`), puis monter en RO ou RW comme dans les exemples Docker.
- **Faire un login interactif ponctuel** sur l'instance (l'entrypoint de l'image est la CLI de review, donc le surcharger) :  
  `docker run -it --rm --entrypoint bash -v "$HOME/.kiro:/root/.kiro" code-review-node -lc 'kiro-cli login && kiro-cli whoami'`

Voir la documentation [Kiro CLI authentication](https://kiro.dev/docs/cli/) pour le flux recommande.

### 4. Exemple de lancement de revue sur EC2

```bash
mkdir -p ~/reviews-out
docker run --rm \
  -v "$HOME/.kiro:/root/.kiro:ro" \
  -v "$HOME/reviews-out:/app/reviews" \
  code-review-node expressjs/express
ls ~/reviews-out
```

### 5. Notes de securite pour la production

- Restreindre les **security groups** (SSH depuis IPs connues uniquement).
- Preferer les **roles IAM d'instance** pour l'acces API AWS quand possible ; Kiro peut conserver son propre mode d'authentification.
- Ne pas embarquer les **cles SSH privees** ni **`~/.kiro`** dans l'image ; monter au runtime ou utiliser un gestionnaire de secrets.
- Pour les repos **GitHub prives**, utiliser une **deploy key** ou un **PAT** a privileges minimaux ; monter `~/.ssh` ou configurer `git credential` dans un volume.

## License

MIT
