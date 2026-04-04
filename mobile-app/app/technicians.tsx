import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text } from "react-native";

import { extractApiError } from "@/src/api/client";
import { readStoredWebSession } from "@/src/api/webAuth";
import { canManageTechnicians as canManageTechnicianDirectory } from "@/src/auth/roles";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import TechnicianDirectoryCard from "@/src/components/TechnicianDirectoryCard";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

export default function TechniciansScreen() {
  const router = useRouter();
  const palette = useAppPalette();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();
  const [loadingRole, setLoadingRole] = useState(false);
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const canManage = canManageTechnicianDirectory(sessionRole);

  const loadRole = useCallback(async () => {
    if (!hasActiveSession) {
      setSessionRole(null);
      return;
    }
    try {
      setLoadingRole(true);
      const session = await readStoredWebSession();
      setSessionRole(session.role);
    } catch (error) {
      console.warn(`[technicians] ${extractApiError(error)}`);
      setSessionRole(null);
    } finally {
      setLoadingRole(false);
    }
  }, [hasActiveSession]);

  useFocusEffect(
    useCallback(() => {
      void loadRole();
    }, [loadRole]),
  );

  if (checkingSession || loadingRole) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.helperText, { color: palette.textSecondary }]}>
          Cargando staff tecnico...
        </Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para administrar tecnicos del tenant."
          onLoginSuccess={async () => {
            await loadRole();
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <ScreenHero
        eyebrow="Tecnicos"
        title="Directorio operativo"
        description="Administra el staff tecnico, sus datos base y el vinculo con usuarios web desde mobile."
      >
        <Text style={[styles.helperText, { color: palette.textSecondary }]}>
          {canManage ? "Gestion completa habilitada" : "Acceso restringido a administradores"}
        </Text>
      </ScreenHero>

      {canManage ? (
        <TechnicianDirectoryCard enabled />
      ) : (
        <Text style={[styles.restrictedText, { color: palette.textMuted }]}>
          Solo `admin` o plataforma pueden gestionar tecnicos desde esta vista.
        </Text>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 12,
  },
  centerContainer: {
    padding: 20,
    gap: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  helperText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  restrictedText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
});
