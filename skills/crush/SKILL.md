---
name: crush
description: "썸 타는 상대를 한 명씩 등록하고, 그 상대와의 카톡 내보내기, 인스타 DM, 데이팅앱이나 메신저 스크린샷, 메모를 상대별 로컬 폴더에 쌓아 하나의 타임라인과 행동 수치로 묶은 뒤 OpenFlirt로 다음 행동을 고른다. 새 썸 상대 등록, 여러 상대 관리와 비교, 스크린샷에서 대화 읽기, 지금 우리 사이가 며칠째인지와 다음 행동을 묻는 요청에 쓴다."
---

# crush

상대 한 명이 폴더 하나다. 무엇을 넣든 원본은 그대로 남기고, 읽은 결과는 그 폴더의 타임라인에 시각 순으로 쌓인다. 판정과 다음 행동은 `$openflirt`가 그 타임라인을 읽고 정하고, 이 스킬은 모으고 세는 일만 한다.

폴더 뿌리는 `$OPENFLIRT_CRUSHES`, 없으면 저장소의 `crushes.local/`이다. 이름에 `.local`이 들어가 커밋되지 않는다. 대화와 사진은 상대의 개인 정보라 이 폴더 밖으로 옮기지 않는다.

## 순서

1. 등록: `node scripts/crush.mjs add <이름> [--id <id>] [--app <앱>] [--met YYYY-MM-DD] [--notes <메모>]`가 `<뿌리>/<id>/profile.json`을 만든다. `--met`은 처음 연락한 날이고 며칠째를 세는 기준이다.
2. 넣기: `node scripts/crush.mjs ingest <id> <파일>... [--me <내 이름>]`가 파일을 `evidence/`에 그대로 두고 `evidence.json`에 적는다. 같은 바이트는 한 번만 들어간다. 카톡 내보내기(.txt)는 `$kakaotalk-chat`의 파서로, `thread.json`(`$instagram-dm`이 쓴 것 포함)은 그대로 `threads/`에 들어간다. 대화의 어느 쪽이 나인지 모르면 종료 코드 2로 멈추니 `--me`를 준다.
3. 스크린샷 읽기: `node scripts/crush.mjs read <id> [--year 2026]`가 아직 안 읽은 이미지를 1600px 이하 JPEG로 줄여 `codex exec -i`에 한 번에 넘기고, 화면에 보이는 말풍선(오른쪽 나, 왼쪽 상대), 약속, 프로필 소개를 `events.jsonl`과 `profile.json`의 `notes`에 쓴다. 어느 앱의 화면이든 같은 꼴로 읽는다. ffmpeg가 PATH에 있어야 한다. 읽은 뒤 `timeline`으로 몇 줄을 원본 스크린샷과 대조하고, 틀린 줄은 `event`로 바로잡는다.
4. 손으로 더하기: `node scripts/crush.mjs event <id> --at YYYY-MM-DDTHH:MM --kind message|meet|plan|call|profile|note [--who me|her] --text <글>`. 만난 날은 `meet`, 잡힌 약속은 그 약속 시각의 `plan`이다. 스크린샷도 내보내기도 없는 사실(통화, 실제로 만난 일)은 이렇게 넣는다.
5. 사진: `node scripts/crush.mjs photo <id> <이미지>`가 스튜디오에 띄울 사진을 정한다. 투명 배경 PNG는 서 있는 그림으로, 나머지는 액자로 그린다.
6. 보기: `node scripts/crush.mjs timeline <id>`는 모든 대화와 이벤트를 시각 순으로 합친 목록이고, `node scripts/crush.mjs state <id> [--now YYYY-MM-DDTHH:MM]`은 며칠째, 단계(만남 전, 약속 잡힘, 만남 N번), 다음 약속, 최근 14일 먼저 연 대화와 답장 중앙값, 게이지를 낸다.
7. 다음 행동: `node scripts/crush.mjs next <id> [--runtime codex|claude] [--ask <질문>]`가 상대 메모, 센 값, 최근 기록 60줄, 지난 추천 세 개와 내 반응을 한 질문으로 묶어 `bin/openflirt.mjs --json`에 넘기고, 검사를 통과한 답을 `decisions.jsonl`에 쌓는다. `node scripts/crush.mjs feedback <id> <추천 id> <like|sent|skip>`이 그 추천에 대한 반응을 적고, 다음 추천의 질문에 들어간다.
8. `node scripts/crush.mjs list`는 등록한 상대 전부다.

같은 일을 화면으로 하려면 저장소 뿌리에서 `node bin/studio.mjs --open`을 띄운다. 등록 폼은 없고 입력창 하나뿐이다. 던진 파일은 `scripts/lib/store.mjs`의 `routeFile`이 상대를 정하고, 같은 창의 글은 `scripts/lib/agents.mjs`의 `askNext`로 OpenFlirt에 간다. 화면의 글과 답은 상대 폴더의 `chat.jsonl`에 남는다.

## 상대 가리기

`routeFile`은 파일이 스스로 밝힌 이름만 읽는다. 카톡 내보내기는 머리글과 말한 사람, `thread.json`은 제목과 참가자, 카톡 파일 이름이 그 이름이다. 이름은 앞의 번호와 공백, 님·씨 같은 호칭을 떼고 비교하고, 상대의 이름이나 별칭과 같으면 그 상대, 두 글자 이상에서 한쪽이 다른 쪽을 품으면(서빈과 박서빈) 그 상대다. 맞는 상대가 하나면 그리로 넣고 그 이름을 별칭으로 더한다. 둘 이상이면 고르게 묻고, 하나도 없으면 그 이름으로 새 상대를 만든다. 이름이 없는 파일은 열려 있는 상대에 넣는다. 열린 상대도 없는 스크린샷은 먼저 읽어 화면에 보이는 이름으로 같은 규칙을 쓴다. 게이지나 대화 내용으로 상대를 짐작하지 않는다.

## 게이지와 판정

게이지는 `scripts/lib/store.mjs`의 `computeState`가 정한 합이다. 잡힌 약속이나 만남 30, 최근 14일 먼저 연 대화 중 상대 몫 25, 상대 답장 중앙값 20, 대화에서 상대 메시지 비중 15, 상대 마지막 메시지가 며칠 전인지 10. 항목마다 근거 문장이 같이 나온다. 여러 상대를 비교할 때 이 순서로 줄을 세우지만, 판정과 할 일은 `$openflirt`의 표대로 행동으로 정하고 게이지로 정하지 않는다. 강의대로 만남에 응하는지가 가장 크게 잡혀 있다.

## 폴더

- `profile.json`: `{ id, name, app, metOn, photo, notes, createdAt }`
- `evidence/`, `evidence.json`: 받은 파일과 그 목록(`{ file, sha256, kind, source, addedAt, read, thread }`, `kind`는 kakaotalk, thread, image, text, other).
- `threads/`: 대화 하나당 `thread.json` 하나와, 카톡이면 `transcript.md`.
- `events.jsonl`: 한 줄에 `{ at, who, kind, text, source }`. `who`는 me, her, null.
- `decisions.jsonl`: 한 줄에 OpenFlirt의 판정, 할 일, 보낼 말, 답, 인용과 `feedback`.

## 종료 코드

`scripts/crush.mjs`는 0 끝남, 1 모델 실행(codex, OpenFlirt) 실패, 2 인자가 틀렸거나 없는 상대거나 형식이 아닌 입력이다. 결과는 표준 출력에 JSON으로 낸다.
