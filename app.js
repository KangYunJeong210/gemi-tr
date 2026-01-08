// app.js (CSS 안 깨지게: 기존 카톡형 UI 클래스 유지 + 게임 목록 카드 스타일 강제)
// - 게임 목록 항목에 "다중 클래스" 적용: 프로젝트 CSS가 어떤 이름을 쓰든 대부분 맞게 걸림

import { loadAll, newGame, upsertGame, getGame } from "./storage.js";

const API_URL = "/api/story";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);

const now = () => Date.now();

const ui = {
  screen: "list",
  activeId: null,
  sending: false,
};

function ensureSkeleton() {
  let root = $("#app") || document.body;

  let list = $("#screenList") || $(".screen.list", root);
  let chat = $("#screenChat") || $(".screen.chat", root);

  if (!list && !chat) {
    root.innerHTML = `
      <section id="screenList" class="screen list">
        <header class="topbar">
          <div class="topbar__left"></div>
          <div class="topbar__title">새 게임</div>
          <div class="topbar__right"></div>
        </header>

        <div class="panel card">
          <div class="field">
            <label>게임 제목</label>
            <input id="titleInput" class="input" placeholder="예: 호그와트 1학년 (오리지널로 바꿔도 됨)" />
          </div>

          <div class="field">
            <label>장르/톤(선택)</label>
            <input id="genreInput" class="input" placeholder="예: 다크 로맨스, 미스터리, 학원 TRPG" />
          </div>

          <div class="field">
            <label>초기 설정(Seed)</label>
            <textarea id="seedInput" class="textarea" placeholder="주인공/금지요소/진행방식/남주 5인/수위/배경 등"></textarea>
          </div>

          <button id="createBtn" class="btn primary">만들기</button>
        </div>

        <div class="panel card">
          <div class="panel__title">게임 목록</div>
          <div id="gamesList" class="games game-list list"></div>
        </div>
      </section>

      <section id="screenChat" class="screen chat" style="display:none;">
        <header class="topbar">
          <button id="backBtn" class="icon-btn" aria-label="Back">←</button>
          <div id="chatTitle" class="topbar__title">게임</div>
          <div class="topbar__right">
            <button id="restartBtn" class="icon-btn" aria-label="Restart">⟳</button>
          </div>
        </header>

        <main class="chat">
          <div id="chatFeed" class="chat__feed"></div>
          <div id="choiceList" class="choices"></div>

          <div class="composer">
            <input id="freeInput" class="composer__input" placeholder="직접 입력(선택)" />
            <button id="sendBtn" class="composer__send btn">전송</button>
          </div>
        </main>
      </section>
    `;
  }

  list = $("#screenList") || $(".screen.list", root);
  chat = $("#screenChat") || $(".screen.chat", root);

  return { root, list, chat };
}

function showScreen(name) {
  const { list, chat } = ensureSkeleton();
  if (name === "list") {
    list.style.display = "";
    chat.style.display = "none";
    ui.screen = "list";
  } else {
    list.style.display = "none";
    chat.style.display = "";
    ui.screen = "chat";
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function scrollFeedToBottom() {
  const feed = $("#chatFeed");
  if (!feed) return;
  feed.scrollTop = feed.scrollHeight;
}

/* -------------------- LIST -------------------- */

function renderList() {
  showScreen("list");
  const data = loadAll();

  const gamesList = $("#gamesList");
  if (gamesList) {
    if (!data.games.length) {
      gamesList.innerHTML = `<div class="empty muted">아직 게임이 없어요. 위에서 새 게임을 만들어봐!</div>`;
    } else {
      gamesList.innerHTML = data.games
        .map((g) => {
          // ✅ 다중 클래스: 네 styles.css에 어떤 이름이 있든 대부분 걸리게
          // - game-card / game-item / list-item / btn / card
          return `
            <button
              type="button"
              class="game-card game-item list-item btn card ghost"
              data-id="${g.id}"
            >
              <div class="game-card__title title">${escapeHtml(g.title || "무제")}</div>
              <div class="game-card__meta meta muted">${escapeHtml(g.genre || "")}</div>
            </button>
          `;
        })
        .join("");

      $$(".game-card", gamesList).forEach((btn) => {
        btn.onclick = () => openGame(btn.dataset.id);
      });
    }
  }

  const createBtn = $("#createBtn");
  if (createBtn) {
    createBtn.onclick = () => {
      const title = ($("#titleInput")?.value ?? "").trim() || "새 게임";
      const genre = ($("#genreInput")?.value ?? "").trim();
      const seed = ($("#seedInput")?.value ?? "").trim();

      const g = newGame({ title, genre, seed });
      upsertGame(g);

      ui.activeId = g.id;
      renderChat();
      gmStep({ userText: null, choiceId: null });
    };
  }
}

/* -------------------- CHAT -------------------- */

function renderChat() {
  showScreen("chat");
  const g = getGame(ui.activeId);
  if (!g) {
    renderList();
    return;
  }

  const chatTitle = $("#chatTitle");
  if (chatTitle) chatTitle.textContent = g.title || "게임";

  const feed = $("#chatFeed");
  if (feed) {
    feed.innerHTML = g.messages
      .map((m) => {
        const roleClass = m.role === "me" ? "me" : "gm";
        return `
          <div class="msg ${roleClass}">
            <div class="bubble">${escapeHtml(m.text)}</div>
          </div>
        `;
      })
      .join("");
  }

  const choiceList = $("#choiceList");
  if (choiceList) {
    choiceList.innerHTML = (g.pendingChoices || [])
      .slice(0, 3)
      .map(
        (c, idx) => `
        <button type="button" class="choice-btn btn" data-id="${escapeHtml(c.id)}" data-text="${escapeHtml(c.text)}">
          ${idx + 1}. ${escapeHtml(c.text)}
        </button>
      `
      )
      .join("");

    $$(".choice-btn", choiceList).forEach((btn) => {
      btn.onclick = () => choose(btn.dataset.id, btn.dataset.text);
    });
  }

  const backBtn = $("#backBtn");
  if (backBtn) backBtn.onclick = () => renderList();

  const sendBtn = $("#sendBtn");
  if (sendBtn) {
    sendBtn.onclick = () => {
      const input = $("#freeInput");
      const t = (input?.value ?? "").trim();
      if (!t) return;
      if (input) input.value = "";
      choose(null, t);
    };
  }

  const restartBtn = $("#restartBtn");
  if (restartBtn) {
    restartBtn.onclick = () => {
      const keep = getGame(ui.activeId);
      if (!keep) return;

      const fresh = newGame({ title: keep.title, genre: keep.genre, seed: keep.seed });
      upsertGame(fresh);

      ui.activeId = fresh.id;
      renderChat();
      gmStep({ userText: null, choiceId: null });
    };
  }

  scrollFeedToBottom();
}

function pushMsg(gameId, role, text) {
  const g = getGame(gameId);
  if (!g) return;
  g.messages.push({ id: uid(), role, text, ts: now() });
  upsertGame(g);
}

function applyGM(gameId, out) {
  const g = getGame(gameId);
  if (!g) return;

  g.messages.push({
    id: uid(),
    role: "gm",
    text: String(out.story ?? "").trim() || "…",
    ts: now(),
  });

  g.pendingChoices = Array.isArray(out.choices) ? out.choices.slice(0, 3) : [];
  g.state = { ...(g.state || {}), ...(out.statePatch || {}) };

  while (g.pendingChoices.length < 3) {
    const i = g.pendingChoices.length + 1;
    g.pendingChoices.push({ id: `${i}`, text: `선택지 ${i}` });
  }

  upsertGame(g);
}

async function gmStep({ userText, choiceId }) {
  const gameId = ui.activeId;
  const g = getGame(gameId);
  if (!g || ui.sending) return;

  ui.sending = true;

  const payload = {
    game: { title: g.title, genre: g.genre, seed: g.seed },
    state: g.state || {},
    history: (g.messages || []).slice(-20).map((m) => ({ role: m.role, text: m.text })),
    userText,
    choiceId,
    lastChoices: (g.pendingChoices || []).map((c) => ({ id: c.id, text: c.text })),
  };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    let out;
    try {
      out = JSON.parse(raw);
    } catch {
      out = { story: `⚠️ 서버 응답 파싱 실패\n${raw}`, choices: [], statePatch: {} };
    }

    applyGM(gameId, out);
    renderChat();
  } catch (err) {
    pushMsg(gameId, "gm", `⚠️ /api/story 호출 실패: ${err?.message || err}`);
    const gg = getGame(gameId);
    gg.pendingChoices = [
      { id: "retry1", text: "다시 시도한다" },
      { id: "retry2", text: "설정을 조정한다" },
      { id: "retry3", text: "목록으로 돌아간다" },
    ];
    upsertGame(gg);
    renderChat();
  } finally {
    ui.sending = false;
  }
}

function choose(choiceId, text) {
  const g = getGame(ui.activeId);
  if (!g) return;

  pushMsg(g.id, "me", text);
  renderChat();
  gmStep({ userText: text, choiceId });
}

function openGame(id) {
  ui.activeId = id;
  renderChat();
}

/* -------------------- boot -------------------- */

(function boot() {
  ensureSkeleton();
  renderList();
})();

window.openGame = openGame;
window.choose = choose;
window.toList = renderList;
