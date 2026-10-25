# openflirt

openflirt는 연애·플러팅 하네스다. 마픽스(마튜브) 강의 「여자가 남자를 좋아하게 되는 과정 [완벽 총정리]」(https://youtu.be/RhfqIi3DmWU)의 철학을 에이전트가 따르는 규칙과 스킬로 옮겨, 사람이 던진 질문에 답하고 다른 프로그램이 자동화의 바탕으로 부를 수 있게 한다. 사람이 쓰는 법은 README.md가, 에이전트가 지킬 규칙은 이 파일이 맡는다.

## 연애 질문에 답할 때

- 연애, 썸, 플러팅 질문이면 "걔가 읽씹했는데"처럼 가볍게 물어도 `$openflirt` 스킬([skills/openflirt/SKILL.md](skills/openflirt/SKILL.md))을 읽고, 그 판단 순서와 답하는 법과 openflirt가 정한 규칙대로 답한다. `bin/openflirt.mjs`가 띄우는 codex와 claude 세션도 이 저장소에서 돌아 이 줄을 읽는다.
- 호출한 쪽이 스키마를 주면 `schema/answer.schema.json`에 맞는 JSON 하나만 낸다.

## 저장소 지도

- `skills/openflirt/`: 하네스. `SKILL.md`(판정과 할 일, 답하는 법, 규칙), `references/part1.md`~`part3.md`(원칙 48개와 강의 원문 인용), `references/glossary.md`(용어집).
- `skills/lecture-corpus/`: 강의 영상 하나를 `corpus/<영상 id>/`로 만드는 스킬과 스크립트. 새 강의는 이것을 따라 넣는다.
- `corpus/RhfqIi3DmWU/`: 강의 전문 `transcript.md`, 소제목 결정 `sections.json`, 표기 결정 `divergence.md`, 원칙 대응표 `coverage.md`.
- `schema/answer.schema.json`: `--json` 답의 계약.
- `bin/openflirt.mjs`, `scripts/lib/cli.mjs`, `scripts/lib/agent.mjs`: 헤드리스 러너. `scripts/check.mjs`와 나머지 `scripts/lib/`: 저장소 검사. `test/`: node:test 테스트.
- `.agents/skills/`, `.claude/skills/`: 두 런타임이 스킬을 찾는 링크. git에 모드 120000 링크로 들어간다.

## 명령

- `node bin/openflirt.mjs [--json] [--runtime codex|claude] [--model <id>] [--timeout <초>] 질문`: 질문 하나에 답한다. 질문을 주지 않으면 표준 입력에서 읽는다. 기본 런타임은 읽기 전용 샌드박스의 `codex exec`이고, `--json`이면 스키마를 통과한 JSON만 낸다. 빈 질문과 잘못된 옵션은 종료 코드 2, 런타임 실패와 스키마 위반은 1이다.
- `npm test`: 테스트 전부와 저장소 검사. `node scripts/check.mjs`: 저장소 검사만. CI(`.github/workflows/check.yml`)가 푸시마다 둘 다 돌린다.

## 검사

`node scripts/check.mjs`는 `scripts/lib/checks.mjs`의 목록을 돈다.

- skills: `SKILL.md` 앞머리와 `agents/openai.yaml`을 YAML 파서로 읽어 skill-creator 규칙을 적용하고, `scripts/`의 스크립트마다 `SKILL.md`가 이름을 부르는지 본다.
- symlinks: `.agents/skills/`와 `.claude/skills/`의 링크가 git 색인에 스킬마다 링크로 있는지 본다.
- principles, quotes: 원칙마다 `<a id>`, `###` 제목, `> [mm:ss]` 인용 줄이 있고, 인용이 그 시각 75초 앞부터 15초 뒤 사이에 시작하는 문단에 띄어쓰기와 문장부호만 빼고 글자 그대로 있는지 본다.
- transcript, coverage: 전문 문단이 `[mm:ss](https://youtu.be/<id>?t=초)`로 시작하고 시각이 거꾸로 가지 않는지, `coverage.md`가 소제목마다 한 줄씩 있고 모든 원칙이 어느 줄엔가 나오는지 본다.
- anchors: references로 가는 링크와 `#앵커`가 있는지 본다.
- schema: 스키마가 ajv strict(draft 2020-12)로 컴파일되고 Structured Outputs strict 부분집합 안에 있으며, 원칙 id enum이 원칙 목록과 같은지 본다.

원칙의 `판단에 쓰는 법`이 `SKILL.md` 판정 표와 맞는지, 한국어 표현이 강의의 결을 살리는지는 검사가 판단하지 못한다. 원칙을 더하거나 고치면 그 부분을 전문과 대조하는 독립된 읽기를 둘 이상 받아 받은 글 그대로 `.omo/` 아래 파일로 남기고, 각 지적은 인용된 강의 원문으로 가린다.

테스트는 가짜 codex로 러너가 만드는 인자와 답 읽기만 확인하고, 실제 런타임이 그 인자와 스키마를 받는지는 확인하지 못한다. 러너나 스키마를 바꾸면 `--json` 실제 실행을 `--runtime codex`와 `--runtime claude`로 한 번씩 한다.

## 저장소 규칙

- 철학과 스킬의 원문은 한국어로 쓴다. 강의에서 온 말(프레임, 어트, 밑밥, 스탠다드, 서브텍스트, 궁핍함, 애매함, 마찰, 방생, 하수와 고수 같은 말)은 강의가 쓴 그대로 쓰고, 다른 말로 바꾸거나 번역하지 않는다.
- 판정과 할 일의 뜻은 `SKILL.md`의 두 표가 정본이다. 스키마의 description은 `--json` 호출자와 모델에게 가는 요약이라, 표를 바꾸면 같이 바꾼다.
- 원칙을 더하면 그 id를 스키마의 principles enum과 `coverage.md`의 해당 소제목 줄에 함께 넣는다. 빠지면 `node scripts/check.mjs`가 잡는다.
- Claude Code의 `--json-schema`는 `$schema`가 draft 2020-12를 가리키는 스키마를 거부한다. 러너는 claude에 보낼 때만 그 줄을 빼므로(`claudeSchemaJson`), 스키마에 draft 2020-12에만 있는 키워드를 쓰지 않는다.
- 커밋 메시지는 영어로 쓴다. 제목은 `type(scope): problem`, 본문은 바뀐 것마다 `- ` 한 줄이며, `hooks/commit-msg`가 커밋마다, `.github/workflows/commits.yml`이 푸시와 풀 리퀘스트마다 같은 규칙을 검사한다.
- 스킬의 `scripts/`에 둔 스크립트마다 그 스킬의 `SKILL.md`가 이름을 부르고 무엇을 읽어 무엇을 쓰는지 말한다. 이름이 빠진 스크립트는 `node scripts/check.mjs`가 잡는다.
- `.omo/`와 `.re0/`는 로컬 작업 상태라 커밋하지 않는다.
