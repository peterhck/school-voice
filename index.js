import express from "express";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
const wss = new WebSocketServer({ noServer: true });

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

  ws.on("message", async frame => {

  console.log("The frames have been sent...",frame);
  const msg = JSON.parse(frame);
  if (msg.event !== "media" || !msg.chunk || !msg.chunk.payload) return;

  console.log("The data is media data.");

  /* 2️⃣  Extract base-64 payload (works for SignalWire or Twilio) */
  const b64 =
        msg.media?.payload   ??   // SignalWire format
        msg.chunk?.payload   ??   // older Twilio format
        null;

  if (!b64) return;               // keep-alive or unknown frame – ignore

  const sttStream = await openai.audio.transcriptions.create({
    model: "gpt-4o-transcribe",
    file: Buffer.from(b64, "base64"),
    mimeType: "audio/raw;encoding=signed-integer;bits=16;rate=8000;endian=little",
    stream: true
  });

  console.log("The data has been transcribed by OpenAI, gpt-4o-transcribe.");

  for await (const { text } of sttStream) {
    if (!text.trim()) continue;

    const [{ message:{ content } }] =
      (await openai.chat.completions.create({
        model:"gpt-4o",
        messages: [
          { role:"system", content:`Translate to ${lang}` },
          { role:"user",   content:text }
        ],
        temperature:0
      })).choices;

      console.log("The contents of the Translation is: ", content);

    const speech = await openai.audio.speech.create({
      model:"tts-1",
      voice:"alloy",
      input:content,
      format:"pcm",
      sampleRate:8000
    });

    console.log("The text has been converted to audio with OpenAI");

    ws.send(JSON.stringify({
      event:"media",
      track:"outbound",
      media:{ payload: Buffer.from(speech.audio).toString("base64") }
    }));

    console.log("The audio data has been sent back to the websocket.");
  }
});


});
const server = app.listen(process.env.PORT || 8080);
server.on("upgrade",(req,sock,head)=>wss.handleUpgrade(req,sock,head,
                 ws=>wss.emit("connection",ws,req)));
