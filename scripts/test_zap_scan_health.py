"""A throttled or unauthenticated ZAP scan must not pass for a clean one."""

from pathlib import Path
import tempfile
import unittest

from zap_scan_health import evaluate, main, markdown, parse_requests

ADMIN = '/api/v1/barbers/admin'


def sample(status, uri, count, method='GET', exception='none'):
    return (
        'http_server_requests_seconds_count{application="taskflow-backend",error="none",'
        f'exception="{exception}",method="{method}",outcome="X",status="{status}",uri="{uri}"}} {count}'
    )


# The status counts of the reproduced run 43093570262 (docs/BENCHMARKS.md, section 69): the
# limiter answered almost everything, and the few requests that got through carried no token.
THROTTLED = '\n'.join([
    sample(429, 'UNKNOWN', 15026),
    sample(401, ADMIN, 1),
    sample(401, 'UNKNOWN', 46),
    sample(403, 'UNKNOWN', 29, method='POST'),
    sample(404, '/**', 27),
    sample(400, '/api/v1/appointments', 19, method='POST'),
    sample(200, '/api/v1/catalog', 5),
    sample(200, '/actuator/health/{*path}', 30),
])

HEALTHY = '\n'.join([
    '# HELP http_server_requests_seconds Duration of HTTP server request handling',
    sample(200, ADMIN, 12),
    sample(400, '/api/v1/appointments', 1442, method='POST'),
    sample(429, '/api/v1/auth/login', 212, method='POST'),
    sample(404, '/**', 2041, method='PUT'),
    sample(200, '/actuator/prometheus', 1),
    'http_server_requests_seconds_sum{method="GET",status="200",uri="/api/v1/barbers/admin"} 0.4',
    'http_server_requests_active_seconds_count{method="GET",status="200",uri="UNKNOWN"} 3',
])


class ScanHealthTest(unittest.TestCase):
    def health(self, text, **options):
        return evaluate(parse_requests(text), **options)

    def test_scan_throttled_by_the_rate_limiter_is_not_effective(self):
        result = self.health(THROTTLED, min_served=2000)
        self.assertFalse(result['effective'])
        self.assertEqual((result['total'], result['served'], result['throttled']), (15153, 127, 15026))
        self.assertIn('served 127 requests (expected at least 2000)', result['problems'][0])

    def test_throttled_scan_is_not_effective_whatever_its_volume(self):
        # The frontend scan sends far fewer requests than the API scan, so its floor is low;
        # the share of 429 responses still gives a throttled run away.
        result = self.health(THROTTLED, min_served=100)
        self.assertEqual(result['problems'], [
            '99.2% of the requests were answered 429 (at most 20% expected): '
            'the rate limiter throttled the scan'])

    def test_scan_that_never_authenticated_is_not_effective(self):
        result = self.health(THROTTLED, required_success=[ADMIN], max_throttled_percent=100)
        self.assertEqual(result['successes'], {ADMIN: 0})
        self.assertIn(f'{ADMIN} never answered 2xx', result['problems'][0])

    def test_served_authenticated_scan_is_effective(self):
        result = self.health(HEALTHY, required_success=[ADMIN], min_served=2000)
        self.assertTrue(result['effective'], result['problems'])
        self.assertEqual(result['by_status'], {'200': 12, '400': 1442, '404': 2041, '429': 212})
        self.assertEqual(result['server_error_count'], 0)

    def test_login_throttle_responses_do_not_count_as_served(self):
        self.assertEqual(self.health(HEALTHY)['served'], 12 + 1442 + 2041)

    def test_own_probes_and_other_series_are_not_scan_traffic(self):
        uris = {labels['uri'] for labels, _ in parse_requests(HEALTHY + '\n' + THROTTLED)}
        self.assertFalse(any(uri.startswith('/actuator') for uri in uris))
        self.assertEqual(self.health('')['total'], 0)
        self.assertFalse(self.health('', min_served=1)['effective'])

    def test_server_errors_are_counted_with_their_cause(self):
        text = '\n'.join([
            HEALTHY,
            sample(500, '/api/v1/appointments', 5, exception='InvalidParameterException'),
            sample(503, '/api/v1/auth/login', 1, method='POST', exception='InternalAuthenticationServiceException'),
        ])
        result = self.health(text, required_success=[ADMIN])
        self.assertTrue(result['effective'])
        self.assertEqual(result['server_error_count'], 6)
        self.assertEqual(result['server_errors'][0],
                         (('500', 'GET', '/api/v1/appointments', 'InvalidParameterException'), 5))
        self.assertIn('| `500` | GET | `/api/v1/appointments` | InvalidParameterException | 5 |',
                      markdown(result))

    def test_cli_writes_outputs_and_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            metrics = Path(directory, 'metrics.prom')
            output = Path(directory, 'output')
            summary = Path(directory, 'summary.md')
            metrics.write_text(THROTTLED, encoding='utf-8')
            status = main(['--metrics', str(metrics), '--require-success', ADMIN, '--min-served', '2000',
                           '--github-output', str(output), '--summary', str(summary)])
            self.assertEqual(status, 0)
            self.assertEqual(output.read_text(encoding='utf-8'), 'effective=false\nserver_errors=0\n')
            self.assertIn('The scan did not exercise the application', summary.read_text(encoding='utf-8'))
            self.assertIn('99.2% answered 429', summary.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
