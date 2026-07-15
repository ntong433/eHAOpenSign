FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY apps/OpenSign/package*.json ./apps/OpenSign/
WORKDIR /app/apps/OpenSign
RUN npm config set fetch-retries 10 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci --registry=https://registry.npmmirror.com

WORKDIR /app
COPY custom ./custom
COPY apps/OpenSign ./apps/OpenSign

WORKDIR /app/apps/OpenSign
ARG REACT_APP_APPID=opensign
ARG REACT_APP_SERVERURL=/api/app
ARG REACT_APP_ENTERPRISE_PRODUCT_NAME="Life Helpers Signature Portal"
ARG REACT_APP_ENTERPRISE_COMPANY_NAME="Life Helpers Initiative"
ARG REACT_APP_ENTERPRISE_META_DESCRIPTION="Enterprise document management and e-signature platform."
ARG VITE_APPID=opensign
ARG VITE_MICROSOFT_CLIENT_ID=
ARG VITE_MICROSOFT_TENANT_ID=
ARG VITE_MICROSOFT_REDIRECT_URI=https://sign.lhinigeria.org/api/auth/microsoft/callback
ENV GENERATE_SOURCEMAP=false
ENV REACT_APP_APPID=$REACT_APP_APPID
ENV REACT_APP_SERVERURL=$REACT_APP_SERVERURL
ENV REACT_APP_ENTERPRISE_PRODUCT_NAME=$REACT_APP_ENTERPRISE_PRODUCT_NAME
ENV REACT_APP_ENTERPRISE_COMPANY_NAME=$REACT_APP_ENTERPRISE_COMPANY_NAME
ENV REACT_APP_ENTERPRISE_META_DESCRIPTION=$REACT_APP_ENTERPRISE_META_DESCRIPTION
ENV VITE_APPID=$VITE_APPID
ENV VITE_MICROSOFT_CLIENT_ID=$VITE_MICROSOFT_CLIENT_ID
ENV VITE_MICROSOFT_TENANT_ID=$VITE_MICROSOFT_TENANT_ID
ENV VITE_MICROSOFT_REDIRECT_URI=$VITE_MICROSOFT_REDIRECT_URI
RUN npm run build \
  && sed -i '/<head>/a\<script src="/env.js"></script>' build/index.html

FROM node:20-bookworm-slim AS runner

WORKDIR /usr/src/app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app/apps/OpenSign/build ./build
COPY apps/OpenSign/server.cjs ./server.cjs
COPY apps/OpenSign/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.cjs"]
