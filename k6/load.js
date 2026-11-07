import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) throw new Error('BASE_URL environment variable is required');

// OPEN_MODEL=true replaces the closed ramp (VUs wait for each response, so a slow server lowers
// the load it gets) with an open arrival rate: requests keep arriving whatever the latency, and
// iterations k6 could not start show up as dropped_iterations instead of disappearing.
const OPEN_MODEL = String(__ENV.OPEN_MODEL || '').toLowerCase() === 'true';

// Up to 200 VUs or 500 requests/s: a local stack only, never production by accident (the
// production check is k6/probe.js). ALLOW_REMOTE_LOAD=true opts in for an environment you own.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'];
const host = (/^https?:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(BASE_URL) || [])[1] || '';
if (!LOCAL_HOSTS.includes(host.toLowerCase()) && __ENV.ALLOW_REMOTE_LOAD !== 'true') {
  throw new Error(
    `load.js only targets a local stack (BASE_URL host "${host}"). Use k6/probe.js for production, ` +
      'or set ALLOW_REMOTE_LOAD=true for an environment you own.',
  );
}

const closedRamp = {
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
};

const openArrival = {
  open_arrival: {
    executor: 'ramping-arrival-rate',
    startRate: 50,
    timeUnit: '1s',
    preAllocatedVUs: 100,
    maxVUs: 300,
    stages: [
      { duration: '30s', target: 200 },
      { duration: '60s', target: 500 },
      { duration: '30s', target: 0 },
    ],
  },
};

export const options = {
  scenarios: OPEN_MODEL ? openArrival : closedRamp,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<800'],
    // Only an open model can drop iterations: then the offered rate was not met. A handful at
    // the stage edges, while k6 allocates VUs, is tolerated.
    ...(OPEN_MODEL ? { dropped_iterations: ['count<10'] } : {}),
    catalog_duration: ['p(95)<250'],
    barbers_duration: ['p(95)<250'],
    busySlots_duration: ['p(95)<500'],
    barberRatings_duration: ['p(95)<300'],
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
    // busySlots requires barberName + bookingDate; use seeded values. Both clients also send the
    // service (its length decides which slots fit), so the load test does too.
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const iso = date.toISOString().slice(0, 10);
    url = `${BASE_URL}/api/v1/appointments/public/busy-slots?barberName=${encodeURIComponent('Alex the Barber')}&bookingDate=${iso}&serviceType=${encodeURIComponent('Classic Haircut')}`;
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
