import * as SQLite from 'expo-sqlite';

import type { BindValue, Db, Statement } from '../core/db';

/** The core's Db interface over expo-sqlite. */
export const openExpoDb = async (name: string): Promise<Db> => {
  const db = await SQLite.openDatabaseAsync(name);
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: BindValue[] = []) => {
      await db.runAsync(sql, params);
    },
    all: <T>(sql: string, params: BindValue[] = []) => db.getAllAsync<T>(sql, params),
    first: <T>(sql: string, params: BindValue[] = []) => db.getFirstAsync<T>(sql, params),
    prepare: async (sql): Promise<Statement> => {
      const statement = await db.prepareAsync(sql);
      return {
        run: async (params) => {
          await statement.executeAsync(params);
        },
        finalize: () => statement.finalizeAsync(),
      };
    },
    // The import database has no other users, so a plain (non-exclusive)
    // transaction on this connection is enough.
    transaction: (task) => db.withTransactionAsync(task),
    close: () => db.closeAsync(),
  };
};

export const deleteExpoDb = async (name: string) => {
  try {
    await SQLite.deleteDatabaseAsync(name);
  } catch {
    // Already gone, or never created.
  }
};
