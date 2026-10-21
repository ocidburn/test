/**
 * Spread markers that would sit on top of each other.
 *
 * Works in screen points. Markers closer than `minDistance` are grouped
 * (transitively), and each small group is laid out on a circle around its
 * centre, keeping the members' order around it so nothing swaps sides. The
 * result is an offset per marker: the map keeps each marker's true
 * coordinate (so movement still animates) and only draws it shifted.
 *
 * Big groups — a queue of trams at a terminus — are left alone: a ring of
 * ten markers is harder to read than the pile.
 */

export type ScreenPoint = { id: string; x: number; y: number };
export type Offset = { dx: number; dy: number };

export const spreadPoints = (
  points: ScreenPoint[],
  minDistance: number,
  { maxGroup = 6 }: { maxGroup?: number } = {},
): Map<string, Offset> => {
  const parent = points.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const minSq = minDistance * minDistance;
  for (let a = 0; a < points.length; a += 1) {
    for (let b = a + 1; b < points.length; b += 1) {
      const dx = points[a].x - points[b].x;
      const dy = points[a].y - points[b].y;
      if (dx * dx + dy * dy < minSq) parent[find(a)] = find(b);
    }
  }

  const groups = new Map<number, number[]>();
  points.forEach((_, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(index);
    else groups.set(root, [index]);
  });

  const offsets = new Map<string, Offset>();
  for (const members of groups.values()) {
    if (members.length < 2 || members.length > maxGroup) continue;
    const cx = members.reduce((sum, i) => sum + points[i].x, 0) / members.length;
    const cy = members.reduce((sum, i) => sum + points[i].y, 0) / members.length;
    // Neighbours on the circle are exactly minDistance apart.
    const radius = members.length === 2 ? minDistance / 2 : minDistance / (2 * Math.sin(Math.PI / members.length));
    const ordered = members
      .map((i, order) => {
        const dx = points[i].x - cx;
        const dy = points[i].y - cy;
        // Points exactly on the centre get their place by order instead of an undefined angle.
        const angle = dx === 0 && dy === 0 ? (order / members.length) * 2 * Math.PI : Math.atan2(dy, dx);
        return { i, angle };
      })
      .sort((p, q) => p.angle - q.angle);
    const start = ordered[0].angle;
    ordered.forEach(({ i }, k) => {
      const angle = start + (k / ordered.length) * 2 * Math.PI;
      offsets.set(points[i].id, {
        dx: cx + Math.cos(angle) * radius - points[i].x,
        dy: cy + Math.sin(angle) * radius - points[i].y,
      });
    });
  }
  return offsets;
};
