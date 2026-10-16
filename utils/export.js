// utils/export.js
// 把图纸画到 Canvas 2D，并支持导出到相册 / 分享 / 带坐标网格导出
const { hexOf } = require('./processor.js');

// 文字颜色：按亮度选黑/白，保证色号可读
function pickTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#000000' : '#FFFFFF';
}

// 列标签：0→A,1→B,…25→Z,26→AA
function colLabel(i) {
  let s = ''; i = i + 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// 在给定 ctx 上绘制图纸（含网格线 + 可选色号）。offX/offY 为偏移（带坐标网格时用于留出标注边距）
function drawChart(ctx, opts) {
  const { grid, external, cell, showCode, offX = 0, offY = 0 } = opts;
  const rows = grid.length;
  const cols = grid[0].length;
  ctx.clearRect(offX, offY, cols * cell, rows * cell);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (external[y][x]) continue;
      const code = grid[y][x];
      const px = offX + x * cell, py = offY + y * cell;
      ctx.fillStyle = hexOf(code);
      ctx.fillRect(px, py, cell, cell);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px, py, cell, cell);
      if (showCode && cell >= 16) {
        ctx.fillStyle = pickTextColor(hexOf(code));
        ctx.font = Math.floor(cell * 0.3) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(code, px + cell / 2, py + cell / 2);
      }
    }
  }
}

// 坐标轴 + 底板分隔线叠加（在已绘制图纸的基础上）
function drawGridOverlay(ctx, opts) {
  const { cols, rows, cell, offX, offY, plateSize, margin } = opts;
  ctx.fillStyle = '#333333';
  ctx.strokeStyle = '#333333';
  ctx.font = Math.floor(margin * 0.42) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 列标签（顶 / 底）
  for (let x = 0; x < cols; x++) {
    const label = colLabel(x);
    const cx = offX + x * cell + cell / 2;
    ctx.fillText(label, cx, margin / 2);
    ctx.fillText(label, cx, offY + rows * cell + margin / 2);
  }
  // 行标签（左 / 右）
  for (let y = 0; y < rows; y++) {
    const label = String(y + 1);
    const cy = offY + y * cell + cell / 2;
    ctx.fillText(label, margin / 2, cy);
    ctx.fillText(label, offX + cols * cell + margin / 2, cy);
  }
  // 每 5 格浅粗线（定位更快）
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(80,80,80,0.35)';
  for (let k = 1; k * 5 <= Math.max(cols, rows); k++) {
    const pos = k * 5 * cell;
    if (pos <= cols * cell) { ctx.beginPath(); ctx.moveTo(offX + pos, offY); ctx.lineTo(offX + pos, offY + rows * cell); ctx.stroke(); }
    if (pos <= rows * cell) { ctx.beginPath(); ctx.moveTo(offX, offY + pos); ctx.lineTo(offX + cols * cell, offY + pos); ctx.stroke(); }
  }
  // 底板分隔线：每 plateSize 格一条粗线 + 板编号（防拼错、提效率）
  if (plateSize > 0) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(20,20,20,0.85)';
    for (let k = 1; k * plateSize <= Math.max(cols, rows); k++) {
      const pos = k * plateSize * cell;
      if (pos <= cols * cell) { ctx.beginPath(); ctx.moveTo(offX + pos, offY); ctx.lineTo(offX + pos, offY + rows * cell); ctx.stroke(); }
      if (pos <= rows * cell) { ctx.beginPath(); ctx.moveTo(offX, offY + pos); ctx.lineTo(offX + cols * cell, offY + pos); ctx.stroke(); }
      const bx = offX + (k - 1) * plateSize * cell;
      const by = offY + (k - 1) * plateSize * cell;
      ctx.fillStyle = 'rgba(20,20,20,0.9)';
      ctx.font = Math.floor(margin * 0.4) + 'px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('板' + k, bx + 2, by + 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    }
  }
}

// 把图纸渲染成临时文件（白底）
function renderToTempFile(opts) {
  const { grid, external, cell, showCode } = opts;
  const rows = grid.length;
  const cols = grid[0].length;
  return new Promise((resolve, reject) => {
    const off = wx.createOffscreenCanvas({ type: '2d', width: cols * cell, height: rows * cell });
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cols * cell, rows * cell);
    drawChart(ctx, { grid, external, cell, showCode });
    wx.canvasToTempFilePath({
      canvas: off,
      success: (res) => resolve(res.tempFilePath),
      fail: (e) => reject(e)
    });
  });
}

// 带坐标网格的临时文件（四周留 margin 画坐标轴 + 底板分隔线）
function renderToTempFileWithGrid(opts) {
  const { grid, external, cell, showCode, plateSize } = opts;
  const rows = grid.length;
  const cols = grid[0].length;
  const margin = Math.max(20, Math.floor(cell * 0.85));
  const W = cols * cell + 2 * margin;
  const H = rows * cell + 2 * margin;
  return new Promise((resolve, reject) => {
    const off = wx.createOffscreenCanvas({ type: '2d', width: W, height: H });
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    drawChart(ctx, { grid, external, cell, showCode, offX: margin, offY: margin });
    drawGridOverlay(ctx, { cols, rows, cell, offX: margin, offY: margin, plateSize: plateSize || 0, margin });
    wx.canvasToTempFilePath({
      canvas: off,
      success: (res) => resolve(res.tempFilePath),
      fail: (e) => reject(e)
    });
  });
}

// 生成图纸并保存到相册
function exportChartToAlbum(opts) {
  return renderToTempFile(opts).then((path) => new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => resolve(path),
      fail: (e) => reject(e)
    });
  }));
}

function exportChartToAlbumWithGrid(opts) {
  return renderToTempFileWithGrid(opts).then((path) => new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath: path,
      success: () => resolve(path),
      fail: (e) => reject(e)
    });
  }));
}

module.exports = {
  drawChart, drawGridOverlay, exportChartToAlbum, exportChartToFile: renderToTempFile,
  exportChartToAlbumWithGrid, exportChartToFileWithGrid: renderToTempFileWithGrid, pickTextColor
};
