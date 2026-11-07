// Minimal PDF writer: one A4 page with a raster image (lossless, Flate-compressed).
// No dependencies: pixels come from a canvas, compression from CompressionStream.

const A4 = { short: 595.28, long: 841.89 }; // points
const MARGIN = 28; // ≈ 1 cm

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  // "deflate" = zlib format, which is what PDF's FlateDecode expects.
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Opaque RGB bytes of a canvas (alpha dropped; the canvas has a background). */
function canvasRgb(canvas: HTMLCanvasElement): Uint8Array {
  const { width, height } = canvas;
  const rgba = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return rgb;
}

/** A PDF with `canvas` fitted on an A4 page (landscape if the image is wide). */
export async function canvasToPdf(canvas: HTMLCanvasElement, title = "Drawing"): Promise<Uint8Array> {
  const w = canvas.width;
  const h = canvas.height;
  const landscape = w >= h;
  const pageW = landscape ? A4.long : A4.short;
  const pageH = landscape ? A4.short : A4.long;
  const scale = Math.min((pageW - 2 * MARGIN) / w, (pageH - 2 * MARGIN) / h);
  const drawW = w * scale;
  const drawH = h * scale;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;
  const f = (n: number) => n.toFixed(2);

  const image = await deflate(canvasRgb(canvas));
  const content = `q ${f(drawW)} 0 0 ${f(drawH)} ${f(x)} ${f(y)} cm /Im0 Do Q`;
  // PDF strings: escape backslash and parentheses; keep it ASCII.
  const safeTitle = title.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (c) => `\\${c}`);

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (body: string, stream?: Uint8Array) => {
    offsets.push(length);
    push(`${offsets.length} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object("<< /Type /Catalog /Pages 2 0 R >>");
  object("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pageW)} ${f(pageH)}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  object(
    `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>`,
    image,
  );
  object(`<< /Length ${content.length} >>`, enc.encode(content));
  object(`<< /Title (${safeTitle}) /Producer (Martall) >>`);

  const xref = length;
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const o of offsets) push(`${String(o).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Info ${offsets.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
