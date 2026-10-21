"""Keep ZAP's scan gate and SARIF reporting aligned without hiding unrelated findings."""

import json
from pathlib import Path
import re
import tempfile
import unittest

from zap2sarif import main


class ZapSarifTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = self.directory / 'report.json'
        self.output = self.directory / 'report.sarif'
        self.rules = Path(__file__).resolve().parents[1] / '.zap' / 'web-rules.tsv'

    def convert(self, alerts, rules=None):
        report = {'site': [{'@host': 'localhost', 'alerts': alerts}]}
        self.source.write_text(json.dumps(report), encoding='utf-8')
        main(self.source, self.output, rules or self.rules, 'http://localhost:4200')
        # Filtering must never rewrite the raw evidence report.
        self.assertEqual(json.loads(self.source.read_text(encoding='utf-8')), report)
        return json.loads(self.output.read_text(encoding='utf-8'))['runs'][0]

    def alert(self, rule, *urls):
        return {
            'pluginid': rule,
            'name': 'Test alert',
            'riskcode': '2',
            'instances': [{'uri': url, 'method': 'GET'} for url in urls],
        }

    def test_guest_root_csrf_false_positives_are_excluded(self):
        run = self.convert([self.alert('10202', 'http://localhost:4200', 'http://localhost:4200/')])
        self.assertEqual(run['results'], [])
        self.assertEqual(run['tool']['driver']['rules'], [])

    def test_same_csrf_rule_stays_enabled_outside_the_exact_guest_root(self):
        urls = [
            'http://localhost:4200/admin',
            'http://localhost:4200/customer',
            'http://localhost:4200/api/v1/auth/logout',
            'http://localhost:4200/?email=private@example.com',
            'http://localhost:4200.evil/',
            'http://localhost:8080/',
        ]
        run = self.convert([self.alert('10202', 'http://localhost:4200/', *urls)])
        self.assertEqual([
            result['locations'][0]['logicalLocations'][0]['name'] for result in run['results']
        ], urls)

    def test_unrelated_rules_on_root_are_not_excluded(self):
        run = self.convert([self.alert(rule, 'http://localhost:4200/') for rule in ('10024', '40012')])
        self.assertEqual([result['ruleId'] for result in run['results']], ['ZAP-10024', 'ZAP-40012'])

    def test_existing_ignore_entries_still_work(self):
        run = self.convert([self.alert('10010', 'http://localhost:4200/api/v1/auth/csrf')])
        self.assertEqual(run['results'], [])

    def test_wildcard_and_comma_separated_scopes_match_packaged_scans(self):
        rules = self.directory / 'rules.tsv'
        rules.write_text(
            '*\tOUTOFSCOPE\t^http://localhost:4200/static/\n'
            '10202,10024\tOUTOFSCOPE\t^http://localhost:4200/allowed$\n',
            encoding='utf-8',
        )
        run = self.convert([
            self.alert('10202', 'http://localhost:4200/static/app.js', 'http://localhost:4200/allowed'),
            self.alert('10024', 'http://localhost:4200/allowed', 'http://localhost:4200/admin'),
        ], rules)
        self.assertEqual([result['ruleId'] for result in run['results']], ['ZAP-10024'])

    def test_invalid_scope_regex_fails_instead_of_silently_ignoring_findings(self):
        rules = self.directory / 'rules.tsv'
        rules.write_text('10202\tOUTOFSCOPE\t[\n', encoding='utf-8')
        with self.assertRaises(re.error):
            self.convert([self.alert('10202', 'http://localhost:4200/')], rules)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
