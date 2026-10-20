import initSqlJs, { type Database } from 'sql.js';

import type { BindValue, Db, Statement } from '../src/core/db';

/** The core's Db interface over sql.js, so the importer and queries run in Node. */
export const openTestDb = async (): Promise<Db & { raw: Database }> => {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();

  const all = async <T>(sql: string, params: BindValue[] = []): Promise<T[]> => {
    const statement = raw.prepare(sql);
    try {
      statement.bind(params);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally {
      statement.free();
    }
  };

  return {
    raw,
    exec: async (sql) => {
      raw.exec(sql);
    },
    run: async (sql, params = []) => {
      raw.run(sql, params);
    },
    all,
    first: async <T>(sql: string, params: BindValue[] = []) => (await all<T>(sql, params))[0] ?? null,
    prepare: async (sql): Promise<Statement> => {
      const statement = raw.prepare(sql);
      return {
        run: async (params) => {
          statement.run(params);
        },
        finalize: async () => {
          statement.free();
        },
      };
    },
    transaction: async (task) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    close: async () => raw.close(),
  };
};
