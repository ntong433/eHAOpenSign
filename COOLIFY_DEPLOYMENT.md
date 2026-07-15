# Coolify production deployment

Deploy `docker-compose.yml` from the `main` branch and attach the public domain
to the `gateway` service only.

## Service and domain configuration

- `gateway`: domain `https://sign.lhinigeria.org`, container port `80`
- `client`: no public domain; internal port `3000`
- `server`: no public domain; internal port `8085`
- `mongo`: no public domain or published port; internal port `27017`

Do not add custom Compose networks or use generated container names as
upstreams. All four services use the Compose default network and the stable
service names `gateway`, `client`, `server`, and `mongo`.

## Required production environment

```dotenv
NODE_ENV=production
APP_ID=opensign
PUBLIC_URL=https://sign.lhinigeria.org
SERVER_URL=https://sign.lhinigeria.org/api/app
REACT_APP_SERVERURL=https://sign.lhinigeria.org/api/app
MONGODB_URI=mongodb://mongo:27017/opensign
DATABASE_URI=mongodb://mongo:27017/opensign
PARSE_MOUNT=/app
USE_LOCAL=true
GRAPH_DEFAULT_SENDER=helpdesk@lhinigeria.org
GRAPH_SERVICE_ACCOUNT=helpdesk@lhinigeria.org
```

Set `MASTER_KEY`, Microsoft credentials, certificate values, and any other
secrets in Coolify. Never put them in source control or frontend runtime
configuration. In particular, do not map either Graph email address to
`SERVER_URL`, `PUBLIC_URL`, `REACT_APP_SERVERURL`, or `PARSE_SERVER_URL`.

## Rebuild and verification

After changing the domain, environment, Caddyfile, or frontend runtime values,
run **Rebuild without cache** in Coolify. Then inspect the active gateway:

```sh
docker exec <gateway-container> cat /etc/caddy/Caddyfile
docker exec <gateway-container> wget -S -O- http://client:3000/
docker exec <gateway-container> wget -S -O- http://server:8085/health
docker exec <gateway-container> wget -S -O- http://127.0.0.1/health
docker logs --tail 300 <gateway-container> 2>&1 | grep -Ei 'dial|connect|refused|upstream|timeout|no such host|error'
```

Finally, verify the public routes:

```sh
curl -I https://sign.lhinigeria.org/
curl -i https://sign.lhinigeria.org/health
curl -i https://sign.lhinigeria.org/api/app
```

The root and health routes must return `200`. The Parse route may return an
application-level authorization response, but it must not return a proxy-level
`502` or `503`.
