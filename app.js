// 내 업무페이지 - 일정 / 사업공고 / 할 일 / 메모
// 개인 데이터는 브라우저 localStorage 에 저장되고, 공고는 data/notices.json 에서 읽는다.

const KINDS = { work: "업무", meeting: "회의", deadline: "마감", personal: "개인" };
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
  todos: store.get("todos", []),
  links: store.get("links", [
    { name: "기업마당", url: "https://www.bizinfo.go.kr" },
    { name: "K-Startup", url: "https://www.k-startup.go.kr" },
    { name: "나라장터", url: "https://www.g2b.go.kr" },
  ]),
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
  const today = todayStr();
  const evs = state.events.filter((e) => e.date === today).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  $("#homeToday").innerHTML = evs.length
    ? evs.map((e) => `<li><span class="dot k-${e.kind}"></span><span>${esc(e.time || "종일")}</span><span class="grow">${esc(e.title)}</span></li>`).join("")
    : `<li class="empty">오늘 일정이 없습니다.</li>`;

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

  $("#links").innerHTML = state.links.map((l, i) =>
    `<span class="chip"><a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.name)}</a><button class="icon" data-link-del="${i}" title="삭제">×</button></span>`).join("");
}

$("#homeTodo").addEventListener("change", (e) => {
  const id = e.target.dataset.todo;
  if (id) toggleTodo(id);
});
$("#links").addEventListener("click", (e) => {
  const i = e.target.dataset.linkDel;
  if (i == null) return;
  state.links.splice(Number(i), 1);
  store.set("links", state.links);
  renderHome();
});
$("#linkForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  state.links.push({ name: f.name.value.trim(), url: f.url.value.trim() });
  store.set("links", state.links);
  f.reset();
  renderHome();
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
  $("#dayTitle").textContent = ds ? `${ds} 일정` : "일정 추가";
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
  const filter = $("#nFilter").value;
  const sort = $("#nSort").value;

  let list = filter === "star" ? Object.values(state.stars) : state.notices.slice();
  if (src) list = list.filter((n) => n.source === src);
  if (q) list = list.filter((n) => [n.title, n.org, n.category, n.summary].join(" ").toLowerCase().includes(q));
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

["#nSearch", "#nSource", "#nFilter", "#nSort"].forEach((s) => $(s).addEventListener("input", renderNotices));

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

// ---------------------------------------------------------------- 백업

$("#exportBtn").addEventListener("click", () => {
  const data = { events: state.events, todos: state.todos, links: state.links, stars: state.stars, memo: state.memo };
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
    for (const k of ["events", "todos", "links", "stars", "memo"]) {
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
