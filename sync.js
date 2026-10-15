// 여러 기기 동기화 (Firebase 무료 요금제)
// 아이디·비밀번호로 로그인하면 일정·할 일·업무·메모·관심공고를 Firestore 의 users/{내 uid}/data/{종류} 에 저장하고,
// 다른 기기에서 바뀌면 바로 받아온다. 보안 규칙은 firestore.rules 참고 (본인 칸만 읽고 쓰기).
// 이 파일을 못 불러오는 환경(예: claude.ai 미리보기)에서는 로그인 버튼이 안 보이고 기존처럼 이 기기에만 저장된다.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, doc, getDoc, setDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAFCCWL4yFJ0_B63jlVxmMucj2XNZfr5Hs",
  authDomain: "test-b773f.firebaseapp.com",
  projectId: "test-b773f",
  storageBucket: "test-b773f.firebasestorage.app",
  messagingSenderId: "554884672860",
  appId: "1:554884672860:web:7161e7369b34b9bacb2599",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });   // 오프라인에서도 동작

const $ = (s) => document.querySelector(s);
const solApp = window.solApp;
const statusEl = $("#syncStatus"), btn = $("#syncBtn");
const nudge = $("#loginNudge");
btn.disabled = false;

let user = null;
let unsubs = [];
const timers = {};

function setStatus(text, cls = "") {
  statusEl.textContent = text;
  statusEl.className = "sync-status " + cls;
}

const ref = (key) => doc(db, "users", user.uid, "data", key);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 처음 로그인하는 기기에서는 이 기기에 있던 것과 클라우드에 있던 것을 합친다 (같은 id 는 클라우드 쪽 유지).
// 그 뒤로는 클라우드가 기준이라, 다른 기기에서 지운 항목이 되살아나지 않는다.
function mergeFirst(key, local, remote) {
  if (remote == null) return local;
  if (Array.isArray(remote) && Array.isArray(local)) {
    const ids = new Set(remote.map((x) => x.id));
    return remote.concat(local.filter((x) => !ids.has(x.id)));
  }
  if (remote && typeof remote === "object" && local && typeof local === "object") return { ...local, ...remote };
  return remote;
}

async function upload(key, value) {
  if (!user) return;
  try {
    await setDoc(ref(key), { value, updatedAt: serverTimestamp() });
    setStatus("동기화됨 · " + toId(user.email), "ok");
  } catch (e) {
    console.error(e);
    setStatus("저장 실패 (다시 시도 중)", "err");
  }
}

// app.js 의 store.set 이 부른다. 연달아 바뀌면 0.4초 모아서 한 번에 올린다.
window.solSync = {
  ready: true,
  push(key, value) {
    if (!user) return;
    setStatus("저장 중…");
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => upload(key, value), 400);
  },
};

async function start() {
  const firstKey = "mwp.synced." + user.uid;
  const first = localStorage.getItem(firstKey) == null;
  setStatus("불러오는 중…");
  for (const key of solApp.SYNC_KEYS) {
    try {
      const snap = await getDoc(ref(key));
      const remote = snap.exists() ? snap.data().value : null;
      const local = solApp.hasLocal(key) ? solApp.get(key) : null;
      let value = first ? mergeFirst(key, local, remote) : remote;
      if (value == null) continue;
      if (!same(value, solApp.get(key))) solApp.apply(key, value);
      if (!same(value, remote)) await upload(key, value);
    } catch (e) {
      console.error(e);
      setStatus("불러오기 실패: " + (e.code || e.message), "err");
      return;
    }
  }
  localStorage.setItem(firstKey, "1");
  // 다른 기기에서 바뀌면 바로 반영
  unsubs = solApp.SYNC_KEYS.map((key) => onSnapshot(ref(key), (snap) => {
    if (snap.metadata.hasPendingWrites || !snap.exists()) return;   // 내가 방금 쓴 것은 건너뜀
    const value = snap.data().value;
    if (!same(value, solApp.get(key))) solApp.apply(key, value);
  }));
  setStatus("동기화됨 · " + toId(user.email), "ok");
}

onAuthStateChanged(auth, (u) => {
  unsubs.forEach((f) => f());
  unsubs = [];
  user = u;
  nudge.hidden = !!u || localStorage.getItem("mwp.nudgeLater") === "1";
  if (u) {
    btn.textContent = "로그아웃";
    btn.title = toId(u.email) + " 로그인 중";
    start();
  } else {
    btn.textContent = "로그인";
    btn.title = "로그인하면 다른 기기와 동기화돼요";
    setStatus("이 기기에만 저장", "");
  }
});

// 아이디는 Firebase 이메일 로그인에 맞춰 "아이디@solworks.store" 로 바꿔 쓴다 (실제 메일은 안 감).
const ID_DOMAIN = "solworks.store";
const toEmail = (id) => (id.includes("@") ? id : `${id}@${ID_DOMAIN}`).toLowerCase();
const toId = (email) => (email || "").replace("@" + ID_DOMAIN, "");
// Firebase 는 비밀번호 6자 이상만 받는다. 짧은 비밀번호도 쓸 수 있게 뒤에 고정 문자열을 붙여 보낸다.
const toFirebasePw = (pw) => pw + "::solworks";

const dlg = $("#loginDialog"), form = $("#loginForm"), msg = $("#loginMsg");
const ERRORS = {
  "auth/invalid-credential": "아이디나 비밀번호가 맞지 않아요.",
  "auth/wrong-password": "아이디나 비밀번호가 맞지 않아요.",
  "auth/user-not-found": "없는 아이디예요. 처음이면 '계정 만들기'를 누르세요.",
  "auth/email-already-in-use": "이미 있는 아이디예요. 로그인을 누르세요.",
  "auth/weak-password": "비밀번호는 3자 이상으로 해주세요.",
  "auth/invalid-email": "아이디는 영문·숫자·. _ - 만 쓸 수 있어요.",
  "auth/too-many-requests": "여러 번 틀려서 잠시 막혔어요. 조금 뒤에 다시 해주세요.",
  "auth/operation-not-allowed": "Firebase에서 '이메일/비밀번호' 로그인이 꺼져 있어요.",
  "auth/network-request-failed": "인터넷 연결을 확인해 주세요.",
};

function login() {
  msg.textContent = "";
  form.reset();
  dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", "");
  form.id.focus();
}

async function submit(create) {
  const id = form.id.value.trim(), pw = form.pw.value;
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(id) && !id.includes("@")) {
    msg.textContent = "아이디는 영문·숫자·. _ - 로 3~30자예요.";
    return;
  }
  if (pw.length < 3) { msg.textContent = "비밀번호는 3자 이상이에요."; return; }
  msg.textContent = create ? "계정 만드는 중…" : "로그인 중…";
  try {
    if (create) {
      await createUserWithEmailAndPassword(auth, toEmail(id), toFirebasePw(pw));
    } else {
      try {
        await signInWithEmailAndPassword(auth, toEmail(id), toFirebasePw(pw));
      } catch (e) {
        // 이 방식 이전에 6자 이상으로 만든 계정이면 원래 비밀번호로 한 번 더 시도
        if (pw.length >= 6 && (e.code === "auth/invalid-credential" || e.code === "auth/wrong-password")) {
          await signInWithEmailAndPassword(auth, toEmail(id), pw);
        } else throw e;
      }
    }
    dlg.close();
  } catch (e) {
    msg.textContent = ERRORS[e.code] || "실패했어요: " + e.code;
  }
}

form.addEventListener("submit", (e) => { e.preventDefault(); submit(false); });
$("#signupBtn").addEventListener("click", () => {
  if (!form.reportValidity()) return;
  submit(true);
});
$("#loginClose").addEventListener("click", () => dlg.close());

btn.addEventListener("click", async () => {
  if (user) {
    if (confirm("로그아웃할까요? 이 기기의 데이터는 그대로 남아요.")) await signOut(auth);
    return;
  }
  login();
});
$("#nudgeLogin").addEventListener("click", login);
$("#nudgeLater").addEventListener("click", () => {
  localStorage.setItem("mwp.nudgeLater", "1");
  nudge.hidden = true;
});
