# ShipNote

Git 태그 하나로 릴리스 노트, 변경 보고서, 전달용 zip(SHA-256 매니페스트 포함)을 만드는 CLI와 이력 조회 화면입니다. Node 24 이상이 필요합니다.

```
npm install
npm run sample                       # 테스트용 저장소(.sample-repo) 생성
node src/cli.ts release v0.1.0 --repo .sample-repo
node src/cli.ts release v0.2.0 --repo .sample-repo
node src/cli.ts verify out/shipnote-v0.2.0.zip
npm run web:build && node src/cli.ts serve   # http://127.0.0.1:4173
```

| 명령 | 설명 |
| --- | --- |
| `release <태그>` | 직전 태그부터 이 태그까지를 읽어 문서·zip을 만들고 DB에 기록. `--from`, `--webhook`, `--force` |
| `verify <zip>` | zip을 풀어 해시를 다시 계산. 어긋나면 종료 코드 1 |
| `ls` | 기록된 릴리스 목록 |
| `serve` | 이력 화면과 API(`/api/releases`) 서빙 |

커밋 메시지는 Conventional Commits를 가정하며, 형식이 아니면 '기타'로 분류합니다.

## Docker

```
docker build -t shipnote .
docker run --rm -v "$PWD:/repo" -v "$PWD/out-docker:/work" shipnote release v0.2.0 --repo /repo
```

## 테스트

`npm test` (파서·분류·렌더·패키징·검증·DB·API, 샘플 저장소 100건 이상 포함), `npm run typecheck`.

## 알려진 한계

- 병렬 파싱(worker_threads)은 넣지 않았습니다. 커밋 수천 건 이상에서 느려지면 추가합니다.
- 변경 요약(Ollama)은 아직 없습니다.
