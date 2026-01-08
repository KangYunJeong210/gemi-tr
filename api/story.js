// api/story.js (Vercel Serverless, ESM)
import { GoogleGenAI } from "@google/genai";




function fallback(reason) {
  return {
    story: `⚠️ 설정 위반 또는 오류: ${reason}\n(초기 설정을 다시 확인해줘)`,
    choices: [
      { id: "1", text: "다시 시도한다" },
      { id: "2", text: "설정을 수정한다" },
      { id: "3", text: "장면을 바꾼다" }
    ],
    statePatch: {}
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json(fallback("POST only"));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(200).json(fallback("API KEY 없음"));

  const body = req.body || {};
  const { game, state, history, userText, lastChoices } = body;

  const system = `
너는 오리지널 다크 로맨스 TRPG의 GM이다.

[절대 규칙]
- 원작 인물 절대 금지
- 위반 시 출력은 실패이며 즉시 재작성
- 항상 한국어
- 반드시 JSON만 출력

[출력 형식]
{
 "story": "...",
 "choices": [{"id":"1","text":"..."},{"id":"2","text":"..."},{"id":"3","text":"..."}],
 "statePatch": {}
}
`;

  const prompt = `
[초기 설정 - 최우선 규칙]
${game.seed || "없음"}

[게임 제목]
${game.title}

[장르/톤]
${game.genre}

[현재 상태]
${JSON.stringify(state || {})}

[최근 대화]
${(history || []).map(h => `${h.role}: ${h.text}`).join("\n")}

[직전 선택지]
${JSON.stringify(lastChoices || [])}

[플레이어 입력]
${userText || "(없음)"}

다음 장면을 작성하라.
`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    const r = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: system, temperature: 0.9 }
    });

    const raw = r.text || "";
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s === -1 || e === -1) return res.json(fallback("JSON 파싱 실패"));

    const out = JSON.parse(raw.slice(s, e + 1));

    const hit = hasBanned(out.story);
    if (hit) return res.json(fallback(`금지어 감지: ${hit}`));

    return res.json({
      story: out.story,
      choices: out.choices.slice(0, 3),
      statePatch: out.statePatch || {}
    });

  } catch (err) {
    return res.json(fallback(err.message));
  }
}

