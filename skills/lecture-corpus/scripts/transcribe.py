# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["faster-whisper==1.2.1", "numpy", "torch==2.11.0"]
# [tool.uv.sources]
# torch = { index = "pytorch-cu128" }
# [[tool.uv.index]]
# name = "pytorch-cu128"
# url = "https://download.pytorch.org/whl/cu128"
# explicit = true
# ///
"""Transcribes a lecture's audio with Whisper large-v3 through faster-whisper (MIT) into
segments [{"start", "end", "text"}], times in seconds.

torch is installed only for the CUDA runtime libraries its wheel ships, which CTranslate2 finds
once torch is imported and, on Windows, its lib folder is on the DLL search path. ffmpeg decodes
the audio into a float32 array, because faster-whisper's own PyAV decoding rejected a file path
under PyAV 17. condition_on_previous_text=False keeps one misheard line from repeating through the
rest of a long lecture.

Usage: uv run transcribe.py <media> --out <segments.json> [--lang ko] [--prompt "word, word"]
       [--device cuda|cpu] [--compute-type float16|int8] [--model-dir <dir>] [--start <s>] [--duration <s>]
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np


def main():
    parser = argparse.ArgumentParser(description="Whisper large-v3 transcript of a lecture")
    parser.add_argument("media")
    parser.add_argument("--out", required=True)
    parser.add_argument("--lang", default="ko")
    parser.add_argument("--prompt", help="the lecture's own coined words, comma separated")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--model-dir")
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--duration", type=float)
    args = parser.parse_args()
    if not os.path.exists(args.media):
        sys.exit("transcribe.py: " + args.media + " does not exist")

    import torch

    lib = os.path.join(torch.__path__[0], "lib")
    if os.name == "nt":
        os.add_dll_directory(lib)
        os.environ["PATH"] = lib + os.pathsep + os.environ["PATH"]
    from faster_whisper import WhisperModel

    window = ["-t", str(args.duration)] if args.duration else []
    command = ["ffmpeg", "-v", "error", "-ss", str(args.start), "-i", args.media, *window, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]
    pcm = subprocess.run(command, capture_output=True, check=True).stdout
    audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
    model = WhisperModel("large-v3", device=args.device, compute_type=args.compute_type, download_root=args.model_dir)
    segments, _ = model.transcribe(
        audio,
        language=args.lang,
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        initial_prompt=args.prompt,
        condition_on_previous_text=False,
        vad_filter=False,
    )
    out = [{"start": round(args.start + s.start, 2), "end": round(args.start + s.end, 2), "text": s.text.strip()} for s in segments]
    with open(args.out, "w", encoding="utf-8") as file:
        json.dump(out, file, ensure_ascii=False, indent=1)
    print("transcribe: %d segments, %.0f s of audio -> %s" % (len(out), len(audio) / 16000, args.out))


if __name__ == "__main__":
    main()
