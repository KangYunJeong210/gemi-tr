const KEY = "trpg_games_v1";

export function loadAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : { games: [], lastOpenId: null };
    if (!data.games) data.games = [];
    return data;
  } catch {
    return { games: [], lastOpenId: null };
  }
}

export function saveAll(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function newGame({ title, genre, seed }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  return {
    id,
    title: title?.trim() || "새 게임",
    genre: genre?.trim() || "",
    seed: seed?.trim() || "",
    createdAt: now,
    updatedAt: now,

    // 상태(LLM에 같이 보낼 것)
    state: {
      turn: 0,
      flags: {},
      // 필요하면 능력치/인벤토리/호감도 등을 여기에
    },

    // 대화 로그
    messages: [
      {
        id: crypto.randomUUID(),
        role: "system",
        text:
          "GM이 이야기를 시작합니다. 아래 선택지로 진행하거나, 직접 입력으로 행동을 적어도 됩니다.",
        ts: now,
      },
    ],

    // 마지막 GM이 제시한 선택지
    pendingChoices: [],
  };
}

export function upsertGame(game) {
  const data = loadAll();
  const idx = data.games.findIndex(g => g.id === game.id);
  game.updatedAt = Date.now();
  if (idx === -1) data.games.unshift(game);
  else data.games[idx] = game;
  data.lastOpenId = game.id;
  saveAll(data);
  return data;
}

export function deleteGame(id) {
  const data = loadAll();
  data.games = data.games.filter(g => g.id !== id);
  if (data.lastOpenId === id) data.lastOpenId = data.games[0]?.id ?? null;
  saveAll(data);
  return data;
}

export function getGame(id) {
  const data = loadAll();
  return data.games.find(g => g.id === id) || null;
}

export function resetGameChat(id) {
  const data = loadAll();
  const g = data.games.find(x => x.id === id);
  if (!g) return null;
  const now = Date.now();
  g.state = { turn: 0, flags: {} };
  g.messages = [
    { id: crypto.randomUUID(), role: "system", text: "GM이 이야기를 새로 시작합니다.", ts: now }
  ];
  g.pendingChoices = [];
  g.updatedAt = now;
  saveAll(data);
  return g;
}
