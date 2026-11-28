from http.server import BaseHTTPRequestHandler
import asyncio
import json
import re
import edge_tts

ALLOWED_VOICES = {
    "hi-IN-SwaraNeural",
    "hi-IN-MadhurNeural",
    "en-IN-NeerjaNeural",
    "en-IN-PrabhatNeural",
    "en-US-JennyNeural",
    "en-US-GuyNeural",
    "en-US-AriaNeural",
    "en-US-AndrewNeural",
}

async def synthesize_mp3(text: str, voice: str, rate: str, pitch: str) -> bytes:
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
    audio_bytes = bytearray()
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            audio_bytes.extend(chunk["data"])
    return bytes(audio_bytes)

class handler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self._send_cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok", "engine": "edge-tts"}).encode("utf-8"))

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length) if length > 0 else b"{}"
            body = json.loads(raw_body.decode("utf-8"))

            text = str(body.get("text", "")).strip()
            voice = str(body.get("voice", "hi-IN-SwaraNeural")).strip()
            rate = str(body.get("rate", "+0%")).strip()
            pitch = str(body.get("pitch", "+0Hz")).strip()

            if not text:
                self.send_response(400)
                self._send_cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Text is empty"}).encode("utf-8"))
                return

            if len(text) > 1500:
                text = text[:1500]

            if voice not in ALLOWED_VOICES:
                voice = "hi-IN-SwaraNeural"
            if not re.match(r"^[+-]\d{1,3}%$", rate):
                rate = "+0%"
            if not re.match(r"^[+-]\d{1,3}Hz$", pitch):
                pitch = "+0Hz"

            mp3_data = asyncio.run(synthesize_mp3(text, voice, rate, pitch))
            if not mp3_data:
                raise RuntimeError("Empty audio generated")

            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(mp3_data)
        except Exception as e:
            self.send_response(500)
            self._send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
