// 테스트용 샘플 저장소를 만든다: node scripts/make-sample-repo.mjs [경로]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const dir = process.argv[2] ?? '.sample-repo';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' }).toString();
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'Sample Dev');
git('config', 'user.email', 'dev@example.com');
git('config', 'commit.gpgsign', 'false');
git('config', 'tag.gpgsign', 'false');

let n = 0;
function commit(msg) {
  writeFileSync(`${dir}/file.txt`, String(++n)); // 매 커밋마다 파일 내용을 바꿔 변경분을 만든다
  git('add', '-A');
  git('commit', '-q', '-m', msg);
}

const scopes = ['api', 'ui', 'db', 'cli', 'auth'];
const subjects = {
  feat: ['사용자 검색 추가', '내보내기 옵션 추가', '알림 설정 추가', 'CSV 가져오기'],
  fix: ['빈 목록에서 오류 수정', '시간대 계산 오류 수정', '중복 저장 방지', '로그인 만료 처리'],
  docs: ['README 보강', 'API 문서 갱신'],
  chore: ['의존성 갱신', '빌드 스크립트 정리'],
  refactor: ['저장소 계층 분리'],
  test: ['경계값 테스트 추가'],
  perf: ['목록 조회 속도 개선'],
};
const types = Object.keys(subjects);

function batch(count) {
  for (let i = 0; i < count; i++) {
    const t = types[i % types.length];
    const list = subjects[t];
    const scope = i % 3 === 0 ? `(${scopes[i % scopes.length]})` : '';
    commit(`${t}${scope}: ${list[i % list.length]} #${n + 1}`);
  }
}

batch(50);
commit('Merge branch feature-x'); // 형식이 아닌 메시지 → '기타'
commit('초기 설정 정리'); // 한글 비표준 메시지
git('tag', 'v0.1.0');

batch(45);
commit('feat(api)!: 응답 형식을 v2로 변경'); // breaking
commit('fix: 긴 메시지 처리\n\n본문에 줄바꿈이 있어도 파싱돼야 한다.');
commit('WIP');
git('tag', 'v0.2.0');

batch(10);
console.log(`샘플 저장소 생성: ${dir} (커밋 ${git('rev-list', '--count', 'HEAD').trim()}건, 태그 v0.1.0 v0.2.0)`);
