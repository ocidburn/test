import Svg, { Circle, Path } from 'react-native-svg';

/** Line icons for the map's buttons, drawn on a 24-point grid. */
type IconProps = { color: string; size?: number };

const stroke = (color: string) =>
  ({ stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }) as const;

/** A warning sign: notices about the service. */
export function AlertIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3.5 L21.5 20 H2.5 Z" {...stroke(color)} />
      <Path d="M12 9.5 V14" {...stroke(color)} strokeWidth={2.4} />
      <Circle cx={12} cy={17} r={1.3} fill={color} />
    </Svg>
  );
}

/** Stacked sheets: the map's base layer. */
export function LayersIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3 L21 8 L12 13 L3 8 Z" {...stroke(color)} />
      <Path d="M3 12.5 L12 17.5 L21 12.5" {...stroke(color)} />
      <Path d="M3 16.5 L12 21.5 L21 16.5" {...stroke(color)} />
    </Svg>
  );
}

/** A route with stops: which lines are on the map. */
export function LinesIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5.5 19 C5.5 12.5 18.5 11.5 18.5 5" {...stroke(color)} />
      <Circle cx={5.5} cy={19} r={2.5} fill={color} />
      <Circle cx={12} cy={12} r={2} fill={color} />
      <Circle cx={18.5} cy={5} r={2.5} fill={color} />
    </Svg>
  );
}

// Eight teeth around a ring, as one outline.
const GEAR = (() => {
  const teeth = 8;
  const [outer, inner] = [10, 7.4];
  const point = (radius: number, angle: number) =>
    `${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`;
  const step = (2 * Math.PI) / teeth;
  const parts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    // Tooth top a little narrower than its base.
    parts.push(point(inner, a - step * 0.3), point(outer, a - step * 0.18), point(outer, a + step * 0.18), point(inner, a + step * 0.3));
  }
  return `M${parts.join(' L')} Z`;
})();

/** Settings: the Data screen. */
export function GearIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={GEAR} {...stroke(color)} strokeWidth={1.8} />
      <Circle cx={12} cy={12} r={3} {...stroke(color)} strokeWidth={1.8} />
    </Svg>
  );
}
