import { describe, expect, it } from "vitest";
import { holeMarkerDepthScale } from "./Viewport";

describe("3D穴マーカー", () => {
  it("薄い板では従来に近い長さを保つ", () => {
    expect(holeMarkerDepthScale(3) * 8).toBe(5);
  });

  it.each([20, 50, 80])("厚さ%immの部品では両表面より1mmずつ外へ届く", (thickness) => {
    expect(holeMarkerDepthScale(thickness) * 8).toBe(thickness + 2);
  });
});
