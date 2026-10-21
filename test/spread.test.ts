import { spreadPoints, type ScreenPoint } from '../src/core/spread';

const placed = (points: ScreenPoint[], minDistance: number) => {
  const offsets = spreadPoints(points, minDistance);
  return points.map((p) => {
    const o = offsets.get(p.id) ?? { dx: 0, dy: 0 };
    return { id: p.id, x: p.x + o.dx, y: p.y + o.dy };
  });
};

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('spreadPoints', () => {
  test('markers far apart stay where they are', () => {
    expect(spreadPoints([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 }], 34).size).toBe(0);
  });

  test('two overlapping markers move apart to exactly the minimum distance, keeping sides', () => {
    const [a, b] = placed([{ id: '113', x: 150, y: 118 }, { id: 'K', x: 160, y: 120 }], 34);
    expect(distance(a, b)).toBeCloseTo(34, 5);
    expect(a.x).toBeLessThan(b.x); // 113 stays on the left
  });

  test('a group of three ends up pairwise at least the minimum distance apart', () => {
    const result = placed(
      [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 5, y: 8 }],
      30,
    );
    for (let i = 0; i < result.length; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) expect(distance(result[i], result[j])).toBeGreaterThanOrEqual(29.999);
    }
  });

  test('markers on the exact same spot are still separated', () => {
    const result = placed([{ id: 'a', x: 50, y: 50 }, { id: 'b', x: 50, y: 50 }], 34);
    expect(distance(result[0], result[1])).toBeCloseTo(34, 5);
  });

  test('a long queue (more than the group limit) is left alone', () => {
    const queue = Array.from({ length: 8 }, (_, i) => ({ id: String(i), x: i * 10, y: 0 }));
    expect(spreadPoints(queue, 34).size).toBe(0);
  });
});
