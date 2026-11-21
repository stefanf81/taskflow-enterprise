#!/usr/bin/env python3
"""Decide on an application image's Grype report: PASS, REVIEW or BLOCK.

  BLOCK   a Critical or unrated (Unknown/unrecognised severity) finding without an exception
  REVIEW  no blocking finding, but High findings that no named person has approved yet
  PASS    otherwise

Exceptions (`critical_exceptions` in the protected policy) name a CVE, package/version,
platform and expiry, scoped to ONE of:
  * `image_ref`       the exact RELEASE image (applications/<app>@sha256:...), or
  * `base_image_ref`  the exact approved base image. An application inherits such an
                      exception only when BOTH hold:
                        - every location Grype reports for the package lies in a base
                          layer (rootfs.diff_ids of --base-config), and
                        - ci/check_additive_layers.py proved (--layer-overlay) that the
                          application layers never overwrite, delete or write through a
                          base path, so the package's files still have the base's bytes.
                      Without that proof (no report, or additive=false) a base exception
                      does not apply and the finding needs its own image_ref exception.

High findings are approved by a person for an exact list (--approved-high). A High finding
that is not on that list keeps the decision at REVIEW; a list never covers new findings.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import sys

# python3 -I does not put the script directory on sys.path; add this trusted directory only.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from evaluate import IMAGE_REF_RE, critical_exceptions, match_exception  # noqa: E402

NON_BLOCKING = ('medium', 'low', 'negligible')
OVERLAY_SCHEMA = 'https://example.org/additive-application-layers/v1'
DIFF_ID_RE = re.compile(r'sha256:[a-f0-9]{64}')


def finding_key(entry):
    return [entry['id'], entry['package'], entry['package_version']]


def findings_sha256(entries):
    keys = sorted(finding_key(e) for e in entries)
    return hashlib.sha256(json.dumps(keys, separators=(',', ':')).encode()).hexdigest()


def base_layers_from_config(config):
    layers = ((config or {}).get('rootfs') or {}).get('diff_ids')
    if not isinstance(layers, list) or not layers or not all(isinstance(x, str) and DIFF_ID_RE.fullmatch(x) for x in layers):
        raise ValueError('base image config has no valid rootfs.diff_ids')
    # OCI rootfs is ordered: an unordered set would erase overlay semantics.
    return layers


def from_base(artifact, base_layers):
    """True only if every reported location of the package is in a base layer."""
    if not base_layers:
        return False
    locations = artifact.get('locations')
    if not isinstance(locations, list) or not locations:
        return False
    return all(isinstance(loc, dict) and loc.get('layerID') in base_layers for loc in locations)


def load_layer_overlay(path, base_layers, image_config_digest=None):
    """True only for a well-formed additive report about this base (and image, if given)."""
    report = json.loads(pathlib.Path(path).read_text())
    if not isinstance(report, dict) or report.get('schema') != OVERLAY_SCHEMA:
        raise ValueError('layer overlay report has an unexpected schema')
    reported = report.get('base_diff_ids')
    if (not base_layers or not isinstance(reported, list) or reported != list(base_layers)
            or not all(isinstance(x, str) and DIFF_ID_RE.fullmatch(x) for x in reported)):
        raise ValueError('layer overlay report was made against a different base image (ordered layers)')
    if image_config_digest is not None and report.get('config_digest') != image_config_digest:
        raise ValueError('layer overlay report is about a different image config')
    if not isinstance(report.get('additive'), bool):
        raise ValueError('layer overlay report lacks a boolean additive result')
    return report['additive']


def decision(data, exceptions=None, image_ref=None, platform=None, base_image_ref=None,
             base_layers=None, release_ref=None, approved_high=None, base_files_unmodified=False):
    if not isinstance(data, dict) or not isinstance(data.get('matches'), list):
        raise ValueError('missing Grype matches array')
    # The DB metadata is not a completeness proof, but a missing metadata
    # object strongly suggests an unexpected scanner output shape.
    if not isinstance(data.get('distro'), dict) and not isinstance(data.get('source'), dict):
        raise ValueError('Grype JSON lacks expected distro/source metadata')
    exceptions = exceptions or []
    release_ref = release_ref or image_ref
    approved = {tuple(k) for k in (approved_high or [])}
    critical, high, high_approved, unknown, critical_excepted, unknown_excepted = [], [], [], [], [], []
    for item in data['matches']:
        if not isinstance(item, dict) or not isinstance(item.get('vulnerability'), dict):
            raise ValueError('malformed Grype match entry')
        vuln = item['vulnerability']
        severity = str(vuln.get('severity', '')).lower()
        item_id = str(vuln.get('id', '')).strip()
        if not item_id:
            raise ValueError('vulnerability without an ID')
        artifact = item.get('artifact') or {}
        package = str(artifact.get('name', '<unknown>'))
        package_version = str(artifact.get('version') or '')
        entry = {'id': item_id, 'package': package, 'package_version': package_version, 'severity': severity,
                 'fix_state': str((vuln.get('fix') or {}).get('state', 'unknown'))}
        if severity == 'high':
            (high_approved if tuple(finding_key(entry)) in approved else high).append(entry)
            continue
        if severity in NON_BLOCKING:
            continue
        # Inherit a base-image exception only with BOTH proofs: the package was found in a
        # base layer, and the application layers never modify base paths.
        origin_base = (base_image_ref if base_files_unmodified and from_base(artifact, base_layers)
                       else None)
        exception = match_exception(exceptions, item_id, package, package_version, release_ref, platform,
                                    origin_base)
        if exception:
            scope = 'image_ref' if exception.get('image_ref') == release_ref else 'base_image_ref'
            accepted = dict(entry, expires=exception['expires'], approved_by=exception['approved_by'],
                            reason=exception['reason'], scope=scope)
            (critical_excepted if severity == 'critical' else unknown_excepted).append(accepted)
        else:
            (critical if severity == 'critical' else unknown).append(entry)
    result = 'BLOCK' if critical or unknown else ('REVIEW' if high else 'PASS')
    return {'decision': result, 'critical': critical, 'unknown': unknown, 'high': high,
            'high_approved': high_approved, 'high_findings_sha256': findings_sha256(high + high_approved),
            'critical_excepted': critical_excepted, 'unknown_excepted': unknown_excepted,
            'image_ref': image_ref, 'release_ref': release_ref, 'base_image_ref': base_image_ref,
            'base_files_unmodified': bool(base_files_unmodified and base_layers),
            'platform': platform, 'total_matches': len(data['matches'])}


def load_approved_high(path):
    """{"approver": "...", "findings": [[cve, package, version], ...]} -> (approver, keys)."""
    data = json.loads(pathlib.Path(path).read_text())
    approver = str(data.get('approver', '')).strip()
    findings = data.get('findings')
    if not approver or approver == 'automatic-policy':
        raise ValueError('High-finding approval needs a named human approver')
    if not isinstance(findings, list) or not all(
            isinstance(f, list) and len(f) == 3 and all(isinstance(x, str) for x in f) for f in findings):
        raise ValueError('High-finding approval must list [cve, package, version] triples')
    return approver, findings


def main():
    p = argparse.ArgumentParser()
    p.add_argument('scan')
    p.add_argument('--report', required=True)
    p.add_argument('--policy', help='protected policy config with exact-scope exceptions')
    p.add_argument('--image-ref', required=True, help='exact scanned image repository@sha256 digest')
    p.add_argument('--release-ref', help='applications/<app>@sha256 used to match image_ref exceptions '
                                         '(default: --image-ref); must have the same digest')
    p.add_argument('--platform', required=True, help='exact image platform, e.g. linux/amd64')
    p.add_argument('--final-base', help='verified approved base repository@sha256 of this image')
    p.add_argument('--base-config', help='image config JSON of --final-base (crane config); enables '
                                         'base_image_ref exceptions for packages proven to come from it')
    p.add_argument('--layer-overlay', help='report of ci/check_additive_layers.py for this image; '
                                           'required for base_image_ref exceptions to apply')
    p.add_argument('--image-config-digest', help='attested config digest the --layer-overlay must name')
    p.add_argument('--approved-high', help='JSON {"approver", "findings"} from the human review')
    p.add_argument('--allow-review', action='store_true', help='exit 0 on REVIEW (the pipeline then asks a human)')
    a = p.parse_args()
    try:
        for name, value in (('--image-ref', a.image_ref), ('--release-ref', a.release_ref),
                            ('--final-base', a.final_base)):
            if value is not None and not IMAGE_REF_RE.fullmatch(value):
                raise ValueError(f'{name} must be an exact repository@sha256:digest')
        if a.release_ref and a.release_ref.split('@')[1] != a.image_ref.split('@')[1]:
            raise ValueError('--release-ref must name the same digest as --image-ref')
        if a.base_config and not a.final_base:
            raise ValueError('--base-config needs --final-base')
        base_layers = None
        if a.base_config:
            base_layers = base_layers_from_config(json.loads(pathlib.Path(a.base_config).read_text()))
        if a.layer_overlay and not base_layers:
            raise ValueError('--layer-overlay needs --base-config')
        unmodified = bool(a.layer_overlay) and load_layer_overlay(a.layer_overlay, base_layers,
                                                                  a.image_config_digest)
        approver, approved = (None, None)
        if a.approved_high:
            approver, approved = load_approved_high(a.approved_high)
        exceptions = []
        if a.policy:
            policy = json.loads(pathlib.Path(a.policy).read_text())
            exceptions = critical_exceptions(policy, dt.datetime.now(dt.timezone.utc).date())
        result = decision(json.loads(pathlib.Path(a.scan).read_text()), exceptions, a.image_ref, a.platform,
                          a.final_base, base_layers, a.release_ref, approved, unmodified)
        result['high_approver'] = approver
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f'INVALID VULNERABILITY SCAN: {exc}')
    pathlib.Path(a.report).write_text(json.dumps(result, sort_keys=True, indent=2) + '\n')
    for kind in ('critical', 'unknown', 'high'):
        for e in result[kind]:
            print(f"{'BLOCKING' if kind != 'high' else 'NEEDS APPROVAL'} {kind}: "
                  f"{e['id']} in {e['package']} {e['package_version']}", file=sys.stderr)
    if result['decision'] == 'BLOCK' or (result['decision'] == 'REVIEW' and not a.allow_review):
        raise SystemExit(f"APPLICATION NOT APPROVED ({result['decision']}): {len(result['critical'])} Critical, "
                         f"{len(result['unknown'])} unrated, {len(result['high'])} unapproved High findings")
    accepted = len(result['critical_excepted']) + len(result['unknown_excepted'])
    print(f"Application scan {result['decision']}: {result['total_matches']} findings, "
          f"{accepted} accepted by exception, {len(result['high_approved'])} High approved, "
          f"{len(result['high'])} High awaiting approval")


if __name__ == '__main__':
    main()
