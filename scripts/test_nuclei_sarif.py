"""Regression tests for clean, partial, and invalid Nuclei report uploads."""

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "prepare_nuclei_sarif", Path(__file__).with_name("prepare-nuclei-sarif.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NucleiSarifTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.reports = Path(self.temp.name)
        self.output = self.reports / "nuclei-upload.sarif"

    def write_json(self, name, value):
        (self.reports / name).write_text(json.dumps(value), encoding="utf-8")

    def scan(self, findings, exit_code=0, complete=True, failed=False):
        self.write_json("nuclei-results.json", findings)
        (self.reports / "nuclei-exit-status.txt").write_text(str(exit_code), encoding="utf-8")
        if complete:
            (self.reports / "nuclei-complete").touch()
        if failed:
            (self.reports / "nuclei-failed").touch()

    def sarif(self):
        return {
            "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
            "version": "2.1.0",
            "runs": [{
                "tool": {"driver": {"name": "Nuclei", "rules": [{"id": "test-rule"}]}},
                "invocations": [{"executionSuccessful": False, "exitCode": 0}],
                "results": [{
                    "ruleId": "test-rule",
                    "message": {"text": "A finding"},
                    "partialFingerprints": {"primaryLocationLineHash": "stable"},
                    "locations": [{"physicalLocation": {"artifactLocation": {"uri": "app.ts"}}}],
                }],
            }],
        }

    def prepare(self):
        module.prepare_report(self.reports, "v3.11.1")
        return json.loads(self.output.read_text(encoding="utf-8")) if self.output.exists() else None

    def test_completed_zero_match_scan_generates_successful_empty_report(self):
        self.scan([])
        run = self.prepare()["runs"][0]
        self.assertEqual(run["results"], [])
        self.assertEqual(run["tool"]["driver"], {
            "name": "nuclei", "rules": [], "semanticVersion": "3.11.1",
        })
        self.assertEqual(run["invocations"], [{"executionSuccessful": True, "exitCode": 0}])

    def test_success_preserves_findings_rules_locations_and_fingerprints(self):
        self.scan([{"template-id": "test-rule"}])
        original = self.sarif()
        self.write_json("nuclei-results.sarif", original)
        run = self.prepare()["runs"][0]
        self.assertEqual(run["results"], original["runs"][0]["results"])
        self.assertEqual(run["tool"]["driver"]["rules"], original["runs"][0]["tool"]["driver"]["rules"])
        self.assertTrue(run["invocations"][0]["executionSuccessful"])
        self.assertEqual(json.loads((self.reports / "nuclei-results.sarif").read_text()), original)

    def test_failed_scan_keeps_partial_results_with_unsuccessful_invocation(self):
        self.scan([], exit_code=1, complete=False, failed=True)
        self.write_json("nuclei-results.sarif", self.sarif())
        run = self.prepare()["runs"][0]
        self.assertEqual(len(run["results"]), 1)
        self.assertEqual(run["invocations"], [{"executionSuccessful": False, "exitCode": 1}])

    def test_no_report_is_synthesized_for_failed_incomplete_or_unstarted_scan(self):
        scenarios = [
            {"exit_code": 1, "complete": False, "failed": True},
            {"exit_code": 0, "complete": False},
            {"exit_code": 0, "failed": True},
        ]
        self.assertIsNone(self.prepare())
        for scenario in scenarios:
            with self.subTest(scenario=scenario):
                for marker in ("nuclei-complete", "nuclei-failed"):
                    (self.reports / marker).unlink(missing_ok=True)
                self.scan([], **scenario)
                self.assertIsNone(self.prepare())

    def test_zero_exit_without_completion_does_not_override_failure_metadata(self):
        self.scan([], complete=False)
        self.write_json("nuclei-results.sarif", self.sarif())
        self.assertEqual(self.prepare()["runs"][0]["invocations"], [
            {"executionSuccessful": False, "exitCode": 0},
        ])

    def test_findings_without_sarif_are_not_reported_as_clean(self):
        self.scan([{"template-id": "test-rule"}])
        with self.assertRaisesRegex(ValueError, "did not produce SARIF"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_invalid_or_missing_json_cannot_generate_successful_report(self):
        self.scan([])
        for content in ("not json", "{}", "[1]", "null"):
            with self.subTest(content=content):
                (self.reports / "nuclei-results.json").write_text(content, encoding="utf-8")
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse(self.output.exists())
        (self.reports / "nuclei-results.json").unlink()
        with self.assertRaises(FileNotFoundError):
            self.prepare()

    def test_malformed_sarif_is_not_replaced_with_clean_report(self):
        self.scan([])
        (self.reports / "nuclei-results.sarif").write_text("not json", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_mismatched_or_invalid_sarif_is_rejected(self):
        self.scan([{"template-id": "test-rule"}])
        bad_reports = []
        for field, value in (("results", []), ("results", None), ("invocations", [False])):
            report = copy.deepcopy(self.sarif())
            report["runs"][0][field] = value
            bad_reports.append(report)
        bad_reports.extend([{"version": "2.1.0", "runs": []}, {"version": "2.0.0"}])
        for report in bad_reports:
            with self.subTest(report=report):
                self.write_json("nuclei-results.sarif", report)
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse(self.output.exists())

    def test_missing_invocation_is_added_and_stale_prepared_report_is_removed(self):
        self.scan([{}])
        report = self.sarif()
        del report["runs"][0]["invocations"]
        self.write_json("nuclei-results.sarif", report)
        self.assertTrue(self.prepare()["runs"][0]["invocations"][0]["executionSuccessful"])
        (self.reports / "nuclei-exit-status.txt").unlink()
        self.assertIsNone(self.prepare())
        self.assertFalse(self.output.exists())

    def test_cli_exit_status_matches_report_preparation(self):
        self.scan([])
        command = [
            sys.executable, str(Path(__file__).with_name("prepare-nuclei-sarif.py")),
            str(self.reports), "--version", "v3.11.1",
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.output.exists())
        self.write_json("nuclei-results.json", [{"template-id": "missing-sarif"}])
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("did not produce SARIF", result.stderr)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
