import { generateMissionNetwork } from '../src/generation/generateMission.js';
import { findExploitableCve } from '../src/generation/findExploitableCve.js';

const seed = process.argv[2] ?? 'password-reset-tier-root-easy';
const targetIp = process.argv[3] ?? '10.201.160.239';
const gameTimeDays = Number(process.argv[4] ?? '0');
const gameTime = gameTimeDays * 24 * 3600 * 1000;

const net = await generateMissionNetwork(seed);
const machine = net.machines.find((m) => m.ip === targetIp);
if (!machine) {
  console.error('machine not found:', targetIp);
  console.error(
    'available:',
    net.machines.map((m) => m.ip),
  );
  process.exit(1);
}

console.log(`seed=${seed}  target=${targetIp}  gameTimeDays=${gameTimeDays}`);
console.log(`hostname=${machine.hostname}  role=${machine.role}`);
console.log('');
for (const port of machine.remoteMachine.ports) {
  if (!port.open) continue;
  const vuln = findExploitableCve(machine.remoteMachine, port, gameTime);
  console.log(
    `port ${port.port}/${port.service} version=${port.serviceVersion ?? '(none)'}  ` +
      `forcedEffect=${port.forcedEffect ? JSON.stringify(port.forcedEffect) : '(none)'}  ` +
      `findExploitableCve=${vuln ? `${vuln.cve} effect=${JSON.stringify(vuln.effect)}` : '(none)'}`,
  );
}
