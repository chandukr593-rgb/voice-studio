import os, hashlib, subprocess, requests, torch, uuid, time, threading
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

CACHE_DIR = "/tmp/voice_cache"
STOP_SECRET = os.environ.get("COLAB_SYNC_SECRET", "")
os.makedirs(CACHE_DIR, exist_ok=True)

print("⏳ XTTS-v2 High-Similarity Model लोड हो रहा है...", flush=True)
device = "cuda" if torch.cuda.is_available() else "cpu"
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
xtts_model = tts.synthesizer.tts_model
xtts_model.eval()
print(f"✅ XTTS-v2 Model Ready on {device}!", flush=True)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
LATENT_CACHE = {}

class CloneReq(BaseModel):
    text: str
    language: str = "hi"
    speaker_url: str

class StopReq(BaseModel):
    secret: str = ""

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
        "ffmpeg", "-y", "-i", raw_path, "-t", "28",
        "-af", "highpass=f=60,silenceremove=start_periods=1:start_silence=0.1:start_threshold=-45dB",
        "-ac", "1", "-ar", "24000", wav_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    with torch.inference_mode():
        gpt_cond_latent, speaker_embedding = xtts_model.get_conditioning_latents(
            audio_path=[wav_path], gpt_cond_len=24, gpt_cond_chunk_len=6, max_ref_length=30, sound_norm_refs=True
        )
    LATENT_CACHE[h] = (gpt_cond_latent, speaker_embedding, wav_path)
    return LATENT_CACHE[h]

@app.get("/health")
def health():
    return {"status": "ok", "model": "xtts_v2_high_similarity", "device": device}

@app.post("/stop")
def stop_server(req: StopReq):
    if STOP_SECRET and req.secret != STOP_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    print("🛑 Telegram Stop Command मिला — Server बंद हो रहा है...", flush=True)
    def _shutdown():
        time.sleep(0.4)
        os._exit(0)
    threading.Thread(target=_shutdown, daemon=True).start()
    return {"status": "stopping"}

@app.post("/clone")
def clone_voice(req: CloneReq):
    clean_text = (req.text or "").strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Text खाली है।")
    lang = (req.language or "hi")[:2].lower()
    if lang not in ("hi", "en"):
        lang = "hi"
    gpt_cond_latent, speaker_embedding, wav_path = get_speaker_latents(req.speaker_url)
    with torch.inference_mode():
        out = xtts_model.inference(
            text=clean_text, language=lang, gpt_cond_latent=gpt_cond_latent,
            speaker_embedding=speaker_embedding, temperature=0.55, length_penalty=1.0,
            repetition_penalty=2.5, top_k=40, top_p=0.85, speed=1.0, enable_text_splitting=False
        )
    wav_data = out["wav"]
    uid = uuid.uuid4().hex
    tmp_wav, tmp_mp3 = f"{CACHE_DIR}/{uid}.wav", f"{CACHE_DIR}/{uid}.mp3"
    try:
        sf.write(tmp_wav, np.array(wav_data, dtype=np.float32), 24000)
        subprocess.run([
            "ffmpeg", "-y", "-i", tmp_wav, "-ac", "1", "-ar", "24000", "-b:a", "96k",
            "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", tmp_mp3
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        with open(tmp_mp3, "rb") as f:
            return Response(content=f.read(), media_type="audio/mpeg")
    finally:
        for p in (tmp_wav, tmp_mp3):
            if os.path.exists(p):
                try: os.remove(p)
                except Exception: pass

uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")