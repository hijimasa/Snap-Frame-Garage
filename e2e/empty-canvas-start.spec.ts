import { expect, test } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";

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
    await expect(page.getByText("中央の案内からおすすめの土台を置くか")).toBeVisible();

    await page.getByRole("button", { name: "おすすめの土台を置く" }).click();
    await expect(start).toBeHidden();
    await expect(page.locator(".statusbar").getByText("9 g", { exact: true })).toBeVisible();
    await expect(page.getByText("下のボタンで向きや高さを調整しよう")).toBeVisible();

    await page.getByTitle("もとに戻す (Ctrl+Z)").click();
    await expect(start).toBeVisible();
    await expect(page.locator(".statusbar").getByText("0 g", { exact: true })).toBeVisible();
    await expect(page.getByText("中央の案内からおすすめの土台を置くか")).toBeVisible();
  });

  test("パーツ配置モードでは光る穴を次の操作として案内する", async ({ page }) => {
    await page.locator(".part-card").filter({ hasText: "マイクロサーボ" }).first().click();

    await expect(page.getByText("「マイクロサーボ」を置く場所を決めよう")).toBeVisible();
    await expect(page.getByText("光っている穴なら接続、床なら仮置き")).toBeVisible();
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

test("厚いパワーボックスでもピン留めモードの穴を描画できる", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("sfg-onboarded", "1");
    localStorage.setItem(
      "sfg-autosave",
      JSON.stringify({
        version: 1,
        name: "穴の表示確認",
        author: "",
        parts: [
          {
            id: "p1",
            defId: "PB-L",
            material: "plastic",
            basePose: { posMm: [0, 0, 40], quatWxyz: [1, 0, 0, 0] },
          },
        ],
        connections: [],
        mappings: [],
        nextSeq: 2,
      })
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: /ピンでとめる/ }).last().click();

  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText("まず、つなぎたい穴を1つ選ぼう")).toBeVisible();
  await testInfo.attach("powerbox-hole-markers", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("スナップ後の接続CTAから遮蔽に依存せずピン留めできる", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("sfg-onboarded", "1");
    localStorage.setItem(
      "sfg-autosave",
      JSON.stringify({
        version: 1,
        name: "接続CTA確認",
        author: "",
        parts: [
          {
            id: "p1",
            defId: "FR-P0606",
            material: "plastic",
            basePose: { posMm: [-40, 0, 1.5], quatWxyz: [1, 0, 0, 0] },
          },
          {
            id: "p2",
            defId: "FR-P0606",
            material: "plastic",
            basePose: { posMm: [40, 0, 1.5], quatWxyz: [1, 0, 0, 0] },
          },
        ],
        connections: [],
        mappings: [],
        nextSeq: 3,
      })
    );
  });
  await page.goto("/");

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const camera = new PerspectiveCamera(40, box.width / box.height, 1, 8000);
  camera.position.set(260, -260, 200);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 40);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const screen = (world: [number, number, number]) => {
    const p = new Vector3(...world).project(camera);
    return {
      x: box.x + ((p.x + 1) / 2) * box.width,
      y: box.y + ((1 - p.y) / 2) * box.height,
    };
  };
  const start = screen([40, 0, 1.5]);
  const end = screen([15, 0, 1.5]);

  await page.mouse.click(start.x, start.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();

  const connect = page.getByRole("button", { name: "ここをつなぐ" });
  await expect(connect).toBeVisible();
  await connect.click();
  await expect(page.getByText("バラバラ 2こ")).toBeHidden();
});
