import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EmptyCanvasStart } from "./EmptyCanvasStart";

describe("空キャンバスの開始案内", () => {
  it("初心者向けの説明と2つの開始方法を表示する", () => {
    const html = renderToStaticMarkup(
      <EmptyCanvasStart onPlaceBase={vi.fn()} onPickTemplate={vi.fn()} />
    );

    expect(html).toContain("まず土台になるパーツを置こう");
    expect(html).toContain("おすすめの土台を置く");
    expect(html).toContain("ひながたから始める");
    expect(html).toContain("もとに戻せるよ");
    expect(html).toContain('aria-label="ロボット作りを始める"');
  });
});
