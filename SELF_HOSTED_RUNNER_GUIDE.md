# Guide: Relier son Mac comme GitHub Self-Hosted Runner (repo `code-review-node`)

Ce guide explique comment connecter ton Mac au repo `code-review-node` pour executer les workflows GitHub Actions localement (labels `self-hosted`, `macOS`).

---

## 1) Creer le runner cote GitHub

1. Ouvre le repo `code-review-node` sur GitHub.
2. Va dans `Settings` -> `Actions` -> `Runners`.
3. Clique sur `New self-hosted runner`.
4. Choisis `macOS`.
5. Garde cette page ouverte: elle contient les commandes d'installation/configuration.

---

## 2) Installer le runner sur ton Mac

Dans un terminal local macOS:

```bash
cd ~
mkdir -p actions-runner
cd actions-runner
```

Ensuite, copie-colle les commandes affichees par GitHub (download + extraction + config), par exemple:

```bash
curl -o actions-runner-osx-x64-<version>.tar.gz -L <URL_GITHUB>
tar xzf actions-runner-osx-x64-<version>.tar.gz
./config.sh --url https://github.com/zdahmed93/code-review-node --token <TOKEN_TEMPORAIRE>
```

### Pendant la config (`./config.sh`)

- `Runner name`: laisse par defaut ou mets un nom explicite (ex: `SFT-PAR-MBP3443`)
- `Runner labels`: garde au minimum `self-hosted,macOS`
- `Work folder`: defaut `_work` (OK)

---

## 3) Demarrer le runner

### Mode simple (manuel)

```bash
./run.sh
```

Laisse ce terminal ouvert.

### Mode service (recommande)

```bash
./svc.sh install
./svc.sh start
./svc.sh status
```

---

## 4) Verifier que tout est bien connecte

Dans GitHub:

- `Settings` -> `Actions` -> `Runners`
- Ton runner doit apparaitre `Online/Active`
- Labels visibles: `self-hosted`, `macOS`

---

## 5) Verifier le workflow

Le workflow doit cibler les bons labels:

```yaml
runs-on: [self-hosted, macOS]
```

Si les labels ne correspondent pas, le job reste en:
`Waiting for a runner to pick up this job...`

---

## 6) Pre-requis applicatifs sur le runner

Sur la machine runner, verifie:

```bash
node -v
kiro-cli whoami
```

Si `kiro-cli whoami` echoue, reconnecte Kiro:

```bash
kiro-cli login
kiro-cli whoami
```

---

## 7) Test rapide

Lance un workflow `workflow_dispatch` dans GitHub Actions.
Le run doit passer de `Queued` a `In progress` en quelques secondes.

---

## 8) Depannage rapide

### Probleme: `Waiting for a runner...`

- Runner offline / non demarre
- Labels non conformes (`runs-on` vs labels reels)
- Runner attache a un autre repo/org

### Probleme: `kiro-cli` introuvable

- Kiro CLI non installe sur le Mac runner
- PATH different en mode service

### Probleme: auth Kiro invalide

- Session expiree -> `kiro-cli login` sur le runner
- Verifier avec `kiro-cli whoami`

---

## 9) Reconfigurer le runner (si necessaire)

```bash
cd ~/actions-runner
./config.sh remove
./config.sh --url https://github.com/zdahmed93/code-review-node --token <NOUVEAU_TOKEN>
./run.sh
```

---

## 10) Bonnes pratiques

- Garder le runner dans un dossier dedie (`~/actions-runner`)
- Eviter de l'installer dans le repo de code
- Utiliser le mode service pour survivre aux redemarrages
- Garder des labels simples et coherents avec le workflow
- Limiter les secrets au strict necessaire dans GitHub Actions
