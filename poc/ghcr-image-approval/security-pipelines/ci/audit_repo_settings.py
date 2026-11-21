#!/usr/bin/env python3
"""Audit the security repository's GitHub settings that the workflows rely on but cannot set.

Workflow YAML cannot stop a repository writer from pushing a branch or tag that carries a
MODIFIED workflow and dispatching it: such a run gets whatever `permissions:` it asks for,
including `packages: write` (GITHUB_TOKEN is not package-scoped). The `github.ref == main`
guards in the workflows only constrain the unmodified files. The real controls are
repository settings, and this script checks them (run it as a repository admin):

  GH_TOKEN=<admin token> python3 ci/audit_repo_settings.py --repo OWNER/SECURITY_REPO

FAIL (exit 1) when:
  * default workflow permissions are not read-only, or Actions may approve pull requests;
  * an environment used by the workflows is missing, or its deployment branches are anything
    but a custom policy of exactly `main` ("protected branches only" is refused: it admits
    every branch that has a protection rule);
  * a reviewer environment has no required reviewers or allows self-review;
  * no ACTIVE ruleset restricts creation of branches AND of tags (~ALL) without a broad
    bypass, so any writer could start a modified workflow;
  * main is not demonstrably protected by required PR review and mandatory CI checks that
    nobody can bypass.

Bypass lists ARE judged:
  * A ruleset only counts as evidence when its `bypass_actors` list is in the API answer.
    A missing field is treated as "unknown", never as "nobody" (v4 did the latter). If the
    token cannot read the list, rerun with one that can manage the ruleset.
  * The main-protection ruleset must have an empty bypass list. Classic branch protection
    must have no pull-request bypass allowances.
  * Creation rulesets may be bypassed by repository admins and organization admins only.
    Any other repository role fails. Teams, apps and deploy keys cannot be judged from here
    and are printed as CHECK MANUALLY lines with their IDs.

CODEOWNERS and the GHCR "Manage Actions access" grants remain manual checks.

PoC (solo maintainer): when policy/config.json sets `"allow_self_approval": true` (see
ci/environment_approver.py), two requirements nobody can meet alone are relaxed and printed
as NOTE lines instead: reviewer environments may allow self-review (they still need a
required reviewer, so the run still pauses), and main may require a pull request with ZERO
approvals (the pull request, the required checks, deletion protection and the empty bypass
list stay mandatory; with one or more required approvals, stale-review dismissal too). Every
other check is unchanged. The switch is read from policy/config.json on the AUDITED
repository's main branch, not from the working directory; `--policy FILE` overrides that for
offline use and says so in the output.
"""
import argparse
import base64
import binascii
import json
import pathlib
import subprocess
import sys

POLICY_PATH = 'policy/config.json'

ENVIRONMENTS = (
    'ghcr-quarantine', 'base-manual-approval', 'base-auto-promotion',
    'application-source-read', 'ghcr-read-only', 'ghcr-candidate-writer',
    'application-high-cve-review', 'ghcr-application-promoter',
    'independent-verification', 'ghcr-application-signing',
)
REVIEWER_ENVIRONMENTS = ('base-manual-approval', 'application-high-cve-review')
ADMIN_REPOSITORY_ROLE_ID = 5   # built-in "admin" repository role in ruleset bypass lists
MANUAL = (
    'CODEOWNERS covers .github/workflows/, ci/, scripts/ and policy/ with required review.',
    'Check inherited organization rulesets and bypass lists; audit is conservative, not an effective-permissions oracle.',
    'Each GHCR package grants this repository only the Actions role it needs (Manage Actions access).',
)


def audit(settings, allow_self_approval=False):
    """settings = {'workflow_permissions', 'environments': {name: env|None},
    'branch_policies': {name: [names]}, 'rulesets': [full ruleset objects]} -> list of failures.

    allow_self_approval relaxes only "Prevent self-review" and the PR approval count."""
    failures = []
    wp = settings.get('workflow_permissions') or {}
    if wp.get('default_workflow_permissions') != 'read':
        failures.append('Default GITHUB_TOKEN permissions must be read-only')
    if wp.get('can_approve_pull_request_reviews'):
        failures.append('GitHub Actions must not be allowed to approve pull requests')
    for name in ENVIRONMENTS:
        env = (settings.get('environments') or {}).get(name)
        if not env:
            failures.append(f'environment {name} does not exist')
            continue
        policy = env.get('deployment_branch_policy')
        branches = (settings.get('branch_policies') or {}).get(name)
        if not policy:
            failures.append(f'environment {name} allows deployments from every branch and tag')
        elif policy.get('custom_branch_policies'):
            if branches != [{'name': 'main', 'type': 'branch'}]:
                failures.append(f'environment {name} must allow exactly the main branch (has {branches})')
        elif policy.get('protected_branches'):
            failures.append(f'environment {name} must allow exactly the main branch; "protected branches '
                            'only" admits every branch that has a protection rule')
        else:
            failures.append(f'environment {name} has no deployment branch restriction')
        if name in REVIEWER_ENVIRONMENTS:
            rules = [r for r in env.get('protection_rules') or [] if r.get('type') == 'required_reviewers']
            if not rules or not rules[0].get('reviewers'):
                failures.append(f'environment {name} needs required reviewers')
            elif not rules[0].get('prevent_self_review') and not allow_self_approval:
                failures.append(f'environment {name} must enable "Prevent self-review"')
    unreadable = [r for r in settings.get('rulesets') or []
                  if r.get('enforcement') == 'active' and _bypass(r) is None]
    hint = (f' ({len(unreadable)} active ruleset(s) ignored: bypass list not readable with this token)'
            if unreadable else '')
    if not _main_is_protected(settings, min_approvals=0 if allow_self_approval else 1):
        failures.append('main branch update protection missing: require PR reviews and status checks '
                        'with no bypass' + hint)
    for target in ('branch', 'tag'):
        if not any(_restricts_creation(r, target) for r in settings.get('rulesets') or []):
            plural = 'branches' if target == 'branch' else 'tags'
            failures.append(f'no active {target} ruleset restricts creating {plural} for everyone but '
                            f'admins (include ~ALL, rule "creation", no broad bypass)' + hint)
    return failures


def _bypass(ruleset):
    """The ruleset's bypass list, or None when the API answer does not contain it."""
    actors = ruleset.get('bypass_actors')
    if isinstance(actors, list) and all(isinstance(a, dict) for a in actors):
        return actors
    return None


def _broad_bypass(actors):
    """Bypass actors that let ordinary writers through (or that this script does not know)."""
    broad = []
    for actor in actors:
        kind = actor.get('actor_type')
        if kind == 'OrganizationAdmin':
            continue
        if kind == 'RepositoryRole' and actor.get('actor_id') == ADMIN_REPOSITORY_ROLE_ID:
            continue
        if kind in ('Team', 'Integration', 'DeployKey'):
            continue   # cannot be judged here; listed by bypass_notes()
        broad.append(actor)
    return broad


def bypass_notes(settings):
    """CHECK MANUALLY lines for bypass actors whose membership this script cannot see."""
    notes = []
    for ruleset in settings.get('rulesets') or []:
        for actor in _bypass(ruleset) or []:
            if actor.get('actor_type') in ('Team', 'Integration', 'DeployKey'):
                notes.append(f"ruleset {ruleset.get('name', ruleset.get('id'))!r} can be bypassed by "
                             f"{actor.get('actor_type')} {actor.get('actor_id')}: confirm it contains "
                             'only people/apps that may change workflows')
    return notes


def _main_ruleset(rule):
    if rule.get('target') != 'branch' or rule.get('enforcement') != 'active':
        return False
    ref = (rule.get('conditions') or {}).get('ref_name') or {}
    included = ref.get('include') or []
    excluded = ref.get('exclude') or []
    covers = any(x in included for x in ('~ALL', '~DEFAULT_BRANCH', 'refs/heads/main'))
    excluded_main = any(x in excluded for x in ('~ALL', '~DEFAULT_BRANCH', 'refs/heads/main'))
    return covers and not excluded_main


def _main_is_protected(settings, min_approvals=1):
    # A ruleset with a `creation` rule does not protect updates to an existing branch.
    # Require active protection of both PR review and CI status checks, and refuse bypass
    # actors since a bypass actor with write rights could modify workflows directly.
    for ruleset in settings.get('rulesets') or []:
        # Unknown bypass list (None) is not evidence; a non-empty one is a bypass.
        if not _main_ruleset(ruleset) or _bypass(ruleset) != []:
            continue
        kinds = {x.get('type'): x.get('parameters') or {} for x in ruleset.get('rules') or []}
        pr = kinds.get('pull_request')
        checks = kinds.get('required_status_checks')
        if (pr is not None and checks is not None
                and pr.get('required_approving_review_count', 0) >= min_approvals
                and (pr.get('required_approving_review_count', 0) == 0
                     or pr.get('dismiss_stale_reviews_on_push', False))
                and checks.get('required_status_checks')
                and kinds.get('deletion') is not None):
            return True
    # Strict alternative: configured and enforced legacy branch protection API.
    branch = settings.get('main_branch_protection') or {}
    reviews = branch.get('required_pull_request_reviews') or {}
    statuses = branch.get('required_status_checks') or {}
    enforced = (branch.get('enforce_admins') or {}).get('enabled')
    allowances = reviews.get('bypass_pull_request_allowances') or {}
    if any(allowances.get(kind) for kind in ('users', 'teams', 'apps')):
        return False   # named people/apps may merge without the required review
    if (branch.get('required_pull_request_reviews') is not None
            and reviews.get('required_approving_review_count', 0) >= min_approvals
            and (reviews.get('required_approving_review_count', 0) == 0
                 or reviews.get('dismiss_stale_reviews', False))
            and (statuses.get('checks') or statuses.get('contexts')) and enforced
            and (branch.get('allow_force_pushes') or {}).get('enabled') is not True
            and (branch.get('allow_deletions') or {}).get('enabled') is not True):
        return True
    return False


def _restricts_creation(ruleset, target):
    if ruleset.get('target') != target or ruleset.get('enforcement') != 'active':
        return False
    ref = ((ruleset.get('conditions') or {}).get('ref_name')) or {}
    if '~ALL' not in (ref.get('include') or []) or ref.get('exclude'):
        return False
    actors = _bypass(ruleset)
    if actors is None or _broad_bypass(actors):
        return False
    return any(rule.get('type') == 'creation' for rule in ruleset.get('rules') or [])


def _gh(path):
    out = subprocess.run(['gh', 'api', '-H', 'Accept: application/vnd.github+json', path],
                         capture_output=True, text=True)
    if out.returncode:
        if 'Not Found' in out.stderr or 'HTTP 404' in out.stderr:
            return None
        raise SystemExit(f'gh api {path} failed: {out.stderr.strip()}')
    return json.loads(out.stdout)


def collect(repo):
    settings = {'workflow_permissions': _gh(f'repos/{repo}/actions/permissions/workflow'),
                'environments': {}, 'branch_policies': {}, 'rulesets': [],
                'main_branch_protection': _gh(f'repos/{repo}/branches/main/protection')}
    for name in ENVIRONMENTS:
        env = _gh(f'repos/{repo}/environments/{name}')
        settings['environments'][name] = env
        if env and (env.get('deployment_branch_policy') or {}).get('custom_branch_policies'):
            data = _gh(f'repos/{repo}/environments/{name}/deployment-branch-policies') or {}
            settings['branch_policies'][name] = sorted(
                ({'name': p.get('name'), 'type': p.get('type', 'branch')} for p in data.get('branch_policies', [])),
                key=lambda p: (p['type'], p['name']))
    for summary in _gh(f'repos/{repo}/rulesets?includes_parents=true&per_page=100') or []:
        full = _gh(f"repos/{repo}/rulesets/{summary['id']}")
        if full:
            settings['rulesets'].append(full)
    return settings


def remote_policy(repo, ref='main'):
    """policy/config.json as committed on `ref` of the audited repository."""
    data = _gh(f'repos/{repo}/contents/{POLICY_PATH}?ref={ref}')
    if not isinstance(data, dict) or data.get('encoding') != 'base64' or not isinstance(data.get('content'), str):
        raise SystemExit(f'cannot read {POLICY_PATH} on {ref} of {repo}')
    try:
        return json.loads(base64.b64decode(data['content']))
    except (ValueError, binascii.Error) as e:
        raise SystemExit(f'{POLICY_PATH} on {ref} of {repo} is not valid JSON: {e}')


def self_approval_setting(config):
    value = config.get('allow_self_approval', False) if isinstance(config, dict) else None
    if not isinstance(value, bool):
        raise SystemExit('allow_self_approval must be true or false')
    return value


def self_approval_notes(allow_self_approval):
    if not allow_self_approval:
        return []
    return ['allow_self_approval is on: reviewer environments may allow self-review and main may '
            'merge pull requests without an approving review. Signed records name such approvers '
            'self:<login>. Turn it off as soon as a second reviewer exists.']


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--repo', required=True, help='OWNER/SECURITY_REPO')
    p.add_argument('--policy', metavar='FILE',
                   help=f'read allow_self_approval from this local file instead of {POLICY_PATH} on the '
                        "audited repository's main (offline use; the output says so)")
    a = p.parse_args()
    if a.policy:
        config = json.loads(pathlib.Path(a.policy).read_text())
        source = f'the LOCAL file {a.policy}, which may differ from main of {a.repo}'
    else:
        config = remote_policy(a.repo)
        source = f'{POLICY_PATH} on main of {a.repo}'
    allow_self = self_approval_setting(config)
    settings = collect(a.repo)
    failures = audit(settings, allow_self_approval=allow_self)
    for f in failures:
        print('FAIL ' + f)
    print(f'NOTE allow_self_approval={str(allow_self).lower()} was read from {source}')
    for n in self_approval_notes(allow_self):
        print('NOTE ' + n)
    for m in list(MANUAL) + bypass_notes(settings):
        print('CHECK MANUALLY ' + m)
    if failures:
        sys.exit(1)
    print('Repository settings audit passed (manual checks above still apply)')


if __name__ == '__main__':
    main()
