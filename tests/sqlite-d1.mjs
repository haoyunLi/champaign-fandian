import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  for (const entry of journal.entries) sqlite.exec(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8'));
  const execute = (sql, values) => {
    const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
    const results = sqlite.prepare(sql).all(...values);
    const changes = sqlite.prepare('SELECT total_changes() AS n').get().n - before;
    return { success: true, results, meta: { changes } };
  };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    result() { return execute(this.sql, this.values); }
    async all() { return this.result(); }
    async run() { return this.result(); }
    async first(column) { const row = this.result().results[0]; return row ? column ? row[column] : row : null; }
  }
  return {
    sqlite,
    prepare: sql => new Statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(statement => statement.result()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
