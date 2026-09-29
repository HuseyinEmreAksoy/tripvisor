import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '@/theme';
import { formatDate, toDate, useT } from '@/i18n';

interface Props {
  label: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  error?: string | null;
}

/**
 * Local-calendar `YYYY-MM-DD`. Never use `toISOString()` here: the native picker
 * works in local time, so a UTC conversion shifts the day east/west of Greenwich.
 */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DateField({ label, value, onChange, error }: Props) {
  const t = useTheme();
  const { t: tx } = useT();
  const [show, setShow] = useState(false);

  // `toDate` parses YYYY-MM-DD as LOCAL midnight (not UTC like `new Date(value)`).
  const date = toDate(value) ?? new Date();

  function handleChange(_e: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS !== 'ios') setShow(false);
    if (selected) onChange(toLocalIsoDate(selected));
  }

  return (
    <View style={{ alignSelf: 'stretch' }}>
      {/* Y2.4: same overline label as TextField, so mixed forms read as one. */}
      <Text style={[t.typography.overline, { color: t.colors.textMuted, marginBottom: 8 }]}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setShow((s) => !s)}
        style={[
          styles.field,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: error ? t.colors.danger : t.colors.border,
            borderRadius: t.radius.md,
            paddingHorizontal: t.spacing.md,
          },
        ]}
      >
        <Text style={[t.typography.body, { color: value ? t.colors.text : t.colors.textMuted }]}>
          {value ? formatDate(value, 'medium') : tx('actions.selectDate')}
        </Text>
      </Pressable>

      {show && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          // iOS spinner renders inline on our surface: follow the app theme, not the OS.
          themeVariant={t.name === 'dark' ? 'dark' : 'light'}
          textColor={String(t.colors.text)}
          onChange={handleChange}
        />
      )}

      {show && Platform.OS === 'ios' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tx('actions.done')}
          onPress={() => setShow(false)}
          style={styles.done}
          hitSlop={8}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.primaryInk }]}>
            {tx('actions.done')}
          </Text>
        </Pressable>
      ) : null}

      {error ? (
        <Text style={[t.typography.small, { color: t.colors.danger, marginTop: 4 }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { height: 48, borderWidth: 1, justifyContent: 'center' },
  done: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4 },
});
