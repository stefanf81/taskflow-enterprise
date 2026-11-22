"""Evaluate testssl.sh JSON reports: one parser for the job summary and the quality gate.

testssl.sh writes two JSON shapes. `--jsonfile` is a flat array of findings.
`--jsonfile-pretty` is an object: run metadata, then `scanResult`, a list with one
object per scanned host whose sections (`protocols`, `vulnerabilities`, ...) are
arrays of findings. A scan that could not start puts the `scanProblem` finding
directly into `scanResult`. Both shapes are accepted, so changing the flag in the
workflow cannot silently empty the gate again: the old inline parser iterated the
pretty object's keys, raised on the first string, swallowed the exception and
reported "no HIGH or CRITICAL findings" on every run.

Anything that prevents an honest verdict is an operational error and fails the
gate, also when findings themselves are only reported: a missing or unparseable
report, an unknown shape, no findings, a FATAL scan problem, an interrupted scan,
a report without the protocol checks, or a testssl.sh error exit status.
"""

import argparse
import json
from pathlib import Path
import re
import sys

GATED_SEVERITIES = ("CRITICAL", "HIGH")
PROTOCOL_IDS = ("SSLv2", "SSLv3", "TLS1", "TLS1_1", "TLS1_2", "TLS1_3")
# testssl.sh reserves 242-255 for its own errors (ERR_CONNECT=246, ERR_DNSLOOKUP=247, ...).
# Lower non-zero values count ambiguous single checks and still come with a full report.
FIRST_ERROR_STATUS = 242


class ReportError(Exception):
    """The report cannot be used for a verdict."""


def safe_name(target):
    """The file-name part the workflow derives from a target (`tr ':/[]' '-' | tr -cd 'A-Za-z0-9._-'`)."""
    return re.sub(r"[^A-Za-z0-9._-]", "", re.sub(r"[:/\[\]]", "-", target))


def _is_finding(value):
    return isinstance(value, dict) and "id" in value and "severity" in value


def _finding(value):
    return {
        "id": str(value.get("id", "")),
        "severity": str(value.get("severity", "")).upper(),
        "finding": str(value.get("finding", "")),
    }


def parse_report(data):
    """Return (findings, scan_time) for either JSON shape; raise ReportError for anything else."""
    findings = []
    scan_time = None

    if isinstance(data, list):
        if any(not _is_finding(item) for item in data):
            raise ReportError("flat report contains an entry that is not a finding object")
        findings = [_finding(item) for item in data]
        for item in findings:
            if item["id"] == "scanTime":
                scan_time = item["finding"]
    elif isinstance(data, dict) and isinstance(data.get("scanResult"), list):
        scan_time = data.get("scanTime")
        # Client-side warnings (`clientProblem1`, ...) are arrays of findings next to the metadata.
        sections = [value for key, value in data.items() if key != "scanResult" and isinstance(value, list)]
        for entry in data["scanResult"]:
            if _is_finding(entry):
                findings.append(_finding(entry))
            elif isinstance(entry, dict):
                sections.extend(value for value in entry.values() if isinstance(value, list))
            else:
                raise ReportError("scanResult contains an entry that is not an object")
        for section in sections:
            if any(not _is_finding(item) for item in section):
                raise ReportError("a report section contains an entry that is not a finding object")
            findings.extend(_finding(item) for item in section)
    else:
        raise ReportError("neither a findings array (--jsonfile) nor an object with scanResult (--jsonfile-pretty)")

    return findings, scan_time


def evaluate_target(reports, target):
    """Read one target's report and exit status. Returns (findings, errors, notes)."""
    name = safe_name(target)
    report = reports / f"testssl-{name}.json"
    errors = []
    notes = []

    status_file = reports / f"testssl-{name}.status"
    try:
        status = int(status_file.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        status = None
        errors.append(f"{target}: no testssl.sh exit status was recorded")
    if status is not None and status >= FIRST_ERROR_STATUS:
        errors.append(f"{target}: testssl.sh exited with error status {status}")
    elif status:
        notes.append(f"{target}: testssl.sh exit status {status} (ambiguous results in {status} check(s))")

    try:
        findings, scan_time = parse_report(json.loads(report.read_text(encoding="utf-8")))
    except OSError as error:
        return [], errors + [f"{target}: report {report.name} is missing ({error.strerror})"], notes
    except (ValueError, ReportError) as error:
        return [], errors + [f"{target}: report {report.name} cannot be evaluated: {error}"], notes

    if not findings:
        errors.append(f"{target}: report {report.name} contains no findings")
    for item in findings:
        if item["severity"] == "FATAL":
            errors.append(f"{target}: {item['id']}: {item['finding']}")
    if "interrupted" in str(scan_time).lower():
        errors.append(f"{target}: the scan did not finish (scanTime: {scan_time})")
    if findings and not any(item["id"] in PROTOCOL_IDS for item in findings):
        errors.append(f"{target}: report {report.name} has no protocol checks")
    return findings, errors, notes


def evaluate(reports, targets_file, accepted_ids=()):
    """Evaluate every target listed in targets_file. Returns a dict the summary and the gate share."""
    result = {"targets": [], "gated": [], "accepted": [], "protocols": [], "errors": [], "notes": []}
    try:
        targets = [line.strip() for line in targets_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    except OSError:
        targets = []
    if not targets:
        result["errors"].append("no TLS target was scanned (HTTPS on port 443 was not reachable)")
        return result

    protocols = set()
    for target in targets:
        findings, errors, notes = evaluate_target(reports, target)
        result["targets"].append(target)
        result["errors"].extend(errors)
        result["notes"].extend(notes)
        for item in findings:
            if item["severity"] in GATED_SEVERITIES:
                bucket = "accepted" if item["id"] in accepted_ids else "gated"
                result[bucket].append({"target": target, **item})
            offered = item["finding"].lower()
            if item["id"] in PROTOCOL_IDS and "offered" in offered and "not offered" not in offered:
                protocols.add(item["id"])
    result["protocols"] = [name for name in PROTOCOL_IDS if name in protocols]
    return result


def markdown(result):
    """The testssl.sh part of the job summary."""
    lines = ["### TLS Security (testssl.sh)", "", f"- **TLS Targets Evaluated:** {len(result['targets'])}"]
    if result["protocols"]:
        lines.append(f"- **Supported TLS Protocols:** `{', '.join(result['protocols'])}`")
    for error in result["errors"]:
        lines.append(f"- 🚨 **Not evaluated:** {error}")
    for note in result["notes"]:
        lines.append(f"- ⚠️ {note}")
    if result["gated"]:
        lines.extend(["", "#### 🚨 High/Critical TLS Findings", ""])
        for item in result["gated"][:15]:
            lines.append(f"- **[{item['severity']}]** `{item['id']}`: {item['finding']}")
    elif not result["errors"]:
        lines.append("- **TLS Vulnerabilities:** ✅ No High or Critical TLS findings.")
    if result["accepted"]:
        lines.extend(["", "#### Accepted High/Critical TLS Findings", ""])
        for item in result["accepted"]:
            lines.append(f"- **[{item['severity']}]** `{item['id']}`: {item['finding']}")
    lines.append("")
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("reports", type=Path, help="directory with testssl-<target>.json and .status files")
    parser.add_argument("--targets", type=Path, help="file with one scanned host:port per line (default: <reports>/tls-targets.txt)")
    parser.add_argument("--markdown", type=Path, help="write the job-summary section to this file")
    parser.add_argument("--accept-ids", default="", help="comma-separated finding ids that do not fail the gate")
    parser.add_argument(
        "--report-findings-only",
        action="store_true",
        help="HIGH/CRITICAL findings do not fail the run; operational errors still do",
    )
    args = parser.parse_args(argv)

    accepted = {name.strip() for name in args.accept_ids.split(",") if name.strip()}
    result = evaluate(args.reports, args.targets or args.reports / "tls-targets.txt", accepted)
    if args.markdown:
        args.markdown.write_text(markdown(result), encoding="utf-8")

    for note in result["notes"]:
        print(f"::warning::{note}")
    for item in result["accepted"]:
        print(f"::notice::accepted {item['severity']} TLS finding {item['id']}: {item['finding']}")
    for error in result["errors"]:
        print(f"::error::testssl.sh result cannot be trusted: {error}")
    if result["gated"]:
        level = "warning" if args.report_findings_only else "error"
        print(f"::{level}::testssl.sh detected {len(result['gated'])} CRITICAL/HIGH TLS finding(s):")
        for item in result["gated"][:10]:
            print(f"::{level}::  - [{item['severity']}] {item['id']}: {item['finding']}")

    if result["errors"]:
        return 2
    if result["gated"] and not args.report_findings_only:
        return 1
    if not result["gated"]:
        print(f"No CRITICAL or HIGH testssl.sh TLS findings in {len(result['targets'])} evaluated target(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
