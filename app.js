import { loadAll, saveAll, newGame, upsertGame, deleteGame, getGame, resetGameChat } from "./storage.js";

const API_URL = "/api/story"; // Vercel 서버리스에 만들 예정

const app = document.querySelector("#app");

let ui = {
  screen: "list", // list | chat
  activeGameId: null,
  draft: { title: "", genre: "", seed: "" },
  sending: false,
};

// ---------- UI Helpers ----------
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function fmtTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function scrollToBottom(feed) {
  feed.scrollTop = feed.scrollHeight;
}

// ---------- Render ----------
function render() {
  app.innerHTML = "";

  if (ui.screen === "list") {
    renderList();
  } else {
    renderChat();
  }
}

function renderList() {
  const tpl = document.querySelector("#tpl-list");
  const node = tpl.content.cloneNode(true);
  app.appendChild(node);

  const root = app.querySelector(".screen");
  const data = loadAll();

  // binds
  const titleEl = root.querySelector('[data-bind="newTitle"]');
  const genreEl = root.querySelector('[data-bind="newGenre"]');
  const seedEl = root.querySelector('[data-bind="newSeed"]');

  titleEl.value = ui.draft.title;
  genreEl.value = ui.draft.genre;
  seedEl.value = ui.draft.seed;

  titleEl.addEventListener("input", e => (ui.draft.title = e.target.value));
  genreEl.addEventListener("input", e => (ui.draft.genre = e.target.value));
  seedEl.addEventListener("input", e => (ui.draft.seed = e.target.value));

  // list
  const list = root.querySelector('[data-slot="game-list"]');
  if (!data.games.length) {
    list.appendChild(el(`<div style="color:var(--muted); font-size:13px; padding:10px 2px;">아직 게임이 없어요. 위에서 새 게임을 만들어봐!</div>`));
  } else {
    data.games
      .slice()
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .forEach(g => {
        const item = el(`
          <div class="gameitem">
            <div class="gameitem__meta">
              <div class="gameitem__title"></div>
              <div class="gameitem__sub"></div>
            </div>
            <div class="gameitem__actions">
              <button class="btn btn--primary" data-action="open">이어하기</button>
              <button class="btn" data-action="delete">삭제</button>
            </div>
          </div>
        `);
        item.querySelector(".gameitem__title").textContent = g.title;
        item.querySelector(".gameitem__sub").textContent =
          `${g.genre ? g.genre + " · " : ""}${new Date(g.updatedAt).toLocaleString("ko-KR")}`;

        item.querySelector('[data-action="open"]').addEventListener("click", () => openGame(g.id));
        item.querySelector('[data-action="delete"]').addEventListener("click", () => {
          if (confirm(`"${g.title}" 게임을 삭제할까?`)) {
            deleteGame(g.id);
            render();
          }
        });
        list.appendChild(item);
      });
  }

  // new game
  root.querySelector('[data-action="new-game"]').addEventListener("click", () => {
    const g = newGame({ title: ui.draft.title, genre: ui.draft.genre, seed: ui.draft.seed });
    upsertGame(g);
    ui.draft = { title: "", genre: "", seed: "" };
    openGame(g.id, { autoStart: true });
  });
}

function renderChat() {
  const tpl = document.querySelector("#tpl-chat");
  const node = tpl.content.cloneNode(true);
  app.appendChild(node);

  const root = app.querySelector(".screen");
  const g = getGame(ui.activeGameId);

  if (!g) {
    ui.screen = "list";
    ui.activeGameId = null;
    render();
    return;
  }

  root.querySelector('[data-slot="game-title"]').textContent = g.title;

  const feed = root.querySelector('[data-slot="feed"]');
  const choicesBox = root.querySelector('[data-slot="choices"]');
  const input = root.querySelector('[data-bind="userText"]');

  // topbar actions
  root.querySelector('[data-action="to-list"]').addEventListener("click", () => {
    ui.screen = "list";
    render();
  });
  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    upsertGame(g);
    toast("저장했어 💾");
  });
  root.querySelector('[data-action="reset-chat"]').addEventListener("click", () => {
    if (!confirm("이 게임의 진행을 리셋할까? (대화/상태 초기화)")) return;
    resetGameChat(g.id);
    render();
  });

  // render messages
  g.messages.forEach(m => {
    if (m.role === "system") {
      feed.appendChild(renderSystem(m));
    } else if (m.role === "me") {
      feed.appendChild(renderBubble("me", "나", m.text, m.ts));
    } else {
      feed.appendChild(renderBubble("gm", "GM", m.text, m.ts));
    }
  });

  // render choices
  renderChoices(choicesBox, g, ui.sending);

  // composer
  root.querySelector('[data-action="composer"]').addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = (input.value || "").trim();
    if (!text) return;
    input.value = "";
    await onUserAction({ type: "freeText", text });
  });

  // scroll
  requestAnimationFrame(() => scrollToBottom(feed));
}

function renderSystem(m) {
  return el(`
    <div class="msg">
      <div class="msg__meta"><span class="msg__tag">ℹ️ 시스템</span> · ${fmtTime(m.ts)}</div>
      <div class="msg__row">
        <div class="msg__bubble" style="background: rgba(255,255,255,.04)">${escapeHtml(m.text)}</div>
      </div>
    </div>
  `);
}

function renderBubble(who, name, text, ts) {
  const cls = who === "me" ? "msg msg--me" : "msg";
  return el(`
    <div class="${cls}">
      <div class="msg__meta">${who === "me" ? `${fmtTime(ts)} · 나` : `GM · ${fmtTime(ts)}`}</div>
      <div class="msg__row">
        <div class="msg__bubble">${escapeHtml(text)}</div>
      </div>
    </div>
  `);
}

function renderChoices(box, game, disabled) {
  box.innerHTML = "";
  const choices = game.pendingChoices || [];

  if (!choices.length) {
    box.appendChild(el(`<div style="color:var(--muted); font-size:12px; padding:4px 2px;">선택지가 없으면 위 입력창으로 행동을 적어도 돼.</div>`));
    return;
  }

  choices.slice(0, 3).forEach((c, idx) => {
    const btn = el(`<button class="choicebtn" ${disabled ? "disabled" : ""}></button>`);
    btn.textContent = `${idx + 1}. ${c.text}`;
    btn.addEventListener("click", async () => {
      await onUserAction({ type: "choice", choiceId: c.id, text: c.text });
    });
    box.appendChild(btn);
  });
}

// ---------- Game Flow ----------
async function openGame(id, { autoStart = false } = {}) {
  ui.activeGameId = id;
  ui.screen = "chat";
  render();

  const g = getGame(id);
  if (!g) return;

  // 처음 만든 직후면, 바로 GM 첫 장면 호출
  if (autoStart && g.state?.turn === 0 && (g.pendingChoices?.length ?? 0) === 0) {
    await gmStep({ gameId: id, userInput: null });
  }
}

async function onUserAction({ type, choiceId, text }) {
  const g = getGame(ui.activeGameId);
  if (!g || ui.sending) return;

  // 유저 메시지 추가
  g.messages.push({
    id: crypto.randomUUID(),
    role: "me",
    text,
    ts: Date.now(),
  });

  // 선택지 소비
  if (type === "choice") {
    g.lastChoiceId = choiceId;
  } else {
    g.lastChoiceId = null;
  }

  // UI 잠금 + 저장
  ui.sending = true;
  upsertGame(g);
  render();

  await gmStep({ gameId: g.id, userInput: text, choiceId: g.lastChoiceId });

  ui.sending = false;
  render();
}

async function gmStep({ gameId, userInput, choiceId }) {
  const g = getGame(gameId);
  if (!g) return;

  // 요청 payload (서버에서 이 구조를 받도록 만들면 됨)
  const payload = {
    game: {
      id: g.id,
      title: g.title,
      genre: g.genre,
      seed: g.seed,
    },
    state: g.state,
    history: g.messages.slice(-20).map(m => ({ role: m.role, text: m.text })), // 최근 20개만 보내기(가벼움)
    choiceId: choiceId || null,
    userText: userInput || null,
    ask: "스토리 1~3문단 + 선택지 3개를 한국어로.",
  };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`API ${res.status}`);
    const out = await res.json();

    // 기대 응답 포맷(권장):
    // { story: "....", choices:[{id,text},{id,text},{id,text}], statePatch:{...} }
    applyGMResponse(g, out);
    upsertGame(g);
  } catch (err) {
    // API 없거나 오류면 mock으로라도 진행 가능하게
    const mock = mockGM(payload);
    applyGMResponse(g, mock);
    upsertGame(g);
  }
}

function applyGMResponse(game, out) {
  const now = Date.now();
  const story = (out?.story ?? "").trim();
  const choices = Array.isArray(out?.choices) ? out.choices : [];

  if (out?.statePatch && typeof out.statePatch === "object") {
    game.state = { ...(game.state || {}), ...out.statePatch };
  }
  game.state.turn = (game.state.turn || 0) + 1;

  if (story) {
    game.messages.push({
      id: crypto.randomUUID(),
      role: "gm",
      text: story,
      ts: now,
    });
  } else {
    game.messages.push({
      id: crypto.randomUUID(),
      role: "gm",
      text: "…(GM 응답이 비어있어. 다시 시도해볼까?)",
      ts: now,
    });
  }

  game.pendingChoices = choices.slice(0, 3).map((c, i) => ({
    id: String(c.id ?? `c${game.state.turn}_${i}`),
    text: String(c.text ?? "").trim() || `선택지 ${i + 1}`,
  }));
}

function mockGM(payload) {
  const t = payload.state?.turn ?? 0;
  return {
    story:
      `GM(모의): 턴 ${t + 1}.\n` +
      `너는 다음 장면으로 넘어간다. (${payload.game?.genre || "기본"} 톤)\n` +
      (payload.userText ? `네 행동: "${payload.userText}"\n` : "") +
      `주변의 분위기가 살짝 변하고, 선택의 순간이 온다.`,
    choices: [
      { id: "a", text: "주변을 관찰한다" },
      { id: "b", text: "상대에게 말을 건다" },
      { id: "c", text: "조용히 다음 장소로 이동한다" },
    ],
    statePatch: {},
  };
}

// ---------- Toast ----------
let toastTimer = null;
function toast(text) {
  const t = el(`<div style="
    position:fixed; left:50%; bottom:24px; transform:translateX(-50%);
    background:rgba(0,0,0,.65); border:1px solid rgba(255,255,255,.12);
    padding:10px 12px; border-radius:14px; color:var(--text); z-index:9999;
    backdrop-filter: blur(10px); font-weight:800; font-size:13px;
  ">${escapeHtml(text)}</div>`);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 1200);
}

// ---------- Escape ----------
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- Boot ----------
(function boot() {
  const data = loadAll();
  // 마지막 열었던 게임이 있으면 목록에서 쉽게 이어가도록 유지(자동 진입은 원하면 바꿀 수 있음)
  render();
})();
