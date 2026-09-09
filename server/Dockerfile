# Prompt Pocket adapter (v1 route + v2 pocket API). Build context is the repo
# root, AFTER `npm run build:server` has emitted server/dist:
#
#   npm run build:server
#   docker build -f server/Dockerfile -t prompt-pocket-server:<git-sha> .
#
# Runtime only: no npm install, no source, no secrets. Configuration is by
# environment variable at run time (see server/DEPLOYMENT.md).
FROM node:22-alpine

WORKDIR /app

# The compiled output is ESM; Node needs the root package.json ("type":
# "module") next to it to load server/dist/**/*.js as modules.
COPY package.json ./
COPY server/dist ./server/dist

# Fail the image build, not the first request, if this Node lacks node:sqlite.
RUN node -e "require('node:sqlite')"

# Drop root: the SQLite writer runs as the image's `node` user (uid 1000), the
# uid the bind-mounted data directory must be owned by (see DEPLOYMENT.md).
USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/dist/server/index.js"]
