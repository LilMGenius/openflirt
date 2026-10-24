# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["paddleocr==3.7.0", "paddlepaddle==3.3.1", "opencv-python-headless", "numpy"]
# ///
"""Reads the Korean subtitles burned into a video into events [{"start", "end", "text",
"confidence"}], times in seconds.

ffmpeg streams the rows of the subtitle band across the full frame width as gray frames. Subtitle
text is white with a black outline, so a pixel counts as text when it is bright and touches a dark
one. Inside the band's own columns, a frame with at least 150 such pixels holds a subtitle, and a
new subtitle starts when its mask overlaps the previous frame's by less than 0.55 either way;
keeping the side columns out of this step stops a static mark there from joining two subtitles.
The fullest frame of each subtitle is read by PaddleOCR's Korean PP-OCRv5 recognizer (Apache-2.0)
on tight line crops of the widest text cluster, which leaves out marks beside the subtitle, and a
subtitle touching a side of the band is read across the full width so its ends are not cut off.
A reading that is empty, below 0.85, or ends in a short Latin or symbol token is read again on up
to five frames across the subtitle, and the most repeated reading wins. Readings without Hangul
and short cross-fade frames are dropped, and a repeat of the previous subtitle is merged into it.
The recognizer often drops word spaces, so compare its text without spaces.

Usage: uv run subtitles.py <video> --band x,y,w,h --out <events.json> [--fps 5] [--start <s>] [--duration <s>]
"""
import argparse
import collections
import difflib
import json
import os
import re
import statistics
import subprocess
import sys
from dataclasses import dataclass, field

import cv2
import numpy as np

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
K3, K5, K9 = (np.ones((n, n), np.uint8) for n in (3, 5, 9))
TEXT_MIN, SAME, EDGE, REREAD = 150, 0.55, 20, 0.85
CROSSFADE, CROSSFADE_SECONDS, MERGE_GAP, MERGE_SIMILAR = 0.55, 0.9, 0.8, 0.85
LEAD = re.compile(r"^(?:[A-Za-z0-9\[\](){}<>@|:;'\".\-_=+*/\\~^%$#!?,]{1,4}\s+)+(?=[가-힣])")
TRAIL = re.compile(r"(?<=[가-힣?!.])\s+[A-Za-z0-9\[\](){}<>@|:;'\"\-_=+*/\\~^%$#,]{1,4}$")
TAIL = re.compile(r"(?<=[가-힣?!.])(?:[A-Z]{2,4}|[A-Z]\d|O\d|\d[A-Z])$")
JUNK = re.compile(r"^[A-Za-z0-9\W_]{1,4}\s|\s[A-Za-z0-9\W_]{1,4}$")


@dataclass
class Showing:
    """The subtitle on screen while it is being followed, with its fullest frame so far."""

    first: int
    last: int
    count: int
    frame: np.ndarray


@dataclass
class Subtitle:
    first: int
    last: int
    wide: bool
    readings: list[tuple[str, float]] = field(default_factory=list)


def frame_width(video):
    probe = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", video]
    return int(subprocess.run(probe, capture_output=True, text=True, check=True).stdout.strip())


def frames(args, top, height, width):
    window = ["-t", str(args.duration)] if args.duration else []
    command = ["ffmpeg", "-v", "error", "-ss", str(args.start), "-i", args.video, *window, "-vf", f"fps={args.fps},crop={width}:{height}:0:{top},format=gray", "-f", "rawvideo", "-"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    stream = process.stdout
    assert stream is not None  # stdout=PIPE always opens the pipe
    size = width * height
    try:
        index = 0
        while len(chunk := stream.read(size)) == size:
            yield index, np.frombuffer(chunk, np.uint8).reshape(height, width)
            index += 1
        if process.wait() != 0:
            sys.exit("subtitles.py: ffmpeg exited with %d" % process.returncode)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def text_mask(gray):
    return ((gray > 205) & (cv2.dilate((gray < 70).astype(np.uint8), K5) > 0)).astype(np.uint8)


def runs(flags):
    spans, start = [], None
    for i, on in enumerate(flags):
        if on and start is None:
            start = i
        if not on and start is not None:
            spans.append((start, i))
            start = None
    return spans + ([(start, len(flags))] if start is not None else [])


def line_crops(gray):
    mask = text_mask(gray)
    columns = cv2.dilate(mask.any(0).astype(np.uint8).reshape(1, -1), np.ones((1, 91), np.uint8)).reshape(-1) > 0
    clusters = runs(columns)
    if not clusters:
        return []
    left, right = max(clusters, key=lambda c: mask[:, c[0]:c[1]].sum())
    main = np.zeros_like(mask)
    main[:, left:right] = mask[:, left:right]
    grown = cv2.dilate(main, K9)
    crops = []
    for top, bottom in runs(grown.any(1)):
        if bottom - top < 22:
            continue
        xs = np.where(grown[top:bottom].any(0))[0]
        crop = gray[max(0, top - 8):bottom + 8, max(0, xs.min() - 16):xs.max() + 16]
        crops.append(cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR))
    return crops


def read(recognizer, gray):
    crops = line_crops(gray)
    if not crops:
        return "", 0.0
    results = list(recognizer.predict(crops, batch_size=len(crops)))
    text = re.sub(r"\s+", " ", " ".join(r["rec_text"].strip() for r in results)).strip()
    return text, float(np.mean([r["rec_score"] for r in results]))


def touches_side(mask):
    xs = np.where(mask.any(0))[0]
    return len(xs) > 0 and (xs.min() < EDGE or xs.max() >= mask.shape[1] - EDGE)


def overlap(mask, grown, previous):
    before, before_grown = previous
    return min(float((mask & before_grown).sum()) / max(1, int(mask.sum())), float((before & grown).sum()) / max(1, int(before.sum())))


def finish(showing, left, width, recognizer):
    band = showing.frame[:, left:left + width]
    wide = touches_side(text_mask(band))
    return Subtitle(showing.first, showing.last, wide, [read(recognizer, showing.frame if wide else band)])


def detect(stream, left, width, recognizer):
    events = []
    showing = None
    previous = None
    for index, full in stream:
        mask = text_mask(full[:, left:left + width])
        count = int(mask.sum())
        same = False
        if count >= TEXT_MIN:
            grown = cv2.dilate(mask, K3)
            same = showing is not None and previous is not None and overlap(mask, grown, previous) >= SAME
            previous = (mask, grown)
        else:
            previous = None
        if showing is not None and not same:
            events.append(finish(showing, left, width, recognizer))
            showing = None
        if count < TEXT_MIN:
            continue
        if showing is None:
            showing = Showing(index, index, count, full.copy())
        else:
            showing.last = index
            if count > showing.count:
                showing.count, showing.frame = count, full.copy()
    if showing is not None:
        events.append(finish(showing, left, width, recognizer))
    return events


def reread(args, top, height, full_width, left, width, recognizer, events):
    wanted = collections.defaultdict(list)
    for event in events:
        text, confidence = event.readings[0]
        if text and confidence >= REREAD and not JUNK.search(text):
            continue
        span = event.last - event.first + 1
        picks = min(span, 5)
        for k in sorted({round(event.first + j * (span - 1) / max(1, picks - 1)) for j in range(picks)}):
            wanted[k].append(event)
    if not wanted:
        return
    last = max(wanted)
    for index, full in frames(args, top, height, full_width):
        for event in wanted.get(index, []):
            event.readings.append(read(recognizer, full if event.wide else full[:, left:left + width]))
        if index >= last:
            break


def clean(text):
    return re.sub(r"\s+", " ", TAIL.sub("", TRAIL.sub("", LEAD.sub("", text)))).strip()


def bare(text):
    return re.sub(r"[\s\W_]+", "", text)


def hangul(text):
    return len(re.findall(r"[가-힣]", text))


def choose(readings):
    votes = collections.defaultdict(list)
    for text, confidence in ((clean(t), c) for t, c in readings):
        if text:
            votes[bare(text)].append((text, confidence))
    if not votes:
        return "", 0.0

    def score(key):
        group = votes[key]
        return (len(group) >= 2, len(group) * 0.15 + max(c for _, c in group) + (0.2 if hangul(group[0][0]) else -1))

    return max(votes[max(votes, key=score)], key=lambda reading: reading[1])


def main():
    parser = argparse.ArgumentParser(description="burned-in Korean subtitles of a video as timed events")
    parser.add_argument("video")
    parser.add_argument("--band", required=True, help="x,y,w,h of the strip the subtitles sit in, in source pixels")
    parser.add_argument("--out", required=True)
    parser.add_argument("--fps", type=float, default=5.0)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--duration", type=float)
    parser.add_argument("--model", default="korean_PP-OCRv5_mobile_rec")
    args = parser.parse_args()
    if not os.path.exists(args.video):
        sys.exit("subtitles.py: " + args.video + " does not exist")
    band = [int(v) for v in args.band.split(",")]
    if len(band) != 4:
        sys.exit("subtitles.py: --band takes x,y,w,h")
    left, top, width, height = band
    full_width = frame_width(args.video)
    if left < 0 or width <= 0 or left + width > full_width:
        sys.exit("subtitles.py: the band does not fit the %d px wide frame" % full_width)
    from paddleocr import TextRecognition

    # oneDNN raised NotImplementedError on Windows, so the CPU path runs without it.
    recognizer = TextRecognition(model_name=args.model, enable_mkldnn=False)
    events = detect(frames(args, top, height, full_width), left, width, recognizer)
    if not events:
        sys.exit("subtitles.py: no subtitle in the band; check --band against a frame")
    reread(args, top, height, full_width, left, width, recognizer, events)
    kept = []
    for event in events:
        text, confidence = choose(event.readings)
        start, end = args.start + event.first / args.fps, args.start + (event.last + 1) / args.fps
        if hangul(text) == 0 or (confidence < CROSSFADE and end - start <= CROSSFADE_SECONDS):
            continue
        previous = kept[-1] if kept else None
        if previous and start - previous["end"] <= MERGE_GAP and difflib.SequenceMatcher(None, bare(previous["text"]), bare(text)).ratio() >= MERGE_SIMILAR:
            if confidence > previous["confidence"]:
                previous.update(text=text, confidence=round(confidence, 4))
            previous["end"] = round(end, 2)
            continue
        kept.append({"start": round(start, 2), "end": round(end, 2), "text": text, "confidence": round(confidence, 4)})
    with open(args.out, "w", encoding="utf-8") as file:
        json.dump(kept, file, ensure_ascii=False, indent=1)
    low = sum(1 for event in kept if event["confidence"] < 0.8)
    median = statistics.median(event["confidence"] for event in kept) if kept else 0.0
    print("subtitles: %d events (%d below 0.8, median %.3f) -> %s" % (len(kept), low, median, args.out))


if __name__ == "__main__":
    main()
