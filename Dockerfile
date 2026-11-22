# Node 24는 .ts를 바로 실행하므로 빌드 단계가 없다. 웹 화면만 미리 빌드한다.
FROM node:24-alpine AS web
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src ./src
COPY web ./web
RUN npx vite build web

FROM node:24-alpine
RUN apk add --no-cache git \
 && git config --system --add safe.directory '*'
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY --from=web /app/web/dist ./web/dist
# 저장소는 /repo, 산출물은 /work(out, shipnote.db)에 마운트해서 쓴다.
WORKDIR /work
ENV NODE_NO_WARNINGS=1
ENTRYPOINT ["node", "/app/src/cli.ts"]
CMD ["--help"]
