import express from "express";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
  const lang = { "1": "Spanish", "2": "Haitian Creole", "3": "Mandarin" }
               [new URL(req.url,"http://x").searchParams.get("lang")] || "Spanish";
  ws.on("message", async frame => {
    const { event, media } = JSON.parse(frame);
    if (event !== "media") return;
    const stt = await openai.audio.transcriptions.create({
      model: "gpt-4o-transcribe", audio: Buffer.from(media.payload,"base64"), stream: true
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
