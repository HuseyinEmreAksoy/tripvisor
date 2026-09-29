import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '@/theme';

interface Props {
  label: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  error?: string | null;
}

export function DateField({ label, value, onChange, error }: Props) {
  const t = useTheme();
  const [show, setShow] = useState(false);

  const date = value ? new Date(value) : new Date();

  function handleChange(_e: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS !== 'ios') setShow(false);
    if (selected) {
      const iso = selected.toISOString().slice(0, 10);
      onChange(iso);
    }
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
        onPress={() => setShow(true)}
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
          {value ?? 'Select date'}
        </Text>
      </Pressable>

      {show && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleChange}
        />
      )}

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
});
