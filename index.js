import express from "express";
import { Readable } from "stream";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import { toFile } from "openai/uploads";   // 👈 add this line
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
const wss = new WebSocketServer({ noServer: true });

const pcmBufferRing = [];            // store incoming 20 ms chunks

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
  const numFrames = pcmBuf.length / 2;           // 16-bit = 2 bytes
  const header = Buffer.alloc(44);

  /* "RIFF" chunk descriptor */
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuf.length, 4);   // file size-8
  header.write("WAVE", 8);

  /* "fmt " sub-chunk */
  header.write("fmt ", 12);
  header.writeUInt32LE(16,   16);               // subchunk1Size (PCM)
  header.writeUInt16LE(1,    20);               // audioFormat 1 = PCM
  header.writeUInt16LE(1,    22);               // numChannels
  header.writeUInt32LE(sampleRate, 24);         // sampleRate
  header.writeUInt32LE(sampleRate * 2, 28);     // byteRate = sr * ch * 2
  header.writeUInt16LE(2,    32);               // blockAlign
  header.writeUInt16LE(16,   34);               // bitsPerSample

  /* "data" sub-chunk */
  header.write("data", 36);
  header.writeUInt32LE(pcmBuf.length, 40);

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

  pcmBufferRing.push(Buffer.from(b64, "base64"));

   /* 50 frames ≈ 1 s @ 20 ms per frame */
  if (pcmBufferRing.length < 50) return;

 /* 1️⃣  Build a single 1-second WAV */
  const pcmBig   = Buffer.concat(pcmBufferRing.splice(0));     // clear ring
  const wavBuf   = pcmToWavBuffer(pcmBig);                     // helper from earlier
  const wavFile  = await toFile(Readable.from(wavBuf), "chunk.wav");


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
