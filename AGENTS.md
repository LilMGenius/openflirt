# openflirt

openflirt는 연애·플러팅 하네스다. 마픽스(마튜브) 강의 「여자가 남자를 좋아하게 되는 과정 [완벽 총정리]」(https://youtu.be/RhfqIi3DmWU)와 「여자가 쉽게 자신을 허락하는 남자 특징」(https://youtu.be/F05nX3MKCD0)의 철학을 에이전트가 따르는 규칙과 스킬로 옮겨, 사람이 던진 질문에 답하고 다른 프로그램이 자동화의 바탕으로 부를 수 있게 한다. 사람이 쓰는 법은 README.md가, 에이전트가 지킬 규칙은 이 파일이 맡는다.

## 연애 질문에 답할 때

- 연애, 썸, 플러팅 질문이면 "걔가 읽씹했는데"처럼 가볍게 물어도 `$openflirt` 스킬([skills/openflirt/SKILL.md](skills/openflirt/SKILL.md))을 읽고, 그 판단 순서와 답하는 법과 openflirt가 정한 규칙대로 답한다. `bin/openflirt.mjs`가 띄우는 codex와 claude 세션도 이 저장소에서 돌아 이 줄을 읽는다.
- 호출한 쪽이 스키마를 주면 `schema/answer.schema.json`에 맞는 JSON 하나만 낸다.

## 저장소 지도

- `skills/openflirt/`: 하네스. `SKILL.md`(판정과 할 일, 답하는 법, 규칙), `references/part1.md`~`part3.md`(첫 강의의 원칙과 원문 인용), `references/part4.md`(두 번째 강의의 원칙과 원문 인용), `references/glossary.md`(용어집), `scripts/behaviors.mjs`(`$kakaotalk-chat`과 `$instagram-dm`이 쓰는 `thread.json`을 주별 행동과 만남 제안 목록으로 센다. 테스트는 `test/behaviors.test.mjs`).
- `skills/lecture-corpus/`: 강의 영상 하나를 `corpus/<영상 id>/`로 만드는 스킬과 스크립트. 받기, Whisper 전사, 화면 자막 읽기는 공통 스킬 `video-transcript`(LilMGenius/skills)가 맡고, 이 스킬은 전문을 짓고 고치는 단계만 둔다. 새 강의는 이것을 따라 넣는다.
- `skills/kakaotalk-chat/`: 카카오톡 대화 내보내기(.txt)를 `thread.json`과 `transcript.md`로 바꾸는 스킬. `scripts/parse.mjs`가 파일을 받아 쓰고 `scripts/lib/export.mjs`가 줄을 푼다. 테스트는 `test/kakaotalk-chat.test.mjs`.
- `skills/instagram-dm/`: 인스타그램 DM 대화방 하나를 BrowserSkill(`bsk`)로 읽어 같은 두 파일로 바꾸는 스킬. `scripts/read.mjs`가 브라우저에서 줄을 읽고 `scripts/lib/rows.mjs`가 정리한다. 테스트는 `test/instagram-dm.test.mjs`.
- `corpus/lectures.json`: 강의 목록. 강의마다 영상 id(`video`), 제목(`title`), 그 강의를 인용하는 원칙 파일(`parts`, 예: `part1.md`)을 차례로 둔다. 검사, 러너, 골든 평가가 모두 이 목록으로 강의를 찾는다.
- `corpus/<영상 id>/`: 강의마다 전문 `transcript.md`, 소제목 결정 `sections.json`, 표기 결정 `divergence.md`, 원칙 대응표 `coverage.md`.
- `schema/answer.schema.json`: `--json` 답의 계약.
- `llms.txt`, `llms-full.txt`: claude.ai나 chatgpt.com처럼 웹에서 이 저장소를 읽는 도구가 들어오는 곳(llmstxt.org 관례). 웹 도구는 받은 파일이 가리키는 다른 파일까지 따라가 읽지 않아서, `llms.txt`는 주요 파일을 raw 절대 주소로 모으고 `llms-full.txt`는 `SKILL.md`, 용어집, 강의 목록의 원칙 파일 전부를 상대 링크만 절대 주소로 바꿔 한 파일에 담는다. 둘 다 `scripts/lib/llms.mjs`가 짓는다.
- `eval/cases.json`: 골든 사례. 강의 풀이 사례(또는 SKILL.md 규칙)마다 강의가 말하는 판정과 할 일을 붙이고, 그 말을 밝힌 인용을 `source`에 둔다. `eval/routing.json`: 스킬이 맡아야 할 프롬프트와 맡지 않아야 할 프롬프트. `scripts/eval.mjs`와 `scripts/routing.mjs`가 이 둘을 읽어 돌리고, 사례 파일의 검사와 채점은 `scripts/lib/eval.mjs`, 라우팅 판정과 집계는 `scripts/lib/routing.mjs`에 있다.
- `bin/openflirt.mjs`, `scripts/lib/cli.mjs`, `scripts/lib/agent.mjs`: 헤드리스 러너. `scripts/check.mjs`와 나머지 `scripts/lib/`: 저장소 검사. `scripts/lib/corpus.mjs`는 둘이 함께 읽는 강의 목록을 읽어 검사하고 강의마다 전문의 위치를 정한다. `test/`: node:test 테스트.
- `.agents/skills/`, `.claude/skills/`: 두 런타임이 스킬을 찾는 링크. git에 모드 120000 링크로 들어간다.

## 명령

- `node bin/openflirt.mjs [--json] [--runtime codex|claude] [--model <id>] [--timeout <초>] 질문`: 질문 하나에 답한다. 질문을 주지 않으면 표준 입력에서 읽는다. 기본 런타임은 읽기 전용 샌드박스의 `codex exec`이고, `--json`이면 스키마를 통과하고 `citations`마다 그 `video` 강의 전문의 그 시각에 있는 JSON만 낸다. 인용 검사는 원칙 인용 검사와 같은 `quoteFinding`이다. 빈 질문과 잘못된 옵션은 종료 코드 2, 런타임 실패, 스키마 위반, 강의 목록에 없는 영상이나 전문에 없는 인용은 1이다.
- `npm test`: 테스트 전부와 저장소 검사. `node scripts/check.mjs`: 저장소 검사만. CI(`.github/workflows/check.yml`)가 푸시마다 둘 다 돌린다.
- `node scripts/llms.mjs [--check]`: `llms.txt`와 `llms-full.txt`를 다시 짓는다. `--check`는 아무것도 쓰지 않고, 낡은 파일 이름을 대며 1로 끝난다. `SKILL.md`, 용어집, 원칙 파일, `corpus/lectures.json`을 바꾸는 커밋은 이것을 돌린 결과를 함께 커밋한다. 빠지면 llms 검사가 잡는다.
- `node scripts/eval.mjs --runtime codex|claude [--model <id>] [--cases eval/cases.json] [--only id,id] --out <result.json>`: 골든 평가. 사례마다 러너(`bin/openflirt.mjs --json`)를 한 번씩 차례로 돌려 답의 판정과 할 일만 사례 라벨과 맞춰 채점하고 문장은 채점하지 않는다. 사례 하나가 유료 모델 실행 한 번이다. 사례 하나가 끝날 때마다 `--out`에 결과를 쓴다. `expect.action`이 목록이면 그중 하나면 맞다. `--rescore <result.json>`은 저장한 답을 현재 라벨로 다시 채점하며 아무것도 돌리지 않는다. 종료 코드는 끝까지 돌았으면 0이다. 러너가 실패한 사례는 `failed`로 기록할 뿐 종료 코드를 바꾸지 않는다. 옵션이 틀리거나 `--out`이 없거나 `--only`가 없는 id를 부르거나 사례 파일이 검사를 통과하지 못하면 2다. 러너가 사용량·속도 제한으로 실패하면(`isLimitError`가 stderr에서 알아본다) 남은 사례를 `not_run`으로 적고 멈추며 1이다.
- `node scripts/routing.mjs --runtime codex|claude [--model <id>] [--only id,id] [--timeout <초>] --out <result.json>`: 라우팅 평가. `eval/routing.json`의 프롬프트 30개(스킬이 맡을 것 20개, 맡지 않을 것 10개)를 임시 폴더에서 하나씩 돌린다. 그 폴더는 `git init`만 하고 `.agents/skills/openflirt`와 `.claude/skills/openflirt` 링크 말고는 아무것도 없어 AGENTS.md도 CLAUDE.md도 읽히지 않으니, 스킬 앞머리의 description만으로 불러지는지 본다. 불러졌는지는 이벤트 스트림에서 도구 호출로만 정한다(codex는 `openflirt/SKILL.md`를 건드린 명령, claude는 `Skill` 호출이나 그 파일의 `Read`). 답에 openflirt라는 말이 있는 것은 세지 않는다. 결과는 `--out`에 혼동표(`tp`, `fn`, `fp`, `tn`, `notRun`, `accuracy`)로 쓰고, 프롬프트마다의 이벤트는 `--out` 옆 `events-<런타임>-<--out 파일 이름>/`에 남긴다. 프롬프트 하나가 유료 모델 실행 한 번이다. `--timeout` 기본은 420초다. 사용량 제한을 만나면 남은 프롬프트를 `not-run`으로 두고 멈추지만 종료 코드는 0이라, 결과의 `notRun`을 읽어야 한다. 옵션이 틀리면 2다.

## 검사

`node scripts/check.mjs`는 `scripts/lib/checks.mjs`의 목록을 돈다.

- skills: `SKILL.md` 앞머리와 `agents/openai.yaml`을 YAML 파서로 읽어 skill-creator 규칙을 적용하고, `scripts/`의 스크립트마다 `SKILL.md`가 이름을 부르는지 본다.
- symlinks: `.agents/skills/`와 `.claude/skills/`의 링크가 git 색인에 스킬마다 링크로 있는지 본다.
- principles, quotes: `corpus/lectures.json`이 꼴에 맞고 `part*.md`마다 꼭 한 강의에 올라 있으며 올라 있는 파일이 모두 있는지, 원칙마다 `<a id>`, `###` 제목, `> [mm:ss]` 인용 줄이 있고, 인용이 그 원칙 파일이 속한 강의 전문에서 그 시각 75초 앞부터 15초 뒤 사이에 시작하는 문단에 띄어쓰기와 문장부호만 빼고 글자 그대로 있는지 본다.
- transcript, coverage: 강의마다 전문 문단이 `[mm:ss](https://youtu.be/<id>?t=초)`로 시작하고 시각이 거꾸로 가지 않는지, 그 강의의 `coverage.md`가 소제목마다 한 줄씩 있고 그 강의의 원칙이 모두 어느 줄엔가 나오는지 본다.
- anchors: references로 가는 링크와 `#앵커`가 있는지 본다.
- schema: 스키마가 ajv strict(draft 2020-12)로 컴파일되고, 러너가 claude에 보내는 형태(`claudeSchemaJson`)도 ajv strict draft-07로 컴파일되며, Structured Outputs strict 부분집합 안에 있고, 원칙 id enum이 원칙 목록과, `citations`의 `video` enum이 강의 목록의 영상 id와 같은지 본다.
- eval: `eval/cases.json`의 사례 id가 겹치지 않고, `expect.verdict`와 `expect.action`이 스키마의 enum 값이며(할 일을 목록으로 주면 서로 다른 둘 이상), `question`과 `why`가 비어 있지 않고, 모든 `source.quote`가 제 시각에서 통과하는지 본다. 강의 인용은 원칙 인용과 같은 `quoteFinding` 규칙으로 `source.video` 강의의 전문과 맞춰 보고(`source.video`가 없으면 강의 목록의 첫 강의, 목록에 없는 영상이면 실패), `source.kind`가 `openflirt`인 사례는 인용이 `SKILL.md`에 있는지 본다. 골든 라벨이 맞는지, 라우팅 프롬프트가 맞는지는 검사가 판단하지 못한다.
- llms: 커밋한 `llms.txt`와 `llms-full.txt`가 `node scripts/llms.mjs`가 지금 짓는 글과 같은지 본다.

원칙의 `판단에 쓰는 법`이 `SKILL.md` 판정 표와 맞는지, 한국어 표현이 강의의 결을 살리는지는 검사가 판단하지 못한다. 원칙을 더하거나 고치면 그 부분을 전문과 대조하는 독립된 읽기를 둘 이상 받아 받은 글 그대로 `.omo/` 아래 파일로 남기고, 각 지적은 인용된 강의 원문으로 가린다.

테스트는 가짜 codex로 러너가 만드는 인자와 답 읽기만 확인하고, 실제 런타임이 그 인자와 스키마를 받는지는 확인하지 못한다. 러너나 스키마를 바꾸면 `--json` 실제 실행을 `--runtime codex`와 `--runtime claude`로 한 번씩 한다.

## 저장소 규칙

- 철학과 스킬의 원문은 한국어로 쓴다. 강의에서 온 말(프레임, 어트, 밑밥, 스탠다드, 서브텍스트, 궁핍함, 애매함, 마찰, 방생, 하수와 고수 같은 말)은 강의가 쓴 그대로 쓰고, 다른 말로 바꾸거나 번역하지 않는다.
- 판정과 할 일의 뜻은 `SKILL.md`의 두 표가 정본이다. 스키마의 description은 `--json` 호출자와 모델에게 가는 요약이라, 표를 바꾸면 같이 바꾼다.
- 원칙을 더하면 그 id를 스키마의 principles enum과 그 강의 `coverage.md`의 해당 소제목 줄에 함께 넣는다. 새 `part*.md`는 `corpus/lectures.json`에서 그 원칙이 인용하는 강의의 `parts`에 올리고, 새 강의는 목록과 스키마의 `video` enum에 함께 넣는다. 빠지면 `node scripts/check.mjs`가 잡는다.
- 원칙의 `판단에 쓰는 법`이 판정 표의 기본 할 일과 다른 할 일을 정하면, `SKILL.md` 상황별 원칙에 질문자가 말할 행동으로 그 원칙을 부르는 줄을 두고, 같은 질문에 함께 맞는 줄이 있으면 어느 줄이 먼저인지 쓴다. 테스트나 도발 같은 분류 이름에만 걸린 원칙은 모델이 찾지 못하고 기본 할 일로 답한다. 강의가 그 행동을 사례로 풀어 주면 `eval/cases.json`에도 넣어 골든 평가가 재게 한다.
- Claude Code의 `--json-schema`는 draft-07로 검사해서 `$schema`가 draft 2020-12를 가리키는 스키마를 거부한다. 러너는 claude에 보낼 때만 그 줄을 빼고(`claudeSchemaJson`), draft 2020-12에만 있는 키워드는 schema 검사가 잡는다.
- 커밋 메시지는 영어로 쓴다. 제목은 `type(scope): problem`, 본문은 바뀐 것마다 `- ` 한 줄이며, `hooks/commit-msg`가 커밋마다, `.github/workflows/commits.yml`이 푸시와 풀 리퀘스트마다 같은 규칙을 검사한다.
- 스킬의 `scripts/`에 둔 스크립트마다 그 스킬의 `SKILL.md`가 이름을 부르고 무엇을 읽어 무엇을 쓰는지 말한다. 이름이 빠진 스크립트는 `node scripts/check.mjs`가 잡는다.
- 두 읽기 스킬(`kakaotalk-chat`, `instagram-dm`)이 쓰는 `thread.json`의 꼴은 각 `SKILL.md`의 결과 절이 적고, `skills/openflirt/scripts/behaviors.mjs`의 `validateThread`가 한 곳에서 검사한다. 두 스킬의 테스트가 저마다 쓴 `thread.json`을 `validateThread`에 넣어 보니, 꼴을 한쪽만 바꾸면 `npm test`가 잡는다.
- `skills/openflirt/SKILL.md`, 원칙, 스키마, 러너를 건드리는 변경은 골든 평가를 `--runtime codex`와 `--runtime claude`로 돌리고, 마지막으로 저장한 결과의 `totals`와 견줘 판정과 할 일이 나빠졌는지 본다. 결과 파일은 `.omo/` 아래처럼 커밋하지 않는 곳에 둔다.
- `SKILL.md` 앞머리의 description을 건드리는 변경은 라우팅 평가를 두 런타임으로 돌린다.
- `.omo/`와 `.re0/`는 로컬 작업 상태라 커밋하지 않는다.
