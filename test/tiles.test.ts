import { countTiles, looksLikeImage, tileBox3857, tileUrl, tileX, tileY, tilesIn, WROCLAW_BOX } from '../src/core/map/tiles';

describe('tile arithmetic', () => {
  test('Wrocław centre falls on the right tiles', () => {
    expect([tileX(17.0385, 10), tileY(51.1079, 10)]).toEqual([560, 342]);
    expect([tileX(17.0385, 16), tileY(51.1079, 16)]).toEqual([35869, 21908]);
  });

  test('the whole city: counts per maximum zoom, and the iterator agrees', () => {
    expect([15, 16, 17, 18].map((z) => countTiles(WROCLAW_BOX, 10, z))).toEqual([1302, 5012, 19712, 78092]);
    expect([...tilesIn(WROCLAW_BOX, 10, 15)]).toHaveLength(1302);
  });

  test('a tile box in Web Mercator metres', () => {
    const h = 20037508.342789244;
    expect(tileBox3857({ z: 0, x: 0, y: 0 })).toEqual([-h, -h, h, h]);
    const [minX, minY, maxX, maxY] = tileBox3857({ z: 1, x: 1, y: 0 });
    expect([minX, minY, maxX, maxY]).toEqual([0, 0, h, h]);
  });

  test('URLs from XYZ, WMTS-style and WMS templates', () => {
    expect(tileUrl('https://t/{z}/{x}/{y}.png', 'xyz', { z: 3, x: 4, y: 5 })).toBe('https://t/3/4/5.png');
    expect(tileUrl('https://t?M=EPSG:3857:{z}&ROW={y}&COL={x}', 'xyz', { z: 3, x: 4, y: 5 })).toBe('https://t?M=EPSG:3857:3&ROW=5&COL=4');
    expect(tileUrl('https://w?BBOX={minX},{minY},{maxX},{maxY}&WIDTH={width}&HEIGHT={height}', 'wms', { z: 1, x: 1, y: 0 })).toBe(
      'https://w?BBOX=0,0,20037508.342789244,20037508.342789244&WIDTH=256&HEIGHT=256',
    );
  });

  test('an error page is not an image', () => {
    expect(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(true);
    expect(looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(looksLikeImage(new TextEncoder().encode('<?xml version="1.0"?><ServiceExceptionReport>'))).toBe(false);
  });
});
