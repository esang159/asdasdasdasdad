import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "crawler"))
import crawl  # noqa: E402


class ParseTest(unittest.TestCase):
    def test_parse_date(self):
        self.assertEqual(crawl.parse_date("20241031"), "2024-10-31")
        self.assertEqual(crawl.parse_date("2024.10.1 18:00"), "2024-10-01")
        self.assertEqual(crawl.parse_date("2024-02-30"), None)
        self.assertEqual(crawl.parse_date("상시"), None)

    def test_parse_period(self):
        self.assertEqual(crawl.parse_period("20241001 ~ 20241031"), ("2024-10-01", "2024-10-31"))
        self.assertEqual(crawl.parse_period("예산 소진시까지"), (None, None))


class RegionTest(unittest.TestCase):
    def test_detect_regions(self):
        self.assertEqual(crawl.detect_regions("#경기 #창업"), ["경기"])
        self.assertEqual(crawl.detect_regions("전라북도 경제통상진흥원"), ["전북"])
        self.assertEqual(crawl.detect_regions("전국"), [])
        self.assertEqual(crawl.detect_regions("중소벤처기업부", None), [])


class MergeTest(unittest.TestCase):
    cfg = {"keywords": ["AI"], "exclude_keywords": ["채용"], "keep_expired_days": 7}

    def test_first_seen_kept_and_expired_dropped(self):
        today = date(2026, 10, 15)
        old = [
            {"id": "a", "title": "AI 바우처", "first_seen": "2026-10-01", "end": "2026-10-30"},
            {"id": "b", "title": "지난 공고", "first_seen": "2026-09-01", "end": "2026-10-01"},
        ]
        new = [
            {"id": "a", "title": "AI 바우처 (수정)", "end": "2026-10-30"},
            {"id": "c", "title": "신규 공고", "end": None},
            {"id": "d", "title": "인턴 채용", "end": None},
        ]
        out = {it["id"]: it for it in crawl.merge(old, new, self.cfg, today)}
        self.assertEqual(set(out), {"a", "c"})
        self.assertEqual(out["a"]["first_seen"], "2026-10-01")
        self.assertEqual(out["a"]["title"], "AI 바우처 (수정)")
        self.assertEqual(out["a"]["matched"], ["AI"])
        self.assertEqual(out["c"]["first_seen"], "2026-10-15")


if __name__ == "__main__":
    unittest.main()
