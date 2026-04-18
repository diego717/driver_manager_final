import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { radii, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

type GuidedFlowRailStep = {
  title: string;
  detail: string;
  state?: "idle" | "active" | "done";
};

type GuidedFlowRailProps = {
  steps: GuidedFlowRailStep[];
};

export default function GuidedFlowRail({ steps }: GuidedFlowRailProps) {
  const palette = useAppPalette();

  return (
    <View style={styles.rail}>
      {steps.map((step, index) => {
        const state = step.state || "idle";
        const isActive = state === "active";
        const isDone = state === "done";
        return (
          <View
            key={`${step.title}-${index}`}
            style={[
              styles.stepCard,
              {
                backgroundColor: isActive ? palette.heroBg : palette.cardBg,
                borderColor: isActive ? palette.heroBorder : palette.cardBorder,
              },
            ]}
          >
            <View style={styles.stepHeader}>
              <View
                style={[
                  styles.stepDot,
                  {
                    backgroundColor: isDone || isActive ? palette.accent : palette.inputBorder,
                    borderColor: isActive ? palette.accent : palette.cardBorder,
                  },
                ]}
              >
                <Text style={[styles.stepDotText, { color: palette.screenBg }]}>
                  {isDone ? "✓" : index + 1}
                </Text>
              </View>
              <Text style={[styles.stepTitle, { color: palette.textPrimary }]}>{step.title}</Text>
            </View>
            <Text style={[styles.stepDetail, { color: palette.textSecondary }]}>{step.detail}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    gap: spacing.s10,
  },
  stepCard: {
    borderWidth: 1,
    borderRadius: radii.r18,
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s13,
    gap: spacing.s8,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s10,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: radii.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12.5,
  },
  stepTitle: {
    flex: 1,
    fontFamily: fontFamilies.bold,
    fontSize: 14.5,
    lineHeight: 18,
  },
  stepDetail: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
});
