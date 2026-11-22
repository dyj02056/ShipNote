# 1단계: CLI(tsc → dist)와 웹 화면(vite → web/dist)을 빌드한다.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json tsconfig.build.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY web ./web
RUN npm run build && npm run web:build

# 2단계: 실행에 필요한 것만 담는다. 의존성은 fflate 하나다.
FROM node:24-alpine
# 저장소는 /repo에 마운트한다. 소유자가 달라도 git이 거부하지 않게 이 경로만 허용한다.
RUN apk add --no-cache git \
 && git config --system --add safe.directory /repo
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
# 산출물(out, shipnote.db)은 /work에 마운트한다. root가 아닌 node 사용자로 실행한다.
RUN mkdir /work && chown node:node /work
USER node
WORKDIR /work
ENV NODE_NO_WARNINGS=1
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["--help"]
