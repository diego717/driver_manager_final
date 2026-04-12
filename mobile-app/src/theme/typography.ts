import { Platform, Text, TextInput } from "react-native";

export const fontFamilies = {
  regular: "SourceSans3_400Regular",
  medium: "SourceSans3_500Medium",
  semibold: "IBMPlexSansCondensed_600SemiBold",
  bold: "IBMPlexSansCondensed_600SemiBold",
  mono: "IBMPlexMono_400Regular",
  display: "IBMPlexSansCondensed_600SemiBold",
} as const;

export const inputFontFamily =
  Platform.OS === "android" ? "sans-serif" : fontFamilies.regular;
export const textInputAccentColor = "#0ba6a6";

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
