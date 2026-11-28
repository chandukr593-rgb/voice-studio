import os, sys, subprocess, time, re, shutil, requests

SUPABASE_URL = "https://pbffjuqifadnqdddeqwc.supabase.co"
SUPABASE_KEY = "sb_publishable_64rcnA_hORGgec-u-JEKHQ_3kDlGiTV"
SERVER_RAW_URL = "https://raw.githubusercontent.com/chandukr593-rgb/voice-studio/main/server.py"
SYNC_SECRET = os.environ.get("COLAB_SYNC_SECRET", "")

IS_KAGGLE = os.path.isdir("/kaggle/working")
WORK_DIR = "/tmp/voice_studio"
SOURCE_NAME = "Kaggle" if IS_KAGGLE else "Colab"
os.makedirs(WORK_DIR, exist_ok=True)

def run(cmd):
    subprocess.run(cmd, shell=True, check=True)

print(f"⏳ 1/4: Setup ({SOURCE_NAME})...", flush=True)
if not shutil.which("ffmpeg"):
    run("apt-get -y -qq update >/dev/null 2>&1 && apt-get -y -qq install ffmpeg >/dev/null 2>&1")
if not shutil.which("uv"):
    run(f"{sys.executable} -m pip install -q uv")
if not os.path.exists("/usr/local/bin/cloudflared"):
    run("wget -q -O /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared")

server_path = f"{WORK_DIR}/server.py"
r_srv = requests.get(SERVER_RAW_URL, timeout=30)
r_srv.raise_for_status()
with open(server_path, "wb") as f:
    f.write(r_srv.content)

print("⏳ 2/4: Python 3.11...", flush=True)
venv_dir = f"{WORK_DIR}/py311"
py_bin = f"{venv_dir}/bin/python"
run("uv python install 3.11")
run(f"uv venv {venv_dir} --python 3.11 --clear")

print("⏳ 3/4: AI Packages...", flush=True)
run(f"uv pip install --python {py_bin} torch torchaudio --index-url https://download.pytorch.org/whl/cu121")
run(f'uv pip install --python {py_bin} coqui-tts "transformers<5" fastapi uvicorn soundfile requests pydantic numpy')

print("⏳ 4/4: AI Model लोड हो रहा है...", flush=True)
env = os.environ.copy()
env["COQUI_TOS_AGREED"] = "1"
env["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] = "1"
if SYNC_SECRET:
    env["COLAB_SYNC_SECRET"] = SYNC_SECRET

log_path = f"{WORK_DIR}/server.log"
log_file = open(log_path, "w")
srv_proc = subprocess.Popen([py_bin, "-u", server_path], env=env, stdout=log_file, stderr=subprocess.STDOUT)

ready = False
last_pos = 0
for _ in range(180):
    try:
        with open(log_path, "r") as lf:
            lf.seek(last_pos)
            chunk = lf.read()
            last_pos = lf.tell()
            if chunk:
                print(chunk, end="", flush=True)
    except Exception:
        pass
    if srv_proc.poll() is not None:
        break
    try:
        if requests.get("http://127.0.0.1:8000/health", timeout=2).status_code == 200:
            ready = True
            break
    except Exception:
        pass
    time.sleep(2)

if not ready:
    raise RuntimeError("AI Server चालू नहीं हुआ — ऊपर Error देखें")

cf_log_path = f"{WORK_DIR}/cf.log"
cf_log_file = open(cf_log_path, "w")
cf = subprocess.Popen(["cloudflared", "tunnel", "--url", "http://127.0.0.1:8000"], stdout=cf_log_file, stderr=subprocess.STDOUT)

live_url = None
for _ in range(45):
    try:
        with open(cf_log_path, "r") as clf:
            txt = clf.read()
        m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", txt)
        if m:
            live_url = m.group(0)
            break
    except Exception:
        pass
    if cf.poll() is not None:
        break
    time.sleep(1)

if not live_url:
    raise RuntimeError("Cloudflare Tunnel URL नहीं बन सका")

print(f"\n✅ सर्वर 100% LIVE है ({SOURCE_NAME}): {live_url}", flush=True)
if SYNC_SECRET:
    reg = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/auto_register_ai_server",
        headers={"apikey": SUPABASE_KEY, "Content-Type": "application/json"},
        json={"p_secret": SYNC_SECRET, "p_url": live_url},
        timeout=15,
    )
    if reg.status_code == 200:
        print("🚀 Website और Telegram Bot दोनों अपडेट हो गए!", flush=True)
        requests.post(
            f"{SUPABASE_URL}/functions/v1/telegram-bot",
            headers={"apikey": SUPABASE_KEY, "Content-Type": "application/json"},
            json={"action": "colab_notify", "secret": SYNC_SECRET, "url": live_url, "source": SOURCE_NAME},
            timeout=15,
        )

try:
    while srv_proc.poll() is None and cf.poll() is None:
        time.sleep(2)
finally:
    for p in (cf, srv_proc):
        try:
            p.terminate()
        except Exception:
            pass
    print("🛑 Server बंद हो गया!", flush=True)
