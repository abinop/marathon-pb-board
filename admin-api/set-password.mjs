// Makes a new admin password and stores its hash as the ADMIN_PASS_HASH secret.
// Run from admin-api/: node set-password.mjs            (random password, stored in Cloudflare)
//                      node set-password.mjs --print    (only print, e.g. for .dev.vars)
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ITER = 100000; // the Workers runtime allows at most 100000 PBKDF2 iterations
const words = randomBytes(12).toString('base64url'); // 16 characters
const password = words.slice(0, 4) + '-' + words.slice(4, 8) + '-' + words.slice(8, 12) + '-' + words.slice(12, 16);
const salt = randomBytes(16);
const hash = `pbkdf2$${ITER}$${salt.toString('base64')}$${pbkdf2Sync(password, salt, ITER, 32, 'sha256').toString('base64')}`;

if (process.argv.includes('--print')) {
  console.log(`ADMIN_PASS_HASH=${hash}`);
} else {
  execFileSync('npx', ['-y', 'wrangler@4', 'secret', 'put', 'ADMIN_PASS_HASH'], { input: hash, stdio: ['pipe', 'inherit', 'inherit'] });
}
console.error(`\nNew admin password: ${password}\n`);
