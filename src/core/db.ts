/**
 * The database surface the core needs. The app implements it over expo-sqlite
 * (src/platform/expo-db.ts); tests implement it over sql.js, so the importer
 * and every query run unchanged in Node.
 */
export type BindValue = string | number | null | Uint8Array;

export interface Statement {
  run(params: BindValue[]): Promise<void>;
  finalize(): Promise<void>;
}

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: BindValue[]): Promise<void>;
  all<T>(sql: string, params?: BindValue[]): Promise<T[]>;
  first<T>(sql: string, params?: BindValue[]): Promise<T | null>;
  prepare(sql: string): Promise<Statement>;
  transaction(task: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

/**
 * Multi-row INSERT in fixed-size batches: one native call per `batchRows`
 * rows instead of one per row, which is what makes a million-row import
 * feasible on a phone.
 */
export class BatchInserter {
  private buffer: BindValue[] = [];
  private statement: Statement | null = null;
  rows = 0;

  constructor(
    private readonly db: Db,
    private readonly table: string,
    private readonly columns: string[],
    private readonly batchRows = 400,
    /** e.g. 'INSERT OR IGNORE' where upstream data may repeat a key. */
    private readonly verb = 'INSERT',
  ) {}

  private sql(rowCount: number) {
    const tuple = `(${this.columns.map(() => '?').join(',')})`;
    return `${this.verb} INTO ${this.table} (${this.columns.join(',')}) VALUES ${Array.from({ length: rowCount }, () => tuple).join(',')}`;
  }

  async add(values: BindValue[]): Promise<void> {
    this.buffer.push(...values);
    this.rows += 1;
    if (this.buffer.length >= this.batchRows * this.columns.length) await this.flushFull();
  }

  private async flushFull() {
    this.statement ??= await this.db.prepare(this.sql(this.batchRows));
    const size = this.batchRows * this.columns.length;
    while (this.buffer.length >= size) {
      const chunk = this.buffer.splice(0, size);
      await this.statement.run(chunk);
    }
  }

  async finish(): Promise<void> {
    await this.flushFull();
    if (this.buffer.length) {
      const rowCount = this.buffer.length / this.columns.length;
      await this.db.run(this.sql(rowCount), this.buffer);
      this.buffer = [];
    }
    await this.statement?.finalize();
    this.statement = null;
  }
}
