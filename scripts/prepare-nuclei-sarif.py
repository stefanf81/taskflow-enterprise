"""Prepare Nuclei SARIF for upload without treating incomplete scans as clean."""

import argparse
import json
from pathlib import Path


def prepare_report(reports, version):
    output = reports / "nuclei-upload.sarif"
    # A previous prepared report must not survive a failed preparation.
    output.unlink(missing_ok=True)
    status_file = reports / "nuclei-exit-status.txt"
    if not status_file.exists():
        print("Nuclei did not run; no SARIF will be uploaded.")
        return

    exit_code = int(status_file.read_text(encoding="utf-8").strip())
    successful = (
        exit_code == 0
        and (reports / "nuclei-complete").exists()
        and not (reports / "nuclei-failed").exists()
    )
    findings = None
    if successful:
        findings = json.loads((reports / "nuclei-results.json").read_text(encoding="utf-8"))
        if not isinstance(findings, list) or any(not isinstance(item, dict) for item in findings):
            raise ValueError("Nuclei JSON must be an array of finding objects")

    source = reports / "nuclei-results.sarif"
    if source.exists() and source.stat().st_size:
        report = json.loads(source.read_text(encoding="utf-8"))
    elif successful and not findings:
        # Nuclei's exporter deliberately writes no SARIF when there are no matches.
        report = {
            "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
            "version": "2.1.0",
            "runs": [{"tool": {"driver": {"name": "nuclei", "rules": []}}, "results": []}],
        }
    elif successful:
        raise ValueError("Nuclei found matches but did not produce SARIF")
    else:
        print("Nuclei did not complete successfully; no empty SARIF will be synthesized.")
        return

    if not isinstance(report, dict) or report.get("version") != "2.1.0":
        raise ValueError("Expected a SARIF 2.1.0 report")
    runs = report.get("runs")
    if not isinstance(runs, list) or len(runs) != 1 or not isinstance(runs[0], dict):
        raise ValueError("Expected exactly one Nuclei SARIF run")
    run = runs[0]
    driver = run["tool"]["driver"]
    if driver.get("name", "").lower() != "nuclei":
        raise ValueError("Expected the Nuclei tool in SARIF")
    results = run.get("results")
    if not isinstance(results, list) or any(not isinstance(item, dict) for item in results):
        raise ValueError("Expected a SARIF results array")
    if not isinstance(driver.get("rules"), list):
        raise ValueError("Expected a SARIF rules array")
    if successful and len(results) != len(findings):
        raise ValueError("Nuclei JSON and SARIF finding counts differ")

    # Match the existing GitHub tool identity, including for synthesized empty runs.
    driver["name"] = "nuclei"
    driver["semanticVersion"] = version.removeprefix("v")
    invocations = run.get("invocations") or [{}]
    if not isinstance(invocations, list) or any(not isinstance(item, dict) for item in invocations):
        raise ValueError("Expected a SARIF invocations array")
    for invocation in invocations:
        # The upstream exporter leaves this bool false even when the process exits 0.
        invocation["executionSuccessful"] = successful
        invocation["exitCode"] = exit_code
    run["invocations"] = invocations
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {output}: {len(results)} findings, executionSuccessful={successful}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", type=Path, help="Directory containing Nuclei exports and markers")
    parser.add_argument("--version", required=True, help="Installed Nuclei version")
    args = parser.parse_args()
    try:
        prepare_report(args.reports, args.version)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        raise SystemExit(f"Unable to prepare Nuclei SARIF: {error}") from error
