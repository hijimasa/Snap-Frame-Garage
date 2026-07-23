// サムネイル取得用:R3FのcanvasをキャプチャしてPNG dataURLにする
let canvasEl: HTMLCanvasElement | null = null;

export function setCaptureCanvas(c: HTMLCanvasElement | null) {
  canvasEl = c;
}

export function captureThumbnail(size = 320): string | undefined {
  if (!canvasEl) return undefined;
  try {
    const off = document.createElement("canvas");
    const ratio = canvasEl.height / canvasEl.width;
    off.width = size;
    off.height = Math.round(size * ratio);
    const ctx = off.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(canvasEl, 0, 0, off.width, off.height);
    return off.toDataURL("image/png");
  } catch {
    return undefined;
  }
}
