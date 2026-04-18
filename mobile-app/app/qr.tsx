import React, { useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import QuickActionCard from "@/src/components/QuickActionCard";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

export default function QrHubScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const activeMode = useMemo(() => {
    const raw = Array.isArray(params.mode) ? params.mode[0] : params.mode;
    return String(raw || "scan").trim().toLowerCase() === "generate" ? "generate" : "scan";
  }, [params.mode]);

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <ScreenHero
        eyebrow="QR"
        title="Centro QR"
        description="Escanear es el camino principal en campo. Generar queda disponible cuando necesitas crear o reimprimir etiquetas."
        aside={
          <View
            style={[
              styles.heroBadge,
              { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
            ]}
          >
            <Text style={[styles.heroBadgeText, { color: palette.heroEyebrowText }]}>
              {activeMode === "scan" ? "escaneo" : "generacion"}
            </Text>
          </View>
        }
      />

      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[
            styles.modeButton,
            {
              backgroundColor:
                activeMode === "scan" ? palette.primaryButtonBg : palette.refreshBg,
              borderColor:
                activeMode === "scan" ? palette.primaryButtonBg : palette.inputBorder,
            },
          ]}
          onPress={() => router.replace("/qr?mode=scan")}
        >
          <Text
            style={[
              styles.modeButtonText,
              {
                color:
                  activeMode === "scan" ? palette.primaryButtonText : palette.refreshText,
              },
            ]}
          >
            Escanear
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.modeButton,
            {
              backgroundColor:
                activeMode === "generate" ? palette.primaryButtonBg : palette.refreshBg,
              borderColor:
                activeMode === "generate" ? palette.primaryButtonBg : palette.inputBorder,
            },
          ]}
          onPress={() => router.replace("/qr?mode=generate")}
        >
          <Text
            style={[
              styles.modeButtonText,
              {
                color:
                  activeMode === "generate" ? palette.primaryButtonText : palette.refreshText,
              },
            ]}
          >
            Generar
          </Text>
        </TouchableOpacity>
      </View>

      {activeMode === "scan" ? (
        <>
          <SectionCard
            title="Launch deck"
            description="Escanear deja de ser una opcion mas: es la puerta principal al trabajo en campo."
          >
            <View
              style={[
                styles.launchDeck,
                {
                  backgroundColor: palette.heroBg,
                  borderColor: palette.heroBorder,
                  shadowColor: palette.shadowColor,
                },
              ]}
            >
              <Text style={[styles.launchEyebrow, { color: palette.heroEyebrowText }]}>
                Modo campo
              </Text>
              <Text style={[styles.launchTitle, { color: palette.textPrimary }]}>
                Escanea, resuelve contexto y entra directo al siguiente paso.
              </Text>
              <Text style={[styles.body, { color: palette.textSecondary }]}>
                Instalacion, equipo o codigo manual: todo cae en un mismo flujo y evita pantallas muertas.
              </Text>
              <TouchableOpacity
                style={[styles.launchPrimaryButton, { backgroundColor: palette.primaryButtonBg }]}
                onPress={() => router.push("/scan")}
              >
                <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
                  Abrir camara
                </Text>
              </TouchableOpacity>
              <View style={styles.launchUtilityRow}>
                <TouchableOpacity
                  style={[
                    styles.launchSecondaryButton,
                    { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                  ]}
                  onPress={() => router.push("/scan")}
                >
                  <Text style={[styles.launchSecondaryText, { color: palette.refreshText }]}>
                    Fallback manual
                  </Text>
                </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.launchSecondaryButton,
                  { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                ]}
                onPress={() => router.push("/case/context" as never)}
              >
                <Text style={[styles.launchSecondaryText, { color: palette.refreshText }]}>
                    Caso manual
                </Text>
              </TouchableOpacity>
              </View>
            </View>
          </SectionCard>

          <SectionCard
            title="Despues del escaneo"
            description="Tres destinos claros para que el usuario siempre sepa que va a pasar."
          >
            <View style={styles.flowSteps}>
              {[
                ["1", "Contexto", "Resuelve el caso correcto antes de abrir una incidencia."],
                ["2", "Caso", "Entra al backlog del caso o abre una incidencia nueva sin mezclar tareas."],
                ["3", "Manual", "Si no hay lectura, inicia un caso manual y sigue operando."],
              ].map(([step, title, body]) => (
                <View
                  key={step}
                  style={[
                    styles.flowStep,
                    { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
                  ]}
                >
                  <View
                    style={[
                      styles.flowBadge,
                      { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
                    ]}
                  >
                    <Text style={[styles.flowBadgeText, { color: palette.heroEyebrowText }]}>
                      {step}
                    </Text>
                  </View>
                  <View style={styles.flowText}>
                    <Text style={[styles.flowTitle, { color: palette.textPrimary }]}>{title}</Text>
                    <Text style={[styles.flowBody, { color: palette.textSecondary }]}>{body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </SectionCard>

          <View style={styles.quickActionGrid}>
            <QuickActionCard
              title="Iniciar trabajo"
              body="Resuelve contexto primero y recien despues entras a la incidencia nueva."
              actionLabel="Ir a escanear"
              onPress={() => router.push("/scan")}
              tone="primary"
            />
            <QuickActionCard
              title="Asociar equipo"
              body="Escanea un activo y decide desde ahi si lo vinculas o si abres su detalle."
              actionLabel="Resolver equipo"
              onPress={() => router.push("/scan")}
            />
          </View>
        </>
      ) : (
        <>
          <SectionCard
            title="Mesa de impresion"
            description="Generacion mas sobria y secundaria: sigue disponible, pero ya no compite con el escaneo."
          >
            <View
              style={[
                styles.launchDeck,
                {
                  backgroundColor: palette.cardBg,
                  borderColor: palette.cardBorder,
                  shadowColor: palette.shadowColor,
                },
              ]}
            >
              <Text style={[styles.launchEyebrow, { color: palette.heroEyebrowText }]}>
                Etiquetas
              </Text>
              <Text style={[styles.launchTitle, { color: palette.textPrimary }]}>
                Prepara un QR nuevo o reimprime uno existente sin perder consistencia con web.
              </Text>
              <Text style={[styles.body, { color: palette.textSecondary }]}>
                Ideal para inventario, alta de equipos y reposicion de etiquetas de campo.
              </Text>
              <TouchableOpacity
                style={[styles.launchPrimaryButton, { backgroundColor: palette.primaryButtonBg }]}
                onPress={() => router.push("/qr-generator" as never)}
              >
                <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
                  Abrir generador QR
                </Text>
              </TouchableOpacity>
            </View>
          </SectionCard>

          <View style={styles.quickActionGrid}>
            <QuickActionCard
              title="Nuevo equipo + QR"
              body="Carga datos del activo y exporta la etiqueta lista para imprimir."
              actionLabel="Crear QR"
              onPress={() => router.push("/qr-generator" as never)}
              tone="primary"
            />
            <QuickActionCard
              title="Reimprimir"
              body="Abre el generador con datos prellenados desde inventario cuando entres desde Equipos."
              actionLabel="Abrir generador"
              onPress={() => router.push("/qr-generator" as never)}
            />
          </View>
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.s20,
    gap: spacing.s12,
  },
  heroBadge: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s7,
  },
  heroBadgeText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.s10,
  },
  modeButton: {
    flex: 1,
    minHeight: sizing.touchTargetMin,
    borderWidth: 1,
    borderRadius: radii.r14,
    alignItems: "center",
    justifyContent: "center",
  },
  modeButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  body: {
    fontFamily: fontFamilies.regular,
    fontSize: 13.5,
    lineHeight: 19,
  },
  launchDeck: {
    borderWidth: 1,
    borderRadius: 24,
    padding: spacing.s16,
    gap: spacing.s12,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  launchEyebrow: {
    fontFamily: fontFamilies.semibold,
    fontSize: 11.5,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  launchTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 19,
    lineHeight: 25,
  },
  primaryButton: {
    minHeight: sizing.touchTargetMin,
    borderRadius: radii.r14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s12,
  },
  launchPrimaryButton: {
    minHeight: 52,
    borderRadius: radii.r18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s12,
  },
  launchUtilityRow: {
    flexDirection: "row",
    gap: spacing.s10,
  },
  launchSecondaryButton: {
    flex: 1,
    minHeight: sizing.touchTargetMin,
    borderRadius: radii.r16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.s10,
  },
  launchSecondaryText: {
    fontFamily: fontFamilies.bold,
    fontSize: 13,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  flowSteps: {
    gap: spacing.s10,
  },
  flowStep: {
    flexDirection: "row",
    gap: spacing.s12,
    borderWidth: 1,
    borderRadius: radii.r18,
    padding: spacing.s12,
  },
  flowBadge: {
    width: 34,
    height: 34,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  flowBadgeText: {
    fontFamily: fontFamilies.bold,
    fontSize: 13,
  },
  flowText: {
    flex: 1,
    gap: spacing.s2,
  },
  flowTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 14.5,
  },
  flowBody: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
  quickActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s10,
  },
});
