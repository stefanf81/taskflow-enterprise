import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) throw new Error('BASE_URL environment variable is required');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '60s', target: 200 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<800'],
    checks: ['rate==1.0'],
  },
};

const catalogTrend = new Trend('catalog_duration');
const barbersTrend = new Trend('barbers_duration');
const busySlotsTrend = new Trend('busySlots_duration');
const ratingsTrend = new Trend('barberRatings_duration');

export default function () {
  // 70% catalog/barbers (cached), 20% busySlots, 10% barber ratings (cached). Every branch must be
  // a backend route that nginx proxies: /actuator is not proxied, so a health probe here was
  // answered by the SPA fallback (index.csr.html, 200 + Cache-Control) and passed both checks.
  const r = Math.random();
  let url, trend;
  if (r < 0.35) {
    url = `${BASE_URL}/api/v1/catalog`;
    trend = catalogTrend;
  } else if (r < 0.7) {
    url = `${BASE_URL}/api/v1/barbers`;
    trend = barbersTrend;
  } else if (r < 0.9) {
    // busySlots requires barberName + bookingDate; use seeded values
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const iso = date.toISOString().slice(0, 10);
    url = `${BASE_URL}/api/v1/appointments/public/busy-slots?barberName=${encodeURIComponent('Alex the Barber')}&bookingDate=${iso}`;
    trend = busySlotsTrend;
  } else {
    url = `${BASE_URL}/api/v1/reviews/public/barber-ratings`;
    trend = ratingsTrend;
  }

  const res = http.get(url, { headers: { Accept: 'application/json' } });
  if (trend) trend.add(res.timings.duration);
  check(res, {
    'status 2xx': (r) => r.status >= 200 && r.status < 300,
    'Cache-Control present': (r) => !!r.headers['Cache-Control'],
  });
  sleep(0.1);
}
