"""Chatterbox TTS service for guysofwisdom. Runs on the GPU droplet.

POST /tts  {text, voice, exaggeration, cfg_weight}  ->  audio/wav
Requires `Authorization: Bearer $CHATTERBOX_TOKEN`.
Each voice is cloned from voices/<voice>.wav (a ~10s clean reference clip).
"""
import io
import os
import re
import threading

import torch
import torchaudio as ta
from chatterbox.tts import ChatterboxTTS
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

TOKEN = os.environ["CHATTERBOX_TOKEN"]
VOICES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voices")

if torch.cuda.is_available():
    device = "cuda"
elif torch.backends.mps.is_available():
    device = "mps"
else:
    device = "cpu"

# checkpoints are saved from CUDA; on other devices they must be remapped when loaded
if device != "cuda":
    _load = torch.load
    torch.load = lambda *a, **kw: _load(*a, **{"map_location": torch.device(device), **kw})

model = ChatterboxTTS.from_pretrained(device=device)
lock = threading.Lock()  # one generation at a time on the GPU
app = FastAPI()


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    voice: str
    exaggeration: float = Field(0.5, ge=0.25, le=2.0)
    cfg_weight: float = Field(0.5, ge=0.0, le=1.0)


@app.post("/tts")
def tts(req: TTSRequest, authorization: str = Header(default="")):
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")
    if not re.fullmatch(r"[a-z0-9_-]+", req.voice):
        raise HTTPException(status_code=400, detail="bad voice id")
    prompt = os.path.join(VOICES_DIR, f"{req.voice}.wav")
    if not os.path.isfile(prompt):
        raise HTTPException(status_code=400, detail=f"no reference clip for voice {req.voice}")

    with lock:
        wav = model.generate(
            req.text,
            audio_prompt_path=prompt,
            exaggeration=req.exaggeration,
            cfg_weight=req.cfg_weight,
        )

    buf = io.BytesIO()
    ta.save(buf, wav.cpu(), model.sr, format="wav")
    return Response(content=buf.getvalue(), media_type="audio/wav")
