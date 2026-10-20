import { strToU8, zipSync } from 'fflate';

import { CsvStream, parseTable, splitCsvLine, timeToSeconds } from '../src/core/gtfs/csv';
import { findEntry, looksLikeZip, readEntryText, readZipDirectory, streamEntryText } from '../src/core/gtfs/zip';

const pushInPieces = (text: string, size: number) => {
  const stream = new CsvStream();
  const rows: string[][] = [];
  for (let at = 0; at < text.length; at += size) rows.push(...stream.push(text.slice(at, at + size)));
  rows.push(...stream.end());
  return rows;
};

describe('CSV', () => {
  const text = '﻿a,b,c\r\n1, two ,"x, y"\r\n"he said ""hi""",,\n"multi\nline",z,9';

  test.each([1, 2, 3, 7, 1000])('same rows whatever the chunk size (%i)', (size) => {
    expect(pushInPieces(text, size)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'two', 'x, y'],
      ['he said "hi"', '', ''],
      ['multi\nline', 'z', '9'],
    ]);
  });

  test('parseTable keys rows by header and skips blank lines', () => {
    expect(parseTable('id,name\n\n1,Rynek\n2,Świdnicka\n')).toEqual([
      { id: '1', name: 'Rynek' },
      { id: '2', name: 'Świdnicka' },
    ]);
  });

  test('splitCsvLine fast path trims', () => {
    expect(splitCsvLine(' a , b,c ')).toEqual(['a', 'b', 'c']);
  });

  test('times past midnight stay on the service day', () => {
    expect(timeToSeconds('25:30:00')).toBe(91_800);
    expect(timeToSeconds('8:05')).toBe(29_100);
    expect(timeToSeconds('')).toBe(-1);
    expect(timeToSeconds('xx')).toBe(-1);
  });
});

describe('zip', () => {
  const big = 'id,value\n' + Array.from({ length: 50_000 }, (_, i) => `${i},żółć ${i}`).join('\n');
  const archive = zipSync({
    'GTFS/stops.txt': [strToU8(big), { level: 6 }],
    'GTFS/': new Uint8Array(0),
    'plain.txt': [strToU8('stored'.repeat(300)), { level: 0 }],
  });

  test('reads the central directory and ignores folders', () => {
    const entries = readZipDirectory(archive);
    expect(entries.map((entry) => entry.path).sort()).toEqual(['GTFS/stops.txt', 'plain.txt']);
    expect(looksLikeZip(archive)).toBe(true);
    expect(looksLikeZip(strToU8('<html>' + ' '.repeat(2000)))).toBe(false);
  });

  test('finds a table by file name inside a folder', () => {
    const entries = readZipDirectory(archive);
    expect(findEntry(entries, 'STOPS.txt')?.path).toBe('GTFS/stops.txt');
    expect(findEntry(entries, 'shapes.txt')).toBeNull();
  });

  test('stored and deflated entries read back exactly', async () => {
    const entries = readZipDirectory(archive);
    expect(readEntryText(archive, findEntry(entries, 'plain.txt')!)).toBe('stored'.repeat(300));

    const pieces: string[] = [];
    const progress: number[] = [];
    await streamEntryText(archive, findEntry(entries, 'stops.txt')!, (piece) => void pieces.push(piece), {
      sliceBytes: 4096,
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(pieces.join('')).toBe(big);
    expect(pieces.length).toBeGreaterThan(1);
    expect(progress[progress.length - 1]).toBe(1);
  });
});
