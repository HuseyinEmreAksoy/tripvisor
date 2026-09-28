/**
 * TextField — v2 "Tide & Terracotta" primitive.
 *
 * Muted uppercase overline label (the v2 section-kicker language), soft
 * rounded field on an elevated surface, teal focus ring, inline error/hint
 * slot announced politely to screen readers.
 */
import { forwardRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { Icon } from './Icon';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, onFocus, onBlur, ...rest },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? t.colors.danger
    : focused
      ? t.colors.primary
      : t.colors.border;

  return (
    <View style={styles.wrapper}>
      <Text
        style={[
          t.typography.overline,
          {
            color: focused ? t.colors.primaryInk : t.colors.textMuted,
            marginBottom: 8,
          },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.inputContainer,
          {
            borderColor,
            borderRadius: t.radius.lg,
            backgroundColor: t.colors.bgElevated,
            ...t.shadows.sm(t.colors.shadowColor),
            ...(focused
              ? {
                borderWidth: 2,
                ...t.shadows.glow(t.colors.glowPrimary),
              }
              : { borderWidth: 1.5 }),
          },
          Platform.OS === 'web' && ({
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          } as ViewStyle),
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={t.colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            t.typography.body,
            styles.input,
            {
              color: t.colors.text,
              paddingHorizontal: t.spacing.lg,
            },
          ]}
          {...rest}
        />
      </View>
      {error ? (
        <View style={styles.errorRow}>
          <Icon name="alert-triangle" size={13} color={t.colors.danger} />
          <Text
            accessibilityLiveRegion="polite"
            style={[t.typography.small, styles.errorText, { color: t.colors.danger, fontWeight: '500' }]}
          >
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text style={[t.typography.small, { color: t.colors.textMuted, marginTop: 6 }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { alignSelf: 'stretch' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  errorText: { flexShrink: 1 },
  inputContainer: {
    overflow: 'hidden',
  },
  input: {
    height: 52,
  },
});
