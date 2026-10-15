"""사업공고 수집기.

매일 GitHub Actions 에서 실행되어 data/notices.json 을 갱신한다.
표준 라이브러리만 사용하므로 별도 설치가 필요 없다.

수집처
  - 기업마당(bizinfo.go.kr) 지원사업 API   : 환경변수 BIZINFO_API_KEY
  - K-Startup 사업공고 (공공데이터포털)     : 환경변수 DATA_GO_KR_KEY
  - 임의의 RSS 피드                         : crawler/config.json 의 sources.rss

키가 없는 수집처는 건너뛴다.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "crawler" / "config.json"
OUTPUT_PATH = ROOT / "data" / "notices.json"

KST = timezone(timedelta(hours=9))
USER_AGENT = "Mozilla/5.0 (compatible; my-work-page-crawler/1.0)"
TIMEOUT = 30


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def parse_date(value) -> str | None:
    """'20241031', '2024-10-31', '2024.10.31 18:00' 등을 'YYYY-MM-DD' 로 바꾼다."""
    if not value:
        return None
    m = re.search(r"(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})", str(value))
    if not m:
        return None
    y, mo, d = (int(g) for g in m.groups())
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return None


def parse_period(value) -> tuple[str | None, str | None]:
    """'20241001 ~ 20241031' 형태의 접수기간을 (시작, 종료) 로 나눈다."""
    if not value:
        return None, None
    parts = re.split(r"\s*~\s*", str(value), maxsplit=1)
    start = parse_date(parts[0])
    end = parse_date(parts[1]) if len(parts) > 1 else None
    return start, end


REGIONS = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원",
           "충북", "충남", "전북", "전남", "경북", "경남", "제주"]
REGION_ALIASES = {
    "충청북도": "충북", "충청남도": "충남", "전라북도": "전북", "전북특별자치도": "전북",
    "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "강원특별자치도": "강원",
    "제주특별자치도": "제주", "세종특별자치시": "세종",
}


def detect_regions(*texts) -> list[str]:
    """지역 표시 문자열이나 제목에서 시·도를 뽑는다. 못 찾으면 빈 목록(전국)."""
    text = " ".join(str(t or "") for t in texts)
    for long, short in REGION_ALIASES.items():
        text = text.replace(long, short)
    if "전국" in text:
        return []
    return [r for r in REGIONS if r in text]


def make_id(source: str, key: str) -> str:
    return source + ":" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]


def clean(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


# ---------------------------------------------------------------- 수집처

def fetch_bizinfo(cfg: dict) -> list[dict]:
    key = os.environ.get("BIZINFO_API_KEY")
    if not key:
        print("[bizinfo] BIZINFO_API_KEY 없음 - 건너뜀")
        return []
    params = {
        "crtfcKey": key,
        "dataType": "json",
        "searchCnt": cfg.get("search_count", 300),
    }
    url = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?" + urllib.parse.urlencode(params)
    data = json.loads(http_get(url))
    rows = data.get("jsonArray") or data.get("items") or []
    items = []
    for r in rows:
        title = clean(r.get("pblancNm"))
        if not title:
            continue
        link = r.get("pblancUrl") or ""
        if link.startswith("/"):
            link = "https://www.bizinfo.go.kr" + link
        start, end = parse_period(r.get("reqstBeginEndDe"))
        items.append({
            "id": make_id("bizinfo", r.get("pblancId") or link or title),
            "source": "기업마당",
            "title": title,
            "org": clean(r.get("jrsdInsttNm") or r.get("excInsttNm")),
            "category": clean(r.get("pldirSportRealmLclasCodeNm")),
            "start": start,
            "end": end,
            "posted": parse_date(r.get("creatPnttm")),
            "url": link,
            "summary": clean(re.sub(r"<[^>]+>", " ", r.get("bsnsSumryCn") or ""))[:300],
            "target": clean(r.get("trgetNm")),
            "regions": detect_regions(r.get("hashtags"), r.get("jrsdInsttNm"), r.get("excInsttNm"), title),
            "age": "",
            "how": clean(re.sub(r"<[^>]+>", " ", r.get("reqstMthPapersCn") or ""))[:200],
            "contact": clean(r.get("refrncNm"))[:200],
        })
    print(f"[bizinfo] {len(items)}건")
    return items


def fetch_kstartup(cfg: dict) -> list[dict]:
    key = os.environ.get("DATA_GO_KR_KEY")
    if not key:
        print("[kstartup] DATA_GO_KR_KEY 없음 - 건너뜀")
        return []
    # 공공데이터포털 키는 이미 인코딩된 형태로 발급되는 경우가 있어 그대로 붙인다.
    query = urllib.parse.urlencode({
        "page": 1,
        "perPage": cfg.get("per_page", 200),
        "returnType": "json",
        "cond[rcrt_prgs_yn::EQ]": "Y",
    })
    url = ("https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01"
           f"?serviceKey={key}&{query}")
    data = json.loads(http_get(url))
    rows = data.get("data") or []
    items = []
    for r in rows:
        title = clean(r.get("biz_pbanc_nm") or r.get("intg_pbanc_biz_nm"))
        if not title:
            continue
        link = r.get("detl_pg_url") or ""
        items.append({
            "id": make_id("kstartup", str(r.get("pbanc_sn") or link or title)),
            "source": "K-Startup",
            "title": title,
            "org": clean(r.get("pbanc_ntrp_nm") or r.get("sprv_inst")),
            "category": clean(r.get("supt_biz_clsfc")),
            "start": parse_date(r.get("pbanc_rcpt_bgng_dt")),
            "end": parse_date(r.get("pbanc_rcpt_end_dt")),
            "posted": parse_date(r.get("pbanc_rcpt_bgng_dt")),
            "url": link,
            "summary": clean(r.get("pbanc_ctnt"))[:300],
            "target": clean(r.get("aply_trgt") or r.get("aply_trgt_ctnt"))[:200],
            "regions": detect_regions(r.get("supt_regin"), title),
            "age": clean(r.get("biz_enyy"))[:100],
            "how": "",
            "contact": clean(r.get("prch_cnpl_no") or r.get("biz_prch_dprt_nm"))[:200],
        })
    print(f"[kstartup] {len(items)}건")
    return items


def fetch_rss(feed: dict) -> list[dict]:
    name, url = feed.get("name", "RSS"), feed["url"]
    root = ET.fromstring(http_get(url))
    items = []
    for it in root.iter("item"):
        title = clean(it.findtext("title"))
        link = clean(it.findtext("link"))
        if not title:
            continue
        posted = it.findtext("pubDate")
        try:
            from email.utils import parsedate_to_datetime
            posted = parsedate_to_datetime(posted).date().isoformat() if posted else None
        except (TypeError, ValueError):
            posted = parse_date(posted)
        items.append({
            "id": make_id("rss-" + name, link or title),
            "source": name,
            "title": title,
            "org": feed.get("org", ""),
            "category": clean(it.findtext("category")),
            "start": None,
            "end": None,
            "posted": posted,
            "url": link,
            "summary": clean(re.sub(r"<[^>]+>", " ", it.findtext("description") or ""))[:300],
            "target": "",
            "regions": detect_regions(title, feed.get("region")),
            "age": "",
            "how": "",
            "contact": "",
        })
    print(f"[rss:{name}] {len(items)}건")
    return items


# ---------------------------------------------------------------- 병합

def match_keywords(item: dict, keywords: list[str]) -> list[str]:
    text = " ".join([item.get("title", ""), item.get("category", ""), item.get("summary", ""),
                     item.get("target", "")]).lower()
    return [k for k in keywords if k.lower() in text]


def merge(old_items: list[dict], new_items: list[dict], cfg: dict, today: date) -> list[dict]:
    """기존 목록과 새로 수집한 목록을 합친다.

    - first_seen 은 처음 발견한 날짜를 유지한다 (NEW 표시용).
    - 마감 후 keep_expired_days 가 지난 공고는 지운다.
    """
    keywords = cfg.get("keywords", [])
    excludes = [k.lower() for k in cfg.get("exclude_keywords", [])]
    keep_days = cfg.get("keep_expired_days", 14)
    cutoff = (today - timedelta(days=keep_days)).isoformat()
    today_s = today.isoformat()

    by_id = {it["id"]: it for it in old_items}
    for it in new_items:
        prev = by_id.get(it["id"])
        it["first_seen"] = prev.get("first_seen", today_s) if prev else today_s
        by_id[it["id"]] = it

    result = []
    for it in by_id.values():
        if it.get("end") and it["end"] < cutoff:
            continue
        if any(x in it.get("title", "").lower() for x in excludes):
            continue
        it["matched"] = match_keywords(it, keywords)
        result.append(it)

    result.sort(key=lambda x: (x.get("first_seen") or "", x.get("posted") or ""), reverse=True)
    return result


def main() -> int:
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    src = cfg.get("sources", {})

    collected: list[dict] = []
    errors: list[str] = []
    jobs = []
    if src.get("bizinfo", {}).get("enabled", True):
        jobs.append(("bizinfo", lambda: fetch_bizinfo(src.get("bizinfo", {}))))
    if src.get("kstartup", {}).get("enabled", True):
        jobs.append(("kstartup", lambda: fetch_kstartup(src.get("kstartup", {}))))
    for feed in src.get("rss", []):
        jobs.append((f"rss:{feed.get('name')}", lambda feed=feed: fetch_rss(feed)))

    for name, job in jobs:
        try:
            collected.extend(job())
        except Exception as e:  # 한 곳이 실패해도 나머지는 계속 수집
            print(f"[{name}] 실패: {e}", file=sys.stderr)
            errors.append(f"{name}: {e}")

    old = {"items": []}
    if OUTPUT_PATH.exists():
        old = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        if old.get("sample"):  # 처음 실제 수집 시 샘플 데이터는 버린다
            if not collected:
                print("수집된 공고가 없어 샘플 데이터를 그대로 둡니다.")
                return 0
            old = {"items": []}

    now = datetime.now(KST)
    items = merge(old.get("items", []), collected, cfg, now.date())
    out = {
        "updated_at": now.isoformat(timespec="seconds"),
        "keywords": cfg.get("keywords", []),
        "errors": errors,
        "items": items,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"총 {len(items)}건 저장 -> {OUTPUT_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
