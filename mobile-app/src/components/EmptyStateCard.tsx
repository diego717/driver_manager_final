import React, { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

type EmptyStateCardProps = {
  title: string;
  body: string;
  action?: ReactNode;
};

export default function EmptyStateCard(props: EmptyStateCardProps) {
  const { title, body, action } = props;
  const palette = useAppPalette();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: palette.surfaceAlt,
          borderColor: palette.cardBorder,
        },
      ]}
    >
      <View
        style={[
          styles.badge,
          {
            backgroundColor: palette.heroEyebrowBg,
            borderColor: palette.heroBorder,
          },
        ]}
      >
        <Text style={[styles.badgeText, { color: palette.heroEyebrowText }]}>Sin datos</Text>
      </View>
      <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>
      <Text style={[styles.body, { color: palette.textSecondary }]}>{body}</Text>
      {action ? <View style={styles.actionWrap}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  badge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
    lineHeight: 20,
  },
  body: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  actionWrap: {
    marginTop: 2,
  },
});
