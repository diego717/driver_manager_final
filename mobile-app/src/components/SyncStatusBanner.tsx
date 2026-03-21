import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useSyncState } from "@/src/hooks/useSyncState";
import { runSync } from "@/src/services/sync/sync-runner";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

function formatLastSync(value: number | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function SyncStatusBanner() {
  const palette = useAppPalette();
  const { isSyncing, pendingCount, lastError, lastSyncAt } = useSyncState();

  const content = useMemo(() => {
    if (lastError) {
      return {
        tone: "error" as const,
        title: "Sincronizacion con error",
        body:
          pendingCount > 0
            ? `${pendingCount} pendientes. ${lastError}`
            : lastError,
      };
    }

    if (isSyncing) {
      return {
        tone: "info" as const,
        title: "Sincronizando",
        body:
          pendingCount > 0
            ? `${pendingCount} pendientes en proceso.`
            : "Procesando cola local.",
      };
    }

    if (pendingCount > 0) {
      return {
        tone: "warning" as const,
        title: "Pendiente de sincronizar",
        body: `${pendingCount} elemento${pendingCount === 1 ? "" : "s"} guardado${pendingCount === 1 ? "" : "s"} en el dispositivo.`,
      };
    }

    if (lastSyncAt) {
      return {
        tone: "success" as const,
        title: "Sincronizado",
        body: `Ultima sincronizacion a las ${formatLastSync(lastSyncAt)}.`,
      };
    }

    return null;
  }, [isSyncing, lastError, lastSyncAt, pendingCount]);

  const colors = useMemo(() => {
    if (!content) return null;
    if (content.tone === "error") {
      return {
        backgroundColor: palette.errorBg,
        borderColor: palette.errorBorder,
        titleColor: palette.errorText,
        bodyColor: palette.errorText,
        chipBg: palette.errorBorder,
        chipText: "#ffffff",
      };
    }
    if (content.tone === "warning") {
      return {
        backgroundColor: palette.warningBg,
        borderColor: palette.warningText,
        titleColor: palette.warningText,
        bodyColor: palette.warningText,
        chipBg: palette.warningText,
        chipText: "#ffffff",
      };
    }
    if (content.tone === "success") {
      return {
        backgroundColor: palette.successBg,
        borderColor: palette.successBorder,
        titleColor: palette.successText,
        bodyColor: palette.successText,
        chipBg: palette.successBorder,
        chipText: "#ffffff",
      };
    }
    return {
      backgroundColor: palette.infoBg,
      borderColor: palette.infoBorder,
      titleColor: palette.infoText,
      bodyColor: palette.infoText,
      chipBg: palette.infoBorder,
      chipText: "#ffffff",
    };
  }, [content, palette]);

  if (!content || !colors) return null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
        },
      ]}
      accessible
      accessibilityLabel={`${content.title}. ${content.body}`}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.titleColor }]}>{content.title}</Text>
        {pendingCount > 0 ? (
          <View style={[styles.countChip, { backgroundColor: colors.chipBg }]}>
            <Text style={[styles.countChipText, { color: colors.chipText }]}>
              {pendingCount}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.body, { color: colors.bodyColor }]}>{content.body}</Text>
      {pendingCount > 0 || lastError ? (
        <TouchableOpacity
          style={[
            styles.actionButton,
            {
              backgroundColor: colors.chipBg,
            },
          ]}
          onPress={() => {
            runSync({ force: true });
          }}
          disabled={isSyncing}
          accessibilityRole="button"
          accessibilityLabel="Sincronizar ahora"
          accessibilityState={{ disabled: isSyncing, busy: isSyncing }}
        >
          <Text style={[styles.actionButtonText, { color: colors.chipText }]}>
            {isSyncing ? "Sincronizando..." : "Sincronizar ahora"}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  title: {
    flex: 1,
    fontFamily: fontFamilies.bold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  body: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
  countChip: {
    minWidth: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
  },
  countChipText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    lineHeight: 13,
  },
  actionButton: {
    alignSelf: "flex-start",
    minHeight: 38,
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12.5,
    lineHeight: 16,
  },
});
