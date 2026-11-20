#!/usr/bin/env python3
"""Structured risk review: config, packages, code files, links, sensitive files and CVEs.

This is a deliberately conservative SAMPLE policy, not malware detection.

Core rule for code files (executables, ELF objects, scripts, jars): every NEW or CHANGED code
file must be explained by something else that changed, otherwise the candidate needs review:
  * a dpkg package that owns the file was added or changed version (ownership comes from the
    `files` list syft records for dpkg packages), or
  * the file lives under a vendor-managed prefix (e.g. opt/java/openjdk/) and the matching
    version variable in the image Env changed (e.g. JAVA_VERSION).
Files in watched locations (tmp/, etc/, usr/local/, image root, ...) are always reviewed.

The inventory covers EVERY regular file; `is_code` distinguishes code from data, and the
reasons say which is which. Version-bump explanations are context only: any code change still
needs a human (see docs/HARDENING.md). New Critical CVEs BLOCK unless an unexpired, named
strict `critical_exceptions` matches exact CVE, package version, platform and candidate
repository@sha256 digest (then REVIEW). "New" means the (CVE, package) pair was not in the
baseline; a version bump of a package with a known unfixed CVE is not new.
"""
import argparse
import datetime as dt
import json
import pathlib
import posixpath
import re

DECISIONS = ('BLOCK', 'REVIEW', 'AUTO_PASS')
IMAGE_REF_RE = re.compile(r'[a-z0-9.-]+(?::[0-9]+)?/[a-z0-9._/-]+@sha256:[a-f0-9]{64}')
LIST_LIMIT = 15
DETAIL_LIMIT = 80


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# --- Debian version comparison (dpkg algorithm), used to detect downgrades -------------------

def _order(c):
    if c.isdigit():
        return 0
    if c.isalpha():
        return ord(c)
    if c == '~':
        return -1
    return ord(c) + 256 if c else 0


def _verrevcmp(a, b):
    i = j = 0
    while i < len(a) or j < len(b):
        first_diff = 0
        while (i < len(a) and not a[i].isdigit()) or (j < len(b) and not b[j].isdigit()):
            ac = _order(a[i]) if i < len(a) else 0
            bc = _order(b[j]) if j < len(b) else 0
            if ac != bc:
                return ac - bc
            i += 1
            j += 1
        while i < len(a) and a[i] == '0':
            i += 1
        while j < len(b) and b[j] == '0':
            j += 1
        while i < len(a) and a[i].isdigit() and j < len(b) and b[j].isdigit():
            if not first_diff:
                first_diff = ord(a[i]) - ord(b[j])
            i += 1
            j += 1
        if i < len(a) and a[i].isdigit():
            return 1
        if j < len(b) and b[j].isdigit():
            return -1
        if first_diff:
            return first_diff
    return 0


def _split_version(v):
    epoch, _, rest = v.partition(':') if ':' in v else ('0', '', v)
    upstream, _, revision = rest.rpartition('-') if '-' in rest else (rest, '', '')
    try:
        epoch_n = int(epoch)
    except ValueError:
        epoch_n = 0
    return epoch_n, upstream, revision


def compare_versions(a, b):
    """<0 if a<b, 0 if equal, >0 if a>b. dpkg semantics; a reasonable heuristic for other types."""
    ea, ua, ra = _split_version(a)
    eb, ub, rb = _split_version(b)
    if ea != eb:
        return ea - eb
    return _verrevcmp(ua, ub) or _verrevcmp(ra, rb)


# --- SBOM helpers -----------------------------------------------------------------------------

def packages(sbom):
    """{(name, type): set(versions)}"""
    result = {}
    for a in sbom.get('artifacts', []):
        result.setdefault((a.get('name', ''), a.get('type', '')), set()).add(a.get('version', ''))
    return result


def file_owners(sbom):
    """{relative path: set((name, type))} from syft dpkg metadata (`metadata.files[].path`).

    Only package-manager records (objects with a `path`) establish ownership. Syft also
    reports e.g. a `java-jvm-installation` whose `files` are plain strings (seen with Syft
    1.57 on eclipse-temurin; v4 crashed on it). Those are skipped on purpose: the JDK tree
    stays governed by `vendor_managed_prefixes`, not by a package-ownership claim."""
    owners = {}
    for a in sbom.get('artifacts', []):
        key = (a.get('name', ''), a.get('type', ''))
        files = (a.get('metadata') or {}).get('files') or []
        if not isinstance(files, list):
            continue
        for record in files:
            if not isinstance(record, dict) or not isinstance(record.get('path'), str):
                continue
            path = (record.get('path') or '').lstrip('/')
            if path:
                owners.setdefault(path, set()).add(key)
    return owners


def _path_aliases(path):
    """usr-merged images: dpkg may record /bin/x while the tar holds usr/bin/x (and vice versa)."""
    yield path
    if path.startswith('usr/'):
        yield path[4:]
    else:
        yield 'usr/' + path


def owners_of(path, owners):
    found = set()
    for alias in _path_aliases(path):
        found |= owners.get(alias, set())
    return found


# --- Config helpers ---------------------------------------------------------------------------

def env_map(env_list):
    result = {}
    for item in env_list or []:
        key, _, value = item.partition('=')
        result[key] = value
    return result


def dict_changes(old, new):
    return sorted(k for k in set(old) | set(new) if old.get(k) != new.get(k))


def _mode(item):
    try:
        return int(item.get('mode', '0'), 8)
    except (TypeError, ValueError):
        return 0


def _resolve_link(link_path, target):
    if target.startswith('/'):
        return posixpath.normpath(target).lstrip('/')
    return posixpath.normpath(posixpath.join(posixpath.dirname(link_path), target)).lstrip('/')


def _vulnerabilities(scan, severity):
    """Return (CVE, package, exact package version) tuples from Grype matches."""
    ids = set()
    if not isinstance(scan, dict) or not isinstance(scan.get('matches'), list):
        raise ValueError('Incomplete Grype result: missing matches array')
    for match in scan['matches']:
        if not isinstance(match, dict) or not isinstance(match.get('vulnerability'), dict):
            raise ValueError('Malformed Grype match')
        vuln = match['vulnerability']
        level = str(vuln.get('severity', '')).lower()
        if level not in ('critical', 'high', 'medium', 'low', 'negligible', 'unknown'):
            raise ValueError(f'Unrecognized Grype vulnerability severity {level!r}')
        if level != severity:
            continue
        artifact = match.get('artifact') or {}
        if not vuln.get('id') or not artifact.get('name'):
            raise ValueError('Incomplete Grype match: missing vulnerability ID or package')
        ids.add((vuln['id'], artifact['name'], str(artifact.get('version') or '')))
    return ids


def match_exception(exceptions, cve, package, package_version, image_ref, platform, base_image_ref=None):
    """No wildcard exceptions. CVE, package, package version and platform must agree, and the
    entry must name either this exact image (`image_ref`) or, for an application build, the
    exact approved base image the application was verified to sit on (`base_image_ref`)."""
    for entry in exceptions:
        if not (entry['id'] == cve and entry['package'] == package and
                entry['package_version'] == package_version and entry['platform'] == platform):
            continue
        if image_ref and entry.get('image_ref') == image_ref:
            return entry
        if base_image_ref and entry.get('base_image_ref') == base_image_ref:
            return entry
    return None


def new_findings(new, old):
    """Findings in `new` whose (CVE, package) pair is not in `old`.

    The package VERSION is deliberately not part of the comparison: a known, still-unfixed CVE
    is not "new" just because its package got a version bump. The version stays in the tuple
    because exceptions must name it."""
    known = {(v[0], v[1]) for v in old}
    return sorted(v for v in new if (v[0], v[1]) not in known)


# --- Policy -----------------------------------------------------------------------------------

def _is_code(item):
    return bool(item.get('is_code', item.get('exec_bits', True)))


def critical_exceptions(settings, today):
    """Validate strictly scoped exceptions; return unexpired entries (never global pairs)."""
    exceptions = settings.get('critical_exceptions', []) or []
    if not isinstance(exceptions, list):
        raise ValueError('critical_exceptions must be a list')
    result = []
    for entry in exceptions:
        if not isinstance(entry, dict):
            raise ValueError('critical exception must be a JSON object')
        required = ('id', 'package', 'package_version', 'platform', 'expires', 'reason', 'approved_by')
        missing = [k for k in required if not isinstance(entry.get(k), str) or not entry[k].strip()]
        if missing:
            raise ValueError(f'critical exception missing exact scope and approval fields: {missing}')
        scopes = [k for k in ('image_ref', 'base_image_ref') if k in entry]
        if not scopes:
            raise ValueError('critical exception needs image_ref and/or base_image_ref (no global exceptions)')
        for key in scopes:
            if not isinstance(entry[key], str) or not IMAGE_REF_RE.fullmatch(entry[key]):
                raise ValueError(f'critical exception {key} must identify an exact repository@sha256:digest')
        if not re.fullmatch(r'linux/[a-z0-9_]+(?:/[a-z0-9_]+)?', entry['platform']):
            raise ValueError('critical exception must specify an exact Linux platform')
        try:
            expires = dt.date.fromisoformat(entry['expires'])
        except ValueError:
            raise ValueError(f'critical exception {entry["id"]}: expires must be YYYY-MM-DD')
        if expires >= today:
            result.append(entry)
    return result


def evaluate(report_dir, platforms, signature, provenance, settings, today=None, candidate_ref=None):
    """Return the decision. review_reasons lists findings that need attention FIRST, then the
    routine reasons every update produces (also available separately as attention_reasons)."""
    report_dir = pathlib.Path(report_dir)
    today = today or dt.datetime.now(dt.timezone.utc).date()
    platforms = [p for p in platforms if p]
    if not platforms:
        raise ValueError('No platforms supplied; refusing to evaluate an empty platform set')
    block, attention, routine, details = [], [], [], {}
    if settings['require_manual_review_if_upstream_identity_unverified'] and signature != 'verified':
        routine.append('No verified upstream publisher signature (human review required)')
    if settings['require_manual_review_if_provenance_unverified'] and provenance != 'verified':
        routine.append('No independently validated upstream build provenance')

    watch = tuple(settings.get('always_review_code_prefixes', []))
    link_watch = tuple(settings.get('suspicious_link_target_prefixes', []))
    vendor = settings.get('vendor_managed_prefixes', {})
    expected_env = set(settings.get('expected_changing_env', []))
    expected_labels = set(settings.get('expected_changing_labels', []))
    exceptions = critical_exceptions(settings, today)
    exceptions_applied = []

    for platform in platforms:
        suffix = platform.replace('/', '-')
        rd = lambda kind, ext: load(report_dir / f'{kind}-{suffix}.{ext}.json')  # noqa: E731

        # Image configuration -------------------------------------------------------------
        old_cfg_json, new_cfg_json = rd('old', 'config'), rd('candidate', 'config')
        if (not isinstance(old_cfg_json.get('config'), dict) or
                not isinstance(new_cfg_json.get('config'), dict)):
            raise ValueError(f'{platform}: missing image config: fail closed')
        old_cfg, new_cfg = old_cfg_json['config'], new_cfg_json['config']
        config_changes = {}
        for key in settings['changed_config_review_fields']:
            if old_cfg.get(key) != new_cfg.get(key):
                config_changes[key] = {'old': old_cfg.get(key), 'new': new_cfg.get(key)}
                attention.append(f'{platform}: image configuration field changed: {key}')
        old_env, new_env = env_map(old_cfg.get('Env')), env_map(new_cfg.get('Env'))
        env_changed = dict_changes(old_env, new_env)
        unexpected_env = [k for k in env_changed if k not in expected_env]
        if unexpected_env:
            attention.append(f'{platform}: unexpected Env variables changed: {unexpected_env[:LIST_LIMIT]}')
        label_changed = dict_changes(old_cfg.get('Labels') or {}, new_cfg.get('Labels') or {})
        unexpected_labels = [k for k in label_changed if k not in expected_labels]
        if unexpected_labels:
            attention.append(f'{platform}: unexpected Labels changed: {unexpected_labels[:LIST_LIMIT]}')
        if new_cfg.get('OnBuild') and old_cfg.get('OnBuild') != new_cfg.get('OnBuild'):
            block.append(f'{platform}: ONBUILD instructions appeared or changed')

        # Packages ------------------------------------------------------------------------
        old_sbom, new_sbom = rd('old', 'syft'), rd('candidate', 'syft')
        if (not isinstance(old_sbom.get('artifacts'), list) or
                not isinstance(new_sbom.get('artifacts'), list) or
                not old_sbom['artifacts'] or not new_sbom['artifacts']):
            raise ValueError(f'{platform}: missing/empty Syft artifacts: fail closed')
        old_pk, new_pk = packages(old_sbom), packages(new_sbom)
        added = sorted(k for k in new_pk if k not in old_pk)
        removed = sorted(k for k in old_pk if k not in new_pk)
        version_changed, downgraded = [], []
        for key in sorted(set(old_pk) & set(new_pk)):
            if old_pk[key] != new_pk[key]:
                version_changed.append(key)
                old_max = max(old_pk[key], key=_cmp_key)
                new_max = max(new_pk[key], key=_cmp_key)
                if compare_versions(new_max, old_max) < 0:
                    downgraded.append({'package': key, 'old': old_max, 'new': new_max})
        if added:
            attention.append(f'{platform}: {len(added)} previously absent packages added: '
                             f'{[k[0] for k in added][:LIST_LIMIT]}')
        if removed and settings.get('review_removed_packages', True):
            attention.append(f'{platform}: {len(removed)} packages removed: {[k[0] for k in removed][:LIST_LIMIT]}')
        if version_changed and settings.get('review_package_changes', True):
            routine.append(f'{platform}: {len(version_changed)} package version changes')
        if downgraded and settings.get('review_package_downgrades', True):
            attention.append(f'{platform}: package downgrades: {[d["package"][0] for d in downgraded][:LIST_LIMIT]}')
        changed_pkg_keys = set(added) | set(version_changed)
        owners = file_owners(new_sbom)

        # Files (the inventory holds EVERY regular file; `is_code` marks code) ---------------
        old_fs, new_fs = rd('old', 'fs'), rd('candidate', 'fs')
        if ('files' not in old_fs or 'files' not in new_fs or
                not isinstance(old_fs['files'], dict) or not isinstance(new_fs['files'], dict) or
                not old_fs['files'] or not new_fs['files']):
            raise ValueError(f'{platform}: missing/empty filesystem inventory: fail closed')
        old_files, new_files = old_fs['files'], new_fs['files']
        new_paths = sorted(set(new_files) - set(old_files))
        removed_paths = sorted(set(old_files) - set(new_files))
        # Include filesystem topology and ownership: equal bytes are not equal files.
        # In particular, switching a regular file to a hardlink changes future write
        # behavior and must never silently become AUTO_PASS.
        metadata_fields = ('sha256', 'size', 'uid', 'gid', 'entry_kind', 'hardlink_to', 'security_attrs')
        changed_paths = sorted(p for p in set(old_files) & set(new_files)
                               if any(old_files[p].get(k) != new_files[p].get(k)
                                      for k in metadata_fields)
                               or _mode(old_files[p]) != _mode(new_files[p]))
        new_code = [p for p in new_paths if _is_code(new_files[p])]
        changed_code = [p for p in changed_paths if _is_code(new_files[p]) or _is_code(old_files[p])]
        removed_code = [p for p in removed_paths if _is_code(old_files[p])]

        def explained(path):
            for prefix, var in vendor.items():
                if path.startswith(prefix):
                    return var in env_changed
            return bool(owners_of(path, owners) & changed_pkg_keys)

        def watched(path):
            return '/' not in path or path.startswith(watch)

        watched_files = [p for p in new_paths + changed_paths if watched(p)]
        unexplained_new_code = [p for p in new_code if not watched(p) and not explained(p)]
        unexplained_changed_code = [p for p in changed_code if not watched(p) and not explained(p)]
        unexplained_data = [p for p in new_paths + changed_paths
                            if p not in new_code and p not in changed_code
                            and not watched(p) and not explained(p)]
        if watched_files:
            attention.append(f'{platform}: files added/changed in watched locations: {watched_files[:LIST_LIMIT]}')
        if unexplained_new_code:
            attention.append(f'{platform}: new code files not explained by a package or vendor version change: '
                             f'{unexplained_new_code[:LIST_LIMIT]}')
        if unexplained_changed_code:
            attention.append(f'{platform}: code files changed without a matching package/vendor version change: '
                             f'{unexplained_changed_code[:LIST_LIMIT]}')
        # Package and vendor version changes provide context, NOT safe-change authorization.
        if new_code or changed_code:
            routine.append(f'{platform}: {len(new_code)} new and {len(changed_code)} changed code files '
                           f'(review even when explained by version bumps)')
        if removed_code:
            routine.append(f'{platform}: {len(removed_code)} code files removed')
        data_new = len(new_paths) - len(new_code)
        data_changed = len(changed_paths) - len(changed_code)
        if settings.get('review_all_added_removed_files', True) and (data_new or len(removed_paths) - len(removed_code)):
            routine.append(f'{platform}: {data_new} new and {len(removed_paths) - len(removed_code)} removed data files')
        if settings.get('review_all_modified_files', True) and data_changed:
            routine.append(f'{platform}: {data_changed} modified data files '
                           f'({len(unexplained_data)} without an owning package/vendor change)')

        new_privileged = sorted(p for p, d in new_files.items()
                                if d.get('suid_or_sgid') and not old_files.get(p, {}).get('suid_or_sgid', False))
        if new_privileged:
            block.append(f'{platform}: newly privileged (SUID/SGID) files: {new_privileged[:LIST_LIMIT]}')
        world_writable = sorted(p for p in new_paths + changed_paths if _mode(new_files[p]) & 0o002)
        if world_writable:
            attention.append(f'{platform}: world-writable files: {world_writable[:LIST_LIMIT]}')

        old_special, new_special = old_fs.get('special_files', {}), new_fs.get('special_files', {})
        special_changed = dict_changes(old_special, new_special)
        if special_changed:
            attention.append(f'{platform}: device/FIFO entries added/changed: {special_changed[:LIST_LIMIT]}')

        # Directory metadata is security-relevant even if all file bytes stay identical.
        # In particular, /etc turning 0755 -> 0777 must never be AUTO_PASS.
        old_dirs, new_dirs = old_fs.get('directories', {}), new_fs.get('directories', {})
        if not isinstance(old_dirs, dict) or not isinstance(new_dirs, dict):
            raise ValueError(f'{platform}: invalid directory inventory')
        directory_changes = dict_changes(old_dirs, new_dirs)
        if directory_changes:
            attention.append(f'{platform}: directory ownership/mode/metadata changed: '
                             f'{directory_changes[:LIST_LIMIT]}')
        protected = settings.get('world_writable_directory_block_prefixes',
                                 ['etc', 'usr', 'bin', 'sbin', 'lib', 'lib64', 'opt', 'root', 'var/lib'])
        dangerous_dirs = []
        for path in directory_changes:
            info = new_dirs.get(path)
            if (info and _mode(info) & 0o002 and
                    any(path == prefix or path.startswith(prefix + '/') for prefix in protected)):
                dangerous_dirs.append(path)
        if dangerous_dirs:
            block.append(f'{platform}: security-sensitive directories became world-writable: '
                         f'{dangerous_dirs[:LIST_LIMIT]}')

        old_link_meta = old_fs.get('symlink_metadata', {})
        new_link_meta = new_fs.get('symlink_metadata', {})
        if not isinstance(old_link_meta, dict) or not isinstance(new_link_meta, dict):
            raise ValueError(f'{platform}: invalid symlink metadata inventory')
        link_meta_changes = dict_changes(old_link_meta, new_link_meta)
        if link_meta_changes:
            attention.append(f'{platform}: symlink ownership/permissions/metadata changed: '
                             f'{link_meta_changes[:LIST_LIMIT]}')

        # Links ---------------------------------------------------------------------------
        old_links, new_links = old_fs.get('symlinks', {}), new_fs.get('symlinks', {})
        file_to_link = sorted(p for p in new_links if p in old_files)
        if file_to_link:
            code_marker = [f'{p} (code)' if _is_code(old_files[p]) else p for p in file_to_link]
            attention.append(f'{platform}: regular files replaced by symlinks: {code_marker[:LIST_LIMIT]}')
        suspicious_links = sorted(
            p for p, target in new_links.items()
            if old_links.get(p) != target and _resolve_link(p, target).startswith(link_watch))
        if settings.get('review_all_link_changes', True) and old_links != new_links:
            routine.append(f'{platform}: {len(dict_changes(old_links, new_links))} symlinks added/removed/retargeted')
        if suspicious_links:
            attention.append(f'{platform}: new/retargeted symlinks into watched locations: {suspicious_links[:LIST_LIMIT]}')

        # Security-sensitive files ----------------------------------------------------------
        old_sensitive = old_fs.get('sensitive_files', {})
        new_sensitive = new_fs.get('sensitive_files', {})
        sensitive_changed = sorted(p for p in set(old_sensitive) | set(new_sensitive)
                                   if old_sensitive.get(p) != new_sensitive.get(p))
        if sensitive_changed:
            attention.append(f'{platform}: security-sensitive paths changed: {sensitive_changed[:LIST_LIMIT]}')

        # Gate new Critical/High vulnerabilities, including those without a vendor fix.
        old_scan, new_scan = rd('old', 'grype'), rd('candidate', 'grype')
        newly_critical = new_findings(_vulnerabilities(new_scan, 'critical'),
                                      _vulnerabilities(old_scan, 'critical'))
        newly_high = new_findings(_vulnerabilities(new_scan, 'high'),
                                  _vulnerabilities(old_scan, 'high'))
        unknown_severity = new_findings(_vulnerabilities(new_scan, 'unknown'),
                                        _vulnerabilities(old_scan, 'unknown'))
        if unknown_severity:
            attention.append(f'{platform}: new findings with unknown severity require investigation: '
                             f'{unknown_severity[:LIST_LIMIT]}')
        accepted = {v: match_exception(exceptions, *v, candidate_ref, platform)
                    for v in newly_critical}
        excepted = [v for v in newly_critical if accepted[v]]
        blocking_critical = [v for v in newly_critical if not accepted[v]]
        if blocking_critical and settings.get('block_new_critical', True):
            block.append(f'{platform}: new Critical vulnerabilities, including unfixed: {blocking_critical[:LIST_LIMIT]}')
        if excepted:
            for v in excepted:
                e = accepted[v]
                exceptions_applied.append({'platform': platform, 'id': v[0], 'package': v[1],
                                           'package_version': v[2], 'image_ref': candidate_ref,
                                           'expires': e['expires'], 'approved_by': e['approved_by'],
                                           'reason': e['reason']})
            labels = ['{} ({} {}) until {}'.format(v[0], v[1], v[2], accepted[v]['expires'])
                      for v in excepted]
            attention.append(f'{platform}: new Critical vulnerabilities accepted by time-limited policy exception: '
                             f'{labels[:LIST_LIMIT]}')
        if newly_high and settings.get('review_new_high', True):
            attention.append(f'{platform}: new High vulnerabilities, including unfixed: {newly_high[:LIST_LIMIT]}')

        details[platform] = {
            'config_changes': config_changes,
            'env_changed': env_changed,
            'labels_changed': label_changed,
            'packages_added': [list(k) for k in added][:DETAIL_LIMIT],
            'packages_removed': [list(k) for k in removed][:DETAIL_LIMIT],
            'packages_version_changed': [list(k) for k in version_changed][:DETAIL_LIMIT],
            'package_downgrades': [{'package': list(d['package']), 'old': d['old'], 'new': d['new']}
                                   for d in downgraded][:DETAIL_LIMIT],
            'new_files': new_paths[:DETAIL_LIMIT],
            'removed_files': removed_paths[:DETAIL_LIMIT],
            'changed_files': changed_paths[:DETAIL_LIMIT],
            'new_code_files': new_code[:DETAIL_LIMIT],
            'changed_code_files': changed_code[:DETAIL_LIMIT],
            'removed_code_files': removed_code[:DETAIL_LIMIT],
            'changed_code_file_count': len(changed_code),
            'changed_file_count': len(changed_paths),
            'watched_files': watched_files[:DETAIL_LIMIT],
            'unexplained_new_code': unexplained_new_code[:DETAIL_LIMIT],
            'unexplained_changed_code': unexplained_changed_code[:DETAIL_LIMIT],
            'unexplained_data_files': unexplained_data[:DETAIL_LIMIT],
            'new_suid_or_sgid': new_privileged[:DETAIL_LIMIT],
            'world_writable_files': world_writable[:DETAIL_LIMIT],
            'special_files_changed': special_changed[:DETAIL_LIMIT],
            'directories_changed': directory_changes[:DETAIL_LIMIT],
            'symlink_metadata_changed': link_meta_changes[:DETAIL_LIMIT],
            'files_replaced_by_symlink': file_to_link[:DETAIL_LIMIT],
            'suspicious_symlinks': suspicious_links[:DETAIL_LIMIT],
            'changed_sensitive_paths': sensitive_changed[:DETAIL_LIMIT],
            'new_critical': [list(v) for v in newly_critical][:DETAIL_LIMIT],
            'new_high': [list(v) for v in newly_high][:DETAIL_LIMIT],
            'unknown_severity': [list(v) for v in unknown_severity][:DETAIL_LIMIT],
        }
    review = attention + routine
    decision = 'BLOCK' if block else ('REVIEW' if review else 'AUTO_PASS')
    return {'decision': decision, 'block_reasons': block, 'review_reasons': review,
            'attention_reasons': attention, 'routine_reasons': routine,
            'critical_exceptions_applied': exceptions_applied,
            'platforms': details, 'policy_version': settings['version'],
            'upstream_signature': signature, 'upstream_provenance': provenance}


class _cmp_key:
    """Sort key wrapper so max() uses dpkg version ordering."""
    def __init__(self, v):
        self.v = v

    def __lt__(self, other):
        return compare_versions(self.v, other.v) < 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--report-dir', default='reports')
    p.add_argument('--platforms', help='comma-separated, e.g. linux/amd64,linux/arm64/v8')
    p.add_argument('--upstream-signature', default='not_verified')
    p.add_argument('--upstream-provenance', default='not_verified')
    p.add_argument('--policy', default='policy/config.json')
    p.add_argument('--candidate-ref', help='exact candidate repository@sha256 digest; required for scoped exceptions')
    p.add_argument('--decision-only', action='store_true')
    args = p.parse_args()
    path = pathlib.Path(args.report_dir)
    if args.decision_only:
        decision = load(path / 'decision.json')['decision']
        if decision not in DECISIONS:
            raise SystemExit(f'Unknown decision {decision!r}')
        print(decision)
        return
    if not args.platforms:
        p.error('--platforms is required')
    result = evaluate(path, args.platforms.split(','), args.upstream_signature,
                      args.upstream_provenance, load(args.policy), candidate_ref=args.candidate_ref)
    (path / 'decision.json').write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'decision': result['decision'],
                      'block_reasons': result['block_reasons'],
                      'attention_reasons': result['attention_reasons'],
                      'routine_reasons': result['routine_reasons'],
                      'critical_exceptions_applied': result['critical_exceptions_applied']}, indent=2))


if __name__ == '__main__':
    main()
