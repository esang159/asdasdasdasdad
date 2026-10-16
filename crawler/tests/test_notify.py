import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import notify_kakao as nk  # noqa: E402


class BuildMessageTest(unittest.TestCase):
    def items(self, n):
        return [{"title": f"공고 제목 {i} " + "가" * 30, "first_seen": "2026-10-15", "end": "2026-10-28",
                 "kind": "연구과제" if i % 2 else "지원사업", "matched": ["AI"] if i == 3 else []}
                for i in range(n)]

    def test_none_when_sample_or_nothing_new(self):
        self.assertIsNone(nk.build_message({"sample": True, "items": self.items(3)}, "2026-10-15"))
        self.assertIsNone(nk.build_message({"items": self.items(3)}, "2026-10-16"))

    def test_summary_not_list(self):
        items = self.items(8)
        items[0]["category"] = "경영"; items[2]["category"] = "경영"; items[1]["category"] = "국가R&D · 접수중"
        items[4]["proc"] = ["혁신제품"]
        msg = nk.build_message({"items": items}, "2026-10-15")
        lines = msg.split("\n")
        self.assertLessEqual(len(msg), nk.TEXT_LIMIT)
        self.assertEqual(lines[0], "[Sol Works] 10월 15일 새 공고 8건")
        self.assertEqual(lines[1], "지원사업 4건 · 연구과제 4건")
        self.assertEqual(lines[2], "분야: 경영 2 · R&D 1 · 기타 5")
        self.assertIn("관심 키워드 1건", lines[3])
        self.assertIn("공공조달 1건", lines[3])
        self.assertNotIn("공고 제목", msg)   # 공고 제목을 늘어놓지 않는다

    def test_field_names_merged(self):
        self.assertEqual(nk.field_of({"category": "판로ㆍ해외진출"}), "수출")
        self.assertEqual(nk.field_of({}), "기타")

if __name__ == "__main__":
    unittest.main()
