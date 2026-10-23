// Read resolved Compose JSON from stdin. Fail before building if any published
// TCP port already has a loopback listener (IPv4 or IPv6).
const net = require('node:net');

function listening(port, host) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (['ECONNREFUSED', 'EAFNOSUPPORT', 'ENETUNREACH', 'EADDRNOTAVAIL'].includes(error.code)) {
        resolve(false);
      } else reject(error);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`Timed out probing ${host}:${port}`));
    });
  });
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const config = JSON.parse(input);
  const ports = new Set();
  for (const service of Object.values(config.services)) {
    for (const binding of service.ports ?? []) {
      if (binding.protocol && binding.protocol !== 'tcp') continue;
      const port = Number(binding.published);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Expected a fixed published TCP port, got ${binding.published}`);
      }
      ports.add(port);
    }
  }
  const occupied = [];
  for (const port of ports) {
    const results = await Promise.all([listening(port, '127.0.0.1'), listening(port, '::1')]);
    if (results.some(Boolean)) occupied.push(port);
  }
  if (occupied.length)
    throw new Error(
      `Occupied Compose ports: ${occupied.join(', ')}. Stop conflicting services first.`,
    );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
