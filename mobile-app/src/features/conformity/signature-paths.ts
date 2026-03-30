export type SignatureBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g;

function extractPathNumbers(path: string): number[] {
  return (String(path || "").match(NUMBER_PATTERN) || [])
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
}

export function getSignatureBounds(paths: string[]): SignatureBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const path of paths || []) {
    const numbers = extractPathNumbers(path);
    for (let index = 0; index < numbers.length; index += 2) {
      const x = numbers[index];
      const y = numbers[index + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function transformPath(path: string, transformCoordinate: (value: number, index: number) => number): string {
  let coordinateIndex = 0;
  return String(path || "").replace(NUMBER_PATTERN, (raw) => {
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return raw;
    const transformed = transformCoordinate(value, coordinateIndex);
    coordinateIndex += 1;
    return transformed.toFixed(1);
  });
}

export function fitSignaturePathsToViewBox(
  paths: string[],
  {
    width,
    height,
    padding = 24,
  }: {
    width: number;
    height: number;
    padding?: number;
  },
): string[] {
  const safePaths = (paths || []).filter(Boolean);
  if (!safePaths.length) return [];

  const bounds = getSignatureBounds(safePaths);
  if (!bounds) return safePaths;

  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const targetWidth = Math.max(1, width - padding * 2);
  const targetHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const offsetX = padding + (targetWidth - sourceWidth * scale) / 2;
  const offsetY = padding + (targetHeight - sourceHeight * scale) / 2;

  return safePaths.map((path) =>
    transformPath(path, (value, coordinateIndex) => {
      const isX = coordinateIndex % 2 === 0;
      const sourceStart = isX ? bounds.minX : bounds.minY;
      const offset = isX ? offsetX : offsetY;
      return (value - sourceStart) * scale + offset;
    }),
  );
}
