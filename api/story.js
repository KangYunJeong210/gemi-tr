// /api/story.js — Vercel Serverless (ESM, 안정판)
import { GoogleGenAI } from "@google/genai";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function fallback(reason = "") {
  return {
    story: reason
      ? `⚠️ GM 오류: ${reason}`
      : "GM이 상황을 정리 중이다. 잠시 후 다시 시도해줘.",
    choices: [
      { id: "retry1", text: "다시 시도한다" },
      { id: "retry2", text: "다른 행동을 해본다" },
      { id: "retry3", text: "잠시 기다린다" }
    ],
    statePatch: {}
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(200).json(fallback("GEMINI_API_KEY 없음"));
    }

    const body = req.body ?? {};
    const game = body.game ?? {};
    const state = body.state ?? {};
    const history = Array.isArray(body.history) ? body.history : [];
    const userText = body.userText ?? "";

    const prompt = `
너는 모바일 TRPG의 GM이다.
항상 한국어로 대답한다.

[게임]
제목: ${game.title || "게임"}
장르: ${game.genre || "자유"}

[상태]
${JSON.stringify(state)}

[최근 대화]
${history.map(h => `${h.role}: ${h.text}`).join("\n")}

[플레이어 입력]
${userText || "(없음)"}

다음 장면을 진행하라.
반드시 아래 JSON 형식으로만 응답하라.

{
  "story": "스토리 본문",
  "choices": [
    { "id": "1", "text": "선택지1" },
    { "id": "2", "text": "선택지2" },
    { "id": "3", "text": "선택지3" }
  ],
  "statePatch": {}
}
`;

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    const result = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    const raw = result?.text || "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");

    if (start === -1 || end === -1) {
      return res.status(200).json(fallback("JSON 파싱 실패"));
    }

    const parsed = JSON.parse(raw.slice(start, end + 1));

    return res.status(200).json({
      story: parsed.story || fallback().story,
      choices: parsed.choices?.slice(0, 3) || fallback().choices,
      statePatch: parsed.statePatch || {}
    });

  } catch (err) {
    // 🔥 절대 500 안 보냄
    return res.status(200).json(fallback(err.message));
  }
}
