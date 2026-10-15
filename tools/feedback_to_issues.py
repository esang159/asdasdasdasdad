"""사이트의 [수정 요청]을 GitHub 이슈로 옮긴다.

사이트에서 올린 요청은 Firestore 의 users/{uid}/feedback/{id} 에 status="new" 로 쌓인다.
여기서 그것들을 읽어 이슈를 만들고, 만든 것은 status="issued" 로 바꿔 다시 옮기지 않는다.

필요한 GitHub Secrets / 환경변수
  FIREBASE_SERVICE_ACCOUNT  Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 (JSON 전체)
  GITHUB_TOKEN              Actions 가 자동으로 넣어 준다 (issues: write)
  GITHUB_REPOSITORY         Actions 가 자동으로 넣어 준다 (owner/repo)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

FIRESTORE = "https://firestore.googleapis.com/v1"


def http(method: str, url: str, token: str, body: dict | None = None) -> dict | list:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json" if "api.github.com" in url else "application/json",
        "User-Agent": "solworks-feedback",
    })
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read() or b"null")


def plain(fields: dict) -> dict:
    """Firestore REST 형식({"text": {"stringValue": ...}})을 보통 dict 로."""
    out = {}
    for k, v in fields.items():
        out[k] = next(iter(v.values())) if v else None
    return out


def issue_of(item: dict) -> tuple[str, str]:
    text = (item.get("text") or "").strip()
    where = item.get("where") or "-"
    first = text.splitlines()[0][:50] if text else "(내용 없음)"
    title = f"[수정요청] {where} — {first}"
    body = (f"{text}\n\n---\n- 화면: {where}\n- 주소: {item.get('url') or '-'}\n"
            f"- 작성: {item.get('at') or '-'}\n- 화면 크기: {item.get('size') or '-'}\n- 사이트에서 바로 올림")
    return title, body


def firebase_token(info: dict) -> str:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/datastore"])
    creds.refresh(Request())
    return creds.token


def main() -> int:
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not raw:
        print("[feedback] FIREBASE_SERVICE_ACCOUNT 가 없어 건너뜁니다")
        return 0
    info = json.loads(raw)
    project = info["project_id"]
    fb = firebase_token(info)
    gh = os.environ["GITHUB_TOKEN"]
    repo = os.environ["GITHUB_REPOSITORY"]

    # 모든 사용자의 feedback 을 한 번에 (필터 없는 컬렉션 그룹 조회라 색인이 필요 없다)
    rows = http("POST", f"{FIRESTORE}/projects/{project}/databases/(default)/documents:runQuery", fb,
                {"structuredQuery": {"from": [{"collectionId": "feedback", "allDescendants": True}]}})
    docs = [r["document"] for r in rows if r.get("document")]
    new = [d for d in docs if plain(d.get("fields", {})).get("status") == "new"]
    new.sort(key=lambda d: d.get("createTime", ""))
    print(f"[feedback] 전체 {len(docs)}건, 새 요청 {len(new)}건")

    made = 0
    for d in new:
        title, body = issue_of(plain(d.get("fields", {})))
        issue = http("POST", f"https://api.github.com/repos/{repo}/issues", gh,
                     {"title": title, "body": body, "labels": ["수정요청"]})
        http("PATCH", f"{FIRESTORE}/{d['name']}?updateMask.fieldPaths=status&updateMask.fieldPaths=issue", fb,
             {"fields": {"status": {"stringValue": "issued"}, "issue": {"integerValue": str(issue["number"])}}})
        print(f"[feedback] 이슈 #{issue['number']} 만듦: {title}")
        made += 1
    print(f"[feedback] 완료 — 이슈 {made}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
