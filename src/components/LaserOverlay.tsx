import { useEffect, useRef } from "react";

interface Props {
  /** Scroll / pinch over the overlay: pan (dx, dy in screen px) or zoom around (x, y). */
  onWheel: (e: { dx: number; dy: number; zoom: number | null; x: number; y: number }) => void;
}

const FADE_MS = 1000;
const COLOR = "255, 59, 48"; // presenter red

interface Pt {
  x: number;
  y: number;
  t: number;
}

/**
 * Laser pointer for presentations: a red dot follows the pointer and, while the
 * button is held, leaves a glowing trail that fades out. Drawn on its own
 * canvas above the (read-only) drawing, so nothing in the drawing changes.
 */
export default function LaserOverlay({ onWheel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const drawing = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const frame = () => {
      const now = performance.now();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // Keep points younger than the fade time; drop empty strokes.
      strokes.current = strokes.current
        .map((s, i) => (i === strokes.current.length - 1 && drawing.current ? s : s.filter((p) => now - p.t < FADE_MS)))
        .filter((s) => s.length > 0);
      for (const s of strokes.current) {
        for (let i = 1; i < s.length; i++) {
          const age = Math.min(1, (now - s[i].t) / FADE_MS);
          const alpha = 1 - age;
          if (alpha <= 0) continue;
          ctx.strokeStyle = `rgba(${COLOR}, ${alpha})`;
          ctx.shadowColor = `rgba(${COLOR}, ${alpha})`;
          ctx.shadowBlur = 12;
          ctx.lineWidth = 2 + 4 * alpha;
          ctx.beginPath();
          ctx.moveTo(s[i - 1].x, s[i - 1].y);
          ctx.lineTo(s[i].x, s[i].y);
          ctx.stroke();
        }
      }
      if (pointer.current) {
        const { x, y } = pointer.current;
        ctx.shadowColor = `rgba(${COLOR}, 0.9)`;
        ctx.shadowBlur = 16;
        ctx.fillStyle = `rgba(${COLOR}, 0.95)`;
        ctx.beginPath();
        ctx.arc(x, y, drawing.current ? 6 : 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        onWheelRef.current({ dx: 0, dy: 0, zoom: Math.exp(-e.deltaY * unit * 0.01), x: e.clientX, y: e.clientY });
      } else {
        onWheelRef.current({ dx: e.deltaX * unit, dy: e.deltaY * unit, zoom: null, x: e.clientX, y: e.clientY });
      }
    };
    canvas.addEventListener("wheel", wheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", wheel);
    };
  }, []);

  const at = (e: React.PointerEvent) => ({ x: e.clientX, y: e.clientY, t: performance.now() });

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-[65] w-screen h-screen"
      style={{ cursor: "none", touchAction: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        strokes.current.push([at(e)]);
      }}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
        if (drawing.current) strokes.current[strokes.current.length - 1]?.push(at(e));
      }}
      onPointerUp={() => {
        drawing.current = false;
      }}
      onPointerLeave={() => {
        pointer.current = null;
      }}
    />
  );
}
