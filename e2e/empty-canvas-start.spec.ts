import { expect, test } from "@playwright/test";
import { PerspectiveCamera, Quaternion, Vector3 } from "three";

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
    await expect(page.getByText("選んだパーツを改造しよう")).toBeVisible();
    await expect(page.getByRole("button", { name: "ほかのパーツとつなぐ" })).toBeVisible();
    await expect(
      page.getByRole("toolbar", { name: "選んだパーツのかんたん操作" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "90°回す" })).toBeVisible();
    await expect(page.getByRole("button", { name: /つなぐ/ }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: "↺ 90°" }).first()).toBeHidden();

    await page.getByText("向きと位置を調整", { exact: true }).click();
    await expect(page.getByRole("button", { name: "↺ 90°" }).first()).toBeVisible();
    await expect(page.locator(".danger-fold .danger")).toBeHidden();

    await page.getByTitle("もとに戻す (Ctrl+Z)").click();
    await expect(start).toBeVisible();
    await expect(page.locator(".statusbar").getByText("0 g", { exact: true })).toBeVisible();
    await expect(page.getByText("中央の案内からおすすめの土台を置くか")).toBeVisible();
  });

  test("配置直後の通知から操作を元に戻せる", async ({ page }) => {
    await page.getByRole("button", { name: "おすすめの土台を置く" }).click();
    await expect(page.getByRole("status")).toContainText("置いたよ");
    await page.getByRole("button", { name: "元に戻す" }).click();

    await expect(
      page.getByRole("region", { name: "ロボット作りを始める" })
    ).toBeVisible();
    const savedPartCount = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("sfg-autosave")!);
      return saved.model.parts.length;
    });
    expect(savedPartCount).toBe(0);
  });

  test("パーツ配置モードでは光る穴を次の操作として案内する", async ({ page }) => {
    await page.locator(".part-card").filter({ hasText: "マイクロサーボ" }).first().click();

    await expect(page.getByText("「マイクロサーボ」を置く場所を決めよう")).toBeVisible();
    await expect(page.getByText("光っている穴なら接続、床なら仮置き")).toBeVisible();
  });

  test("サーボの取付面と向きを配置前に変更できる", async ({ page }) => {
    await page.locator(".part-card").filter({ hasText: "車輪用サーボ" }).click();
    await expect(page.getByRole("button", { name: /取付面: 底面/ })).toBeVisible();

    await page.getByRole("button", { name: /取付面: 底面/ }).click();
    await expect(page.getByRole("button", { name: /取付面: うしろ面/ })).toBeVisible();
    await page.getByRole("button", { name: "配置する向きを右へ90度" }).click();
    await expect(page.getByText("向き 90°")).toBeVisible();

    const canvas = page.locator("canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
    await expect(page.locator(".statusbar").getByText("9 g", { exact: true })).toBeVisible();

    const quat = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("sfg-autosave")!);
      return saved.model.parts[0].basePose.quatWxyz as [number, number, number, number];
    });
    const q = new Quaternion(quat[1], quat[2], quat[3], quat[0]);
    const driveAxis = new Vector3(0, 0, 1).applyQuaternion(q);
    expect(Math.abs(driveAxis.z)).toBeLessThan(1e-6);
  });

  test("カタログをおすすめ・検索・全パーツで切り替えられる", async ({ page }) => {
    await expect(page.locator(".part-card")).toHaveCount(8);
    await expect(page.getByText("まず置く土台におすすめ")).toBeVisible();

    await page.getByRole("searchbox", { name: "パーツを検索" }).fill("PB-L");
    await expect(page.locator(".part-card")).toHaveCount(1);
    await expect(page.getByText("パワーボックスL(辞書)")).toBeVisible();

    await page.getByRole("searchbox", { name: "パーツを検索" }).clear();
    await page.getByRole("button", { name: "すべて" }).click();
    await expect(page.locator(".part-card")).toHaveCount(0);
    await page.getByRole("button", { name: /ほね・いた/ }).click();
    await expect(page.locator(".part-card")).toHaveCount(15);
  });

  test("上部の低頻度操作をファイルとヘルプのメニューにまとめる", async ({ page }) => {
    await expect(page.getByRole("button", { name: "保存" })).toBeHidden();
    await page.getByRole("button", { name: "ファイル" }).click();
    await expect(page.getByRole("menu", { name: "ファイル" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "保存" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "ひらく" })).toBeVisible();

    await page.getByRole("button", { name: "ヘルプ" }).click();
    await expect(page.getByRole("menu", { name: "ファイル" })).toBeHidden();
    await expect(page.getByRole("menuitem", { name: "組み立てガイド" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "ヘルプ" })).toBeHidden();
  });

  test("かんたん表示と詳細表示で情報量を切り替える", async ({ page }) => {
    await page.getByRole("button", { name: "ひながたから始める" }).click();
    await page.locator(".template-card").filter({ hasText: "にりんしゃ" }).click();
    await expect(page.locator(".inspector > .panel-title")).toContainText("パーツのようす");
    await expect(page.getByText("コントローラのわりあて", { exact: true })).toBeHidden();

    await page.getByRole("checkbox", { name: "かんたん" }).check();
    await expect(page.locator(".inspector > .panel-title")).toContainText("設計・プロパティ");
    await expect(page.getByText("操作割当", { exact: true })).toBeVisible();
    await expect(page.getByText("詳細", { exact: true })).toBeVisible();
  });

  test("キーボードで回転・削除・Undo・ヘルプを操作できる", async ({ page }) => {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "3D作業エリアへ移動" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main", { name: "3D組み立て作業エリア" })).toBeFocused();

    await page.getByRole("button", { name: "おすすめの土台を置く" }).click();
    const before = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("sfg-autosave")!);
      return saved.model.parts[0].basePose.quatWxyz;
    });
    await page.keyboard.press("r");
    const after = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("sfg-autosave")!);
      return saved.model.parts[0].basePose.quatWxyz;
    });
    expect(after).not.toEqual(before);

    await page.keyboard.press("Delete");
    await expect(page.getByRole("region", { name: "ロボット作りを始める" })).toBeVisible();
    await page.keyboard.press("Control+z");
    await expect(page.getByRole("region", { name: "ロボット作りを始める" })).toBeHidden();

    await page.keyboard.press("Shift+/");
    await expect(page.getByText("はじめてのロボット(2輪車)")).toBeVisible();
  });

  test("ひながた選択を開くと開始案内と競合しない", async ({ page }) => {
    const start = page.getByRole("region", { name: "ロボット作りを始める" });
    await page.getByRole("button", { name: "ひながたから始める" }).click();

    await expect(page.getByText("できあがったロボットを読みこんで")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "ひながたから始める" })).toBeFocused();
    await expect(start).toBeHidden();
  });

  test("ひながた読込後に胴体を選び、飾り関節を警告と区別する", async ({ page }) => {
    await page.getByRole("button", { name: "ひながたから始める" }).click();
    await page.locator(".template-card").filter({ hasText: "いぬがた4そく" }).click();

    await expect(page.getByText("選んだパーツを改造しよう")).toBeVisible();
    await expect(
      page.getByRole("toolbar", { name: "選んだパーツのかんたん操作" })
    ).toBeVisible();
    await expect(page.getByText(/飾りとして動く関節 1/)).toBeVisible();
    await expect(page.getByText(/固定されていない関節がある/)).toBeHidden();
  });

  test("タブレットでは左右パネルをドロワーとして切り替える", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.reload();

    const catalog = page.locator("#catalog-drawer");
    const inspector = page.locator("#inspector-drawer");
    await expect(catalog).toBeHidden();
    await expect(inspector).toBeHidden();

    await page.getByRole("button", { name: "パーツカタログを開く" }).click();
    await expect(catalog).toBeVisible();
    await page.getByRole("searchbox", { name: "パーツを検索" }).fill("サーボ");

    await page.getByRole("button", { name: "パーツの調整を開く" }).click();
    await expect(catalog).toBeHidden();
    await expect(inspector).toBeVisible();

    await page.getByRole("button", { name: "パーツの調整を開く" }).click();
    await expect(inspector).toBeHidden();
    await page.getByRole("button", { name: "パーツカタログを開く" }).click();
    await expect(page.getByRole("searchbox", { name: "パーツを検索" })).toHaveValue("サーボ");
    await page.keyboard.press("Escape");
    await expect(catalog).toBeHidden();
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
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
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

test("穴へスナップすると追加操作なしでピン留めされ、元に戻せる", async ({ page }) => {
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

  await expect(page.getByText("バラバラ 2こ")).toBeHidden();
  await expect(page.getByRole("status")).toContainText("自動でくっつけた");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("バラバラ 2こ")).toBeVisible();
});
