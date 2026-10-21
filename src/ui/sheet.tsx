import { useEffect, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View, type PanResponderInstance } from 'react-native';

import { useTheme } from './theme';

/** Past this far below half, or this fast downwards, a drag from half closes the sheet. */
const DISMISS_POINTS = 90;
const FLICK = 0.6;

/** The sheet's position and drag gestures; plain mutable state, outside React's render. */
class SheetDrag {
  /** translateY: 0 is fully open, `halfY` half, `full` off screen. */
  readonly y: Animated.Value;
  readonly header: PanResponderInstance;
  readonly body: PanResponderInstance;
  private expanded = false;
  private start = 0;
  /** Where the last snap is heading. */
  private at: number;
  private onDismiss = () => {};
  private onExpandedChange?: (expanded: boolean) => void;

  constructor(
    private full: number,
    private halfY: number,
    private readonly setExpanded: (expanded: boolean) => void,
  ) {
    this.y = new Animated.Value(full);
    this.at = full;
    this.header = this.responder(false);
    this.body = this.responder(true);
  }

  update(next: { full: number; halfY: number; onDismiss: () => void; onExpandedChange?: (expanded: boolean) => void }) {
    this.full = next.full;
    this.halfY = next.halfY;
    this.onDismiss = next.onDismiss;
    this.onExpandedChange = next.onExpandedChange;
  }

  snap(to: 'full' | 'half' | 'gone', velocity = 0) {
    const target = to === 'full' ? 0 : to === 'half' ? this.halfY : this.full;
    this.at = target;
    if (to !== 'gone' && (to === 'full') !== this.expanded) {
      this.expanded = to === 'full';
      this.setExpanded(this.expanded);
      this.onExpandedChange?.(this.expanded);
    }
    Animated.spring(this.y, { toValue: target, velocity, useNativeDriver: true, bounciness: 0, speed: 16 }).start(({ finished }) => {
      if (finished && to === 'gone') this.onDismiss();
    });
  }

  /** The header drags in both states; the body only at half, where its list does not scroll. */
  private responder(body: boolean) {
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx) && (!body || !this.expanded),
      onPanResponderGrant: () => {
        // Where it was heading; corrected to where it actually is once the animation reports back.
        this.start = this.at;
        this.y.stopAnimation((value) => {
          this.start = value;
        });
      },
      onPanResponderMove: (_e, g) => this.y.setValue(Math.min(this.full, Math.max(0, this.start + g.dy))),
      onPanResponderRelease: (_e, g) => {
        const at = this.start + g.dy;
        if (g.vy < -FLICK) return this.snap('full', g.vy);
        if (g.vy > FLICK) return this.snap(at > this.halfY || !this.expanded ? 'gone' : 'half', g.vy);
        if (at > this.halfY + DISMISS_POINTS) return this.snap('gone');
        this.snap(at < this.halfY / 2 ? 'full' : 'half');
      },
      onPanResponderTerminate: () => this.snap(this.expanded ? 'full' : 'half'),
    });
  }
}

/**
 * A bottom sheet that opens at `half` points tall and can be dragged up to
 * `full`. The header drags it in both states; the body drags it only while
 * at half, where its list does not scroll. Dragging down from half closes it.
 */
export function Sheet({
  half,
  full,
  onDismiss,
  onExpandedChange,
  header,
  children,
}: {
  half: number;
  full: number;
  onDismiss: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  header: ReactNode;
  children: (expanded: boolean) => ReactNode;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [drag] = useState(() => new SheetDrag(full, full - half, setExpanded));
  useEffect(() => drag.update({ full, halfY: full - half, onDismiss, onExpandedChange }));
  // Rises to half when it appears.
  useEffect(() => drag.snap('half'), [drag]);

  return (
    <Animated.View
      style={[styles.sheet, { height: full, backgroundColor: theme.surface, borderColor: theme.border, transform: [{ translateY: drag.y }] }]}
    >
      <View {...drag.header.panHandlers}>
        <Pressable
          onPress={() => drag.snap(expanded ? 'half' : 'full')}
          style={styles.handleArea}
          accessibilityLabel={expanded ? 'Свернуть' : 'Развернуть'}
          hitSlop={8}
        >
          <View style={[styles.handle, { backgroundColor: theme.muted }]} />
        </Pressable>
        {header}
      </View>
      <View style={styles.body} {...drag.body.panHandlers}>
        {children(expanded)}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -2 },
  },
  handleArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  handle: { width: 40, height: 5, borderRadius: 3, opacity: 0.5 },
  body: { flex: 1 },
});
