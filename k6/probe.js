import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) throw new Error('BASE_URL environment variable is required');

// This runs against the public production URL. Keep the single runner IP below
// the application's 100-request-per-minute abuse-protection limit.
export const options = {
  scenarios: {
    production_probe: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 1,
      maxVUs: 1,
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

export default function () {
  const r = Math.random();
  let url, trend;
  if (r < 0.4) {
    url = `${BASE_URL}/api/v1/catalog`;
    trend = catalogTrend;
  } else if (r < 0.8) {
    url = `${BASE_URL}/api/v1/barbers`;
    trend = barbersTrend;
  } else {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const iso = date.toISOString().slice(0, 10);
    url = `${BASE_URL}/api/v1/appointments/public/busy-slots?barberName=${encodeURIComponent('Alex the Barber')}&bookingDate=${iso}`;
    trend = busySlotsTrend;
  }

  const res = http.get(url, { headers: { Accept: 'application/json' } });
  trend.add(res.timings.duration);
  check(res, {
    'status 2xx': (response) => response.status >= 200 && response.status < 300,
    'Cache-Control present': (response) => !!response.headers['Cache-Control'],
  });
}
