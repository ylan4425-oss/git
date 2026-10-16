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

// 板编号角标（白底 pill，压在角格上也清晰可读）
function drawBoardBadge(ctx, text, x, y) {
  ctx.save();
  ctx.font = 'bold 13px sans-serif';
  const w = ctx.measureText(text).width + 10;
  const h = 18;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(17,17,17,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 5, y + h / 2 + 0.5);
  ctx.restore();
}

// 坐标轴 + 底板分隔线叠加（在已绘制图纸的基础上）
function drawGridOverlay(ctx, opts) {
  const { cols, rows, cell, offX, offY, plateSize, margin } = opts;
  const nBx = plateSize > 0 ? Math.ceil(cols / plateSize) : 1;
  const nBy = plateSize > 0 ? Math.ceil(rows / plateSize) : 1;
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
  // 底板分隔线：每 plateSize 格一条加粗深色线（醒目"分板/裁剪"边界）+ 每块板左上角编号角标
  if (plateSize > 0) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(17,17,17,0.92)';
    for (let k = 1; k * plateSize <= Math.max(cols, rows); k++) {
      const pos = k * plateSize * cell;
      if (pos <= cols * cell) { ctx.beginPath(); ctx.moveTo(offX + pos, offY); ctx.lineTo(offX + pos, offY + rows * cell); ctx.stroke(); }
      if (pos <= rows * cell) { ctx.beginPath(); ctx.moveTo(offX, offY + pos); ctx.lineTo(offX + cols * cell, offY + pos); ctx.stroke(); }
    }
    for (let k = 1; k <= nBx * nBy; k++) {
      const bi = (k - 1) % nBx, bj = Math.floor((k - 1) / nBx);
      const bx = offX + bi * plateSize * cell;
      const by = offY + bj * plateSize * cell;
      drawBoardBadge(ctx, '板' + k, bx + 3, by + 3);
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

// 板内局部坐标轴（A~列、1~行，标注在板四周，并画板外框）
function drawLocalAxes(ctx, o) {
  const { cols, rows, cell, offX, offY, margin } = o;
  ctx.fillStyle = '#333';
  ctx.font = Math.floor(margin * 0.42) + 'px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let x = 0; x < cols; x++) {
    const label = colLabel(x);
    const cx = offX + x * cell + cell / 2;
    ctx.fillText(label, cx, offY - margin / 2);
    ctx.fillText(label, cx, offY + rows * cell + margin / 2);
  }
  for (let y = 0; y < rows; y++) {
    const label = String(y + 1);
    const cy = offY + y * cell + cell / 2;
    ctx.fillText(label, offX - margin / 2, cy);
    ctx.fillText(label, offX + cols * cell + margin / 2, cy);
  }
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(17,17,17,0.85)';
  ctx.strokeRect(offX, offY, cols * cell, rows * cell);
}

// 渲染单块板（带标题与板内局部坐标）为临时图片
function renderBoardToTempFile(opts) {
  const { subGrid, subExternal, cell, title, showCode } = opts;
  const rows = subGrid.length, cols = subGrid[0].length;
  const margin = Math.max(18, Math.floor(cell * 0.85));
  const titleH = Math.floor(cell * 1.2);
  const W = cols * cell + 2 * margin;
  const H = rows * cell + 2 * margin + titleH;
  return new Promise((resolve, reject) => {
    const off = wx.createOffscreenCanvas({ type: '2d', width: W, height: H });
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#111';
    ctx.font = 'bold ' + Math.floor(cell * 0.7) + 'px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(title, margin, titleH / 2);
    const offX = margin, offY = margin + titleH;
    drawChart(ctx, { grid: subGrid, external: subExternal, cell, showCode, offX, offY });
    drawLocalAxes(ctx, { cols, rows, cell, offX, offY, margin });
    wx.canvasToTempFilePath({ canvas: off, success: r => resolve(r.tempFilePath), fail: e => reject(e) });
  });
}

// 逐板导出：把整图按 plateSize 切成多块，每块单独一张图（自带局部坐标+全局列范围），依次存相册
function exportBoardsToAlbum(opts) {
  const { grid, external, cell, showCode, plateSize } = opts;
  const rows = grid.length, cols = grid[0].length;
  const nBx = Math.ceil(cols / plateSize), nBy = Math.ceil(rows / plateSize);
  const total = nBx * nBy;
  let idx = 0;
  return new Promise((resolve, reject) => {
    const next = () => {
      if (idx >= total) { resolve(total); return; }
      const bi = idx % nBx, bj = Math.floor(idx / nBx);
      const c0 = bi * plateSize, r0 = bj * plateSize;
      const c1 = Math.min(c0 + plateSize, cols), r1 = Math.min(r0 + plateSize, rows);
      const subGrid = [], subExternal = [];
      for (let y = r0; y < r1; y++) { subGrid.push(grid[y].slice(c0, c1)); subExternal.push(external[y].slice(c0, c1)); }
      const title = '板 ' + (idx + 1) + '/' + total + '（全局列 ' + colLabel(c0) + '~' + colLabel(c1 - 1) + '）';
      renderBoardToTempFile({ subGrid, subExternal, cell, title, showCode })
        .then(path => new Promise((res, rej) => {
          wx.saveImageToPhotosAlbum({ filePath: path, success: () => res(), fail: e => rej(e) });
        }))
        .then(() => { idx++; next(); })
        .catch(e => reject(e));
    };
    next();
  });
}

module.exports = {
  drawChart, drawGridOverlay, exportChartToAlbum, exportChartToFile: renderToTempFile,
  exportChartToAlbumWithGrid, exportChartToFileWithGrid: renderToTempFileWithGrid, pickTextColor,
  renderBoardToTempFile, exportBoardsToAlbum
};
