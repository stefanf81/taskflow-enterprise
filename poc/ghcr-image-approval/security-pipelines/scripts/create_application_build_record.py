#!/usr/bin/env python3
"""Create a signed *workflow record* from verified, bound GitHub Actions evidence.

This is not SLSA provenance: evidence is inherited from protected GitHub Actions stages;
a separately trusted build control-plane must originate real SLSA provenance.
"""
import argparse
import hashlib
import json
import pathlib
import sys
import re

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from validate_publish_evidence import verify


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def create(a):
    directory = pathlib.Path(a.directory)
    candidate = (directory / 'pushed-ref.txt').read_text().strip()
    ref = (directory / 'approved-ref.txt').read_text().strip()
    # The signed image must be EXACTLY the pipeline's release repository at a digest, and the
    # candidate exactly the candidate repository. (Until v4 a Harbor-shaped pattern,
    # host/applications/app, was used here; it never matched ghcr.io/<owner>/applications/app,
    # so the sign job rejected every GHCR release.)
    for name, repository in (('release', a.release_repository), ('candidate', a.candidate_repository)):
        if not re.fullmatch(r'[a-z0-9.-]+(?::[0-9]+)?(?:/[a-z0-9][a-z0-9._-]*)+', repository or ''):
            raise ValueError(f'invalid {name} repository')
    if a.release_repository == a.candidate_repository:
        raise ValueError('release and candidate repositories must differ')
    verify(directory, a.candidate_repository, 'not-a-real-tag', a.artifact_manifest, a.release_repository)
    if not re.fullmatch(re.escape(a.release_repository) + r'@sha256:[0-9a-f]{64}', ref):
        raise ValueError('not a digest in the expected application release repository')
    if candidate.split('@')[1] != ref.split('@')[1]:
        raise ValueError('promoted digest does not match verified candidate')
    if not re.fullmatch(r'[0-9a-f]{40}', a.app_commit):
        raise ValueError('app commit is not a full Git SHA1')
    if not a.source_repository or not a.build_job or not re.match(r'^https?://[^/\s]+/', a.build_url):
        raise ValueError('missing trusted build identity')
    return {'schema': a.schema, 'image': ref, 'gitCommit': a.app_commit,
            'sourceRepository': a.source_repository, 'buildJob': a.build_job,
            'workflowRunUrl': a.build_url,
            'releaseAuthorizationSha256': digest(a.release_authorization),
            'applicationArtifactManifestSha256': digest(a.artifact_manifest),
            'vulnerabilityDecisionSha256': digest(directory / 'vulnerability-decision.json'),
            'independentVerificationSha256': digest(directory / 'independent-verification.json'),
            'independentVerificationSignatureSha256': digest(directory / 'independent-verification.sig'),
            'independentScanSha256': digest(directory / 'independent-grype.json'),
            'highFindingsApproval': json.loads((directory / 'independent-verification.json').read_text()).get('highApproval'),
            'platform': (directory / 'platform.txt').read_text().strip(),
            'imageConfigDigest': (directory / 'config-digest.txt').read_text().strip(),
            'baseImages': [x.strip() for x in (directory / 'base-images.txt').read_text().splitlines() if x.strip()],
            'finalBase': (directory / 'final-base.txt').read_text().strip(),
            'provenanceType': 'github-actions-workflow-record-not-slsa', 'candidateImage': candidate}


def main():
    p = argparse.ArgumentParser()
    for key in ('directory', 'app-commit', 'source-repository', 'build-job', 'schema',
                'release-authorization', 'artifact-manifest', 'build-url', 'output',
                'release-repository', 'candidate-repository'):
        p.add_argument('--' + key, required=True)
    a = p.parse_args()
    try:
        result = create(a)
        pathlib.Path(a.output).write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    except (ValueError, OSError, json.JSONDecodeError) as e:
        raise SystemExit(f'INVALID BUILD RECORD: {e}')


if __name__ == '__main__':
    main()
