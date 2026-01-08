// /api/story.js — Vercel Serverless (ESM)
// 목적: Gemini GM -> {story, choices(3), statePatch} JSON으로 반환
// 핵심: "원작(해리포터 등) 캐논 인물/장소/고유명사 절대 금지"를 프롬프트+필터로 강제

import { GoogleGenAI } from "@google/genai";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function fallback(reason = "") {
  return {
    story: reason
      ? `⚠️ GM 오류/제약 위반: ${reason}\n(다시 시도해줘)`
      : "GM이 상황을 정리 중이다. 잠시 후 다시 시도해줘.",
    choices: [
      { id: "retry1", text: "다시 시도한다" },
      { id: "retry2", text: "입력을 더 구체적으로 한다" },
      { id: "retry3", text: "장면을 바꿔 진행한다" }
    ],
    statePatch: {}
  };
}

/** Gemini가 JSON 외 텍스트를 섞어도 JSON 객체만 뽑아내기 */
function safeJsonParse(raw) {
  if (!raw) return null;
  let t = String(raw).trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e === -1 || e <= s) return null;
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
}

function normalize(out) {
  const story = String(out?.story ?? "").trim();
  const rawChoices = Array.isArray(out?.choices) ? out.choices : [];
  const choices = rawChoices.slice(0, 3).map((c, i) => ({
    id: String(c?.id ?? `${i + 1}`),
    text: String(c?.text ?? "").trim() || `선택지 ${i + 1}`
  }));
  while (choices.length < 3) {
    const i = choices.length;
    choices.push({ id: `${i + 1}`, text: `선택지 ${i + 1}` });
  }
  const statePatch =
    out?.statePatch && typeof out.statePatch === "object" && !Array.isArray(out.statePatch)
      ? out.statePatch
      : {};
  return { story: story || "…(GM이 잠시 말이 없다. 다시 시도해줘.)", choices, statePatch };
}

/**
 * ❗원작/캐논/IP 고유명사 금지 필터
 * - "원작 인물 등장" 문제를 서버에서 확실히 잡아냄
 * - 필요하면 금지어를 더 추가하면 됨
 */


// 대소문자 무시 검사(영문 포함)
function containsBanned(text) {
  const lower = String(text || "").toLowerCase();
  return BANNED.find(w => lower.includes(String(w).toLowerCase())) || null;
}

// 응답에서 금지어를 “치환”해도 되지만, 여기서는 더 강하게 "재생성" 트리거로 사용
function scanForBanned(payloadObj) {
  const all = [
    payloadObj?.story || "",
    ...(payloadObj?.choices || []).map(c => c?.text || ""),
  ].join("\n");
  return containsBanned(all);
}

function buildSystemInstruction({ allowHighViolence = false } = {}) {
  return [
    // 최우선: IP/원작 배제
    "너는 '완전히 오리지널' 다크 판타지 로맨스 TRPG의 GM이다.",
    "절대 특정 원작/캐논/IP(예: 해리포터 등)의 인물/지명/학교/기숙사/마법 주문/설정 고유명사를 사용하지 마라.",
    "원작을 연상시키는 직접적인 고유명사(해리, 호그와트, 그리핀도르 등)나 등장인물을 절대 출력하지 마라.",
    "위 규칙을 어기면 즉시 출력물을 폐기하고, 오리지널 명칭으로 다시 작성해야 한다.",

    // 출력 규격
    "항상 한국어로 출력한다.",
    "반드시 JSON 객체만 응답한다(설명/코드펜스/추가 텍스트 금지).",
    "JSON 형식: {story:string, choices:[{id,text}*3], statePatch:object}",
    "스토리 1~3문단 + 선택지 정확히 3개.",
    "선택지는 서로 다른 성격(감정/행동/위험)을 가져야 하며, 직전 선택지와 유사 반복 금지.",

    // 수위/안전(유혈은 가능하되 과도한 묘사는 피함)
    allowHighViolence
    
    "모든 주요 인물은 성인(18+)이다."
  ].join(" ");
}

function buildUserPrompt({ game, state, history, userText, lastChoices }) {
  const title = String(game?.title ?? "게임").trim();
  const genre = String(game?.genre ?? "").trim();
  const seed = String(game?.seed ?? "").trim();

  const historyText = (history || [])
    .slice(-20)
    .map(m => `${m.role}: ${String(m.text ?? "").trim()}`)
    .filter(Boolean)
    .join("\n");

  return [
    `게임 제목: ${title}`,
    genre ? `장르/톤: ${genre}` : "",
    seed ? `설정(Seed): ${seed}` : "",

    "",
    "현재 상태(state) JSON:",
    JSON.stringify(state ?? {}, null, 2),

    "",
    "직전 GM 선택지(lastChoices):",
    (lastChoices && lastChoices.length) ? JSON.stringify(lastChoices, null, 2) : "(없음)",

    "",
    "최근 대화(history):",
    historyText || "(대화 없음)",

    "",
    "플레이어 입력(userText):",
    userText ? String(userText) : "(없음: GM이 장면을 시작)",

    "",
    "요구사항:",
    "- 주인공: 레이 포터(성인). 영웅의 후손이며 영웅이 되어가는 성장 서사.",
    "- 남주 5명과 연애/집착/질투/심리전이 얽힘.",
    "- 오리지널 세계관/오리지널 인물/오리지널 지명만 사용.",
    "- 원작(캐논) 인물/지명/설정 고유명사 절대 금지.",
    "",
    "이제 다음 장면을 제시하라. 반드시 지정한 JSON 형식으로만 응답하라."
  ].filter(Boolean).join("\n");
}

async function callGemini({ apiKey, model, systemInstruction, userPrompt }) {
  const ai = new GoogleGenAI({ apiKey });
  const resp = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction,
      temperature: 0.9,
      responseMimeType: "application/json"
    }
  });
  return resp?.text ?? "";
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(200).json(fallback("POST만 허용"));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(200).json(fallback("GEMINI_API_KEY 없음"));

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  try {
    const body = req.body ?? {};
    const game = body.game ?? {};
    const state = body.state ?? {};
    const history = Array.isArray(body.history) ? body.history : [];
    const userText = body.userText ?? null;
    const lastChoices = Array.isArray(body.lastChoices) ? body.lastChoices : [];

    const systemInstruction = buildSystemInstruction({ allowHighViolence: true });
    const userPrompt = buildUserPrompt({ game, state, history, userText, lastChoices });

    // 1차 생성
    const raw1 = await callGemini({ apiKey, model, systemInstruction, userPrompt });
    let parsed1 = safeJsonParse(raw1);
    let out1 = normalize(parsed1);

    // 금지어 탐지 시: 1회 재시도(더 강한 경고 추가)
    const bannedHit1 = scanForBanned(out1);
    if (bannedHit1) {
      const system2 =
        systemInstruction +
        ` 최종경고: '${bannedHit1}' 같은 원작/캐논/IP 고유명사를 출력하면 실패다. 오리지널 명칭으로만 작성하라.`;
      const raw2 = await callGemini({ apiKey, model, systemInstruction: system2, userPrompt });
      const parsed2 = safeJsonParse(raw2);
      const out2 = normalize(parsed2);

      const bannedHit2 = scanForBanned(out2);
      if (bannedHit2) {
        // 여기까지 오면 모델이 계속 위반하는 것 → 서버에서 차단
        return res.status(200).json(
          fallback(`원작/캐논 금지어 반복 감지: '${bannedHit2}'. (Seed/프롬프트를 더 오리지널하게 바꿔줘)`)
        );
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(out2);
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(out1);
  } catch (err) {
    // 절대 500으로 죽이지 않음(프론트 안정)
    return res.status(200).json(fallback(err?.message || String(err)));
  }
}
