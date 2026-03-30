import React, { useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";

import SignatureCanvas from "@/src/components/SignatureCanvas";
import {
  getSignatureSession,
  updateSignatureSession,
} from "@/src/features/conformity/signature-session";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function CaseSignatureScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = normalizeParam(params.sessionId).trim();
  const session = useMemo(() => getSignatureSession(sessionId), [sessionId]);
  const [paths, setPaths] = useState<string[]>(() => session?.paths ?? []);

  const canvasHeight = Math.max(220, Math.min(height - 170, width - 110));

  const handleSave = () => {
    if (!sessionId) {
      router.back();
      return;
    }
    updateSignatureSession(sessionId, paths);
    router.back();
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.screenBg }]}>
      <Stack.Screen
        options={{
          title: "Firma",
          headerShown: false,
          presentation: "fullScreenModal",
          orientation: "landscape",
        }}
      />

      <View style={[styles.chrome, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.topRow}>
          <View style={styles.titleWrap}>
            <Text style={[styles.eyebrow, { color: palette.textMuted }]}>Conformidad</Text>
            <Text style={[styles.title, { color: palette.textPrimary }]}>Espacio de firma</Text>
            <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
              Usa toda la anchura del dispositivo para firmar con mas comodidad.
            </Text>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.secondaryButton,
                { backgroundColor: palette.secondaryButtonBg, borderColor: palette.border },
              ]}
              onPress={() => setPaths([])}
              accessibilityRole="button"
              accessibilityLabel="Limpiar firma"
            >
              <Text style={[styles.secondaryButtonText, { color: palette.secondaryButtonText }]}>
                Limpiar
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.secondaryButton,
                { backgroundColor: palette.secondaryButtonBg, borderColor: palette.border },
              ]}
              onPress={handleCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancelar firma"
            >
              <Text style={[styles.secondaryButtonText, { color: palette.secondaryButtonText }]}>
                Cancelar
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.primaryButton,
                { backgroundColor: palette.primaryButtonBg, borderColor: palette.primaryButtonBg },
              ]}
              onPress={handleSave}
              accessibilityRole="button"
              accessibilityLabel="Guardar firma"
            >
              <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
                Guardar firma
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <SignatureCanvas
          paths={paths}
          onChange={setPaths}
          height={canvasHeight}
          borderColor={palette.border}
          backgroundColor={palette.surface}
          strokeColor={palette.accent}
          hintColor={palette.textMuted}
          hint="Firma dentro del recuadro. Al guardar vuelves a la conformidad."
        />

        <View style={styles.footerRow}>
          <Text style={[styles.footerText, { color: palette.textSecondary }]}>
            {paths.length
              ? "Firma lista para usarse en el PDF."
              : "Todavia no hay trazos guardados."}
          </Text>
          <Text style={[styles.footerText, { color: palette.textMuted }]}>
            La orientacion vuelve a normal al salir.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 18,
  },
  chrome: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 28,
    padding: 18,
    gap: 14,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 18,
    alignItems: "flex-start",
  },
  titleWrap: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    fontSize: 11.5,
    lineHeight: 15,
    letterSpacing: 0.7,
    textTransform: "uppercase",
    fontFamily: fontFamilies.semibold,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: fontFamilies.bold,
  },
  subtitle: {
    fontSize: 13.5,
    lineHeight: 18,
    fontFamily: fontFamilies.regular,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  actionButton: {
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    minWidth: 150,
  },
  secondaryButton: {
    minWidth: 112,
  },
  primaryButtonText: {
    fontSize: 14,
    fontFamily: fontFamilies.bold,
  },
  secondaryButtonText: {
    fontSize: 13.5,
    fontFamily: fontFamilies.semibold,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  footerText: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: fontFamilies.regular,
  },
});
