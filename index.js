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

    const { event, media } = JSON.parse(frame);
    if (event !== "media") return;


    const stt = await openai.audio.transcriptions.create({
  model: "gpt-4o-transcribe",          // or "whisper-1" for non-streaming
  file: Buffer.from(b64, "base64"),    // <-- CORRECT key
  mimeType: "audio/raw;encoding=signed-integer;bits=16;rate=8000;endian=little",
  stream: true                         // keep if you want incremental words
});

    for await (const { text } of stt) {
      const [{ message:{ content }}] =
        (await openai.chat.completions.create({
          model:"gpt-4o", messages:[
            {role:"system",content:`Translate to ${lang}`},
            {role:"user",content:text}], temperature:0 })).choices;
      const speech = await openai.audio.speech.create({
        model:"tts-1", voice:"alloy", input:content, format:"pcm"});
      ws.send(JSON.stringify({event:"media",
                media:{payload:Buffer.from(speech.audio).toString("base64")}}));
    }
  });
});
const server = app.listen(process.env.PORT || 8080);
server.on("upgrade",(req,sock,head)=>wss.handleUpgrade(req,sock,head,
                 ws=>wss.emit("connection",ws,req)));
