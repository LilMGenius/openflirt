---
name: lecture-corpus
description: "강의 영상 하나를 openflirt 말뭉치 항목으로 만든다. YouTube 자동 자막으로 시각 링크가 달린 초안 전문과 소제목을 만들고, Whisper 전사와 화면 자막 OCR로 고친다. 새 강의를 openflirt에 넣거나 전문을 다시 고칠 때 쓴다."
---

# 강의 말뭉치

강의 영상 하나를 `corpus/<영상 id>/`에 넣는다. 입력이 정해지면 결과가 정해지는 단계는 `scripts/`의 스크립트가 하고, 뜻을 보고 고르는 단계는 판단해서 그 결정을 파일로 남긴다. 다음 스크립트가 그 파일을 읽으니, 다시 돌리면 기계 단계는 같은 결과를 내고 판단은 남긴 대로 되풀이된다.

## 만드는 것

- `transcript.md`: 강의 전문. 소제목(`##`, `###`) 아래 문단마다 한 줄이고, 문단은 `[mm:ss](https://youtu.be/<id>?t=초)`로 시작한다.
- `sections.json`: 소제목 결정. `["H2" 또는 "H3", "소제목", "앵커 구절"]`을 강의 순서대로 적는다. 앵커 구절은 그 소제목이 시작하는 말을 자동 자막에 나온 대로 적은 몇 낱말이고, 첫 항목은 `"__START__"`, 문단 없이 아래 소제목만 묶는 항목은 `""`이다.
- `divergence.md`: 출처가 갈린 철학어, 은어, 이름을 어떻게 적었는지의 기록.
- `coverage.md`: 소제목마다 그 구간을 담은 openflirt 원칙 id, 또는 `제외: 사유`.

## 순서

1. `node scripts/fetch.mjs <영상 URL> --out <작업 폴더> --audio --video`가 메타데이터(`<id>.info.json`), 원어 자동 자막(`<id>.ko-orig.json3`), 소리(`<id>.audio.*`)와 영상(`<id>.video.*`)을 받는다. 작업 폴더는 저장소 밖이나 `.omo/` 아래에 둔다.
2. 판단: 소제목을 정한다. `[["H2","전문","__START__"]]` 한 줄짜리 `sections.json`으로 3단계를 한 번 돌리면 통짜 초안이 나오니, 그것을 읽고 강의가 실제로 넘어가는 자리마다 소제목과 앵커 구절을 적는다. 강의 안내, 광고, 여담에도 소제목을 주어 전문에 남기고, 원칙에서 뺄지는 `coverage.md`에서 정한다.
3. `node scripts/draft.mjs --captions <json3> --meta <info.json> --sections <sections.json> --out corpus/<id>/transcript.md`가 초안 전문을 쓴다. 앵커 구절이 앞 소제목 뒤의 자막에 없으면 아무것도 쓰지 않고 멈춘다. 고치기 전에 이 초안부터 커밋하면 고친 내역이 diff로 남는다.
4. `uv run scripts/transcribe.py <소리 파일> --out <whisper.json> --prompt "<강의가 만든 말, 쉼표로>"`가 Whisper large-v3 전사를 쓴다. 프롬프트에는 영상 태그와 설명에 나오는 그 강의만의 말을 넣는다. CUDA가 없으면 `--device cpu --compute-type int8`로 돌리고, 몇 배 오래 걸린다.
5. 판단: 화면 자막이 놓이는 띠를 정한다. 장면 몇 개를 잘라 보고 자막이 들어가는 가로 띠를 `x,y,w,h`로 잡는다. 1080p 강의 RhfqIi3DmWU에서는 `240,810,1440,180`이었다.
6. `uv run scripts/subtitles.py <영상 파일> --band x,y,w,h --out <subtitles.json>`가 화면 자막을 시각이 붙은 사건 목록으로 읽는다.
7. `node scripts/readings.mjs --transcript corpus/<id>/transcript.md --video <id> --whisper <whisper.json> --subtitles <subtitles.json> --out <readings.md> [--from 초] [--to 초]`가 문단마다 세 출처를 나란히 놓은 대조표를 쓴다. 구간을 나눠 쓰면 여러 에이전트가 나눠 고칠 수 있다.
8. 판단: [references/reconcile.md](references/reconcile.md)를 따라 문단마다 고친 한 줄을 쓰고, 갈린 표기를 `divergence.md`에 남긴다.
9. `node scripts/apply.mjs --transcript corpus/<id>/transcript.md --video <id> --lines <고친 줄 파일> [--lines …] --out corpus/<id>/transcript.md`가 고친 줄을 전문에 넣는다. 문단과 고친 줄의 시각이 하나라도 어긋나면 쓰지 않고 멈추고, 한 구간만 먼저 확인할 때는 `--partial`을 준다. 전문 머리의 출처 줄을 고친 판에 맞게 바꾸고 커밋한다.
10. 판단: openflirt 스킬의 원칙을 쓰고 `coverage.md`를 채운다. `npm test`와 `node scripts/check.mjs`가 인용, 소제목 대응, 링크를 검사한다.

## 필요한 것

node 22 이상, `uv`(yt-dlp, Whisper, PaddleOCR를 스크립트가 받아 쓴다), PATH의 `ffmpeg`와 `ffprobe`. Whisper는 CUDA GPU에서 영상 길이의 4분의 1쯤 걸린다.
