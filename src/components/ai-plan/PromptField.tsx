/**
 * PromptField — multiline labelled text area for the AI trip prompt.
 *
 * Exists because the shared `TextField` hard-codes a 50px single-line input
 * (its `style` prop is intentionally sealed). This mirrors TextField's visual
 * language — caption label, focus ring, danger border, hint/error slot — and
 * adds multiline sizing plus a live character counter.
 *
 * Usage:
 *   <PromptField label="Describe your trip" value={v} onChangeText={set}
 *                maxLength={2000} error={err} />
 */
import { useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/theme';
import { Icon } from '@/components/Icon';

export interface PromptFieldProps
  extends Pick<TextInputProps, 'value' | 'onChangeText' | 'onBlur' | 'placeholder' | 'maxLength'> {
  label: string;
  error?: string | null;
  hint?: string;
  /** Visible height of the text area. */
  minHeight?: number;
}

export function PromptField({
  label,
  error,
  hint,
  minHeight = 132,
  value,
  onChangeText,
  onBlur,
  placeholder,
  maxLength,
}: PromptFieldProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? t.colors.danger : focused ? t.colors.primary : t.colors.border;

  return (
    <View style={styles.wrapper}>
      <Text
        style={[
          t.typography.caption,
          {
            color: focused ? t.colors.primaryInk : t.colors.textMuted,
            marginBottom: 6,
            fontWeight: '600',
            letterSpacing: 0.3,
          },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          {
            borderColor,
            borderRadius: t.radius.lg,
            backgroundColor: t.colors.bgElevated,
            overflow: 'hidden',
            ...t.shadows.sm(t.colors.shadowColor),
            ...(focused
              ? { borderWidth: 2, ...t.shadows.glow(t.colors.glowPrimary) }
              : { borderWidth: 1.5 }),
          },
          Platform.OS === 'web' &&
            ({ transition: 'border-color 0.2s ease, box-shadow 0.2s ease' } as ViewStyle),
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          multiline
          textAlignVertical="top"
          placeholder={placeholder}
          placeholderTextColor={t.colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          maxLength={maxLength}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            t.typography.body,
            {
              color: t.colors.text,
              minHeight,
              paddingHorizontal: t.spacing.lg,
              paddingTop: t.spacing.md,
              paddingBottom: t.spacing.md,
            },
          ]}
        />
      </View>
      <View style={styles.footer}>
        <View style={styles.message}>
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
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>{hint}</Text>
          ) : null}
        </View>
        {maxLength ? (
          <Text
            style={[t.typography.small, { color: t.colors.textMuted }]}
            accessibilityLabel={`${(value ?? '').length} of ${maxLength} characters used`}
          >
            {(value ?? '').length} / {maxLength}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignSelf: 'stretch' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  errorText: { flexShrink: 1 },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 6,
  },
  message: { flex: 1 },
});
