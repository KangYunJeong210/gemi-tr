// /api/story.js (Vercel Serverless Function, ESM)
// ENV: GEMINI_API_KEY, (optional) GEMINI_MODEL=gemini-2.0-flash

import { GoogleGenAI } from "@google/genai";

function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function safeJsonParse(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(t.slice(first, last + 1));
  } catch {
    return null;
  }
}

function normalizeOutput(out) {
  const story = String(out?.story ?? "").trim();

  const choicesRaw = Array.isArray(out?.choices) ? out.choices : [];
  const choices = choicesRaw.slice(0, 3).map((c, i) => ({
    id: String(c?.id ?? `c${i + 1}`),
    text: String(c?.text ?? "").trim() || `선택지 ${i + 1}`,
  }));
  while (choices.length < 3) {
    const i = choices.length;
    choices.push({ id: `c${i + 1}`, text: `선택지 ${i + 1}` });
  }

  const statePatch =
    out?.statePatch && typeof out.statePatch === "object" && !Array.isArray(out.statePatch)
      ? out.statePatch
      : {};

  return {
    story: story || "…(GM이 잠시 말이 없다. 다시 시도해줘.)",
    choices,
    statePatch,
  };
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

  try {
    const body = req.body ?? {};
    const game = body.game ?? {};
    const state = body.state ?? {};
    const history = Array.isArray(body.history) ? body.history : [];
    const userText = body.userText ?? null;
    const choiceId = body.choiceId ?? null;
    const lastChoices = Array.isArray(body.lastChoices) ? body.lastChoices : [];

    const title = String(game.title ?? "게임").trim();
    const genre = String(game.genre ?? "").trim();
    const seed = String(game.seed ?? "").trim();

    const historyText = history
      .slice(-20)
      .map((m) => {
        const r = m.role === "me" ? "PLAYER" : m.role === "gm" ? "GM" : "SYSTEM";
        const txt = String(m.text ?? "").trim();
        return txt ? `${r}: ${txt}` : "";
      })
      .filter(Boolean)
      .join("\n");

    const systemInstruction = [
      "너는 모바일 TRPG의 GM이다.",
      "항상 한국어로, 스토리 1~3문단을 출력한다.",
      "반드시 JSON만 응답한다(설명/코드펜스/추가 텍스트 금지).",
      "선택지는 정확히 3개. 서로 다른 접근(관찰/대화/행동 등)으로 구분한다.",
      "직전 턴 선택지와 동일/유사한 선택지를 반복하지 마라.",
      "플레이어의 직전 입력에 직접 반응하는 선택지를 최소 1개 포함하라.",
     
    ].join(" ");

    const userPrompt = [
      `게임 제목: ${title}`,
      genre ? `장르/톤: ${genre}` : "",
      seed ? `초기 설정: ${seed}` : "",
      "",
      "현재 상태(state) JSON:",
      JSON.stringify(state ?? {}, null, 2),
      "",
      "직전 GM 선택지:",
      lastChoices.length ? JSON.stringify(lastChoices, null, 2) : "(없음)",
      "",
      "최근 대화:",
      historyText || "(대화 없음)",
      "",
      "플레이어 입력:",
      userText ? String(userText) : "(없음: GM이 장면을 시작)",
      choiceId ? `선택지 ID: ${choiceId}` : "",
      "",
      "이제 다음 장면을 제시하라."
    ].filter(Boolean).join("\n");

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction,
        temperature: 0.9,
        responseMimeType: "application/json"
      }
    });

    const raw = response?.text ?? "";
    const parsed = safeJsonParse(raw);
    const out = normalizeOutput(parsed);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: String(err?.message || err),
    });

    const response = await ai.models.generateContent({
  model,
  contents: [{ role: "user", parts: [{ text: userPrompt }] }],
  config: {
    systemInstruction,
    temperature: 0.9,
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        story: { type: "string" },
        choices: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string" }
            },
            required: ["id", "text"]
          }
        },
        statePatch: { type: "object" }
      },
      required: ["story", "choices", "statePatch"]
    }
  }
});

    
  }
}


