// /api/story.js  (Vercel Serverless Function - Node.js)
// - Request: 프론트(app.js)에서 보내는 payload 그대로
// - Response: { story: string, choices: [{id,text}*3], statePatch: object }
//
// ENV:
// - GEMINI_API_KEY=xxxx
// - (optional) GEMINI_MODEL=gemini-2.0-flash  (default)

function setCors(req, res) {
  // 필요하면 "*" 대신 본인 도메인으로 제한해도 됨
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function safeJsonParse(text) {
  if (!text) return null;
  let t = String(text).trim();

  // code fence 제거
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();

  // 텍스트 중 JSON 객체만 뽑기(혹시 앞뒤 잡담 섞였을 때)
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  t = t.slice(first, last + 1);

  try {
    return JSON.parse(t);
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

  // 3개 미만이면 채워 넣기
  while (choices.length < 3) {
    const i = choices.length;
    choices.push({ id: `c${i + 1}`, text: `선택지 ${i + 1}` });
  }

  const statePatch =
    out?.statePatch && typeof out.statePatch === "object" && !Array.isArray(out.statePatch)
      ? out.statePatch
      : {};

  return { story: story || "…(GM이 잠시 말이 없다. 다시 한 번 시도해줘.)", choices, statePatch };
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing GEMINI_API_KEY in env" });
  }

  try {
    const body = req.body ?? {};
    const game = body.game ?? {};
    const state = body.state ?? {};
    const history = Array.isArray(body.history) ? body.history : [];
    const userText = body.userText ?? null;
    const choiceId = body.choiceId ?? null;

    const title = String(game.title ?? "게임").trim();
    const genre = String(game.genre ?? "").trim();
    const seed = String(game.seed ?? "").trim();

    // 최근 대화 텍스트(모델에 참고용)
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
      "항상 한국어로, 분위기 있는 스토리 1~3문단을 출력한다.",
      "반드시 다음 JSON 스키마로만 응답한다(설명/코드펜스/추가 텍스트 금지).",
      "스토리는 이전 대화와 상태(state)를 자연스럽게 이어간다.",
      "선택지는 3개. (서로 다른 행동/대사/태도)로 만들고, 너무 길지 않게 쓴다."
    ].join(" ");

    const userPrompt = [
      `게임 제목: ${title}`,
      genre ? `장르/톤: ${genre}` : "",
      seed ? `초기 설정: ${seed}` : "",
      "",
      "현재 상태(state) JSON:",
      JSON.stringify(state ?? {}, null, 2),
      "",
      "최근 대화:",
      historyText || "(대화 없음)",
      "",
      "플레이어 입력:",
      userText ? String(userText) : "(없음: GM이 장면을 시작)",
      choiceId ? `선택지 ID: ${choiceId}` : "",
      "",
      "이제 다음 장면을 제시하라.",
    ]
      .filter(Boolean)
      .join("\n");

    // ---- Google GenAI SDK (new) ----
    // Migrated SDK: @google/genai :contentReference[oaicite:1]{index=1}
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    // JSON 모드 + responseSchema로 출력 강제 :contentReference[oaicite:2]{index=2}
    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.9,
        candidateCount: 1,
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
                  text: { type: "string" },
                },
                required: ["id", "text"],
              },
            },
            statePatch: {
              type: "object",
              additionalProperties: true,
            },
          },
          required: ["story", "choices", "statePatch"],
        },
      },
    });

    // SDK는 response.text에 후보 텍스트를 합쳐 제공 :contentReference[oaicite:3]{index=3}
    const rawText = response?.text ?? "";
    const parsed = safeJsonParse(rawText);

    const out = normalizeOutput(parsed);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(out);
  } catch (err) {
    // 서버에서 에러가 나도 프론트가 멈추지 않게 최소 포맷으로 반환
    return res.status(200).json({
      story: "GM: (서버 오류가 났어. 잠시 후 다시 시도해줘.)",
      choices: [
        { id: "retry1", text: "다시 시도한다" },
        { id: "retry2", text: "조금 쉬었다가 진행한다" },
        { id: "retry3", text: "상황을 다시 정리해 말한다" },
      ],
      statePatch: {},
      _error: String(err?.message || err),
    });
  }
};

