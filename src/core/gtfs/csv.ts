/**
 * Incremental CSV reader for GTFS tables.
 *
 * Text arrives in arbitrary pieces (a decompressed slice can end mid-line or
 * mid-quote), so incomplete trailing input is carried to the next push. Most
 * GTFS lines carry no quotes at all and take a plain `split(',')`; quoted
 * fields, doubled quotes, CRLF and quoted newlines are handled on the slow path.
 */

const splitQuoted = (line: string): string[] => {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field.trim());
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field.trim());
  return fields;
};

export const splitCsvLine = (line: string): string[] => {
  if (line.indexOf('"') === -1) {
    const fields = line.split(',');
    for (let index = 0; index < fields.length; index += 1) fields[index] = fields[index].trim();
    return fields;
  }
  return splitQuoted(line);
};

const countQuotes = (text: string) => {
  let count = 0;
  for (let at = text.indexOf('"'); at !== -1; at = text.indexOf('"', at + 1)) count += 1;
  return count;
};

export class CsvStream {
  private carry = '';
  private started = false;

  /** Feed a piece of text; returns every row completed by it. */
  push(text: string): string[][] {
    let input = this.carry + text;
    if (!this.started) {
      if (input.length === 0) return [];
      if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);
      this.started = true;
    }

    const rows: string[][] = [];
    let start = 0;
    let pendingLine = '';
    for (let newline = input.indexOf('\n', start); newline !== -1; newline = input.indexOf('\n', start)) {
      let line = input.slice(start, newline);
      start = newline + 1;
      if (pendingLine) line = `${pendingLine}\n${line}`;
      // An odd number of quotes means a quoted field continues on the next line.
      if (countQuotes(line) % 2 === 1) {
        pendingLine = line;
        continue;
      }
      pendingLine = '';
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length === 0) continue;
      rows.push(splitCsvLine(line));
    }
    this.carry = (pendingLine ? `${pendingLine}\n` : '') + input.slice(start);
    return rows;
  }

  /** Rows left once the input has ended (a last line without a newline). */
  end(): string[][] {
    const rest = this.carry;
    this.carry = '';
    if (!rest.trim()) return [];
    return this.push(`${rest}\n`);
  }
}

/** Parse a whole small table into keyed rows. */
export const parseTable = (text: string): Record<string, string>[] => {
  const stream = new CsvStream();
  const rows = [...stream.push(text), ...stream.end()];
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((fields) => {
    const row: Record<string, string> = {};
    header.forEach((column, index) => {
      row[column] = fields[index] ?? '';
    });
    return row;
  });
};

/** Column name -> index, for array-shaped rows. */
export const columnIndex = (header: string[]) => {
  const map = new Map<string, number>();
  header.forEach((column, index) => map.set(column.trim(), index));
  return (name: string) => map.get(name) ?? -1;
};

/**
 * GTFS times may exceed 24h ("25:10:00" is 01:10 the next morning), so they
 * stay seconds after the start of the service day. -1 when unparseable.
 */
export const timeToSeconds = (value: string | undefined): number => {
  if (!value) return -1;
  const parts = value.split(':');
  if (parts.length < 2) return -1;
  const hours = Number.parseInt(parts[0], 10);
  const minutes = Number.parseInt(parts[1], 10);
  const seconds = parts.length > 2 ? Number.parseInt(parts[2], 10) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return -1;
  return hours * 3600 + minutes * 60 + seconds;
};
