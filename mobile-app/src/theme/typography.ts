import { Platform, Text, TextInput } from "react-native";

export const fontFamilies = {
  regular: "SourceSans3_400Regular",
  medium: "SourceSans3_500Medium",
  semibold: "IBMPlexSansCondensed_600SemiBold",
  bold: "IBMPlexSansCondensed_600SemiBold",
  mono: "IBMPlexMono_400Regular",
  display: "BebasNeue_400Regular",
} as const;

export const typeScale = {
  heroDisplay: {
    fontSize: 46,
    lineHeight: 42,
    letterSpacing: 0.85,
  },
  sectionDisplay: {
    fontSize: 28,
    lineHeight: 27,
    letterSpacing: 0.75,
  },
  actionDisplay: {
    fontSize: 32,
    lineHeight: 29,
    letterSpacing: 0.75,
  },
  titleStrong: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.1,
  },
  body: {
    fontSize: 13.5,
    lineHeight: 19,
  },
  bodyCompact: {
    fontSize: 13,
    lineHeight: 18,
  },
  metaMono: {
    fontSize: 11.5,
    lineHeight: 18,
    letterSpacing: 1,
  },
  buttonMono: {
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: 0.7,
  },
  buttonMonoTight: {
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 0.8,
  },
} as const;

export const inputFontFamily =
  Platform.OS === "android" ? "sans-serif" : fontFamilies.regular;
export const textInputAccentColor = "#9af2bd";

let defaultsApplied = false;

function withDefaultFont(
  style: unknown,
  fontFamily: string,
): Array<Record<string, string> | unknown> {
  if (Array.isArray(style)) {
    return [{ fontFamily }, ...style];
  }
  if (style) {
    return [{ fontFamily }, style];
  }
  return [{ fontFamily }];
}

export function applyGlobalTypographyDefaults(): void {
  if (defaultsApplied) return;

  const textComponent = Text as unknown as { defaultProps?: { style?: unknown } };
  textComponent.defaultProps = textComponent.defaultProps ?? {};
  textComponent.defaultProps.style = withDefaultFont(
    textComponent.defaultProps.style,
    fontFamilies.regular,
  );

  const inputComponent = TextInput as unknown as {
    defaultProps?: {
      style?: unknown;
      selectionColor?: string;
      cursorColor?: string;
      underlineColorAndroid?: string;
    };
  };
  inputComponent.defaultProps = inputComponent.defaultProps ?? {};
  inputComponent.defaultProps.style = withDefaultFont(
    inputComponent.defaultProps.style,
    inputFontFamily,
  );
  inputComponent.defaultProps.selectionColor = textInputAccentColor;
  inputComponent.defaultProps.cursorColor = textInputAccentColor;
  inputComponent.defaultProps.underlineColorAndroid = "transparent";

  defaultsApplied = true;
}
