import { execSync } from 'node:child_process';
import { bump, versionTags } from './write-version.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') {
  console.log('Version tags are created when main is pushed to GitHub.');
  process.exit(0);
}

const tags = versionTags();
const next = tags.length ? bump(tags[tags.length - 1]) : '10.0.0';
const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const already = tags.find((tag) => execSync(`git rev-list -n 1 ${tag}`, { encoding: 'utf8' }).trim() === head);

if (already) {
  console.log(`This commit is already ${already}.`);
  process.exit(0);
}

execSync(`git tag ${next}`, { stdio: 'inherit' });
execSync(`git push origin refs/tags/${next}`, { stdio: 'inherit' });
console.log(`Tagged ${next}`);
