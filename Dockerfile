# Node + git + Kiro CLI for kiro-repo-review
# Build: docker build -t code-review-node .
# Run:   docker run --rm code-review-node --help

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates bash \
  && rm -rf /var/lib/apt/lists/*

# Official installer: https://kiro.dev/docs/cli/installation/
# Adjust PATH for typical install locations used by the script.
ENV PATH="/root/.local/bin:/usr/local/bin:${PATH}"
RUN set -eux \
  && curl -fsSL https://cli.kiro.dev/install | bash \
  && command -v kiro-cli

WORKDIR /app

COPY package.json ./
COPY bin ./bin
COPY prompts ./prompts
RUN mkdir -p reviews

ENTRYPOINT ["node", "/app/bin/kiro-repo-review.mjs"]
CMD ["--help"]
