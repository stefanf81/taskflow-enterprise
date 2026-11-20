#!/usr/bin/env python3
"""Create the JSON predicate recording the approval *decision* (distinct from build provenance).

Binds the decision to the evidence: every report file in --evidence-dir is hashed into the
predicate, so the signed attestation commits to the SBOMs, scans, diffs and inventories that
the decision was based on (archive them with the build to make the hashes checkable).

--bootstrap (PoC, used only by the base-bootstrap workflow) records the FIRST baseline, which
nothing could be compared with: the record says `"bootstrap": true` and carries NO
`policy_sha256`. The attestation checker therefore accepts it only where no fingerprint is
required (as the comparison baseline of the next base evaluation); the precheck and the
application base verification demand the current fingerprint and refuse it, so no application
can be built on a bootstrapped digest until the normal pipeline has evaluated and approved it.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from policy_fingerprint import fingerprint

AUTOMATIC_APPROVER = 'automatic-policy'
SIGNABLE_DECISIONS = ('AUTO_PASS', 'REVIEW')


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def evidence_hashes(evidence_dir, exclude):
    root = pathlib.Path(evidence_dir)
    exclude = {pathlib.Path(p).resolve() for p in exclude}
    return {str(p.relative_to(root)): sha256_file(p)
            for p in sorted(root.rglob('*')) if p.is_file() and p.resolve() not in exclude}


def build_record(args):
    decision_path = pathlib.Path(args.decision_file)
    decision_bytes = decision_path.read_bytes()
    decision = json.loads(decision_bytes)
    verdict = decision['decision']
    approver = (args.approver or '').strip()
    if verdict not in SIGNABLE_DECISIONS:
        raise ValueError(f'Refusing to record an approval for decision {verdict!r}')
    if verdict == 'REVIEW' and approver in ('', AUTOMATIC_APPROVER):
        raise ValueError('Decision is REVIEW but no human approver was recorded')
    if verdict == 'AUTO_PASS' and approver != AUTOMATIC_APPROVER:
        raise ValueError(f'Decision is AUTO_PASS but approver is {approver!r}; expected {AUTOMATIC_APPROVER!r}')
    bootstrap = bool(getattr(args, 'bootstrap', False))
    if bootstrap and verdict != 'REVIEW':
        raise ValueError('A bootstrap baseline must be a human-reviewed REVIEW decision')
    record = {
        'schema': args.predicate_type,
        'upstream_ref': args.upstream_ref,
        'approved_ref': args.approved_ref,
        'decision': verdict,
        'policy_version': decision['policy_version'],
        'policy_sha256': fingerprint(),
        'upstream_signature': decision.get('upstream_signature', 'unknown'),
        'upstream_provenance': decision.get('upstream_provenance', 'unknown'),
        'decision_report_sha256': hashlib.sha256(decision_bytes).hexdigest(),
        'evidence_sha256': evidence_hashes(args.evidence_dir, exclude=[args.output]),
        'approver': approver,
        'build_url': args.build_url,
        'git_commit': args.git_commit,
        'timestamp_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    if bootstrap:
        del record['policy_sha256']
        record['bootstrap'] = True
    return record


def main():
    p = argparse.ArgumentParser()
    for option in ('decision-file', 'evidence-dir', 'upstream-ref', 'approved-ref', 'approver',
                   'build-url', 'git-commit', 'predicate-type', 'output'):
        p.add_argument('--' + option, required=True)
    p.add_argument('--bootstrap', action='store_true',
                   help='first baseline: mark the record and leave out the policy fingerprint')
    args = p.parse_args()
    record = build_record(args)
    pathlib.Path(args.output).write_text(json.dumps(record, indent=2, sort_keys=True) + '\n')


if __name__ == '__main__':
    main()
