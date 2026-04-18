import React, { useMemo, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { fitSignaturePathsToViewBox } from "@/src/features/conformity/signature-paths";
import { radii, spacing } from "@/src/theme/layout";
import { fontFamilies } from "@/src/theme/typography";

const DEFAULT_CANVAS_WIDTH = 320;
export const SIGNATURE_VIEWBOX_WIDTH = 1000;
export const SIGNATURE_VIEWBOX_HEIGHT = 320;
export const SIGNATURE_STROKE_WIDTH = 4.4;

function buildLinePath(x: number, y: number): string {
  return `M ${x.toFixed(1)} ${y.toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`;
}

type SignatureCanvasProps = {
  paths: string[];
  onChange: (paths: string[]) => void;
  height: number;
  borderColor: string;
  backgroundColor: string;
  strokeColor: string;
  hintColor: string;
  hint?: string;
  fitToBounds?: boolean;
};

export default function SignatureCanvas({
  paths,
  onChange,
  height,
  borderColor,
  backgroundColor,
  strokeColor,
  hintColor,
  hint = "Firma aqui con el dedo o stylus.",
  fitToBounds = false,
}: SignatureCanvasProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_CANVAS_WIDTH);

  const appendPoint = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    const normalizedX = (locationX / Math.max(1, canvasWidth)) * SIGNATURE_VIEWBOX_WIDTH;
    const normalizedY = (locationY / Math.max(1, height)) * SIGNATURE_VIEWBOX_HEIGHT;
    setCurrentPath((existing) => {
      if (!existing) return buildLinePath(normalizedX, normalizedY);
      return `${existing} L ${normalizedX.toFixed(1)} ${normalizedY.toFixed(1)}`;
    });
  };

  const commitStroke = () => {
    if (currentPath) {
      onChange([...paths, currentPath]);
    }
    setCurrentPath("");
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: appendPoint,
        onPanResponderMove: appendPoint,
        onPanResponderRelease: commitStroke,
        onPanResponderTerminate: commitStroke,
        onPanResponderTerminationRequest: () => false,
      }),
    [currentPath, onChange, paths],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.max(DEFAULT_CANVAS_WIDTH, Math.round(event.nativeEvent.layout.width || 0));
    setCanvasWidth(nextWidth);
  };

  const hasSignature = paths.length > 0 || currentPath.length > 0;
  const renderedPaths = useMemo(() => {
    if (!fitToBounds) return paths;
    return fitSignaturePathsToViewBox(paths, {
      width: SIGNATURE_VIEWBOX_WIDTH,
      height: SIGNATURE_VIEWBOX_HEIGHT,
      padding: 24,
    });
  }, [fitToBounds, paths]);

  return (
    <View
      style={[
        styles.shell,
        {
          minHeight: height,
          borderColor,
          backgroundColor,
        },
      ]}
      onLayout={handleLayout}
      {...panResponder.panHandlers}
    >
      <Svg width="100%" height={height} viewBox={`0 0 ${SIGNATURE_VIEWBOX_WIDTH} ${SIGNATURE_VIEWBOX_HEIGHT}`}>
        <Rect
          x="0"
          y="0"
          width={SIGNATURE_VIEWBOX_WIDTH}
          height={SIGNATURE_VIEWBOX_HEIGHT}
          fill={backgroundColor}
        />
        {renderedPaths.map((path, index) => (
          <Path
            key={`${path.slice(0, 24)}-${index}`}
            d={path}
            stroke={strokeColor}
            strokeWidth={SIGNATURE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        {currentPath ? (
          <Path
            d={currentPath}
            stroke={strokeColor}
            strokeWidth={SIGNATURE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}
      </Svg>
      {!hasSignature ? (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={[styles.hint, { color: hintColor }]}>{hint}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: "relative",
    borderWidth: 1,
    borderRadius: radii.r20,
    overflow: "hidden",
  },
  hintWrap: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.s24,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    fontFamily: fontFamilies.medium,
  },
});
