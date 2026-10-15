// 내 업무페이지 - 일정 / 사업공고 / 할 일 / 메모
// 개인 데이터는 브라우저 localStorage 에 저장되고, 공고는 data/notices.json 에서 읽는다.

const KINDS = { work: "업무", meeting: "회의", deadline: "마감", personal: "개인" };
// 처음 열었을 때 할 일 목록에 넣어두는 설정 작업
const SETUP_TODOS = [
  "[설정] claude.ai에서 GitHub 다시 연결 (Claude가 저장소에 올릴 수 있게)",
  "[설정] 기업마당 API 인증키 발급 (bizinfo.go.kr → 정책정보 개방)",
  "[설정] 공공데이터포털에서 K-Startup 사업공고 조회서비스 활용신청",
  "[설정] GitHub 저장소 Secrets에 BIZINFO_API_KEY, DATA_GO_KR_KEY 등록",
  "[설정] GitHub Actions에서 '사업공고 수집' 한 번 수동 실행",
  "[설정] GitHub Pages 켜기 (Settings → Pages)",
  "[설정] 관심 업종·지역·키워드를 Claude에게 알려주기",
];
const KIND_COLOR = { work: "var(--c-work)", meeting: "var(--c-meeting)", deadline: "var(--c-deadline)", personal: "var(--c-personal)" };

// ---------------------------------------------------------------- 저장소

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("mwp." + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("mwp." + key, JSON.stringify(value)); } catch { /* 저장 불가 환경 */ }
  },
};

const state = {
  events: store.get("events", []),
  todos: store.get("todos", null) ?? SETUP_TODOS.map((text, i) => ({ id: "setup" + i, text, due: "", done: false })),
  stars: store.get("stars", {}),     // 공고 id -> 공고 사본 (목록에서 빠져도 유지)
  memo: store.get("memo", ""),
  notices: [],
  noticeMeta: {},
  cal: { year: 0, month: 0, selected: "" },
};

// ---------------------------------------------------------------- 유틸

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 86400000);
}

function ddayBadge(end) {
  const n = daysUntil(end);
  if (n == null) return `<span class="badge">상시/미정</span>`;
  if (n < 0) return `<span class="badge closed">마감</span>`;
  const label = n === 0 ? "D-Day" : `D-${n}`;
  return `<span class="badge dday ${n <= 3 ? "urgent" : ""}">${label}</span>`;
}

function isNew(n) {
  const d = daysUntil(n.first_seen);
  return d != null && d >= -2; // 최근 3일 안에 처음 수집됨
}

// ---------------------------------------------------------------- 탭

function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + name));
  store.set("tab", name);
  location.hash = name;
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

// ---------------------------------------------------------------- 대시보드

function renderHome() {
  const deadlines = Object.values(state.stars)
    .filter((n) => { const d = daysUntil(n.end); return d != null && d >= 0 && d <= 7; })
    .sort((a, b) => a.end.localeCompare(b.end));
  $("#homeDeadline").innerHTML = deadlines.length
    ? deadlines.map((n) => `<li>${ddayBadge(n.end)}<a class="grow" href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(n.title)}</a></li>`).join("")
    : `<li class="empty">공고 탭에서 ★ 를 누르면 여기에 마감일이 표시됩니다.</li>`;

  const todos = state.todos.filter((t) => !t.done).slice(0, 8);
  $("#homeTodo").innerHTML = todos.length
    ? todos.map((t) => `<li><input type="checkbox" data-todo="${t.id}" style="width:auto"><span class="grow">${esc(t.text)}</span>${t.due ? ddayBadge(t.due) : ""}</li>`).join("")
    : `<li class="empty">남은 할 일이 없습니다.</li>`;

  const fresh = state.notices.filter(isNew);
  const freshShown = fresh.filter((n) => n.matched && n.matched.length).concat(fresh.filter((n) => !(n.matched && n.matched.length))).slice(0, 10);
  $("#homeNewCount").textContent = fresh.length ? `(${fresh.length}건)` : "";
  $("#homeNew").innerHTML = freshShown.length
    ? freshShown.map((n) => `<li><span class="badge">${esc(n.source)}</span>${(n.matched || []).map((k) => `<span class="badge new">${esc(k)}</span>`).join("")}<a class="grow" href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(n.title)}</a>${ddayBadge(n.end)}</li>`).join("")
    : `<li class="empty">최근 3일 동안 새 공고가 없습니다.</li>`;

}

$("#homeTodo").addEventListener("change", (e) => {
  const id = e.target.dataset.todo;
  if (id) toggleTodo(id);
});
// ---------------------------------------------------------------- 달력

function renderCalendar() {
  const { year, month } = state.cal;
  $("#calTitle").textContent = `${year}년 ${month + 1}월`;
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const today = todayStr();

  const byDate = {};
  for (const e of state.events) (byDate[e.date] ||= []).push(e);
  const added = new Set(state.events.map((e) => e.noticeId).filter(Boolean));
  for (const n of Object.values(state.stars)) {
    if (n.end && !added.has(n.id)) (byDate[n.end] ||= []).push({ title: "[마감] " + n.title, kind: "deadline", notice: true });
  }

  let html = ["일", "월", "화", "수", "목", "금", "토"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ds = ymd(d);
    const evs = (byDate[ds] || []).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    const cls = ["cell", d.getMonth() !== month && "other", ds === today && "today", ds === state.cal.selected && "selected", d.getDay() === 0 && "sun"].filter(Boolean).join(" ");
    html += `<div class="${cls}" data-date="${ds}"><span class="num">${d.getDate()}</span>` +
      evs.slice(0, 3).map((e) => `<div class="ev" style="background:${KIND_COLOR[e.kind]}" title="${esc(e.title)}">${esc((e.time ? e.time + " " : "") + e.title)}</div>`).join("") +
      (evs.length > 3 ? `<div class="more">+${evs.length - 3}</div>` : "") + `</div>`;
  }
  $("#calGrid").innerHTML = html;
  renderDay();
}

function renderDay() {
  const ds = state.cal.selected;
  const [y, m, d] = ds.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  $("#dayTitle").textContent = (ds === todayStr() ? "오늘 · " : "") + label;
  const evs = state.events.filter((e) => e.date === ds).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const added = new Set(state.events.map((e) => e.noticeId).filter(Boolean));
  const deadlines = Object.values(state.stars).filter((n) => n.end === ds && !added.has(n.id));
  $("#dayEvents").innerHTML =
    evs.map((e) => `<li><span class="dot k-${e.kind}"></span><span>${esc(e.time || "종일")}</span><a href="#" class="grow" data-edit="${e.id}">${esc(e.title)}</a><span class="badge">${KINDS[e.kind]}</span></li>`).join("") +
    deadlines.map((n) => `<li><span class="dot k-deadline"></span><a class="grow" href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">[마감] ${esc(n.title)}</a></li>`).join("") ||
    `<li class="empty">일정이 없습니다.</li>`;
}

function selectDate(ds) {
  state.cal.selected = ds;
  resetEventForm();
  renderCalendar();
}

function resetEventForm() {
  const f = $("#eventForm");
  f.reset();
  f.id.value = "";
  f.date.value = state.cal.selected || todayStr();
  $("#eventDelete").hidden = true;
  $("#formTitle").textContent = "일정 추가";
}

$("#calGrid").addEventListener("click", (e) => {
  const cell = e.target.closest(".cell");
  if (cell) selectDate(cell.dataset.date);
});
$("#calPrev").addEventListener("click", () => moveMonth(-1));
$("#calNext").addEventListener("click", () => moveMonth(1));
$("#calToday").addEventListener("click", () => {
  const t = new Date();
  state.cal.year = t.getFullYear(); state.cal.month = t.getMonth();
  selectDate(todayStr());
});
function moveMonth(delta) {
  const d = new Date(state.cal.year, state.cal.month + delta, 1);
  state.cal.year = d.getFullYear(); state.cal.month = d.getMonth();
  renderCalendar();
}

$("#dayEvents").addEventListener("click", (e) => {
  const id = e.target.dataset.edit;
  if (!id) return;
  e.preventDefault();
  const ev = state.events.find((x) => x.id === id);
  const f = $("#eventForm");
  for (const k of ["id", "title", "date", "time", "kind", "memo"]) f[k].value = ev[k] || "";
  $("#eventDelete").hidden = false;
  $("#formTitle").textContent = "일정 수정";
  f.title.focus();
});

$("#eventForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const data = { title: f.title.value.trim(), date: f.date.value, time: f.time.value, kind: f.kind.value, memo: f.memo.value.trim() };
  if (f.id.value) Object.assign(state.events.find((x) => x.id === f.id.value), data);
  else state.events.push({ id: uid(), ...data });
  store.set("events", state.events);
  state.cal.selected = data.date;
  const [y, m] = data.date.split("-").map(Number);
  state.cal.year = y; state.cal.month = m - 1;
  resetEventForm();
  renderAll();
});
$("#eventDelete").addEventListener("click", () => {
  const id = $("#eventForm").id.value;
  if (!id || !confirm("이 일정을 삭제할까요?")) return;
  state.events = state.events.filter((x) => x.id !== id);
  store.set("events", state.events);
  resetEventForm();
  renderAll();
});
$("#eventReset").addEventListener("click", resetEventForm);

// ---------------------------------------------------------------- 사업공고

async function loadNotices() {
  try {
    const res = await fetch("data/notices.json", { cache: "no-store" });
    const data = await res.json();
    state.notices = data.items || [];
    state.noticeMeta = data;
  } catch (err) {
    state.notices = [];
    state.noticeMeta = { error: String(err) };
  }
  const sources = [...new Set(state.notices.map((n) => n.source))];
  $("#nSource").innerHTML = `<option value="">전체 출처</option>` + sources.map((s) => `<option>${esc(s)}</option>`).join("");
  // 관심공고 사본을 최신 정보로 갱신
  for (const n of state.notices) if (state.stars[n.id]) state.stars[n.id] = n;
  store.set("stars", state.stars);
  renderAll();
}

function renderNotices() {
  const q = $("#nSearch").value.trim().toLowerCase();
  const src = $("#nSource").value;
  const region = $("#nRegion").value;
  store.set("region", region);
  const filter = $("#nFilter").value;
  const sort = $("#nSort").value;

  let list = filter === "star" ? Object.values(state.stars) : state.notices.slice();
  if (src) list = list.filter((n) => n.source === src);
  // 지역을 고르면 그 지역 공고와 전국 공고를 함께 보여준다
  if (region) list = list.filter((n) => !(n.regions && n.regions.length) || n.regions.includes(region));
  if (q) list = list.filter((n) => [n.title, n.org, n.category, n.summary, n.target].join(" ").toLowerCase().includes(q));
  if (filter === "open") list = list.filter((n) => { const d = daysUntil(n.end); return d == null || d >= 0; });
  if (filter === "matched") list = list.filter((n) => n.matched && n.matched.length);
  if (filter === "new") list = list.filter(isNew);
  if (sort === "deadline") list.sort((a, b) => (a.end || "9999").localeCompare(b.end || "9999"));
  else list.sort((a, b) => (b.first_seen || "").localeCompare(a.first_seen || "") || (b.posted || "").localeCompare(a.posted || ""));

  const m = state.noticeMeta;
  const updated = m.updated_at ? new Date(m.updated_at).toLocaleString("ko-KR") : "-";
  $("#nMeta").innerHTML = `${list.length}건 표시 · 마지막 수집 ${esc(updated)}` +
    (m.sample ? ` · <b>샘플 데이터입니다</b> (API 키 설정 후 실제 공고로 바뀝니다)` : "") +
    (m.error ? ` · 공고 파일을 읽지 못했습니다` : "") +
    (m.errors && m.errors.length ? ` · 수집 오류 ${m.errors.length}건` : "");

  $("#nList").innerHTML = list.length ? list.map((n) => `
    <div class="notice">
      <button class="star ${state.stars[n.id] ? "on" : ""}" data-star="${esc(n.id)}" title="관심공고">${state.stars[n.id] ? "★" : "☆"}</button>
      <div class="body">
        <div class="title"><a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(n.title)}</a></div>
        <div class="sub">
          ${isNew(n) ? `<span class="badge new">NEW</span>` : ""}
          <span class="badge">${esc(n.source)}</span>
          ${n.org ? `<span>${esc(n.org)}</span>` : ""}
          ${n.category ? `<span>· ${esc(n.category)}</span>` : ""}
          <span>· 접수 ${esc(n.start || "?")} ~ ${esc(n.end || "?")}</span>
        </div>
        <div class="facts">
          <span><b>지역</b> ${esc(n.regions && n.regions.length ? n.regions.join(", ") : "전국")}</span>
          ${n.target ? `<span><b>대상</b> ${esc(n.target)}</span>` : ""}
          ${n.age ? `<span><b>업력</b> ${esc(n.age)}</span>` : ""}
          ${n.contact ? `<span><b>문의</b> ${esc(n.contact)}</span>` : ""}
          ${(n.matched || []).map((k) => `<span class="badge new">#${esc(k)}</span>`).join("")}
        </div>
        ${n.summary ? `<div class="summary">${esc(n.summary)}</div>` : ""}
      </div>
      <div class="actions">
        ${ddayBadge(n.end)}
        ${!n.end ? "" : state.events.some((e) => e.noticeId === n.id)
          ? `<button class="ghost" disabled>일정 추가됨 ✓</button>`
          : `<button class="ghost" data-to-cal="${esc(n.id)}">일정에 추가</button>`}
      </div>
    </div>`).join("") : `<p class="meta">조건에 맞는 공고가 없습니다.</p>`;
}

$("#nRegion").value = store.get("region", "");
["#nSearch", "#nSource", "#nRegion", "#nFilter", "#nSort"].forEach((s) => $(s).addEventListener("input", renderNotices));

function findNotice(id) {
  return state.notices.find((n) => n.id === id) || state.stars[id];
}

$("#nList").addEventListener("click", (e) => {
  const starId = e.target.dataset.star;
  if (starId) {
    if (state.stars[starId]) delete state.stars[starId];
    else state.stars[starId] = findNotice(starId);
    store.set("stars", state.stars);
    renderAll();
    return;
  }
  const calId = e.target.dataset.toCal;
  if (calId) {
    const n = findNotice(calId);
    state.events.push({ id: uid(), title: "[공고마감] " + n.title, date: n.end, time: "", kind: "deadline", memo: n.url, noticeId: n.id });
    store.set("events", state.events);
    renderAll();
  }
});

// ---------------------------------------------------------------- 할 일 / 메모

function renderTodos() {
  const list = state.todos.slice().sort((a, b) => a.done - b.done || (a.due || "9999").localeCompare(b.due || "9999"));
  $("#todoList").innerHTML = list.length ? list.map((t) => `
    <li>
      <input type="checkbox" data-todo="${t.id}" ${t.done ? "checked" : ""} style="width:auto">
      <span class="grow" style="${t.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(t.text)}</span>
      ${t.due && !t.done ? ddayBadge(t.due) : ""}
      <button class="icon" data-todo-del="${t.id}" title="삭제">×</button>
    </li>`).join("") : `<li class="empty">할 일이 없습니다.</li>`;
}

function toggleTodo(id) {
  const t = state.todos.find((x) => x.id === id);
  if (t) t.done = !t.done;
  store.set("todos", state.todos);
  renderAll();
}

$("#todoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  state.todos.push({ id: uid(), text: f.text.value.trim(), due: f.due.value, done: false });
  store.set("todos", state.todos);
  f.reset();
  renderAll();
});
$("#todoList").addEventListener("click", (e) => {
  if (e.target.dataset.todo) toggleTodo(e.target.dataset.todo);
  if (e.target.dataset.todoDel) {
    state.todos = state.todos.filter((x) => x.id !== e.target.dataset.todoDel);
    store.set("todos", state.todos);
    renderAll();
  }
});

let memoTimer;
$("#memo").value = state.memo;
$("#memo").addEventListener("input", (e) => {
  clearTimeout(memoTimer);
  memoTimer = setTimeout(() => {
    state.memo = e.target.value;
    store.set("memo", state.memo);
    $("#memoSaved").textContent = "저장됨 " + new Date().toLocaleTimeString("ko-KR");
  }, 400);
});

// ---------------------------------------------------------------- Claude 검색창
// claude.ai 아티팩트로 열면 페이지 안에서 바로 답하고 일정·할 일도 추가한다.
// 그 밖의 곳(GitHub Pages 등)에서는 질문을 담아 claude.ai 새 대화를 연다.

let sampleFn = null;
let askCtl = null;
if (window.claude?.use) window.claude.use("sample").then((fn) => { sampleFn = fn; }).catch(() => {});

function pageContext() {
  const today = todayStr();
  const soon = state.events
    .filter((e) => { const d = daysUntil(e.date); return d != null && d >= -1 && d <= 30; })
    .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))
    .map((e) => `- ${e.date} ${e.time || "종일"} [${KINDS[e.kind]}] ${e.title}`);
  const todos = state.todos.filter((t) => !t.done).map((t) => `- ${t.text}${t.due ? " (기한 " + t.due + ")" : ""}`);
  const notices = state.notices
    .filter((n) => { const d = daysUntil(n.end); return d == null || d >= 0; })
    .slice(0, 60)
    .map((n) => `- [${n.id}] ${n.title} | ${n.org || ""} | 지역 ${(n.regions || []).join(",") || "전국"} | 대상 ${n.target || "-"} | 접수 ${n.start || "?"}~${n.end || "?"}${state.stars[n.id] ? " | ★관심" : ""}`);
  return `오늘: ${today} (${new Date().toLocaleDateString("ko-KR", { weekday: "long" })})

[앞으로 30일 일정]
${soon.join("\n") || "(없음)"}

[남은 할 일]
${todos.join("\n") || "(없음)"}

[접수중인 사업공고]
${notices.join("\n") || "(없음)"}`;
}

const ASK_TOOLS = [
  {
    name: "add_event",
    description: "사용자 달력에 일정을 추가한다. 날짜는 YYYY-MM-DD, 시간은 HH:MM(24시간, 없으면 빈 문자열). 추가된 일정을 돌려준다.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string" },
        time: { type: "string" },
        kind: { type: "string", enum: ["work", "meeting", "deadline", "personal"] },
        memo: { type: "string" },
      },
      required: ["title", "date"],
    },
    execute(input) {
      const date = String(input.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date는 YYYY-MM-DD 형식이어야 합니다");
      const time = /^\d{2}:\d{2}$/.test(String(input.time || "")) ? String(input.time) : "";
      const kind = KINDS[input.kind] ? String(input.kind) : "work";
      const ev = { id: uid(), title: String(input.title).slice(0, 200), date, time, kind, memo: String(input.memo || "") };
      state.events.push(ev);
      store.set("events", state.events);
      const [y, m] = date.split("-").map(Number);
      state.cal = { year: y, month: m - 1, selected: date };
      renderAll();
      return ev;
    },
  },
  {
    name: "add_todo",
    description: "할 일 목록에 항목을 추가한다. due는 YYYY-MM-DD 또는 빈 문자열.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" }, due: { type: "string" } },
      required: ["text"],
    },
    execute(input) {
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(input.due || "")) ? String(input.due) : "";
      const t = { id: uid(), text: String(input.text).slice(0, 200), due, done: false };
      state.todos.push(t);
      store.set("todos", state.todos);
      renderAll();
      return t;
    },
  },
  {
    name: "star_notice",
    description: "사업공고를 관심공고(★)로 표시한다. 공고 목록의 대괄호 안 id를 넘긴다. 관심공고 마감일은 달력에 표시된다.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    execute(input) {
      const n = state.notices.find((x) => x.id === String(input.id));
      if (!n) throw new Error("그런 id의 공고가 없습니다");
      state.stars[n.id] = n;
      store.set("stars", state.stars);
      renderAll();
      return { ok: true, title: n.title };
    },
  },
];

const ASK_ERRORS = {
  not_granted: "Claude 사용을 허용하지 않아 답할 수 없습니다.",
  sampling_disabled: "이 계정에서는 Claude를 쓸 수 없습니다.",
  rate_limited: "요청이 많습니다. 잠시 후 다시 물어봐 주세요.",
  session_expired: "claude.ai에 다시 로그인해 주세요.",
  refused: "이 질문에는 답할 수 없습니다. 다르게 물어봐 주세요.",
  prompt_too_large: "보낼 내용이 너무 깁니다.",
};

async function ask(question) {
  if (!sampleFn) {
    const q = `${question}\n\n(참고: 오늘은 ${todayStr()}입니다)`;
    window.open("https://claude.ai/new?q=" + encodeURIComponent(q), "_blank", "noopener");
    return;
  }
  const panel = $("#askPanel"), out = $("#askA"), note = $("#askNote");
  panel.hidden = false;
  $("#askQ").textContent = question;
  out.textContent = "생각하는 중…";
  note.textContent = "";
  $("#askBtn").disabled = true;
  $("#askStop").hidden = false;
  askCtl = new AbortController();
  const canUseTools = !!(await sampleFn.limits().catch(() => null))?.tools;
  const prompt = `너는 사용자의 개인 업무페이지에 있는 비서야. 아래 페이지 데이터를 보고 한국어로 짧고 바로 쓸 수 있게 답해.
일정이나 할 일을 추가해 달라고 하면 도구를 써서 실제로 추가하고, 무엇을 추가했는지 한 줄로 알려줘.
"다음 주 화요일" 같은 상대 날짜는 오늘 날짜를 기준으로 계산해. 마크다운 표나 제목은 쓰지 말고 평문과 짧은 목록만 써.

${pageContext()}

[질문]
${question}`;
  try {
    const { truncated } = await sampleFn(prompt, {
      signal: askCtl.signal,
      modelTier: "quick",
      ...(canUseTools ? { tools: ASK_TOOLS } : {}),
      onText: ({ text }) => { out.textContent = text; },
    });
    if (truncated) note.textContent = "답이 길어 중간에 끊겼습니다.";
  } catch (e) {
    out.textContent = e?.text ?? "";
    if (e?.code !== "cancelled") {
      note.textContent = ASK_ERRORS[e?.code] || "답을 받지 못했습니다. 다시 시도해 주세요.";
    }
    if (e?.code === "not_granted" || e?.code === "sampling_disabled") sampleFn = null;
  } finally {
    $("#askBtn").disabled = false;
    $("#askStop").hidden = true;
  }
}

$("#askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#askInput").value.trim();
  if (!q) return;
  $("#askInput").value = "";
  ask(q);
});
$("#askStop").addEventListener("click", () => askCtl?.abort());
$("#askClose").addEventListener("click", () => { askCtl?.abort(); $("#askPanel").hidden = true; });

// ---------------------------------------------------------------- 백업

$("#exportBtn").addEventListener("click", () => {
  const data = { events: state.events, todos: state.todos, stars: state.stars, memo: state.memo };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `업무페이지-백업-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm("현재 데이터를 백업 파일 내용으로 바꿀까요?")) return;
    for (const k of ["events", "todos", "stars", "memo"]) {
      if (data[k] !== undefined) { state[k] = data[k]; store.set(k, data[k]); }
    }
    $("#memo").value = state.memo;
    renderAll();
  } catch {
    alert("올바른 백업 파일이 아닙니다.");
  }
  e.target.value = "";
});

// ---------------------------------------------------------------- 시작

function renderAll() {
  renderHome();
  renderCalendar();
  renderNotices();
  renderTodos();
}

(function init() {
  const t = new Date();
  $("#todayLabel").textContent = t.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  state.cal = { year: t.getFullYear(), month: t.getMonth(), selected: todayStr() };
  resetEventForm();
  const tab = location.hash.slice(1) || store.get("tab", "home");
  showTab(document.getElementById("tab-" + tab) ? tab : "home");
  renderAll();
  loadNotices();
})();
