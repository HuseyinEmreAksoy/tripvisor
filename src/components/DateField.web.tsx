import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

interface Props {
  label: string;
  value: string | null;
  onChange: (iso: string | null) => void;
  error?: string | null;
}

export function DateField({ label, value, onChange, error }: Props) {
  const t = useTheme();
  return (
    <View style={{ alignSelf: 'stretch' }}>
      {/* Y2.4: same overline label as TextField, so mixed forms read as one. */}
      <Text style={[t.typography.overline, { color: t.colors.textMuted, marginBottom: 8 }]}>
        {label}
      </Text>
      <View
        style={[
          styles.field,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: error ? t.colors.danger : t.colors.border,
            borderRadius: t.radius.md,
          },
        ]}
      >
        {/* @ts-expect-error — HTML <input> works via react-native-web */}
        <input
          type="date"
          aria-label={label}
          value={value ?? ''}
          onChange={(e: { target: { value: string } }) => onChange(e.target.value || null)}
          style={{
            flex: 1,
            height: 46,
            paddingInline: t.spacing.md,
            border: 'none',
            background: 'transparent',
            color: String(t.colors.text),
            fontSize: 16,
            outline: 'none',
          }}
        />
      </View>
      {error ? (
        <Text style={[t.typography.small, { color: t.colors.danger, marginTop: 4 }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { borderWidth: 1, height: 48, justifyContent: 'center' },
});
