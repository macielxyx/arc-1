import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: root }).trim();
}

export function rank(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return major * 100 + minor * 10 + patch;
}

// 10.0.9 -> 10.1.0, 10.9.9 -> 11.0.0
export function bump(version) {
  let [major, minor, patch] = version.split('.').map(Number);
  patch += 1;
  if (patch > 9) {
    patch = 0;
    minor += 1;
  }
  if (minor > 9) {
    minor = 0;
    major += 1;
  }
  return `${major}.${minor}.${patch}`;
}

export function versionTags() {
  const raw = sh('git tag --list');
  return raw
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => /^\d+\.\d+\.\d+$/.test(tag))
    .sort((a, b) => rank(a) - rank(b));
}

export function writeVersion() {
  let history;
  try {
    const tags = versionTags();
    if (tags.length) {
      history = tags.map((version) => ({
        version,
        updated: sh(`git log -1 --format=%cI ${version}`),
      }));
    } else {
      history = [{ version: '10.0.0', updated: sh('git log -1 --format=%cI') }];
    }
  } catch {
    history = [{ version: '10.0.0', updated: new Date().toISOString() }];
  }
  const last = history[history.length - 1];
  const data = { version: last.version, updated: last.updated, history };
  writeFileSync(join(root, 'src/version.json'), `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = writeVersion();
  console.log(`${data.version} · ${data.updated}`);
}
