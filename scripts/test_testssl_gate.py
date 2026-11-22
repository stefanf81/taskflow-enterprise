"""The testssl.sh gate must read both JSON shapes and fail when it cannot give a verdict.

The fixtures in testdata/testssl are unedited testssl.sh 3.2.5 output
(ghcr.io/testssl/testssl.sh:3.2, 2026-11-21) of the workflow's command line against a
throwaway `openssl s_server` with a self-signed certificate on localhost (two CRITICAL and
one HIGH finding, exit status 0) and against a closed local port (exit status 246).
"""

import contextlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest

import testssl_gate as gate

FIXTURES = Path(__file__).with_name("testdata") / "testssl"
TARGET = "scan.example.test:443"


class TestsslGateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.reports = Path(self.temp.name)
        (self.reports / "tls-targets.txt").write_text(f"{TARGET}\n", encoding="utf-8")

    def report(self, fixture=None, data=None, status="0"):
        target = self.reports / f"testssl-{gate.safe_name(TARGET)}.json"
        if fixture:
            shutil.copy(FIXTURES / fixture, target)
        elif data is not None:
            target.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")
        if status is not None:
            (self.reports / f"testssl-{gate.safe_name(TARGET)}.status").write_text(f"{status}\n", encoding="utf-8")

    def run_gate(self, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = gate.main([str(self.reports), *args])
        return code, output.getvalue()

    def clean(self, fixture):
        """The real report without its HIGH/CRITICAL findings, in the same shape."""
        data = json.loads((FIXTURES / fixture).read_text(encoding="utf-8"))
        keep = lambda items: [item for item in items if item.get("severity") not in gate.GATED_SEVERITIES]
        if isinstance(data, list):
            return keep(data)
        for host in data["scanResult"]:
            for key, value in host.items():
                if isinstance(value, list):
                    host[key] = keep(value)
        return data

    def test_file_names_match_the_workflow(self):
        # tr ':/[]' '-' | tr -cd 'A-Za-z0-9._-'
        self.assertEqual(gate.safe_name("taskflow.example.org:443"), "taskflow.example.org-443")
        self.assertEqual(gate.safe_name("[2001:db8::1]:443"), "-2001-db8--1--443")

    def test_pretty_report_fails_on_its_high_and_critical_findings(self):
        self.report("pretty-selfsigned.json")
        code, output = self.run_gate()
        self.assertEqual(code, 1)
        self.assertIn("::error::testssl.sh detected 3 CRITICAL/HIGH TLS finding(s):", output)
        self.assertIn("cert_chain_of_trust: failed (self signed).", output)

    def test_flat_report_gives_the_same_verdict(self):
        self.report("pretty-selfsigned.json")
        pretty = gate.evaluate(self.reports, self.reports / "tls-targets.txt")
        self.report("flat-selfsigned.json")
        flat = gate.evaluate(self.reports, self.reports / "tls-targets.txt")
        self.assertEqual(flat["gated"], pretty["gated"])
        self.assertEqual([item["id"] for item in flat["gated"]], ["cert_chain_of_trust", "cert_revocation", "overall_grade"])
        self.assertEqual(flat["protocols"], ["TLS1_2", "TLS1_3"])
        self.assertEqual(pretty["protocols"], ["TLS1_2", "TLS1_3"])
        self.assertEqual(flat["errors"], [])

    def test_the_old_inline_parser_raised_on_the_pretty_report(self):
        # What the workflow did before: `for item in data: item.get("severity")` inside
        # `except Exception`, which turned every pretty report into "no findings".
        data = json.loads((FIXTURES / "pretty-selfsigned.json").read_text(encoding="utf-8"))
        with self.assertRaises(AttributeError):
            for item in data:
                item.get("severity")

    def test_clean_reports_pass_in_both_shapes(self):
        for fixture in ("pretty-selfsigned.json", "flat-selfsigned.json"):
            with self.subTest(fixture=fixture):
                self.report(data=self.clean(fixture))
                code, output = self.run_gate()
                self.assertEqual(code, 0, output)
                self.assertIn("No CRITICAL or HIGH testssl.sh TLS findings in 1 evaluated target(s).", output)

    def test_findings_can_be_reported_without_failing(self):
        self.report("pretty-selfsigned.json")
        code, output = self.run_gate("--report-findings-only")
        self.assertEqual(code, 0)
        self.assertIn("::warning::testssl.sh detected 3 CRITICAL/HIGH TLS finding(s):", output)

    def test_accepted_ids_are_listed_but_do_not_fail(self):
        self.report("pretty-selfsigned.json")
        code, output = self.run_gate("--accept-ids", "cert_chain_of_trust, cert_revocation,overall_grade")
        self.assertEqual(code, 0, output)
        self.assertIn("::notice::accepted CRITICAL TLS finding cert_chain_of_trust", output)
        code, _ = self.run_gate("--accept-ids", "cert_revocation")
        self.assertEqual(code, 1)

    def test_a_scan_that_could_not_connect_fails_in_both_shapes(self):
        # testssl.sh still writes a small, valid JSON file, which the workflow took for a
        # completed scan.
        for fixture in ("pretty-refused.json", "flat-refused.json"):
            with self.subTest(fixture=fixture):
                self.report(fixture, status="246")
                code, output = self.run_gate("--report-findings-only")
                self.assertEqual(code, 2)
                self.assertIn("scanProblem: Can't connect to '127.0.0.1:18999'", output)
                self.assertIn("testssl.sh exited with error status 246", output)
                self.assertIn("the scan did not finish", output)

    def test_unusable_reports_fail_closed(self):
        cases = {
            "missing report": None,
            "empty file": "",
            "truncated JSON": '{"scanResult": [',
            "empty array": [],
            "no scanResult": {"Invocation": "testssl.sh", "version": "3.2.5"},
            "empty scanResult": {"scanResult": [], "scanTime": 1},
            "array of strings": ["Invocation", "scanResult"],
            "host without findings": {"scanResult": [{"targetHost": "x", "protocols": []}], "scanTime": 1},
            "section of strings": {"scanResult": [{"targetHost": "x", "protocols": ["TLS1_2"]}], "scanTime": 1},
            "no protocol checks": [{"id": "cert_trust", "severity": "OK", "finding": "Ok via SAN"}],
        }
        for name, data in cases.items():
            with self.subTest(case=name):
                (self.reports / f"testssl-{gate.safe_name(TARGET)}.json").unlink(missing_ok=True)
                self.report(data=data)
                code, output = self.run_gate("--report-findings-only")
                self.assertEqual(code, 2, output)
                self.assertIn("::error::testssl.sh result cannot be trusted:", output)

    def test_exit_status_is_part_of_the_verdict(self):
        clean = self.clean("pretty-selfsigned.json")
        self.report(data=clean, status=None)
        self.assertEqual(self.run_gate()[0], 2)
        self.report(data=clean, status="not a number")
        self.assertEqual(self.run_gate()[0], 2)
        self.report(data=clean, status="242")
        self.assertEqual(self.run_gate()[0], 2)
        # 1-241 counts ambiguous single checks; the report is complete.
        self.report(data=clean, status="3")
        code, output = self.run_gate()
        self.assertEqual(code, 0, output)
        self.assertIn("::warning::scan.example.test:443: testssl.sh exit status 3", output)

    def test_no_scanned_target_fails(self):
        # HTTPS unreachable: the workflow writes no TLS target, and no report means no verdict.
        (self.reports / "tls-targets.txt").write_text("", encoding="utf-8")
        self.assertEqual(self.run_gate()[0], 2)
        (self.reports / "tls-targets.txt").unlink()
        code, output = self.run_gate()
        self.assertEqual(code, 2)
        self.assertIn("no TLS target was scanned", output)

    def test_every_listed_target_needs_its_own_report(self):
        self.report(data=self.clean("pretty-selfsigned.json"))
        (self.reports / "tls-targets.txt").write_text(f"{TARGET}\nother.example.test:443\n", encoding="utf-8")
        code, output = self.run_gate()
        self.assertEqual(code, 2)
        self.assertIn("other.example.test:443: report testssl-other.example.test-443.json is missing", output)

    def test_summary_names_findings_and_errors(self):
        self.report("pretty-selfsigned.json")
        summary = self.reports / "testssl-summary.md"
        self.run_gate("--markdown", str(summary), "--report-findings-only")
        text = summary.read_text(encoding="utf-8")
        self.assertIn("- **Supported TLS Protocols:** `TLS1_2, TLS1_3`", text)
        self.assertIn("- **[CRITICAL]** `cert_chain_of_trust`: failed (self signed).", text)
        self.assertNotIn("No High or Critical", text)

        self.report("pretty-refused.json", status="246")
        self.run_gate("--markdown", str(summary))
        text = summary.read_text(encoding="utf-8")
        self.assertIn("🚨 **Not evaluated:**", text)
        self.assertNotIn("No High or Critical", text)


if __name__ == "__main__":
    unittest.main()
