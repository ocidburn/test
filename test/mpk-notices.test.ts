import {
  fetchMpkNotices,
  mergeNotices,
  noticeState,
  parseMpkNotices,
  parseNoticeText,
  sortNotices,
  type Notice,
} from '../src/core/alerts/mpk-notices';
import type { FetchLike } from '../src/core/net/http';

// Cards as mpk.wroc.pl serves them (October 2026), whitespace trimmed.
const card = (lines: string[], validity: string, href: string, title: string) => `
<div class="message__card">
  <div class="message__icon_box"><div class="message__icon"><span class="icon-message orange" role="presentation" ></span></div></div>
  <div class="message__content">
    <div class="message__meta">
      <div class="message__numbers">
        <span class="message__label">linie:</span>
        ${lines.map((line) => `<span class="message__number">${line}</span>`).join('\n        ')}
      </div>
      <div class="message__date">
        <span class="message__label">obowiązuje:</span>
        <span class="date__value">${validity}</span>
      </div>
    </div>
    <div class="message__main"><div class="main__inner"><p><a href="${href}">${title}</a></p></div></div>
  </div>
</div>`;

const LOST_PROPERTY = `
<div class="message__card">
  <div class="message__icon_box"><div class="message__icon"><span class="icon-message red" role="presentation"></span></div></div>
  <div class="message__content">
    <div class="message__meta"><div class="message__date">
      <span class="message__label">data: </span><span class="date__value">21.10.2026</span>
    </div></div>
    <div class="message__main"><div class="main__inner"><p>Granatowa torba Kipsta.</p></div></div>
  </div>
</div>`;

const HOME = `<html><body>
${card(['6', '7', '74'], '24.10.2026 - 31.10.2026', 'https://mpk.wroc.pl/komunikat/1163/2026-10-31-pomorska', '24.10.2026r. - przywr&oacute;cenie ruchu dla linii tramwajowych na ul. Pomorskiej')}
${LOST_PROPERTY}
${card(['.'], '31.10.2026', 'https://mpk.wroc.pl/komunikat/1144/2026-10-31-zmiany', '26.09.2026r. - zmiany w kursowaniu  komunikacji zbiorowej: Traugutta, Peronowa')}
${card(['125', '132'], '31.10.2026', 'https://mpk.wroc.pl/komunikat/1109/2026-10-31-wiejska', 'Rozbudowa skrzyżowania Wiejska-Mokronoska-Awicenny')}
${card(['N', '131'], '10.10.2026 - 31.12.2026', 'https://mpk.wroc.pl/komunikat/1155/x', '10.10.2026r. - rozpoczęcie remontu ul. Żmudzkiej')}
</body></html>`;

describe('MPK notices', () => {
  test('reads the notice cards, not the lost-property ones', () => {
    const notices = parseMpkNotices(HOME);
    expect(notices.map((n) => n.id)).toEqual(['1163', '1144', '1109', '1155']);
    expect(notices[0]).toEqual({
      id: '1163',
      title: '24.10.2026r. - przywrócenie ruchu dla linii tramwajowych na ul. Pomorskiej',
      url: 'https://mpk.wroc.pl/komunikat/1163/2026-10-31-pomorska',
      lines: ['6', '7', '74'],
      from: 20261024,
      to: 20261031,
    });
  });

  test('a "." is no line; letters are lines', () => {
    const [, general, , night] = parseMpkNotices(HOME);
    expect(general.lines).toEqual([]);
    expect(general.title).toBe('26.09.2026r. - zmiany w kursowaniu komunikacji zbiorowej: Traugutta, Peronowa');
    expect(night.lines).toEqual(['N', '131']);
  });

  test('with only the end date, the start comes from the title, or stays unknown', () => {
    const [, general, wiejska] = parseMpkNotices(HOME);
    expect([general.from, general.to]).toEqual([20260926, 20261031]);
    expect([wiejska.from, wiejska.to]).toEqual([null, 20261031]);
  });

  test('a page without the message block is an error, not "no notices"', () => {
    expect(() => parseMpkNotices('<html><body>Przerwa techniczna</body></html>')).toThrow(/сайт изменился/);
    expect(parseMpkNotices(`<div class="message__card">${LOST_PROPERTY}`)).toEqual([]);
  });

  test('in force now (newest first), then coming (soonest first); finished ones go', () => {
    const n = (id: string, from: number | null, to: number | null): Notice => ({ id, title: id, url: id, lines: [], from, to });
    const today = 20261021;
    const notices = [n('old', 20261001, 20261020), n('a', 20261010, 20261031), n('b', null, 20261031), n('c', 20261015, null), n('late', 20261101, 20261110), n('soon', 20261024, 20261031)];
    expect(noticeState(notices[0], today)).toBe('over');
    expect(noticeState(notices[5], today)).toBe('soon');
    expect(noticeState(n('today', 20261021, 20261021), today)).toBe('now');
    expect(sortNotices(notices, today).map((x) => x.id)).toEqual(['c', 'a', 'b', 'soon', 'late']);
  });

  test('pages listing the same notice merge into one', () => {
    const a: Notice = { id: '1', title: 't', url: 'u', lines: [], from: null, to: 20261031 };
    const b: Notice = { id: '1', title: 't', url: 'u', lines: ['6'], from: 20261024, to: 20261031 };
    expect(mergeNotices([[a], [b]])).toEqual([{ ...a, lines: ['6'], from: 20261024 }]);
  });

  test('one page failing is enough; both failing is an error', async () => {
    const answers: Record<string, () => Response> = {
      'https://mpk.wroc.pl/': () => new Response('', { status: 503 }),
      'https://mpk.wroc.pl/strefa-pasazera/zaplanuj-podroz/zmiany-w-komunikacji': () => new Response(HOME),
    };
    const fetchImpl: FetchLike = async (url) => answers[url]();
    expect((await fetchMpkNotices({ fetchImpl })).length).toBe(4);
    const down: FetchLike = async () => new Response('', { status: 503 });
    await expect(fetchMpkNotices({ fetchImpl: down })).rejects.toThrow(/503/);
  });

  test('the full text of a notice, as paragraphs', () => {
    const page = `<section><div class="message__card message__card--single"><div class="message__main"><div class="main__inner">
      <p>W&nbsp;związku z przywr&oacute;ceniem ruchu:<br />
<br />
Linia 6 &ndash; trasa:</p>

<p>KRZYKI &ndash; Powstańc&oacute;w Śląskich</p>
<ul><li>jeden</li><li>dwa</li></ul>
<p>&nbsp;</p>                        </div></div></div></section>`;
    expect(parseNoticeText(page)).toBe(
      'W związku z przywróceniem ruchu:\n\nLinia 6 – trasa:\n\nKRZYKI – Powstańców Śląskich\n\n• jeden\n\n• dwa',
    );
    expect(() => parseNoticeText('<html></html>')).toThrow(/сайт изменился/);
  });
});
