import React, { useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import ConsoleButton from "@/src/components/ConsoleButton";
import SignatureCanvas from "@/src/components/SignatureCanvas";
import {
  getSignatureSession,
  updateSignatureSession,
} from "@/src/features/conformity/signature-session";
import { triggerSuccessHaptic } from "@/src/services/haptics";
import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";

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
    if (paths.length) {
      void triggerSuccessHaptic();
    }
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
            <ConsoleButton
              variant="subtle"
              style={[styles.actionButton, styles.secondaryButton]}
              onPress={() => setPaths([])}
              accessibilityLabel="Limpiar firma"
              label="Limpiar"
              textStyle={styles.secondaryButtonText}
            />
            <ConsoleButton
              variant="subtle"
              style={[styles.actionButton, styles.secondaryButton]}
              onPress={handleCancel}
              accessibilityLabel="Cancelar firma"
              label="Cancelar"
              textStyle={styles.secondaryButtonText}
            />
            <ConsoleButton
              variant="primary"
              style={[styles.actionButton, styles.primaryButton]}
              onPress={handleSave}
              accessibilityLabel="Guardar firma"
              label="Guardar firma"
              textStyle={styles.primaryButtonText}
            />
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
    padding: spacing.s18,
  },
  chrome: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radii.r16,
    padding: spacing.s18,
    gap: spacing.s14,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.s18,
    alignItems: "flex-start",
  },
  titleWrap: {
    flex: 1,
    gap: spacing.s4,
  },
  eyebrow: {
    ...typeScale.buttonMonoTight,
    letterSpacing: 0.7,
    textTransform: "uppercase",
    fontFamily: fontFamilies.mono,
  },
  title: {
    fontFamily: fontFamilies.display,
    ...typeScale.sectionDisplay,
    fontSize: 24,
    lineHeight: 24,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  subtitle: {
    ...typeScale.bodyCompact,
    fontFamily: fontFamilies.regular,
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.s10,
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  actionButton: {
    minHeight: sizing.touchTargetMin + spacing.s2,
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s16,
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
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.s12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  footerText: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: fontFamilies.regular,
  },
});
