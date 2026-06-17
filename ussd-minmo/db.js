import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_DB_FILE = process.env.SQLITE_FILE || './data/minmo-ussd.sqlite';

let singleton;

function resolveDbFile(filename = DEFAULT_DB_FILE) {
  if (filename === ':memory:') return filename;
  return path.isAbsolute(filename) ? filename : path.join(APP_DIR, filename);
}

// Central SQLite adapter. The rest of the app depends on this small async API,
// which keeps storage calls testable and independent from route handling.
export async function createDatabase(filename = DEFAULT_DB_FILE) {
  const resolved = resolveDbFile(filename);
  if (resolved !== ':memory:') fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const connection = await open({ filename: resolved, driver: sqlite3.Database });
  await connection.exec('PRAGMA foreign_keys = ON;');
  if (resolved !== ':memory:') await connection.exec('PRAGMA journal_mode = WAL;');

  return {
    filename: resolved,
    connection,
    async exec(sql) {
      return connection.exec(sql);
    },
    async run(sql, params = []) {
      return connection.run(sql, params);
    },
    async get(sql, params = []) {
      return connection.get(sql, params);
    },
    async all(sql, params = []) {
      return connection.all(sql, params);
    },
    async close() {
      return connection.close();
    }
  };
}

export async function getDb() {
  if (!singleton) singleton = createDatabase();
  return singleton;
}

export async function initDb(db) {
  const database = db || await getDb();
  const schema = fs.readFileSync(path.join(APP_DIR, 'schema.sql'), 'utf8');
  await database.exec(schema);
  return database;
}

export async function recordPublishedEvent(db, event, relayResults = []) {
  await db.run(
    `INSERT OR IGNORE INTO published_events
      (event_id, event_kind, pubkey, event_json, relay_results_json)
     VALUES (?, ?, ?, ?, ?)`,
    [event.id, event.kind, event.pubkey, JSON.stringify(event), JSON.stringify(relayResults)]
  );
}
