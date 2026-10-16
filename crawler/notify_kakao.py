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
DEFAULT_PAGE = "https://www.solworks.store/"
TEXT_LIMIT = 200   # 기본 텍스트 템플릿 본문 길이에 여유를 두고 맞춘다


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


# 출처마다 다른 분야 이름을 몇 갈래로 묶는다 (기업마당 분류는 그대로 쓴다)
FIELD_MAP = {
    "사업화": "창업", "창업교육": "창업", "멘토링ㆍ컨설팅ㆍ교육": "교육·컨설팅",
    "시설ㆍ공간ㆍ보육": "공간·보육", "행사ㆍ네트워크": "행사", "판로ㆍ해외진출": "수출", "글로벌": "수출",
    "융자ㆍ보증": "금융", "정책자금": "금융", "기술개발(R&amp;D)": "기술", "기술개발(R&D)": "기술",
    "국가R&D": "R&D",
}


def field_of(n: dict) -> str:
    cat = (n.get("category") or "").split(" · ")[0].strip()
    return FIELD_MAP.get(cat, cat) or "기타"


def build_message(data: dict, today: str, tag: str = "") -> str | None:
    """오늘 처음 들어온 공고를 요약한다. 없으면 None.
    공고를 하나하나 늘어놓지 않고 구분·분야별 건수와 눈여겨볼 것만 적는다."""
    if data.get("sample"):
        return None
    fresh = [n for n in data.get("items", []) if n.get("first_seen") == today]
    if not fresh:
        return None
    m, d = today[5:7].lstrip("0"), today[8:10].lstrip("0")
    head = f"[Sol Works{tag}] {m}월 {d}일 새 공고 {len(fresh)}건"

    support = sum(1 for n in fresh if n.get("kind") != "연구과제")
    lines = [f"지원사업 {support}건 · 연구과제 {len(fresh) - support}건"]

    fields: dict[str, int] = {}
    for n in fresh:
        f = field_of(n)
        fields[f] = fields.get(f, 0) + 1
    top = sorted(fields.items(), key=lambda kv: (kv[0] == "기타", -kv[1], kv[0]))   # 기타는 맨 끝
    shown, rest = top[:5], sum(c for _, c in top[5:])
    parts = [f"{k} {v}" for k, v in shown] + ([f"그 외 {rest}"] if rest else [])
    lines.append("분야: " + " · ".join(parts))

    extra = []
    matched = sum(1 for n in fresh if n.get("matched"))
    if matched:
        extra.append(f"관심 키워드 {matched}건")
    soon_limit = (datetime.fromisoformat(today) + timedelta(days=7)).date().isoformat()
    soon = sum(1 for n in fresh if n.get("end") and today <= n["end"] <= soon_limit)
    if soon:
        extra.append(f"7일 안 마감 {soon}건")
    proc = sum(1 for n in fresh if n.get("proc"))
    if proc:
        extra.append(f"공공조달 {proc}건")
    if extra:
        lines.append(" · ".join(extra))

    text = head + "\n" + "\n".join(lines)
    return text[:TEXT_LIMIT]


def main() -> int:
    if not (os.environ.get("KAKAO_REST_API_KEY") and os.environ.get("KAKAO_REFRESH_TOKEN")):
        print("[kakao] KAKAO_REST_API_KEY / KAKAO_REFRESH_TOKEN 없음 - 건너뜀")
        return 0
    page_url = os.environ.get("PAGE_URL") or DEFAULT_PAGE
    today = datetime.now(KST).date().isoformat()

    if "--test" in sys.argv:
        # 실제 아침 알림과 같은 모양으로, 지금 접수 중인 공고로 만들어 보낸다
        data = json.loads(NOTICES.read_text(encoding="utf-8")) if NOTICES.exists() else {}
        sample = [dict(n, first_seen=today) for n in data.get("items", []) if (n.get("end") or "9999") >= today]
        text = build_message({"items": sample}, today, tag=" · 테스트") or f"[Sol Works] 카카오톡 알림 테스트예요. ({today})"
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
