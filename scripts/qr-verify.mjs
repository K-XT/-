import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createQrMatrix, toMatrixText } from '../public/js/qr.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const swiftScript = path.join(HERE, 'qr-verify.swift');
const samplePath = path.join(HERE, '.qr-sample.txt');

const samples = [
  'ZS:tok-01',
  'http://192.168.1.5:4173/?t=tok-01',
  '零号提交测试',
  '你好世界零号提交',
  'http://10.0.0.8:4173/?t=tok-40',
];

let matched = 0;
let failed = 0;
let unavailable = 0;

for (const text of samples) {
  const info = createQrMatrix(text);
  fs.writeFileSync(samplePath, toMatrixText(text), 'utf8');
  let output = '';
  let status = 0;
  try {
    output = execFileSync('swift', [swiftScript, samplePath], { encoding: 'utf8', timeout: 120000 }).trim();
  } catch (error) {
    status = error.status ?? 1;
    output = `${error.stdout ?? ''}`.trim();
  }

  if (output === text) {
    matched += 1;
    console.log(`text=${JSON.stringify(text)} version=${info.version} mask=${info.mask} vision_decoded=true`);
    continue;
  }
  if (output === 'VISION_UNAVAILABLE' || status === 3) {
    unavailable += 1;
    console.log(`text=${JSON.stringify(text)} version=${info.version} mask=${info.mask} vision_decoded=env_unavailable`);
    continue;
  }
  failed += 1;
  console.log(`text=${JSON.stringify(text)} version=${info.version} mask=${info.mask} vision_decoded=false output=${JSON.stringify(output)}`);
}

fs.rmSync(samplePath, { force: true });
console.log(`qr_verify matched=${matched} failed=${failed} env_unavailable=${unavailable} total=${samples.length}`);
process.exit(failed > 0 ? 1 : 0);