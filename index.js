import express from "express";
import { Readable } from "stream";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import { toFile } from "openai/uploads";   // 👈 add this line
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
const wss = new WebSocketServer({ noServer: true });


let frameRing = [];                    // holds ≤ 50 Buffers
const MAX_FRAMES = 100;                 // 100 × 20 ms ≈ 2 s
const FRAME_MS      = 20;              // each SignalWire frame is 20 ms
const FRAMES_PER_WAV = 1000 / FRAME_MS; // 50 frames ≈ 1 s

wss.on("connection", (ws, req) => {

console.log('🟢 WebSocket CONNECTED:', req.url);

const ka = setInterval(() => {
  if (ws.readyState === ws.OPEN)
    ws.send(JSON.stringify({ event:"media", track:"outbound",
                             media:{ payload:"" }}));
}, 4000);

ws.on("close", () => clearInterval(ka));


ws.on('error', err => {
  console.error('❌ WebSocket ERROR:', err);
});


  const lang = { "1": "Spanish", "2": "Haitian Creole", "3": "Mandarin" }
               [new URL(req.url,"http://x").searchParams.get("lang")] || "Spanish";

  console.log("🟢 WebSocket CONNECTED:", req.url, "→ translating to", lang);

 function pcmToWavBuffer(pcmBuf, sampleRate = 8000) {
  const numFrames  = pcmBuf.length / 2;            // 16-bit PCM → 2 bytes/sample
  const byteRate   = sampleRate * 2;               // 1 ch × 16-bit
  const blockAlign = 2;

  const header = Buffer.alloc(44);

  header.write("RIFF", 0);                         // ChunkID
  header.writeUInt32LE(36 + pcmBuf.length, 4);     // ChunkSize
  header.write("WAVE", 8);                         // Format

  header.write("fmt ", 12);                        // SubChunk1ID
  header.writeUInt32LE(16, 16);                    // SubChunk1Size (PCM)
  header.writeUInt16LE(1, 20);                     // AudioFormat (1=PCM)
  header.writeUInt16LE(1, 22);                     // NumChannels
  header.writeUInt32LE(sampleRate, 24);            // SampleRate
  header.writeUInt32LE(byteRate, 28);              // ByteRate
  header.writeUInt16LE(blockAlign, 32);            // BlockAlign
  header.writeUInt16LE(16, 34);                    // BitsPerSample

  header.write("data", 36);                        // SubChunk2ID
  header.writeUInt32LE(pcmBuf.length, 40);         // SubChunk2Size

  return Buffer.concat([header, pcmBuf]);
}



  ws.on("message", async frame => {

  //console.log("The frames have been sent...",frame);
  const msg = JSON.parse(frame);
  if (msg.event !== "media" || !msg.media || !msg.media.payload) return;

  console.log("The data is media data.");

  /* 2️⃣  Extract base-64 payload (works for SignalWire or Twilio) */
  const b64 =
        msg.media?.payload   ??   // SignalWire format
        msg.chunk?.payload   ??   // older Twilio format
        null;

  if (!b64) return;               // keep-alive or unknown frame – ignore

  frameRing.push(Buffer.from(b64, "base64"));
 if (frameRing.length < FRAMES_PER_WAV) return;   // wait until we have 1 s

 /* 1️⃣  Build ~1 s WAV & clear ring */
  const pcmBlock = Buffer.concat(frameRing.splice(0));
  const wavBuf   = pcmToWavBuffer(pcmBlock);       // header + PCM

 

/* 2️⃣  Create a File-like object */
const wavFile = {
  data: wavBuf,          // Buffer
  name: "chunk.wav",
  type: "audio/wav"      // MIME
};

 /* 1️⃣  Build a single 1-second WAV 
  const pcmBig   = Buffer.concat(pcmBufferRing.splice(0));     // clear ring
  const wavBuf   = pcmToWavBuffer(pcmBig);                     // helper from earlier
  const wavFile  = await toFile(Readable.from(wavBuf), "chunk.wav"); */


   try {
    /* 2️⃣  Transcribe */
    const { text } = await openai.audio.transcriptions.create({
      model:    "gpt-4o-transcribe",          // or "whisper-1"
      file:     wavFile,
      mimeType: "audio/wav"
    });
    if (!text.trim()) return;

    /* 3️⃣  Translate  */
    const [{ message:{ content } }] =
      (await openai.chat.completions.create({
        model:"gpt-4o",
        messages:[
          {role:"system",content:`Translate to ${lang}`},
          {role:"user",  content:text}
        ],
        temperature:0
      })).choices;

    /* 4️⃣  TTS (8 kHz PCM) */
    const speech = await openai.audio.speech.create({
      model:"tts-1",
      voice:"alloy",
      input:content,
      format:"pcm",
      sampleRate:8000
    });

    /* 5️⃣  Ship audio back to SignalWire */
    ws.send(JSON.stringify({
      event:"media",
      track:"outbound",
      media:{ payload: Buffer.from(speech.audio).toString("base64") }
    }));
  } catch (err) {
    console.error("❌ OpenAI STT/TTS error:", err.message || err);
  }
});


});
const server = app.listen(process.env.PORT || 8080);
server.on("upgrade",(req,sock,head)=>wss.handleUpgrade(req,sock,head,
                 ws=>wss.emit("connection",ws,req)));
