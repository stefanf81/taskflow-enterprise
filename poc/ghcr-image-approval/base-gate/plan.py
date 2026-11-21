#!/usr/bin/env python3
"""Plan the CI base-image gate: which digest-pinned base images does this change move?

The baseline is the commit the change lands on: for a pull request the first parent of the
merge commit actions/checkout tests (the current main), for a push to main the commit before
the push (`github.event.before`). The candidate is the checked-out working tree.

For every Dockerfile listed in base-gate/config.json at the baseline OR at the candidate (so
a change cannot stop the gate from watching a file by dropping it from the list), the FROM
images are read and paired by repository:
  * changed  - same repository, different digest: compare old -> new;
  * added    - a repository with no baseline pin: compare the image with itself, so
               scripts/evaluate.py's self-comparison mode reports its absolute findings
               (SUID/SGID files, world-writable paths, Critical and High CVEs, ...);
  * removed / unchanged - reported only.
Identical (old, new) pairs found in several files are compared once.

Every external FROM must be pinned by digest; an unpinned one cannot be compared and fails
the plan. Stage names and `scratch` are skipped. Nothing is compared when there is no
baseline: on the first push (`before` is all zeros), or when the baseline commit has no
base-gate/config.json yet (the change introduces the gate). A candidate without the config
fails.

Usage: plan.py --base-rev SHA [--config base-gate/config.json] [--output plan.json]
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from check_dockerfile_bases import logical_instructions  # noqa: E402

SHA = re.compile(r'^[0-9a-f]{40}$')
NO_BASE = '0' * 40
CONFIG = 'base-gate/config.json'
DOCKERFILE = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_./-]*$')
DIGEST = re.compile(r'^sha256:[0-9a-f]{64}$')
TAG = re.compile(r'^[\w][\w.-]{0,127}$')
REGISTRY = re.compile(r'^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?$')
COMPONENT = re.compile(r'^[a-z0-9]+(?:[._-][a-z0-9]+)*$')


def normalise(image):
    """`[registry/]path[:tag]@sha256:...` -> ('registry/path', 'sha256:...'); tag dropped."""
    name, _, digest = image.partition('@')
    if not DIGEST.fullmatch(digest):
        raise ValueError(f'base image {image!r} is not pinned by digest (repository[:tag]@sha256:...)')
    head, _, last = name.rpartition('/')
    if ':' in last:
        last, _, tag = last.partition(':')
        if not TAG.fullmatch(tag):
            raise ValueError(f'cannot parse tag of {image!r}')
    name = f'{head}/{last}' if head else last
    parts = name.split('/')
    if len(parts) > 1 and ('.' in parts[0] or ':' in parts[0] or parts[0] == 'localhost'):
        registry, path = parts[0], parts[1:]
        if not REGISTRY.fullmatch(registry):
            raise ValueError(f'cannot parse registry of {image!r}')
    else:
        registry, path = 'docker.io', parts
    if registry == 'docker.io' and len(path) == 1:
        path = ['library'] + path
    if not path or not all(COMPONENT.fullmatch(p) for p in path):
        raise ValueError(f'cannot parse repository of {image!r}')
    return f'{registry}/{"/".join(path)}', digest


def pins(text, where):
    """{repository: digest} for every external FROM of one Dockerfile."""
    result, stages = {}, set()
    for number, instruction in logical_instructions(text):
        tokens = instruction.split()
        if tokens[0].upper() != 'FROM':
            continue
        args = [t for t in tokens[1:] if not t.startswith('--')]
        if not args or '$' in args[0]:
            raise ValueError(f'{where} line {number}: cannot read the FROM image')
        image = args[0]
        if len(args) >= 3 and args[1].lower() == 'as':
            stages.add(args[2].lower())
        if image.lower() in stages or image == 'scratch':
            continue
        repository, digest = normalise(image)
        if result.get(repository, digest) != digest:
            raise ValueError(f'{where}: {repository} is pinned to two different digests')
        result[repository] = digest
    return result


def git_show(rev, path):
    result = subprocess.run(['git', 'show', f'{rev}:{path}'], cwd=ROOT, capture_output=True)
    return result.stdout.decode() if result.returncode == 0 else None


def dockerfiles(config_text, where):
    data = json.loads(config_text)
    files = data.get('dockerfiles') if isinstance(data, dict) else None
    if not isinstance(files, list) or not all(
            isinstance(f, str) and DOCKERFILE.fullmatch(f) and '..' not in f for f in files):
        raise ValueError(f'{where}: "dockerfiles" must be a list of relative paths')
    return files


def plan(base_rev, config_path=CONFIG):
    if base_rev == NO_BASE:
        return {'base': None, 'skipped': 'no previous commit to compare with (first push)',
                'comparisons': [], 'unchanged': [], 'removed': []}
    if not SHA.fullmatch(base_rev or ''):
        raise ValueError('--base-rev must be a full lowercase 40-hex commit SHA')
    check = subprocess.run(['git', 'cat-file', '-e', f'{base_rev}^{{commit}}'], cwd=ROOT, capture_output=True)
    if check.returncode != 0:
        raise ValueError(f'baseline commit {base_rev} is not in this clone (fetch-depth: 0 needed)')
    head_config = (ROOT / config_path).read_text()   # deleting the config fails closed here
    base_config = git_show(base_rev, config_path)
    files = set(dockerfiles(head_config, 'candidate config'))
    if base_config is None:
        # The baseline predates the gate (e.g. the first push onto a repository created with a
        # README): there is no accepted pin set to compare with yet.
        return {'base': base_rev, 'skipped': f'{config_path} does not exist at the baseline '
                f'{base_rev} (this change introduces the gate)',
                'comparisons': [], 'unchanged': [], 'removed': []}
    files |= set(dockerfiles(base_config, 'baseline config'))
    comparisons, unchanged, removed = {}, [], []
    for path in sorted(files):
        old_text = git_show(base_rev, path)
        new_file = ROOT / path
        new_text = new_file.read_text() if new_file.is_file() else None
        if old_text is None and new_text is None:
            raise ValueError(f'{path} is listed in {config_path} but exists in neither commit')
        old = pins(old_text, f'{path} (baseline)') if old_text is not None else {}
        new = pins(new_text, path) if new_text is not None else {}
        for repository in sorted(set(old) | set(new)):
            if repository not in new:
                removed.append({'file': path, 'ref': f'{repository}@{old[repository]}'})
                continue
            new_ref = f'{repository}@{new[repository]}'
            if old.get(repository) == new[repository]:
                unchanged.append({'file': path, 'ref': new_ref})
                continue
            old_ref = f'{repository}@{old[repository]}' if repository in old else new_ref
            entry = comparisons.setdefault((old_ref, new_ref), {
                'old_ref': old_ref, 'new_ref': new_ref,
                'kind': 'changed' if repository in old else 'added', 'files': []})
            entry['files'].append(path)
    ordered = [dict(entry, id=f'c{i}') for i, entry in enumerate(comparisons.values(), 1)]
    return {'base': base_rev, 'comparisons': ordered, 'unchanged': unchanged, 'removed': removed}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--base-rev', required=True)
    p.add_argument('--config', default=CONFIG)
    p.add_argument('--output')
    a = p.parse_args()
    try:
        result = plan(a.base_rev, a.config)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f'BASE GATE PLAN FAILED: {exc}')
    text = json.dumps(result, indent=2, sort_keys=True) + '\n'
    if a.output:
        pathlib.Path(a.output).write_text(text)
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()
