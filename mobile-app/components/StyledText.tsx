import { Text, TextProps } from './Themed';
import { fontFamilies } from '@/src/theme/typography';

export function MonoText(props: TextProps) {
  return <Text {...props} style={[props.style, { fontFamily: fontFamilies.mono }]} />;
}
