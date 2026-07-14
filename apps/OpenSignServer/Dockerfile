FROM node:20-bookworm-slim AS deps

WORKDIR /usr/src/app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY apps/OpenSignServer/package*.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runner

WORKDIR /usr/src/app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libreoffice fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8085

COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY apps/OpenSignServer ./
COPY config ./config
COPY custom /usr/custom
RUN mkdir -p files

EXPOSE 8085
CMD ["npm", "start"]
