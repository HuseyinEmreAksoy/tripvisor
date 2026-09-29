/**
 * surfaceStyle — the elevation scale applied (M5 Y2.4).
 *
 * One call gives a card its background, edge, radius and shadow for the
 * level, tuned per theme:
 *   - light: white card on paper, soft warm shadow, and a hairline edge only
 *     for `flat` (shadows carry depth on paper);
 *   - dark: the lifted `cardBgSolid` surface plus a hairline edge at every
 *     level (shadows barely register on ink, tone + edge carry depth).
 *
 *   <View style={[surfaceStyle(t, 'raised'), { padding: t.layout.cardPadding }]} />
 */
import type { ViewStyle } from 'react-native';
import type { Theme } from './ThemeProvider';
import { elevation, type ElevationLevel } from './tokens';

export function surfaceStyle(t: Theme, level: ElevationLevel = 'raised'): ViewStyle {
  const spec = elevation[level];
  const dark = t.name === 'dark';
  const style: ViewStyle = {
    backgroundColor: t.colors.cardBgSolid,
    borderRadius: t.radius[spec.radius],
  };
  if (dark || spec.shadow === null) {
    // 1 unit: a crisp 1 px on web (hairline there is already 1 px, so ×2
    // read heavy) and a visible-but-light 1 pt edge on native.
    style.borderWidth = 1;
    style.borderColor = t.colors.border;
  }
  if (spec.shadow) {
    Object.assign(
      style,
      t.shadows[spec.shadow](level === 'overlay' ? t.colors.shadowColorStrong : t.colors.shadowColor),
    );
  }
  return style;
}
