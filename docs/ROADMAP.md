# 로드맵

openflirt는 연애 판단의 엔진이고, 사람이 쓰는 화면과 다른 에이전트가 부르는 입구를 그 위에 얹는다. 순서는 앞 단계가 뒤 단계의 재료가 되는 차례다.

| 순서 | 할 일 | 상태 | 놓일 곳 |
| --- | --- | --- | --- |
| 1 | 상대별 로컬 폴더, 증거 보관, 스크린샷 읽기, 타임라인, 게이지 | 됨 | `skills/crush/` |
| 2 | 미연시 화면: 상대 목록, 며칠째, 게이지, 마지막 대화, Next와 하트 루프 | 됨 | `bin/studio.mjs`, `studio/` |
| 3 | 추천에 대한 반응(하트, 보냄, 건너뜀)을 다음 질문에 넣기 | 됨 | `skills/crush/scripts/lib/agents.mjs` |
| 4 | MCP 서버: `list_crushes`, `add_evidence`, `timeline`, `next_action`을 도구로 내어 ChatGPT와 Claude 앱에서 부르기 | 다음 | `bin/mcp.mjs` |
| 5 | 봇 어댑터: Telegram, Discord 같은 메신저 봇이 MCP나 `--json` 러너를 부르는 얇은 층 | 그다음 | 별도 패키지 |
| 6 | 같은 상대의 대화가 여러 앱에 흩어질 때 겹치는 줄을 시각과 글로 합치기 | 그다음 | `skills/crush/scripts/lib/store.mjs` |
| 7 | 새 강의 `BjzAgcVfv9o`를 `$lecture-corpus`로 넣기 | 대기 | `corpus/` |

연동 대상(Grok 봇, Muse, OpenClaw 같은 에이전트 플랫폼)은 4번 MCP 서버와 `node bin/openflirt.mjs --json`의 JSON 계약(`schema/answer.schema.json`)을 그대로 부르는 쪽으로 붙인다. 플랫폼마다의 코드를 이 저장소에 두지 않는다.

