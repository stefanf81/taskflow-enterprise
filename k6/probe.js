import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

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
    // Every request the server answered must be a 2xx with caching headers.
    checks: ['rate==1.0'],
    // A request with no answer at all (connection reset, timeout) is the network between this
    // runner and the edge, not the application: tolerate two in the 60. With `rate<0.01` on
    // http_req_failed a single reset (1 of 61 = 1.6%) failed the whole probe.
    transport_errors: ['count<=2'],
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<500', 'p(99)<800'],
  },
};

const transportErrors = new Counter('transport_errors');

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
    // With serviceType, like both clients send it (and k6/load.js since §64).
    url = `${BASE_URL}/api/v1/appointments/public/busy-slots?barberName=${encodeURIComponent('Alex the Barber')}&bookingDate=${iso}&serviceType=${encodeURIComponent('Classic Haircut')}`;
    trend = busySlotsTrend;
  }

  const res = http.get(url, { headers: { Accept: 'application/json' } });
  // Status 0: k6 got no HTTP response. Counted (0 keeps the metric present on a clean run).
  transportErrors.add(res.status === 0 ? 1 : 0);
  if (res.status === 0) return;
  trend.add(res.timings.duration);
  check(res, {
    'status 2xx': (response) => response.status >= 200 && response.status < 300,
    'Cache-Control present': (response) => !!response.headers['Cache-Control'],
  });
}
