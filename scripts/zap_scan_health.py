"""Decide whether a ZAP scan exercised the application, from the backend's own request counters.

ZAP's exit code only says whether it raised alerts. A scan whose requests were rejected by the
rate limiter, or that never sent its credentials, raises none and is indistinguishable from a
clean one: dast.yml ran that way (99% of the requests answered 429, every admin endpoint 401)
and stayed green. This reads the `http_server_requests` counters the scanned backend exposes
on /actuator/prometheus and reports:

  effective      enough requests were served (not 429), no more than a small share was
                 answered 429, and every `--require-success` URI answered 2xx at least once
                 (proof that the scan was authenticated)
  server_errors  how many requests the backend answered with 5xx

Both are written to `--github-output`; dast.yml's gate decides what fails the job.
"""

import argparse
import re
import sys
from collections import Counter

METRIC = 'http_server_requests_seconds_count'
LABEL = re.compile(r'(\w+)="((?:[^"\\]|\\.)*)"')
# The job's own readiness polls and the scrape that produced the input are not scan traffic.
OWN_TRAFFIC_PREFIX = '/actuator'


def parse_requests(text):
    """Return [(labels, count)] for every http_server_requests counter outside /actuator."""
    samples = []
    for line in text.splitlines():
        if not line.startswith(METRIC + '{'):
            continue
        labels_text, _, value = line[len(METRIC) + 1:].rpartition('}')
        labels = dict(LABEL.findall(labels_text))
        if 'status' not in labels or labels.get('uri', '').startswith(OWN_TRAFFIC_PREFIX):
            continue
        samples.append((labels, int(float(value))))
    return samples


def evaluate(samples, required_success=(), min_served=1, max_throttled_percent=20):
    by_status = Counter()
    for labels, count in samples:
        by_status[labels['status']] += count
    total = sum(by_status.values())
    throttled = by_status.get('429', 0)
    served = total - throttled

    successes = {
        uri: sum(count for labels, count in samples
                 if labels.get('uri') == uri and labels['status'].startswith('2'))
        for uri in required_success
    }

    errors = Counter()
    for labels, count in samples:
        if labels['status'].startswith('5'):
            errors[(labels['status'], labels.get('method', ''), labels.get('uri', ''),
                    labels.get('exception', ''))] += count

    problems = []
    if served < min_served:
        problems.append(
            f'the backend served {served} requests (expected at least {min_served}); '
            f'{throttled} of {total} were answered 429 by its rate limiters')
    # The per-account login throttle answers a few percent of a scan with 429 (2.6% of the API
    # scan); the per-IP limiter at production limits answers nearly all of it.
    if total and 100 * throttled > max_throttled_percent * total:
        problems.append(
            f'{100 * throttled / total:.1f}% of the requests were answered 429 '
            f'(at most {max_throttled_percent}% expected): the rate limiter throttled the scan')
    for uri, count in successes.items():
        if count == 0:
            problems.append(
                f'{uri} never answered 2xx, so the scan did not run with the credentials it was given')

    return {
        'total': total,
        'served': served,
        'throttled': throttled,
        'by_status': dict(sorted(by_status.items())),
        'successes': successes,
        'server_errors': sorted(errors.items()),
        'server_error_count': sum(errors.values()),
        'problems': problems,
        'effective': not problems,
    }


def markdown(result):
    lines = ['', '### What the backend answered', '', '| Status | Requests |', '| :--- | ---: |']
    lines += [f'| `{status}` | {count} |' for status, count in result['by_status'].items()]
    share = 100 * result['throttled'] / result['total'] if result['total'] else 0
    lines += ['', f"Served {result['served']} of {result['total']} requests "
                  f"({share:.1f}% answered 429)."]
    for uri, count in result['successes'].items():
        lines.append(f'`{uri}` answered 2xx {count} times.')
    if result['server_errors']:
        lines += ['', '**Server errors**', '', '| Status | Method | URI | Exception | Requests |',
                  '| :--- | :--- | :--- | :--- | ---: |']
        lines += [f'| `{status}` | {method} | `{uri}` | {exception} | {count} |'
                  for (status, method, uri, exception), count in result['server_errors']]
    if result['problems']:
        lines += ['', '**The scan did not exercise the application:**', '']
        lines += [f'- {problem}' for problem in result['problems']]
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--metrics', required=True, help='Prometheus text scraped from the scanned backend')
    parser.add_argument('--require-success', action='append', default=[], metavar='URI',
                        help='`uri` tag that must have answered 2xx at least once (repeatable)')
    parser.add_argument('--min-served', type=int, default=1,
                        help='requests the backend must have served, not counting 429 responses')
    parser.add_argument('--max-throttled-percent', type=float, default=20,
                        help='largest share of 429 responses that still counts as an unthrottled scan')
    parser.add_argument('--summary', help='file to append a Markdown summary to')
    parser.add_argument('--github-output', help='file to append `effective` and `server_errors` to')
    args = parser.parse_args(argv)

    with open(args.metrics, encoding='utf-8') as file:
        samples = parse_requests(file.read())
    result = evaluate(samples, args.require_success, args.min_served, args.max_throttled_percent)

    print(f"requests: {result['total']}, served: {result['served']}, 429: {result['throttled']}, "
          f"5xx: {result['server_error_count']}")
    for (status, method, uri, exception), count in result['server_errors']:
        print(f'::warning::{count} x {status} on {method} {uri} ({exception})')
    for problem in result['problems']:
        print(f'::error::The scan did not exercise the application: {problem}')

    if args.summary:
        with open(args.summary, 'a', encoding='utf-8') as file:
            file.write(markdown(result))
    if args.github_output:
        with open(args.github_output, 'a', encoding='utf-8') as file:
            file.write(f"effective={'true' if result['effective'] else 'false'}\n")
            file.write(f"server_errors={result['server_error_count']}\n")
    return 0


if __name__ == '__main__':
    sys.exit(main())
