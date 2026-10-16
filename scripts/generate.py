"""Pre-generate every line in content/*.json with Chatterbox.

Reads each category file, asks the running Chatterbox service (CHATTERBOX_URL, CHATTERBOX_TOKEN)
to speak each line's `text` in its persona's voice with the line's own exaggeration/cfg_weight.
The WAV master is kept in content/wav/ (not shipped); an MP3 for the site is written to content/audio/.
Lines that already have an MP3 are skipped, so it can be stopped and re-run.
Writes content/manifest.json when finished.

  --convert-only   never call Chatterbox; convert existing WAVs and fail if any line has none.
                   Also adopts WAVs an older version of this script left in content/audio/.
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "content")
URL = os.environ.get("CHATTERBOX_URL", "http://127.0.0.1:8000").rstrip("/") + "/tts"
TOKEN = os.environ["CHATTERBOX_TOKEN"]
CATEGORIES = ["koans", "affirmations", "astrology", "pumpup"]


def speak(line):
    body = json.dumps({
        "text": line["text"],
        "voice": line["persona"].lower(),
        "exaggeration": line["exaggeration"],
        "cfg_weight": line["cfg_weight"],
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TOKEN}",
    })
    with urllib.request.urlopen(req, timeout=900) as res:
        return res.read()


def to_mp3(wav, mp3):
    tmp = mp3 + ".tmp.mp3"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", wav, "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "64k", tmp],
        check=True,
    )
    os.replace(tmp, mp3)


def main():
    convert_only = "--convert-only" in sys.argv
    manifest = []
    todo = []
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is required to write the mp3s")
    for category in CATEGORIES:
        with open(os.path.join(ROOT, f"{category}.json")) as f:
            data = json.load(f)
        for line in data["lines"]:
            stem = os.path.splitext(line["output_file"])[0]
            todo.append((category, line, {
                "wav": os.path.join(ROOT, "wav", stem + ".wav"),
                "legacy": os.path.join(ROOT, "audio", stem + ".wav"),
                "mp3": os.path.join(ROOT, "audio", stem + ".mp3"),
                "rel": "audio/" + stem + ".mp3",
            }))

    done_before = sum(os.path.exists(p['mp3']) for _, _, p in todo)
    print(f"{len(todo)} lines, {done_before} already have an mp3", flush=True)

    started = time.time()
    generated = 0
    for i, (category, line, p) in enumerate(todo, 1):
        os.makedirs(os.path.dirname(p["wav"]), exist_ok=True)
        os.makedirs(os.path.dirname(p["mp3"]), exist_ok=True)

        if not os.path.exists(p["wav"]) and os.path.exists(p["legacy"]):
            shutil.move(p["legacy"], p["wav"])

        if not os.path.exists(p["wav"]):
            if convert_only:
                sys.exit(f"{line['id']} has no wav; run without --convert-only to generate it")
            for attempt in (1, 2):
                try:
                    audio = speak(line)
                    break
                except Exception as err:
                    print(f"  {line['id']} attempt {attempt} failed: {err}", flush=True)
                    if attempt == 2:
                        sys.exit(f"giving up on {line['id']}")
            tmp = p["wav"] + ".tmp"
            with open(tmp, "wb") as f:
                f.write(audio)
            os.replace(tmp, p["wav"])
            generated += 1
            elapsed = time.time() - started
            print(f"[{i}/{len(todo)}] {line['id']} ({line['persona']}) done, {elapsed / generated:.0f}s avg", flush=True)

        if not os.path.exists(p["mp3"]):
            to_mp3(p["wav"], p["mp3"])

        manifest.append({
            "id": line["id"],
            "category": category,
            "persona": line["persona"],
            "text": line["text"],
            "audio": p["rel"],
        })

    with open(os.path.join(ROOT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(f"finished: {len(manifest)} lines in manifest", flush=True)


main()
