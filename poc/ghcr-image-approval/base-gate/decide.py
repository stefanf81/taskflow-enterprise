#!/usr/bin/env python3
"""Decide the CI base-image gate from the per-comparison decisions of compare_all.sh.

For each comparison in the plan (REPORTS/<id>/decision.json, written by scripts/evaluate.py):
  * any block reason                      -> FAIL. Cannot be accepted here; a new Critical CVE
                                             can only be excepted by the kit's own scoped
                                             policy/config.json `critical_exceptions`.
  * any attention reason                  -> FAIL, unless base-gate/config.json `acceptances`
                                             holds an unexpired entry for that exact new
                                             image (repository@sha256:digest).
  * only routine reasons (or none at all) -> PASS; the routine reasons are reported.
A missing or unreadable decision fails closed.

An acceptance covers every attention finding of that image until it expires (at most
MAX_ACCEPT_DAYS ahead). It is a reviewed change in the pull request that moves the pin:
  {"image": "docker.io/library/eclipse-temurin@sha256:...", "approved_by": "github-login",
   "reason": "why these findings are acceptable", "expires": "YYYY-MM-DD"}

Usage: decide.py --plan plan.json --reports DIR [--config base-gate/config.json]
                 [--summary FILE] [--today YYYY-MM-DD]
Exit code 0 = gate passed, 1 = gate failed.
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import sys

IMAGE = re.compile(r'^[a-z0-9.:-]+(?:/[a-z0-9._-]+)+@sha256:[0-9a-f]{64}$')
MAX_ACCEPT_DAYS = 90
ACCEPT_KEYS = {'image', 'approved_by', 'reason', 'expires'}
DECISIONS = {'BLOCK', 'REVIEW', 'AUTO_PASS'}


def acceptances(config, today):
    """Validate every entry; return the unexpired ones keyed by image."""
    entries = config.get('acceptances', [])
    if not isinstance(entries, list):
        raise ValueError('acceptances must be a list')
    valid = {}
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != ACCEPT_KEYS:
            raise ValueError(f'acceptance needs exactly {sorted(ACCEPT_KEYS)}: {entry!r}')
        if not all(isinstance(entry[k], str) and entry[k].strip() for k in ACCEPT_KEYS):
            raise ValueError(f'acceptance fields must be non-empty strings: {entry!r}')
        if not IMAGE.fullmatch(entry['image']):
            raise ValueError(f'acceptance image must be an exact repository@sha256:digest: {entry["image"]!r}')
        try:
            expires = dt.date.fromisoformat(entry['expires'])
        except ValueError:
            raise ValueError(f'acceptance for {entry["image"]}: expires must be YYYY-MM-DD')
        if expires > today + dt.timedelta(days=MAX_ACCEPT_DAYS):
            raise ValueError(f'acceptance for {entry["image"]} expires more than {MAX_ACCEPT_DAYS} days ahead')
        if expires >= today:
            valid[entry['image']] = entry
    return valid


def judge(comparison, decision, accepted):
    """Return (verdict, note) for one comparison."""
    if not isinstance(decision, dict) or decision.get('decision') not in DECISIONS:
        return 'FAIL', 'no valid decision.json (the comparison did not finish)'
    for key in ('block_reasons', 'attention_reasons', 'routine_reasons'):
        if not isinstance(decision.get(key), list):
            return 'FAIL', f'decision.json lacks {key}'
    if decision['block_reasons']:
        return 'FAIL', 'block findings (cannot be accepted in base-gate/config.json)'
    if decision['attention_reasons']:
        entry = accepted.get(comparison['new_ref'])
        if entry is None:
            return 'FAIL', ('attention findings; review them and add an acceptance for this exact image '
                            'to base-gate/config.json, or keep the old pin')
        return 'ACCEPTED', f'attention findings accepted by {entry["approved_by"]} until {entry["expires"]}: {entry["reason"]}'
    return 'PASS', 'no block or attention findings'


def fence(lines):
    # Image paths are untrusted: backticks could end the code block on the summary page.
    return ['```text'] + [line.replace('`', "'") for line in lines] + ['```']


def report(plan, results):
    out = ['## Base-image gate', '']
    if plan.get('skipped'):
        out.append(f'Skipped: {plan["skipped"]}.')
    elif not plan['comparisons']:
        out.append(f'No base-image pin changed against `{plan["base"]}`.')
    for comparison, verdict, note, decision in results:
        out += ['', f'### {verdict}: {comparison["kind"]} pin in {", ".join(comparison["files"])}', '',
                f'- baseline: `{comparison["old_ref"]}`' if comparison['kind'] == 'changed'
                else '- baseline: none (new repository; the image was compared with itself)',
                f'- candidate: `{comparison["new_ref"]}`', f'- {note}', '']
        lines = []
        if isinstance(decision, dict):
            for key, label in (('block_reasons', 'BLOCK'), ('attention_reasons', 'ATTENTION'),
                               ('routine_reasons', 'routine')):
                lines += [f'{label}: {reason}' for reason in decision.get(key) or []]
        out += fence(lines or ['(no findings)'])
    for key, label in (('unchanged', 'Unchanged'), ('removed', 'Removed')):
        if plan.get(key):
            out += ['', f'{label} pins:'] + [f'- `{p["ref"]}` ({p["file"]})' for p in plan[key]]
    return '\n'.join(out) + '\n'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--plan', required=True)
    p.add_argument('--reports', required=True)
    p.add_argument('--config', default='base-gate/config.json')
    p.add_argument('--summary')
    p.add_argument('--today', type=dt.date.fromisoformat, default=dt.datetime.now(dt.timezone.utc).date())
    a = p.parse_args()
    try:
        plan = json.loads(pathlib.Path(a.plan).read_text())
        accepted = acceptances(json.loads(pathlib.Path(a.config).read_text()), a.today)
    except (ValueError, OSError) as exc:
        raise SystemExit(f'BASE GATE FAILED: {exc}')
    results = []
    for comparison in plan['comparisons']:
        path = pathlib.Path(a.reports) / comparison['id'] / 'decision.json'
        try:
            decision = json.loads(path.read_text())
        except (OSError, ValueError):
            decision = None
        verdict, note = judge(comparison, decision, accepted)
        results.append((comparison, verdict, note, decision))
    text = report(plan, results)
    sys.stdout.write(text)
    if a.summary:
        with open(a.summary, 'a') as handle:
            handle.write(text)
    failed = [c['new_ref'] for c, verdict, _, _ in results if verdict == 'FAIL']
    if failed:
        raise SystemExit(f'BASE GATE FAILED for {", ".join(failed)}')
    print('Base-image gate passed.')


if __name__ == '__main__':
    main()
