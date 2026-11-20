#!/usr/bin/env python3
"""Resolve the application a release run is for, from the PROTECTED allowlist.

The release workflow takes `app_name` as a dispatch input. Everything else about the
application (source repository, Dockerfile path, declared build outputs) comes from
policy/applications.json on the security repository's protected main branch, never from
the person dispatching the run. One security repository can therefore release many
applications, and adding one is a reviewed pull request.

Every job of the release run checks out the same security-repository commit, so each job
resolves the same entry itself; nothing about the application travels between jobs as
unchecked text.

Usage: app_config.py --name APP [--allowlist policy/applications.json]
                     [--field source_repo|dockerfile|build_outputs] [--github-output FILE]
Without --field prints (and appends to --github-output) lines name=..., source_repo=...,
dockerfile=..., build_outputs=...; with --field prints only that value.
"""
import argparse
import json
import pathlib
import re

SCHEMA = 'https://example.org/ghcr-application-allowlist/v1'
NAME = re.compile(r'[a-z0-9][a-z0-9._-]{0,99}')
REPO = re.compile(r'[A-Za-z0-9._-]+/[A-Za-z0-9._-]+')
OUTPUT = re.compile(r'[A-Za-z0-9_./-]+')


def resolve(allowlist, name):
    if not NAME.fullmatch(name or ''):
        raise ValueError('app_name must be a lowercase GHCR package name')
    data = json.loads(pathlib.Path(allowlist).read_text())
    if not isinstance(data, dict) or data.get('schema') != SCHEMA or not isinstance(data.get('applications'), dict):
        raise ValueError('application allowlist has an unexpected schema')
    for key in data['applications']:
        if not NAME.fullmatch(key):
            raise ValueError(f'allowlist entry {key!r} is not a valid package name')
    entry = data['applications'].get(name)
    if not isinstance(entry, dict):
        raise ValueError(f'application {name!r} is not in the protected allowlist')
    if set(entry) != {'source_repo', 'dockerfile', 'build_outputs'}:
        raise ValueError('allowlist entry must have exactly source_repo, dockerfile and build_outputs')
    repo, dockerfile, outputs = entry['source_repo'], entry['dockerfile'], entry['build_outputs']
    if not isinstance(repo, str) or not REPO.fullmatch(repo):
        raise ValueError('source_repo must be owner/name')
    if (not isinstance(dockerfile, str) or not OUTPUT.fullmatch(dockerfile) or dockerfile.startswith('/')
            or '..' in dockerfile.split('/')):
        raise ValueError('dockerfile must be a relative path inside the repository')
    if not isinstance(outputs, str) or not outputs.strip():
        raise ValueError('build_outputs must be a non-empty string')
    for path in re.split(r'[,\s]+', outputs.strip()):
        if not OUTPUT.fullmatch(path) or path.startswith('/') or '..' in path.split('/'):
            raise ValueError(f'unsafe build output path {path!r}')
    return {'name': name, 'source_repo': repo, 'dockerfile': dockerfile,
            'build_outputs': ' '.join(re.split(r'[,\s]+', outputs.strip()))}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--name', required=True)
    p.add_argument('--allowlist', default='policy/applications.json')
    p.add_argument('--github-output')
    p.add_argument('--field', choices=['source_repo', 'dockerfile', 'build_outputs'])
    a = p.parse_args()
    try:
        result = resolve(a.allowlist, a.name)
    except (ValueError, OSError, json.JSONDecodeError) as e:
        raise SystemExit(f'APPLICATION NOT ALLOWED: {e}')
    if a.field:
        print(result[a.field])
        return
    lines = ''.join(f'{k}={v}\n' for k, v in result.items())
    if a.github_output:
        with open(a.github_output, 'a', encoding='utf-8') as f:
            f.write(lines)
    print(lines, end='')


if __name__ == '__main__':
    main()
