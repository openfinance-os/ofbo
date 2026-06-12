# Nebras simulator container (Railway, demo profile — BD-14).
# Build context is the REPO ROOT (pnpm workspace): the Railway service sets
# RAILWAY_DOCKERFILE_PATH=services/nebras-sim/Dockerfile.
FROM node:22-alpine

WORKDIR /app
RUN corepack enable

# The frozen lockfile covers every workspace importer, so the whole (small)
# workspace is copied; only the simulator's subtree is installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY services ./services

RUN pnpm install --frozen-lockfile --filter @ofbo/nebras-sim...

ENV NODE_ENV=production
EXPOSE 8788
CMD ["pnpm", "--filter", "@ofbo/nebras-sim", "start"]
