// app.js
import {
  loadAll,
  saveAll,
  newGame,
  upsertGame,
  getGame,
} from "./storage.js";

const API_URL = "/api/story";
const app = document.getElementById("app");

let ui = {
  screen: "list",
  activeGameId: null,
  draft: { title: "", genre: "", seed: "" },
  sending: false,
};

/* -------------------- render -------------------- */

function render() {
  app.innerHTML = "";
  if (ui.screen === "list") renderList();
  else renderChat();
}

/* -------------------- list -------------------- */

function renderList() {
  const data = loadAll();

  app.innerHTML = `
    <div class="screen">
      <h2>새 게임</h2>

      <input placeholder="게임 제목"
        value="${ui.draft.title}"
        oninput="this.dispatchEvent(new CustomEvent('t',{detail:this.value}))"
      />

      <input placeholder="장르/톤"
        value="${ui.draft.genre}"
        oninput="this.dispatchEvent(new CustomEvent('g',{detail:this.value}))"
      />

      <textarea placeholder="초기 설정(주인공 설정, 금지 요소, 진행 방식 등)"
        oninput="this.dispatchEvent(new CustomEvent('s',{detail:this.value}))"
      >${ui.draft.seed}</textarea>

      <button id="create">만들기</button>

      <hr/>

      ${data.games.map(g => `
        <button onclick="window.openGame('${g.id}')">
          ▶ ${g.title}
        </button>
      `).join("")}
    </div>
  `;

  app.querySelector("input[placeholder='게임 제목']")
    .addEventListener("t", e => ui.draft.title = e.detail);

  app.querySelector("input[placeholder='장르/톤']")
    .addEventListener("g", e => ui.draft.genre = e.detail);

  app.querySelector("textarea")
    .addEventListener("s", e => ui.draft.seed = e.detail);

  document.getElementById("create").onclick = () => {
    const g = newGame({
      title: ui.draft.title,
      genre: ui.draft.genre,
      seed: ui.draft.seed,
    });
    upsertGame(g);
    ui.activeGameId = g.id;
    ui.screen = "chat";
    render();
    gmStep(null);
  };
}

/* -------------------- chat -------------------- */

function renderChat() {
  const g = getGame(ui.activeGameId);
  if (!g) return;

  app.innerHTML = `
    <div class="screen">
      <h3>${g.title}</h3>
      <div class="feed">
        ${g.messages.map(m => `
          <div class="${m.role}">
            ${m.text}
          </div>
        `).join("")}
      </div>

      <div class="choices">
        ${g.pendingChoices.map(c => `
          <button onclick="window.choose('${c.id}','${c.text}')">
            ${c.text}
          </button>
        `).join("")}
      </div>

      <input id="free" placeholder="직접 입력(선택)"/>
      <button id="send">전송</button>

      <button onclick="window.toList()">← 목록</button>
    </div>
  `;

  document.getElementById("send").onclick = () => {
    const t = document.getElementById("free").value.trim();
    if (t) choose(null, t);
  };
}

/* -------------------- flow -------------------- */

async function gmStep(userText, choiceId = null) {
  const g = getGame(ui.activeGameId);
  if (!g || ui.sending) return;

  ui.sending = true;

  const payload = {
    game: {
      title: g.title,
      genre: g.genre,
      seed: g.seed,
    },
    state: g.state,
    history: g.messages.slice(-20),
    userText,
    choiceId,
    lastChoices: g.pendingChoices,
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const out = await res.json();

  g.messages.push({ role: "gm", text: out.story });
  g.pendingChoices = out.choices;
  g.state = { ...g.state, ...out.statePatch };

  upsertGame(g);
  ui.sending = false;
  render();
}

/* -------------------- globals -------------------- */

window.choose = (id, text) => {
  const g = getGame(ui.activeGameId);
  g.messages.push({ role: "me", text });
  upsertGame(g);
  render();
  gmStep(text, id);
};

window.openGame = (id) => {
  ui.activeGameId = id;
  ui.screen = "chat";
  render();
};

window.toList = () => {
  ui.screen = "list";
  render();
};

render();
