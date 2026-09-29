/**
 * CurrencyPicker — currency chip row + an inline, searchable "More…" list
 * (M5 Y3.2). Used by the expense sheet (expense currency), the trip settings
 * sheet (home currency) and the new-trip form.
 *
 * The chip row shows `suggestions` (home first, then recently used). "More…"
 * expands an in-place search (no nested modal: the pickers already live in
 * bottom sheets) over every code fx-rates supports — the list loads on first
 * expand and falls back to COMMON_CURRENCIES offline.
 */
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { useFxCurrencies } from '@/api/fx';
import { ChoiceChip } from './ChoiceChip';
import { allCurrencyCodes, filterCurrencies } from './currencies';

/** Max rows rendered in the expanded list (search narrows it further). */
const MAX_LIST_ROWS = 80;

/** `code → display name` from the money namespace; unknown codes show the code. */
export function useCurrencyName(): (code: string) => string {
  const { t: tx } = useT('money');
  // `tx` changes identity with the language, so the name table follows it.
  return useMemo(() => {
    const names = tx('currencyNames', { returnObjects: true }) as unknown as Record<string, string> | null;
    return (code: string) => {
      const n = names && typeof names === 'object' ? names[code] : undefined;
      return typeof n === 'string' ? n : code;
    };
  }, [tx]);
}

export interface CurrencyPickerProps {
  value: string;
  onChange: (code: string) => void;
  /** Chip row codes (see suggestedCurrencies). `value` should be among them. */
  suggestions: readonly string[];
  /** Radiogroup label (also the visible overline when `showLabel`). */
  label: string;
  showLabel?: boolean;
  /** Marks this code with a "home" tag. */
  home?: string | null;
  /** Override display names (e.g. a screen with its own name keys). */
  nameOf?: (code: string) => string;
  /** Override the per-option screen-reader label. */
  optionA11y?: (code: string, name: string) => string;
  /** Test/SSR hook: skip the network list. */
  disableRemoteList?: boolean;
}

export function CurrencyPicker({
  value,
  onChange,
  suggestions,
  label,
  showLabel = false,
  home,
  nameOf,
  optionA11y,
  disableRemoteList = false,
}: CurrencyPickerProps) {
  const t = useTheme();
  const { t: tx } = useT('money');
  const defaultName = useCurrencyName();
  const name = nameOf ?? defaultName;
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const list = useFxCurrencies({ enabled: expanded && !disableRemoteList });

  const codes = useMemo(
    () => allCurrencyCodes(list.data?.currencies.map((c) => c.code)),
    [list.data],
  );
  const filtered = useMemo(() => filterCurrencies(codes, query, name), [codes, query, name]);
  const shown = filtered.slice(0, MAX_LIST_ROWS);
  const homeCode = home?.toUpperCase() ?? null;
  const a11yFor = (code: string): string =>
    optionA11y ? optionA11y(code, name(code)) : tx('currency.optionA11y', { code, name: name(code) });

  function pick(code: string) {
    onChange(code);
    setExpanded(false);
    setQuery('');
  }

  return (
    <View style={{ gap: t.spacing.sm }}>
      {showLabel ? (
        <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>{label}</Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        contentContainerStyle={{ gap: t.spacing.xs }}
        keyboardShouldPersistTaps="handled"
      >
        {suggestions.map((code) => (
          <ChoiceChip
            key={code}
            label={code === homeCode ? tx('currency.chipHome', { code }) : code}
            accessibilityLabel={
              code === homeCode
                ? tx('currency.optionHomeA11y', { code, name: name(code) })
                : a11yFor(code)
            }
            selected={value === code}
            onPress={() => pick(code)}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? tx('currency.lessA11y') : tx('currency.moreA11y')}
          accessibilityState={{ expanded }}
          onPress={() => {
            haptics.select();
            setExpanded((v) => !v);
          }}
          style={({ pressed }) => [
            styles.moreChip,
            {
              borderColor: t.colors.primary,
              borderRadius: t.radius.pill,
              paddingHorizontal: t.spacing.md,
              backgroundColor: pressed || expanded ? t.colors.gradientSubtle : 'transparent',
            },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
          ]}
        >
          <Text style={[t.typography.caption, { color: t.colors.primaryInk, fontWeight: '700' }]}>
            {expanded ? tx('currency.less') : tx('currency.more')}
          </Text>
        </Pressable>
      </ScrollView>

      {expanded ? (
        <View
          style={[
            styles.panel,
            {
              borderColor: t.colors.border,
              borderRadius: t.radius.md,
              backgroundColor: t.colors.bgElevated,
              padding: t.spacing.sm,
              gap: t.spacing.xs,
            },
          ]}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus={Platform.OS === 'web'}
            autoCorrect={false}
            autoCapitalize="none"
            placeholder={tx('currency.searchPlaceholder')}
            placeholderTextColor={t.colors.textMuted}
            accessibilityLabel={tx('currency.searchA11y')}
            style={[
              styles.search,
              t.typography.body,
              {
                color: t.colors.text,
                borderColor: t.colors.border,
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
                backgroundColor: t.colors.bg,
              },
            ]}
          />
          {list.isError || (!list.data && !list.isLoading && !disableRemoteList) ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{tx('currency.listOffline')}</Text>
          ) : null}
          <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {shown.length === 0 ? (
              <Text
                style={[t.typography.caption, { color: t.colors.textMuted, padding: t.spacing.sm }]}
                accessibilityLiveRegion="polite"
              >
                {tx('currency.noMatch', { query: query.trim() })}
              </Text>
            ) : (
              shown.map((code) => {
                const active = code === value;
                return (
                  <Pressable
                    key={code}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={a11yFor(code)}
                    onPress={() => {
                      haptics.select();
                      pick(code);
                    }}
                    style={({ pressed }) => [
                      styles.listRow,
                      {
                        borderRadius: t.radius.sm,
                        paddingHorizontal: t.spacing.sm,
                        gap: t.spacing.sm,
                        backgroundColor: active
                          ? t.colors.gradientSubtle
                          : pressed
                            ? t.colors.bgMuted
                            : 'transparent',
                      },
                      Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
                    ]}
                  >
                    <Text style={[t.typography.bodyStrong, styles.code, { color: t.colors.text }]}>{code}</Text>
                    <Text style={[t.typography.caption, styles.flex, { color: t.colors.textMuted }]} numberOfLines={1}>
                      {name(code) === code ? '' : name(code)}
                    </Text>
                    {code === homeCode ? (
                      <Text style={[t.typography.small, { color: t.colors.primaryInk, fontWeight: '700' }]}>
                        {tx('currency.homeTag')}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  moreChip: { borderWidth: 1.5, minHeight: 40, justifyContent: 'center', alignItems: 'center' },
  panel: { borderWidth: 1 },
  search: { borderWidth: 1, minHeight: 44 },
  list: { maxHeight: 240 },
  listRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  code: { width: 48 },
  flex: { flex: 1 },
});
