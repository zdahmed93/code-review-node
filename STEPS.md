# STEPS - Reproduire le setup complet (local + GitHub)

Ce guide permet a un autre developpeur de reproduire rapidement tout le setup:

- execution locale de `code-review-node`,
- configuration runner self-hosted sur Mac,
- configuration GitHub Actions,
- declenchement depuis un repo externe,
- verification de bout en bout.

---

## 0) Prerequis

- macOS (ou machine capable d'executer un runner self-hosted)
- Node.js 18+ (22 recommande)
- git
- compte GitHub avec acces aux repos concernes
- Kiro CLI installe + session valide

Verifier localement:

```bash
node -v
git --version
kiro-cli whoami
```

---

## 1) Recuperer le projet orchestrateur

```bash
git clone <URL_DU_REPO_CODE_REVIEW_NODE>
cd code-review-node
```

Commandes utiles:

```bash
node bin/kiro-repo-review.mjs --help
```

---

## 2) Configurer le runner self-hosted (Mac)

Reference detaillee: `SELF_HOSTED_RUNNER_GUIDE.md`

### 2.1 Cote GitHub

Dans le repo `code-review-node`:

- `Settings` -> `Actions` -> `Runners` -> `New self-hosted runner` (macOS)

### 2.2 Cote machine locale

```bash
cd ~
mkdir -p actions-runner
cd actions-runner
```

Copier/coller les commandes affichees par GitHub (download/extract/config), puis:

```bash
./run.sh
```

Ou en service:

```bash
./svc.sh install
./svc.sh start
./svc.sh status
```

### 2.3 Verification

Dans GitHub `Settings` -> `Actions` -> `Runners`:

- runner `Online/Active`
- labels contenant `self-hosted` et `macOS`

Le workflow du repo est pinne sur:

```yaml
runs-on: [self-hosted, macOS]
```

---

## 3) Secrets GitHub dans le repo orchestrateur

Dans `code-review-node` -> `Settings` -> `Secrets and variables` -> `Actions`:

Ajouter:

- `REVIEW_GITHUB_TOKEN`

Ce token sert a push une branche et creer une PR dans le repo analyse.

Permissions recommandees (fine-grained):

- Repository access: repos a analyser
- Contents: Read and write
- Pull requests: Read and write

---

## 4) Test manuel rapide (workflow_dispatch)

Dans `code-review-node` -> `Actions` -> `Auto Review External Repos` -> `Run workflow`:

- `target_repo`: `owner/repo`
- `pr_base`: optionnel (sinon branche par defaut)

Resultat attendu:

1. run demarre sur runner self-hosted
2. review executee
3. PR creee dans le repo analyse avec rapport dans `docs/code-reviews/`

---

## 5) Declenchement depuis un repo externe (tag)

Dans le repo externe, ajouter un workflow:

```yaml
name: Trigger code-review-node on tag

on:
  push:
    tags:
      - "review-*"

jobs:
  trigger-orchestrator:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch review request to orchestrator
        env:
          ORCH_OWNER: <owner_or_org_orchestrateur>
          ORCH_REPO: code-review-node
          ORCH_PAT: ${{ secrets.ORCH_PAT }}
          TARGET_REPO: ${{ github.repository }}
        run: |
          set -euo pipefail
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

Dans le repo externe, ajouter le secret:

- `ORCH_PAT`

Ce PAT doit pouvoir appeler:

- `POST /repos/<owner>/code-review-node/dispatches`

Permissions minimales observees:

- Contents: Write sur `code-review-node`

---

## 6) Test tag depuis repo externe

Dans le repo externe:

```bash
git tag review-2026-04-03
git push origin review-2026-04-03
```

Verification:

1. workflow du repo externe passe (dispatch OK)
2. workflow `Auto Review External Repos` demarre dans `code-review-node`
3. PR automatique creee dans le repo externe

---

## 7) Troubleshooting rapide

### A) "Waiting for a runner to pick up this job..."

- runner offline/non lance
- labels mismatch (`runs-on` vs labels runner)
- runner attache au mauvais repo

### B) "Kiro auth is not valid on this runner"

Sur la machine runner:

```bash
kiro-cli login
kiro-cli whoami
```

### C) 403 "Resource not accessible by personal access token" (dispatch)

Le token `ORCH_PAT` est insuffisant ou scope incorrect.
Verifier permissions et repo scope du PAT.

### D) 403 push denied lors de creation PR

Le `REVIEW_GITHUB_TOKEN` n'a pas les droits write sur le repo analyse.

---

## 8) Checklist finale (Go/No-Go)

- [ ] Runner self-hosted online avec labels `self-hosted,macOS`
- [ ] `kiro-cli whoami` OK sur machine runner
- [ ] Secret `REVIEW_GITHUB_TOKEN` configure dans `code-review-node`
- [ ] Secret `ORCH_PAT` configure dans le repo externe
- [ ] Test `workflow_dispatch` OK
- [ ] Test tag externe -> dispatch -> review -> PR OK

---

## 9) Commandes utiles

### Lancer localement sans workflow

```bash
node bin/kiro-repo-review.mjs --github-pr --github-token "$REVIEW_GITHUB_TOKEN" owner/repo
```

### Afficher l'aide CLI

```bash
node bin/kiro-repo-review.mjs --help
```

