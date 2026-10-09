import { describe, expect, it } from "vitest";
import { detailCamera, detailSpring } from "./detail-camera";

describe("Winery detail camera", () => {
  it("keeps the pin above the mobile sheet occupying 85%", () => {
    expect(detailCamera(390, 844, 12).padding).toEqual({ top: 16, bottom: 717.4, left: 16, right: 16 });
  });
  it("clears the 420px desktop panel and 16px edge gaps", () => {
    expect(detailCamera(1400, 1000, 12).padding.left).toBe(420 + 16 + 16);
  });
  it("opens two zoom levels closer", () => {
    expect(detailCamera(1400, 1000, 12).zoom).toBe(14);
  });
  it("uses the requested spring", () => {
    expect(detailSpring).toEqual({ type: "spring", stiffness: 300, damping: 30 });
  });
});