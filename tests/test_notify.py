import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "crawler"))
import notify_kakao as nk  # noqa: E402


class BuildMessageTest(unittest.TestCase):
    def items(self, n):
        return [{"title": f"공고 제목 {i} " + "가" * 30, "first_seen": "2026-10-15", "end": "2026-10-28",
                 "kind": "연구과제" if i % 2 else "지원사업", "matched": ["AI"] if i == 3 else []}
                for i in range(n)]

    def test_none_when_sample_or_nothing_new(self):
        self.assertIsNone(nk.build_message({"sample": True, "items": self.items(3)}, "2026-10-15"))
        self.assertIsNone(nk.build_message({"items": self.items(3)}, "2026-10-16"))

    def test_fits_limit_and_puts_keyword_match_first(self):
        msg = nk.build_message({"items": self.items(8)}, "2026-10-15")
        self.assertLessEqual(len(msg), nk.TEXT_LIMIT)
        self.assertTrue(msg.startswith("[Sol Works] 10월 15일 새 공고 8건"))
        self.assertIn("공고 제목 3", msg.split("\n")[1])
        self.assertIn("외 ", msg)


if __name__ == "__main__":
    unittest.main()
