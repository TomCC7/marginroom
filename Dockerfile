# Enhanced derivative of Alexa Griffith's MIT-licensed markmyword.
FROM node:22.23.4-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

FROM node:22.23.4-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=development HOST=0.0.0.0 PORT=3939 HS_DB_PATH=/data/app.db HS_DOCS_DIR=/data/docs
COPY --from=build --chown=node:node /app /app
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3939
# Persist identity BEFORE importing guardrails (which reads env at import time).
# Development cookie mode is deliberate for loopback HTTP; set production behind HTTPS.
CMD ["node", "--input-type=module", "-e", "import fs from 'node:fs'; import crypto from 'node:crypto'; const p='/data/identity.json'; if(!fs.existsSync(p)){fs.writeFileSync(p,JSON.stringify({SESSION_SECRET:process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'),OWNER_KEY:process.env.OWNER_KEY||crypto.randomBytes(32).toString('hex')})+'\\n',{mode:0o600,flag:'wx'});} const s=JSON.parse(fs.readFileSync(p,'utf8')); for(const k of ['SESSION_SECRET','OWNER_KEY']){if(typeof s[k]!=='string'||s[k].length<32)throw Error('Invalid persisted identity: '+k); if(process.env[k]&&process.env[k]!==s[k])throw Error('Environment conflicts with persisted '+k);process.env[k]=s[k];} process.argv[1]='/app/server.js'; await import('./server.js');"]
