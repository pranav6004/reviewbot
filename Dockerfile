FROM node:24-slim AS base
WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY packages/diff/package.json ./packages/diff/
COPY packages/config/package.json ./packages/config/
COPY packages/llm/package.json ./packages/llm/
COPY packages/review-core/package.json ./packages/review-core/
COPY packages/github/package.json ./packages/github/
COPY packages/persistence/package.json ./packages/persistence/
COPY apps/server/package.json ./apps/server/

RUN npm install

# Copy source and configurations
COPY tsconfig*.json ./
COPY packages ./packages
COPY apps ./apps

# Build all packages
RUN npm run build

# Volume for SQLite persistence
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3000
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/reviewbot.sqlite

CMD ["node", "apps/server/dist/index.js"]
