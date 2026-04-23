import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, ...rest },
  ref,
) {
  const t = useTheme();
  return (
    <View style={styles.wrapper}>
      <Text style={[t.typography.caption, { color: t.colors.textMuted, marginBottom: 4 }]}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={t.colors.textMuted}
        style={[
          t.typography.body,
          styles.input,
          {
            color: t.colors.text,
            backgroundColor: t.colors.bgElevated,
            borderColor: error ? t.colors.danger : t.colors.border,
            borderRadius: t.radius.md,
            paddingHorizontal: t.spacing.md,
          },
        ]}
        {...rest}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[t.typography.small, { color: t.colors.danger, marginTop: 4 }]}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text style={[t.typography.small, { color: t.colors.textMuted, marginTop: 4 }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { alignSelf: 'stretch' },
  input: { height: 48, borderWidth: 1 },
});
