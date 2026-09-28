/**
 * CsvImportButton (web) — Google Takeout saved-places CSV picker
 * (v2 Phase N4 step 4.3, web-only extra).
 *
 * A hidden HTML `<input type="file">` (the DateField.web.tsx interop pattern
 * — react-native-web renders DOM elements directly; zero new dependencies)
 * triggered by a styled pressable. The chosen file is read client-side, its
 * `Title` column extracted via parseTakeoutCsvTitles, and the names are
 * handed UP to the import sheet's textarea — the user still reviews and
 * presses Import themselves (nothing fires on file pick alone).
 *
 * Native renders the base CsvImportButton.tsx, which is empty.
 */
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { Icon } from '@/components/Icon';
import { parseTakeoutCsvTitles } from '@/lib/importParse';

export interface CsvImportButtonProps {
  /** Receives the Title-column values parsed from the chosen CSV. */
  onNames: (names: string[]) => void;
  /** Receives a human-readable parse/read failure message. */
  onError: (message: string) => void;
  disabled?: boolean;
}

export function CsvImportButton({ onNames, onError, disabled }: CsvImportButtonProps) {
  const t = useTheme();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const titles = parseTakeoutCsvTitles(text);
      if (titles.length === 0) {
        onError(
          'No "Title" column found — export your saved places from Google Takeout as CSV and try again.',
        );
        return;
      }
      onNames(titles);
    } catch {
      onError("Couldn't read that file — try exporting the CSV again.");
    }
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Upload a CSV file of saved places from Google Takeout"
        disabled={disabled}
        onPress={() => inputRef.current?.click()}
        style={({ pressed }) => [
          styles.pill,
          {
            borderColor: t.colors.border,
            backgroundColor: t.colors.bgElevated,
            borderRadius: t.radius.pill,
            paddingHorizontal: t.spacing.md,
            opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
            cursor: disabled ? 'default' : 'pointer',
          } as ViewStyle,
        ]}
      >
        <View style={styles.pillContent}>
          <Icon name="file-text" size={16} color={t.colors.textMuted} />
          <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '600' }]}>
            Upload .csv (Google Takeout)
          </Text>
        </View>
      </Pressable>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        aria-hidden
        tabIndex={-1}
        onChange={(e: { target: { files?: ArrayLike<File> | null; value: string } }) => {
          const file = e.target.files?.[0];
          // Reset so re-picking the same file fires onChange again.
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start' },
  pillContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: {
    minHeight: 44,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
