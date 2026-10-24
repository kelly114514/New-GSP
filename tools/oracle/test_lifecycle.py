"""Offline lifecycle regressions: never launches or terminates the original app."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import gsp_oracle as oracle


class LifecycleTests(unittest.TestCase):
    def test_safe_cli_defaults(self):
        args = oracle.build_parser().parse_args([
            "batch", "--list", "*.gsp", "--out-dir", "unused",
        ])
        self.assertEqual(args.retries, 0)
        self.assertEqual(args.recycle, 0)

    def test_previous_process_is_never_terminated(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            pid_file = state / "pid.json"
            pid_file.write_text(json.dumps({"pid": 123, "creation": None}), encoding="utf-8")
            with patch.object(oracle, "STATE", state), \
                    patch.object(oracle, "pid_alive", return_value=True), \
                    patch.object(oracle, "proc_image", return_value=str(oracle.RUNTIME / oracle.EXE_NAME)), \
                    patch.object(oracle, "terminate_pid") as terminate:
                with self.assertRaises(oracle.OracleError):
                    oracle.Session().kill_stale()
                terminate.assert_not_called()
                self.assertTrue(pid_file.exists())

    def test_crash_stops_batch_without_retry_or_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = [root / "one.gsp", root / "two.gsp"]
            for src in files:
                src.write_bytes(b"test")
            session = MagicMock()
            session.alive.return_value = False
            session.restarts = 0
            failure = {"status": "failed", "error": "app died", "stop_required": True,
                       "input": "one.gsp", "outputs": {}, "dialogs": [], "seconds": 0}
            with patch.object(oracle, "Session", return_value=session), \
                    patch.object(oracle, "RunLock"), \
                    patch.object(oracle, "run_job", return_value=failure) as run_job:
                result = oracle.run_batch(files, root / "out", {"html"}, 120, False,
                                          root, "min", 5, False, None, False)
                run_job.assert_called_once()
                session.start.assert_called_once()
                session.restart.assert_not_called()
                session.stop.assert_called_once()
                self.assertEqual(result.get("missing"), 1)

    def test_resume_accepts_intentionally_absent_emf(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            src = root / "empty.gsp"
            src.write_bytes(b"test")
            out = root / "out"
            out.mkdir()
            html = out / "empty.htm"
            html.write_text("empty")
            oracle.append_manifest(out / "manifest.jsonl", {
                "input": "empty.gsp", "status": "ok", "seconds": 0, "input_sha256": oracle.sha256_file(src),
                "outputs": {"emf": {"produced": False}, "html": {"path": str(html)}},
            })
            with patch.object(oracle, "Session") as session:
                result = oracle.run_batch([src], out, {"emf", "html"}, 120, True,
                                          root, "min", 0, False, None, False)
                session.assert_not_called()
                self.assertEqual(result.get("ok"), 1)

    def test_failed_job_records_stop_instead_of_restarting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            src = root / "input.gsp"
            src.write_bytes(b"test")
            session = MagicMock()
            session.check_alive.side_effect = oracle.AppDied("gone")
            session.alive.return_value = False
            with patch.object(oracle, "WORK", root / "work"):
                entry = oracle.run_job(session, src, "input.gsp", {"html"}, root / "out", 120)
            self.assertEqual(entry["status"], "failed")
            self.assertTrue(entry["stop_required"])
            self.assertFalse(entry["restarted"])
            session.restart.assert_not_called()


if __name__ == "__main__":
    unittest.main()
