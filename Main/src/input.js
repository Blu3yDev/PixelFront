export class PaintInput {
  constructor(canvas) {
    this.canvas = canvas;

    this._viewport = null;
    this._screenToWorldCell = null;
    this._worldCellToScreenCenter = null;
    this._worldW = 0;
    this._worldH = 0;

    this._onClick = null;
    this._onPaintStart = null;
    this._onPaintAdd = null;
    this._onPaintEnd = null;

    this._down = null; // { id, px, py, cell }
    this._painting = false;
    this._painted = new Set(); // indices
    this._dragThresholdPx = 3;

    this._rubber = null; // { x0,y0,x1,y1, active }
    this._lastCell = null;

    // 0 = single cell, 1 = 3x3 brush.
    this._brushRadius = 1;
    this._brushRadiusMin = 0;
    this._brushRadiusMax = 14; // 29x29 max brush (tile-pixels in world space)
    this._brushGhost = null; // { x, y, radiusTiles, sizePx, untilMs }

    // FIX: broken string/newline in your original code.
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("pointerdown", (e) => this._onDown(e));
    this.canvas.addEventListener("pointermove", (e) => this._onMove(e));
    this.canvas.addEventListener("pointerup", (e) => this._onUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this._onUp(e));

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.clear();
    });
  }

  bind(viewport, screenToWorldCellFn, worldCellToScreenCenterFn, worldW, worldH) {
    this._viewport = viewport;
    this._screenToWorldCell = screenToWorldCellFn;
    this._worldCellToScreenCenter = worldCellToScreenCenterFn;
    this._worldW = worldW;
    this._worldH = worldH;
  }

  onClick(cb) { this._onClick = cb; }
  onPaintStart(cb) { this._onPaintStart = cb; }
  onPaintAdd(cb) { this._onPaintAdd = cb; }
  onPaintEnd(cb) { this._onPaintEnd = cb; }

  getRubberLine() { return this._rubber && this._rubber.active ? this._rubber : null; }
  getBrushGhost() {
    const g = this._brushGhost;
    if (!g) return null;
    if ((g.untilMs | 0) <= (performance.now() | 0)) return null;
    return {
      x: g.x | 0,
      y: g.y | 0,
      radiusTiles: g.radiusTiles | 0,
      sizePx: g.sizePx | 0
    };
  }

  consumeWheelResize(e) {
    if (!e) return false;
    // Keep wheel-to-zoom as default; only consume wheel while actively drawing intent.
    if (!this._down && !this._painting) return false;
    if (!this._viewport || !this._screenToWorldCell) return false;

    const dpr = this._viewport.dpr || 1;
    const px = e.offsetX * dpr;
    const py = e.offsetY * dpr;
    const cell = this._screenToWorldCell(px, py) || this._lastCell || (this._down ? this._down.cell : null);
    if (!cell) return false;

    const step = e.deltaY < 0 ? 1 : -1;
    const next = Math.max(this._brushRadiusMin, Math.min(this._brushRadiusMax, (this._brushRadius | 0) + step));
    if (next === this._brushRadius) {
      this._setBrushGhost(cell.x, cell.y);
      return true;
    }

    this._brushRadius = next;
    this._setBrushGhost(cell.x, cell.y);
    return true;
  }

  isPointerDown() { return Boolean(this._down); }
  isPainting() { return Boolean(this._painting); }

  clear() {
    this._down = null;
    this._painting = false;
    this._painted.clear();
    this._rubber = null;
    this._lastCell = null;
    this._brushGhost = null;
  }

  _onDown(e) {
    if (e.button !== 0) return;
    if (!this._viewport || !this._screenToWorldCell || !this._worldCellToScreenCenter) return;

    const dpr = this._viewport.dpr || 1;
    const px = e.offsetX * dpr;
    const py = e.offsetY * dpr;

    const cell = this._screenToWorldCell(px, py);
    if (!cell) return;

    this._down = { id: e.pointerId, px, py, cell };
    this._painting = false;
    this._painted.clear();
    this._lastCell = cell;

    const s0 = this._worldCellToScreenCenter(cell.x, cell.y);
    this._rubber = { x0: s0.x, y0: s0.y, x1: s0.x, y1: s0.y, active: true };

    this.canvas.setPointerCapture(e.pointerId);
  }

  _onMove(e) {
    if (!this._down || e.pointerId !== this._down.id) return;
    if (!this._viewport || !this._screenToWorldCell || !this._worldCellToScreenCenter) return;

    const dpr = this._viewport.dpr || 1;
    const px = e.offsetX * dpr;
    const py = e.offsetY * dpr;

    const cell = this._screenToWorldCell(px, py);
    if (!cell) return;

    if (this._rubber) {
      const s1 = this._worldCellToScreenCenter(cell.x, cell.y);
      this._rubber.x1 = s1.x;
      this._rubber.y1 = s1.y;
      this._rubber.active = true;
    }

    const dx = px - this._down.px;
    const dy = py - this._down.py;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!this._painting && dist >= this._dragThresholdPx) {
      this._painting = true;
      if (this._onPaintStart) this._onPaintStart(this._down.cell);

      this._paintAt(this._down.cell.x, this._down.cell.y);
      this._lastCell = this._down.cell;
    }

    if (!this._painting) return;

    const a = this._lastCell || cell;
    this._paintLine(a.x, a.y, cell.x, cell.y);
    this._lastCell = cell;
  }

  _onUp(e) {
    if (!this._down || e.pointerId !== this._down.id) return;

    const down = this._down;
    this._down = null;

    if (!this._painting) {
      // Use release position for click accuracy (fallback to press cell if unavailable).
      let clickCell = down.cell;
      if (this._viewport && this._screenToWorldCell) {
        const dpr = this._viewport.dpr || 1;
        const upPx = e.offsetX * dpr;
        const upPy = e.offsetY * dpr;
        const upCell = this._screenToWorldCell(upPx, upPy);
        if (upCell) clickCell = upCell;
      }
      if (this._onClick) this._onClick(clickCell);
      this._rubber = null;
      this._lastCell = null;
      return;
    }

    this._painting = false;

    const indices = Array.from(this._painted);
    this._painted.clear();

    if (this._onPaintEnd) this._onPaintEnd(indices);

    this._rubber = null;
    this._lastCell = null;
  }

  _setBrushGhost(x, y) {
    const radius = this._brushRadius | 0;
    this._brushGhost = {
      x: x | 0,
      y: y | 0,
      radiusTiles: radius,
      sizePx: (radius * 2 + 1) | 0,
      untilMs: (performance.now() + 900) | 0
    };
  }

  _paintLine(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0);
    let sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0);
    let sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;

    while (true) {
      this._paintAt(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  _paintAt(x, y) {
    const r = this._brushRadius;
    if (r <= 0) {
      this._paintCell({ x, y });
      return;
    }

    for (let yy = y - r; yy <= y + r; yy++) {
      for (let xx = x - r; xx <= x + r; xx++) {
        this._paintCell({ x: xx, y: yy });
      }
    }
  }

  _paintCell(cell) {
    if (!cell) return;
    if (cell.x < 0 || cell.y < 0 || cell.x >= this._worldW || cell.y >= this._worldH) return;

    const idx = cell.y * this._worldW + cell.x;
    if (this._painted.has(idx)) return;

    this._painted.add(idx);
    if (this._onPaintAdd) this._onPaintAdd(cell, idx);
  }
}

