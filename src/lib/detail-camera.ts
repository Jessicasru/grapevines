export const detailSpring = { type: "spring" as const, stiffness: 300, damping: 30 };

/** Padding puts the winery at the center of the uncovered map, not under the detail. */
export function detailCamera(width: number, height: number, zoom: number) {
  const desktop = width >= 1024;
  return {
    zoom: Math.min(18, zoom + 2),
    padding: desktop
      ? { top: 16, bottom: 16, left: 452, right: 16 }
      : { top: 16, bottom: height * 0.85, left: 16, right: 16 },
  };
}