# 로드맵

OpenFlirt는 연애 판단의 엔진이고, 사람이 쓰는 화면과 다른 에이전트가 부르는 입구를 그 위에 얹는다. 웹을 먼저 내고, 앞 단계가 뒤 단계의 재료가 되는 차례로 간다.

| 순서 | 할 일 | 상태 | 놓일 곳 |
| --- | --- | --- | --- |
| 1 | 상대별 로컬 폴더, 증거 보관, 스크린샷 읽기, 타임라인, 게이지 | 됨 | `skills/crush/` |
| 2 | 미연시 스튜디오: 장면, 하트 게이지, 대화창, 타임라인 페이지 넘김 | 됨 | `bin/studio.mjs`, `studio/` |
| 3 | 입력창 하나: 파일, 스크린샷, URL을 던지면 이름으로 상대를 가려 넣고 같은 창에서 묻는다 | 됨 | `skills/crush/scripts/lib/store.mjs`의 `routeFile` |
| 4 | 모델 고르기: Codex와 Claude Code의 모델별 실행 | 됨 | `bin/studio.mjs`의 `models` |
| 5 | MCP 서버: `list_crushes`, `add_evidence`, `timeline`, `next_action`을 도구로 내어 ChatGPT와 Claude 앱에서 부르기 | 다음 | `bin/mcp.mjs` |
| 6 | 호스팅 웹 버전과 계정, 상대 폴더의 암호화 저장 | 다음 | 별도 서비스 |
| 7 | OpenFlirt Premium: 월 구독. ChatGPT, Claude 앱 같은 에이전트에서 내 상대 폴더를 부르는 연동(5번 MCP 서버 위)과 데이팅앱 연동(10번), 상대 수, 스크린샷 읽기, 모델 사용량 | 다음 | 호스팅 웹 버전 위 |
| 8 | 카카오톡 CLI 연동: 내보내기 없이 대화방을 바로 읽기 | 그다음 | `skills/kakaotalk-chat/` |
| 9 | 인스타그램 아이디 연동: 대화방 주소 대신 아이디로 DM 읽기 | 그다음 | `skills/instagram-dm/` |
| 10 | 데이팅앱 연동: 피클, 뮤즈처럼 여러 앱의 대화와 프로필을 한 상대로 모으기 | 그다음 | 앱마다 리더 스킬 |
| 11 | iOS, Android 앱: 공유 시트로 스크린샷과 대화를 바로 넣기 | 그다음 | 별도 저장소 |
| 12 | 봇 어댑터: Grok 봇, Muse, OpenClaw 같은 플랫폼이 MCP나 `--json` 러너를 부르기 | 그다음 | 별도 패키지 |
| 13 | 새 강의 `BjzAgcVfv9o`를 `$lecture-corpus`로 넣기 | 대기 | `corpus/` |

연동 대상 플랫폼마다의 코드는 이 저장소에 두지 않고, MCP 서버와 `schema/answer.schema.json`의 JSON 계약을 부르는 쪽으로 붙인다.
