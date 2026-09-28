/**
 * Insights building blocks (X3.1): icon badges replace the 👍/👎 strings,
 * rows carry one spoken summary, and category colors come from theme tokens.
 */
import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { ThemeProvider, darkColors, lightColors } from '@/theme';
import { PlaceCatalogRow, ReactionLegend, categoryColor } from '../InsightCards';
import type { Theme } from '@/theme';

describe('InsightCards', () => {
  it('PlaceCatalogRow speaks title, trip, day and count', () => {
    const { getByLabelText, getByText } = render(
      <ThemeProvider>
        <PlaceCatalogRow title="Belém Tower" tripTitle="Lisbon" dayIndex={1} count={3} kind="liked" />
      </ThemeProvider>,
    );
    expect(getByLabelText('Belém Tower, Lisbon, day 2. liked 3 times')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });

  it('ReactionLegend names both series', () => {
    const { getByText } = render(
      <ThemeProvider>
        <ReactionLegend />
      </ThemeProvider>,
    );
    expect(getByText('Liked')).toBeTruthy();
    expect(getByText("Didn't like")).toBeTruthy();
  });

  it('categoryColor reads theme tokens in both modes', () => {
    const light = { colors: lightColors } as unknown as Theme;
    const dark = { colors: darkColors } as unknown as Theme;
    expect(categoryColor(light, 'food')).toBe(lightColors.chartFood);
    expect(categoryColor(dark, 'food')).toBe(darkColors.chartFood);
    expect(categoryColor(dark, 'other')).toBe(darkColors.chartOther);
  });
});
