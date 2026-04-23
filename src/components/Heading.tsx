import { Platform, Text, type TextProps } from 'react-native';
import { useTheme } from '@/theme';

type Level = 1 | 2 | 3;
const variants = { 1: 'display', 2: 'title', 3: 'subtitle' } as const;

interface HeadingProps extends Omit<TextProps, 'style'> {
  level?: Level;
  children: React.ReactNode;
}

export function Heading({ level = 1, children, ...rest }: HeadingProps) {
  const t = useTheme();
  const variant = variants[level];
  const webProps =
    Platform.OS === 'web' ? { role: 'heading', 'aria-level': level } : {};
  return (
    <Text
      accessibilityRole="header"
      {...(webProps as object)}
      style={[t.typography[variant], { color: t.colors.text }]}
      {...rest}
    >
      {children}
    </Text>
  );
}
