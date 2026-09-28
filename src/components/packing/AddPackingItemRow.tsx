/**
 * AddPackingItemRow — manual add form for the packing screen (v2 Phase P2.2).
 *
 * One TextField for the label plus an OPTIONAL category picker (chips for
 * the five canonical seed categories; tap the selected chip again to clear →
 * the item lands in "Other"). Submit hands a single `{ label, category }` up
 * to the parent, which runs the bulk-create hook with an array of one.
 *
 * On success the label clears but the category selection STAYS — adding
 * "Razor", "Floss", "Cotton pads" in a row shouldn't mean re-picking
 * "toiletries" three times. Errors render inline and are announced politely.
 */
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Button, TextField } from '@/components';
import { useTheme } from '@/theme';
import { PACKING_SEED_CATEGORIES } from '@/lib/packingSeed';
import { categoryTitle } from './groupPackingItems';

const MAX_LABEL_LENGTH = 120; // mirrors the trip_packing_items CHECK + zod bound

export interface AddPackingItemRowProps {
  /** Persists one item; rejection surfaces as the inline error. */
  onAdd: (input: { label: string; category: string | null }) => Promise<void>;
  /** True while the create mutation is in flight (disables double-submit). */
  pending: boolean;
}

export function AddPackingItemRow({ onAdd, pending }: AddPackingItemRowProps) {
  const t = useTheme();
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = label.trim();

  async function handleSubmit() {
    if (trimmed.length === 0 || pending) return;
    if (trimmed.length > MAX_LABEL_LENGTH) {
      setError(`Keep it under ${MAX_LABEL_LENGTH} characters.`);
      return;
    }
    setError(null);
    try {
      await onAdd({ label: trimmed, category });
      setLabel(''); // category intentionally kept — see module header
    } catch {
      setError("Couldn't add that item — try again.");
    }
  }

  return (
    <View style={{ gap: t.spacing.sm }}>
      <TextField
        label="Add an item"
        placeholder="e.g. Hiking boots"
        value={label}
        onChangeText={(v) => {
          setLabel(v);
          if (error) setError(null);
        }}
        onSubmitEditing={() => void handleSubmit()}
        returnKeyType="done"
        error={error}
      />

      {/* Optional category — single-select chip row, tap again to clear. */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Category (optional)"
        style={[styles.chipRow, { gap: t.spacing.xs }]}
      >
        {PACKING_SEED_CATEGORIES.map((cat) => {
          const selected = category === cat;
          return (
            <Pressable
              key={cat}
              accessibilityRole="radio"
              accessibilityLabel={`Category ${categoryTitle(cat)}${selected ? ', selected — tap to clear' : ''}`}
              accessibilityState={{ checked: selected }}
              onPress={() => setCategory(selected ? null : cat)}
              hitSlop={4}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: selected ? t.colors.primary : t.colors.border,
                  backgroundColor: selected ? t.colors.gradientSubtle : t.colors.bgElevated,
                  borderRadius: t.radius.pill,
                  opacity: pressed ? 0.6 : 1,
                },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
              ]}
            >
              <Text
                style={[
                  t.typography.small,
                  {
                    color: selected ? t.colors.primaryInk : t.colors.textMuted,
                    fontWeight: '600',
                  },
                ]}
              >
                {categoryTitle(cat)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Button
        label="Add to list"
        variant="secondary"
        onPress={() => void handleSubmit()}
        loading={pending}
        disabled={trimmed.length === 0 || pending}
        accessibilityLabel={
          trimmed.length === 0 ? 'Type an item label first' : `Add ${trimmed} to the packing list`
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  chip: {
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
