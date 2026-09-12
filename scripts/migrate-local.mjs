import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { projectRoot } from './sites-env.mjs';

const source = JSON.parse(readFileSync(path.join(projectRoot, 'dist/server/wrangler.json'), 'utf8'));
if (!source.d1_databases?.some(database => database.binding === 'DB')) throw new Error('Build the project with the DB binding first.');
const runtime = path.join(projectRoot, '.sites-runtime');
mkdirSync(runtime, { recursive: true });
const config = path.join(runtime, 'migrate-local.json');
writeFileSync(config, JSON.stringify({
  name: 'fandian-local-migrations', compatibility_date: source.compatibility_date,
  d1_databases: source.d1_databases.map(database => ({ ...database, migrations_dir: path.join(projectRoot, 'drizzle') })),
}, null, 2));
// This command is intentionally local-only; it cannot apply to a live database.
const result = spawnSync(process.execPath, [path.join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'),
  'd1', 'migrations', 'apply', 'DB', '--local', '--config', config,
  '--persist-to', process.argv[2] || path.join(projectRoot, '.wrangler/state'),
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
