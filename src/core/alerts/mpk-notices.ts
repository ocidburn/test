/**
 * MPK's service-change notices ("zmiany w komunikacji") from mpk.wroc.pl.
 *
 * Each notice is a card: the lines it touches, the dates it is in force and
 * a title linking to the full text:
 *
 *   <div class="message__card"> … <span class="icon-message orange"></span> …
 *     <span class="message__label">linie: </span>
 *     <span class="message__number">6</span> <span class="message__number">7</span> …
 *     <span class="message__label">obowiązuje: </span>
 *     <span class="date__value">24.10.2026 - 31.10.2026</span>   (or just the end date)
 *     <a href="https://mpk.wroc.pl/komunikat/1163/…">24.10.2026r. - przywrócenie ruchu …</a>
 *
 * The same page also shows lost-property cards ("data:", red icon); only
 * cards with a "linie:" label are notices. These are planned changes —
 * roadworks, diversions, moved stops. Live incidents MPK posts on X
 * (@AlertMPK), which an app without a server cannot read.
 */

import { fetchText, type RequestOptions } from '../net/http';

/** The home page lists every notice in force; the changes page the newest, with the coming ones. */
export const NOTICE_PAGES = ['https://mpk.wroc.pl/', 'https://mpk.wroc.pl/strefa-pasazera/zaplanuj-podroz/zmiany-w-komunikacji'];

export type Notice = {
  id: string;
  title: string;
  url: string;
  lines: string[];
  /** In force from / until, YYYYMMDD; null when the notice does not say. */
  from: number | null;
  to: number | null;
};

// The site's editor writes Polish letters as themselves but ó and punctuation as entities.
const ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  oacute: 'ó',
  Oacute: 'Ó',
  ndash: '–',
  mdash: '—',
  bdquo: '„',
  rdquo: '”',
  ldquo: '“',
  rsquo: '’',
  lsquo: '‘',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  deg: '°',
  middot: '·',
};

const decodeEntities = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole;
  });

const decode = (text: string) => decodeEntities(text).replace(/\s+/g, ' ').trim();

/** "24.10.2026" → 20261024. */
const dateKey = (text: string): number | null => {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return year * 10_000 + month * 100 + day;
};

/** Throws when the page has no notice cards at all: the site was redesigned, not "no notices". */
export const parseMpkNotices = (html: string): Notice[] => {
  if (!html.includes('class="message__card')) throw new Error('на странице MPK нет блока сообщений — сайт изменился?');
  const notices: Notice[] = [];
  for (const card of html.split('class="message__card"').slice(1)) {
    // A card ends where the next begins; cap it so a missing closing tag cannot swallow the page.
    const body = card.slice(0, 4000);
    if (!/message__label">\s*linie:/i.test(body)) continue;
    const link = /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(body);
    if (!link) continue;
    const url = decode(link[1]);
    const title = decode(link[2].replace(/<[^>]+>/g, ' '));
    if (!title) continue;
    const lines = [...body.matchAll(/message__number">\s*([^<]*?)\s*</g)]
      .map((m) => decode(m[1]).toUpperCase())
      // The site puts a "." where a notice concerns no particular line.
      .filter((line) => /^[0-9A-ZĄĆĘŁŃÓŚŹŻ]+$/.test(line));
    const validity = /date__value">([^<]*)</.exec(body)?.[1] ?? '';
    const [first, second] = validity.split(/\s+-\s+/);
    // "24.10.2026 - 31.10.2026", or the end date alone with the start in the title ("24.10.2026r. - …").
    const from = second !== undefined ? dateKey(first) : dateKey(/^\s*(\d{1,2}\.\d{1,2}\.\d{4})/.exec(title)?.[1] ?? '');
    const to = dateKey(second ?? first ?? '');
    const id = /\/komunikat\/(\d+)/.exec(url)?.[1] ?? url;
    notices.push({ id, title, url, lines: [...new Set(lines)], from, to });
  }
  return notices;
};

/** Several pages list overlapping notices: one per id, the one with the most detail kept. */
export const mergeNotices = (lists: Notice[][]): Notice[] => {
  const byId = new Map<string, Notice>();
  for (const notice of lists.flat()) {
    const kept = byId.get(notice.id);
    if (!kept) byId.set(notice.id, notice);
    else
      byId.set(notice.id, {
        ...kept,
        lines: kept.lines.length >= notice.lines.length ? kept.lines : notice.lines,
        from: kept.from ?? notice.from,
        to: kept.to ?? notice.to,
      });
  }
  return [...byId.values()];
};

export type NoticeState = 'now' | 'soon' | 'over';

export const noticeState = (notice: Notice, today: number): NoticeState => {
  if (notice.to !== null && notice.to < today) return 'over';
  if (notice.from !== null && notice.from > today) return 'soon';
  return 'now';
};

/** In force now first (the newest start first), then the coming ones (soonest first); finished ones dropped. */
export const sortNotices = (notices: Notice[], today: number): Notice[] => {
  const now = notices.filter((n) => noticeState(n, today) === 'now').sort((a, b) => (b.from ?? 0) - (a.from ?? 0));
  const soon = notices.filter((n) => noticeState(n, today) === 'soon').sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  return [...now, ...soon];
};

/** The full text of a notice, from its own page, as plain paragraphs. */
export const parseNoticeText = (html: string): string => {
  const card = html.indexOf('message__card--single');
  const start = card < 0 ? -1 : html.indexOf('main__inner">', card);
  if (start < 0) throw new Error('на странице сообщения нет текста — сайт изменился?');
  const end = html.indexOf('</div>', start);
  const body = html.slice(start + 'main__inner">'.length, end < 0 ? undefined : end);
  return decodeEntities(
    body
      // Line breaks in the source are only the editor's wrapping.
      .replace(/\s+/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/(p|li|h\d|tr|ul|ol|table)>/gi, '\n\n')
      .replace(/<\/t[dh]>/gi, '  ')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Every notice from the pages above. One page failing is enough to answer;
 * only when none answers is it an error.
 */
export const fetchMpkNotices = async (options?: RequestOptions): Promise<Notice[]> => {
  const results = await Promise.allSettled(NOTICE_PAGES.map(async (url) => parseMpkNotices(await fetchText(url, options))));
  const lists = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!lists.length) throw (results[0] as PromiseRejectedResult).reason;
  return mergeNotices(lists);
};

export const fetchNoticeText = async (url: string, options?: RequestOptions): Promise<string> => {
  if (!/^https:\/\/mpk\.wroc\.pl\//.test(url)) throw new Error('не страница MPK');
  return parseNoticeText(await fetchText(url, options));
};
