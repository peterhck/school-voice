import express from "express";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {

console.log('🟢 WebSocket CONNECTED:', req.url);

ws.on('close', (code, reason) => {
  console.log('🔴 WebSocket CLOSED:', code, reason.toString());
});

ws.on('error', err => {
  console.error('❌ WebSocket ERROR:', err);
});


  const lang = { "1": "Spanish", "2": "Haitian Creole", "3": "Mandarin" }
               [new URL(req.url,"http://x").searchParams.get("lang")] || "Spanish";
  ws.on("message", async frame => {
  // 1️⃣  Parse the JSON that SignalWire sends
  const msg = JSON.parse(frame);

  // 2️⃣  Ignore heart-beats and non-audio events
  if (msg.event !== "media" || !msg.chunk || !msg.chunk.payload) return;

  // 3️⃣  Extract the base-64 audio blob into b64
  const b64 = msg.chunk.payload;       // <-- NOW b64 exists

  try {
    // 4️⃣  Speech-to-text
    const sttStream = await openai.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file: Buffer.from(b64, "base64"),            // uses b64 safely
      mimeType:
        "audio/raw;encoding=signed-integer;bits=16;rate=8000;endian=little",
      stream: true
    });

    for await (const { text } of sttStream) {
      if (!text.trim()) continue;                  // skip silence

      // 5️⃣  Translate
      const { choices: [{ message: { content } }] } =
        await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: `Translate to ${targetLang}` },
            { role: "user",   content: text }
          ],
          temperature: 0
        });

      // 6️⃣  Text-to-speech
      const speech = await openai.audio.speech.create({
        model: "tts-1",
        voice: "alloy",
        input: content,
        format: "pcm"
      });

      // 7️⃣  Send the translated audio back to SignalWire
      ws.send(
        JSON.stringify({
          event: "media",
          media: { payload: Buffer.from(speech.audio).toString("base64") }
        })
      );
    }
  } catch (err) {
    console.error("❌ OpenAI error:", err);
  }
});

});
const server = app.listen(process.env.PORT || 8080);
server.on("upgrade",(req,sock,head)=>wss.handleUpgrade(req,sock,head,
                 ws=>wss.emit("connection",ws,req)));
