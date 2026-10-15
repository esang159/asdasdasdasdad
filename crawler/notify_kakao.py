"""새 공고를 카카오톡 '나에게 보내기'로 알린다.

GitHub Actions 에서 공고 수집이 끝난 뒤 실행된다. 필요한 환경변수 (GitHub Secrets):
  KAKAO_REST_API_KEY   카카오 디벨로퍼스 앱의 REST API 키
  KAKAO_REFRESH_TOKEN  처음 동의할 때 받은 refresh_token
선택:
  KAKAO_CLIENT_SECRET  앱에서 Client Secret 을 켠 경우
  PAGE_URL             메시지 버튼이 열 주소 (기본: GitHub Pages 주소)

토큰 값은 절대 로그에 찍지 않는다 (공개 저장소면 Actions 로그를 누구나 볼 수 있다).

  python crawler/notify_kakao.py          오늘 새로 들어온 공고가 있으면 보냄
  python crawler/notify_kakao.py --test   공고와 상관없이 테스트 메시지를 보냄
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTICES = ROOT / "data" / "notices.json"
KST = timezone(timedelta(hours=9))
DEFAULT_PAGE = "https://esang159.github.io/asdasdasdasdad/"
TEXT_LIMIT = 200   # 기본 텍스트 템플릿 본문 길이에 여유를 두고 맞춘다
MAX_ITEMS = 5


def post_form(url: str, data: dict, token: str | None = None) -> dict:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded;charset=utf-8")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        # 응답 본문에는 토큰이 없고 오류 코드·설명만 있다
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}") from None


def access_token() -> tuple[str, bool]:
    """refresh_token 으로 access_token 을 받는다. 두 번째 값은 refresh_token 이 새로 발급됐는지."""
    data = {
        "grant_type": "refresh_token",
        "client_id": os.environ["KAKAO_REST_API_KEY"],
        "refresh_token": os.environ["KAKAO_REFRESH_TOKEN"],
    }
    if os.environ.get("KAKAO_CLIENT_SECRET"):
        data["client_secret"] = os.environ["KAKAO_CLIENT_SECRET"]
    res = post_form("https://kauth.kakao.com/oauth/token", data)
    # 카카오는 refresh_token 만료가 가까워지면 새 값을 함께 준다 → 다시 연결이 필요하다는 신호
    return res["access_token"], bool(res.get("refresh_token"))


def send_text(token: str, text: str, page_url: str) -> None:
    template = {
        "object_type": "text",
        "text": text[:TEXT_LIMIT],
        "link": {"web_url": page_url, "mobile_web_url": page_url},
        "button_title": "Sol Works 열기",
    }
    res = post_form("https://kapi.kakao.com/v2/api/talk/memo/default/send",
                    {"template_object": json.dumps(template, ensure_ascii=False)}, token)
    if res.get("result_code") != 0:
        raise RuntimeError(f"전송 실패: {res}")


def build_message(data: dict, today: str) -> str | None:
    """오늘 처음 들어온 공고로 메시지를 만든다. 없으면 None. 관심 키워드가 맞는 공고를 먼저."""
    if data.get("sample"):
        return None
    fresh = [n for n in data.get("items", []) if n.get("first_seen") == today]
    if not fresh:
        return None
    fresh.sort(key=lambda n: (not n.get("matched"), n.get("end") or "9999"))
    m, d = today[5:7].lstrip("0"), today[8:10].lstrip("0")
    head = f"[Sol Works] {m}월 {d}일 새 공고 {len(fresh)}건"
    lines, used = [], len(head)
    for n in fresh[:MAX_ITEMS]:
        kind = "연구" if n.get("kind") == "연구과제" else "지원"
        end = f" ~{n['end'][5:].replace('-', '/')}" if n.get("end") else ""
        line = f"\n· ({kind}) {n.get('title', '')}"
        room = TEXT_LIMIT - used - len(end) - 12   # '외 n건' 자리를 남긴다
        if room < 15:
            break
        if len(line) > room:
            line = line[:room - 1] + "…"
        lines.append(line + end)
        used += len(line) + len(end)
    rest = len(fresh) - len(lines)
    tail = f"\n외 {rest}건" if rest > 0 else ""
    return head + "".join(lines) + tail


def main() -> int:
    if not (os.environ.get("KAKAO_REST_API_KEY") and os.environ.get("KAKAO_REFRESH_TOKEN")):
        print("[kakao] KAKAO_REST_API_KEY / KAKAO_REFRESH_TOKEN 없음 - 건너뜀")
        return 0
    page_url = os.environ.get("PAGE_URL") or DEFAULT_PAGE
    today = datetime.now(KST).date().isoformat()

    if "--test" in sys.argv:
        text = f"[Sol Works] 카카오톡 알림 연결 테스트예요. ({today})\n매일 아침 새 공고가 있으면 이렇게 알려드릴게요."
    else:
        data = json.loads(NOTICES.read_text(encoding="utf-8")) if NOTICES.exists() else {}
        text = build_message(data, today)
        if not text:
            print("[kakao] 오늘 새로 들어온 공고 없음 - 보내지 않음")
            return 0

    token, renewed = access_token()
    if renewed:
        text = ("[Sol Works] 카카오 연결이 곧 만료돼요. 동의를 다시 받아 "
                "KAKAO_REFRESH_TOKEN 을 새 값으로 바꿔주세요.\n\n" + text)
    send_text(token, text, page_url)
    print("[kakao] 전송 완료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
