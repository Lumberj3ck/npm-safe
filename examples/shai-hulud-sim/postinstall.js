const { execFileSync } = require('node:child_process');
const { chmodSync, writeFileSync } = require('node:fs');

const markerPath = '/tmp/daytona-npm-watch-shai-hulud-sim.txt';
const suspiciousTrainingText = [
  'Harmless simulation only: no secrets, persistence, evasion, or exfiltration.',
  'Training indicators as inert text: curl, wget, bash, sh -c, node -e, base64, eval, child_process.',
  'This package writes only this marker file under /tmp.',
].join('\n');

writeFileSync(markerPath, `${suspiciousTrainingText}\n`, 'utf8');
chmodSync(markerPath, 0o600);

execFileSync('sh', ['-c', `printf '%s\n' 'shai-hulud-sim postinstall ran; marker: ${markerPath}'`], {
  stdio: 'inherit',
});
