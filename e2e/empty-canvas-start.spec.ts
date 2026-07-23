import { expect, test } from "@playwright/test";

test.describe("空キャンバスの開始案内", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("sfg-onboarded", "1");
    });
    await page.goto("/");
  });

  test("おすすめの土台を置き、Undoで空状態へ戻れる", async ({ page }) => {
    const start = page.getByRole("region", { name: "ロボット作りを始める" });
    await expect(start).toBeVisible();

    await page.getByRole("button", { name: "おすすめの土台を置く" }).click();
    await expect(start).toBeHidden();
    await expect(page.locator(".statusbar").getByText("9 g", { exact: true })).toBeVisible();

    await page.getByTitle("もとに戻す (Ctrl+Z)").click();
    await expect(start).toBeVisible();
    await expect(page.locator(".statusbar").getByText("0 g", { exact: true })).toBeVisible();
  });

  test("ひながた選択を開くと開始案内と競合しない", async ({ page }) => {
    const start = page.getByRole("region", { name: "ロボット作りを始める" });
    await page.getByRole("button", { name: "ひながたから始める" }).click();

    await expect(page.getByText("できあがったロボットを読みこんで")).toBeVisible();
    await expect(start).toBeHidden();
  });

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet-landscape", width: 1024, height: 768 },
    { name: "tablet-portrait", width: 768, height: 1024 },
  ]) {
    test(`${viewport.name}で開始操作が画面内に表示される`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.reload();

      const start = page.getByRole("region", { name: "ロボット作りを始める" });
      await expect(start).toBeVisible();
      await expect(page.getByRole("button", { name: "おすすめの土台を置く" })).toBeInViewport();
      await expect(page.getByRole("button", { name: "ひながたから始める" })).toBeInViewport();
    });
  }
});

test("初回説明をスキップすると開始案内が表示される", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");

  await expect(page.getByText("Snap Frame Garage へようこそ!")).toBeVisible();
  await page.getByRole("button", { name: "スキップ" }).click();
  await expect(page.getByRole("region", { name: "ロボット作りを始める" })).toBeVisible();
});
