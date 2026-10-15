import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import feedback_to_issues as fb  # noqa: E402


class FeedbackTest(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(fb.plain({"text": {"stringValue": "a"}, "issue": {"integerValue": "3"}}),
                         {"text": "a", "issue": "3"})

    def test_issue_of(self):
        title, body = fb.issue_of({"text": "글씨가 작아요\n키워 주세요", "where": "대시보드 · 사업공고",
                                   "url": "https://www.solworks.store/#notices", "at": "2026-10-15 09:00"})
        self.assertEqual(title, "[수정요청] 대시보드 · 사업공고 — 글씨가 작아요")
        self.assertIn("키워 주세요", body)
        self.assertIn("https://www.solworks.store/#notices", body)

    def test_no_secret_skips(self):
        import os
        old = os.environ.pop("FIREBASE_SERVICE_ACCOUNT", None)
        try:
            self.assertEqual(fb.main(), 0)
        finally:
            if old is not None:
                os.environ["FIREBASE_SERVICE_ACCOUNT"] = old


if __name__ == "__main__":
    unittest.main()
