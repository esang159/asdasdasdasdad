// 수정 요청을 Firebase 에 바로 저장한다 (feedback.js 가 부른다).
// 사이트에 로그인해 있으면 users/{내 uid}/feedback/{자동 id} 에 들어가고,
// GitHub Actions(feedback.yml)가 한 시간마다 읽어서 GitHub 이슈로 옮긴다.
// 대시보드에서는 sync.js 가 먼저 만든 Firebase 앱을 같이 쓰고, 여행노트에서는 여기서 만든다
// (같은 사이트라 로그인 상태가 그대로 이어진다).

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
let user = null;
onAuthStateChanged(auth, (u) => { user = u; });

window.solFeedback = {
  ready: () => !!user,
  async send(item) {
    if (!user) throw new Error("로그인되어 있지 않아요");
    const ref = await addDoc(collection(getFirestore(app), "users", user.uid, "feedback"), {
      ...item, status: "new", createdAt: serverTimestamp(),
    });
    return ref.id;
  },
};
