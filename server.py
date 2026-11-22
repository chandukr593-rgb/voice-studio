import os, hashlib, subprocess, requests, torch
import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from TTS.api import TTS

os.environ["COQUI_TOS_AGREED"] = "1"
os.environ["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] = "1"
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.benchmark = True

print("⏳ XTTS-v2 Model लोड हो रहा है...", flush=True)
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")
xtts_model = tts.synthesizer.tts_model
xtts_model.eval()
print("✅ XTTS-v2 Model Ready!", flush=True)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
LATENT_CACHE = {}
CACHE_DIR = "/content/voice_cache"
os.makedirs(CACHE_DIR, exist_ok=True)

class CloneReq(BaseModel):
    text: str
    language: str = "hi"
    speaker_url: str

def get_speaker_latents(speaker_url: str):
    h = hashlib.md5(speaker_url.encode()).hexdigest()
    if h in LATENT_CACHE:
        return LATENT_CACHE[h]
    raw_path, wav_path = f"{CACHE_DIR}/{h}_raw", f"{CACHE_DIR}/{h}.wav"
    r = requests.get(speaker_url, timeout=30)
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail="Audio Sample डाउनलोड नहीं हो सका।")
    with open(raw_path, "wb") as f:
        f.write(r.content)
    subprocess.run([
        "ffmpeg", "-y", "-i", raw_path, "-t", "25",
        "-af", "highpass=f=80,lowpass=f=10000,silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB,loudnorm",
        "-ac", "1", "-ar", "24000", wav_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    with torch.inference_mode():
        gpt_cond_latent, speaker_embedding = xtts_model.get_conditioning_latents(
            audio_path=[wav_path], gpt_cond_len=15, gpt_cond_chunk_len=4, max_ref_length=30, sound_norm_refs=True
        )
    LATENT_CACHE[h] = (gpt_cond_latent, speaker_embedding, wav_path)
    return LATENT_CACHE[h]

@app.get("/health")
def health():
    return {"status": "ok", "model": "xtts_v2_fast_fp16_clone"}

@app.post("/clone")
def clone_voice(req: CloneReq):
    clean_text = (req.text or "").strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Text खाली है।")
    lang = (req.language or "hi")[:2].lower()
    if lang not in ("hi", "en"):
        lang = "hi"
    gpt_cond_latent, speaker_embedding, wav_path = get_speaker_latents(req.speaker_url)
    try:
        with torch.inference_mode(), torch.amp.autocast("cuda", dtype=torch.float16):
            out = xtts_model.inference(
                text=clean_text, language=lang, gpt_cond_latent=gpt_cond_latent,
                speaker_embedding=speaker_embedding, temperature=0.65, length_penalty=1.0,
                repetition_penalty=5.0, top_k=50, top_p=0.80, speed=1.0, enable_text_splitting=False
            )
        wav_data = out["wav"]
    except Exception:
        with torch.inference_mode():
            out = xtts_model.inference(
                text=clean_text, language=lang, gpt_cond_latent=gpt_cond_latent,
                speaker_embedding=speaker_embedding, temperature=0.65, top_p=0.80,
                repetition_penalty=5.0, enable_text_splitting=True
            )
        wav_data = out["wav"]
    tmp_wav, tmp_mp3 = f"{CACHE_DIR}/chunk.wav", f"{CACHE_DIR}/chunk.mp3"
    sf.write(tmp_wav, np.array(wav_data, dtype=np.float32), 24000)
    subprocess.run([
        "ffmpeg", "-y", "-i", tmp_wav, "-ac", "1", "-ar", "24000", "-b:a", "64k",
        "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", tmp_mp3
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    with open(tmp_mp3, "rb") as f:
        return Response(content=f.read(), media_type="audio/mpeg")

uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
