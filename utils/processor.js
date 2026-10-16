// utils/processor.js
// 图片 → 拼豆图纸核心算法（移植自 belleqaq/perler-bead-generator，MIT）
//
// v2 画质优化（2026-09-30）：
//   ① 平滑降采样 + 区域均值取色（告别发虚/杂点）
//   ② 色板匹配改用 CIE-Lab 感知距离（比 RGB 距离更准）
//   ③ Floyd–Steinberg 抖动（有限色板下大幅提升细节/渐变）
//   ④ 半透明区域视为背景
//
// v3 多品牌 + 单色清理（2026-10-15）：
//   · 品牌感知：generatePattern 传入 palette（某品牌的真实色库），匹配/抖动/取色全用该色库
//   · 单色清理：生成后对「出现 ≤1 次且邻格存在高频近色」的孤格，替换为该近色，色块更干净
//   · 防偏色（2026-09-30 已修）：近中性深/浅色强力惩罚带色调色板色，避免黑发掺绿/白袍撒粉
const { MARD_PALETTE, hexToRgb } = require('./palette.js');

const S = 4; // 每格超采样倍数：先在 cols*S×rows*S 平滑图上取 S×S 区域均值，得到该格代表色

// ── 颜色空间：sRGB → CIE-Lab（用于感知匹配与抖动）──
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function rgbToXyz(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  let x = R * 0.4124 + G * 0.3576 + B * 0.1805;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  x /= 0.95047; y /= 1.0; z /= 1.08883;
  return [x, y, z];
}
function xyzToLab(x, y, z) {
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

// ── 当前激活色库（由 setPalette 设置；默认 MARD）──
let _CODES = [], _RGB = [], _LAB = [], _HEXMAP = {}, _IDX = {};
function setPalette(palette) {
  _CODES = palette.map(c => c.code);
  _RGB = palette.map(c => hexToRgb(c.hex));
  _LAB = _RGB.map(([r, g, b]) => rgbToLab(r, g, b));
  _HEXMAP = {};
  _IDX = {};
  palette.forEach((c, i) => { _HEXMAP[c.code] = c.hex; _IDX[c.code] = i; });
}
setPalette(MARD_PALETTE); // 默认兜底

// Lab 感知距离最近的色板下标（CIE76，用平方省 sqrt）
// 防偏色规则（针对真实照片里的黑发/白袍杂色噪点）：
//   · 源色近中性（chroma 小）→ 额外加权色度差，严格要求色板也中性；
//   · 源色「近中性 且 极暗(L<22) 或 极亮(L>82)」→ 再重罚色板里带色调的深/浅色，
//     避免「纯黑被配成墨绿 B22/B23、纯白被配成粉白 E16/E8」这类肉眼很扎眼的偏色。
function nearestLabIdx(lab) {
  const srcC = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
  const srcL = lab[0];
  const neutralDarkLight = srcC < 10 && (srcL < 22 || srcL > 82);
  let min = Infinity, idx = 0;
  for (let i = 0; i < _LAB.length; i++) {
    const p = _LAB[i];
    const palC = Math.sqrt(p[1] * p[1] + p[2] * p[2]);
    let wc = srcC < 8 ? 2.5 : 1.0;
    if (neutralDarkLight && palC > 6) wc += 6; // 近中性深/浅色：色板也最好中性，否则重罚
    const dl = lab[0] - p[0], da = lab[1] - p[1], db = lab[2] - p[2];
    const d = dl * dl + wc * (da * da + db * db);
    if (d < min) { min = d; idx = i; }
  }
  return idx;
}

function hexOf(code) {
  return _HEXMAP[code] || '#FFFFFF';
}
function rgbOf(code) {
  return hexToRgb(hexOf(code));
}

// 在已平滑缩放到 (cols*S)×(rows*S) 的图上，逐格取 S×S 区域均值 → 该格代表色（去透明）
function sampleGrid(pixels, sw, sh, cols, rows) {
  const grid = [];
  for (let cy = 0; cy < rows; cy++) {
    const row = [];
    for (let cx = 0; cx < cols; cx++) {
      let r = 0, g = 0, b = 0, n = 0, trans = 0;
      const total = S * S;
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const x = cx * S + dx, y = cy * S + dy;
          if (x >= sw || y >= sh) continue;
          const i = (y * sw + x) * 4;
          const a = pixels[i + 3];
          if (a < 16) { trans++; continue; }
          r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
        }
      }
      if (trans > total / 2) row.push(null);            // 半透明以上 → 视为背景
      else if (n > 0) row.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
      else row.push([255, 255, 255]);
    }
    grid.push(row);
  }
  return grid;
}

// 直接按 Lab 最近取色（关闭抖动时使用）
function rgbToCodes(grid) {
  return grid.map(row => row.map(c =>
    c ? _CODES[nearestLabIdx(rgbToLab(c[0], c[1], c[2]))] : 'H2'
  ));
}

// Floyd–Steinberg 抖动（在 Lab 空间做误差扩散，感知更准）
// 防噪点增强：
//   · 半透明背景格不参与抖动，也不接收误差（避免把绿/蓝误差染进人物轮廓边的背景）；
//   · 近中性目标格只扩散明度(L)误差，不扩散色度(a/b)误差 —— 黑发/白袍大块不会被
//     邻格的轻微色调「染」出绿/粉杂豆；
//   · 扩散后 clamp 到合法 Lab 区间，防止误差累积 runaway。
const FS_DIST = [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];
function fsDither(grid, rows, cols) {
  const lab = grid.map(row => row.map(c => (c ? rgbToLab(c[0], c[1], c[2]) : null)));
  const codes = [];
  for (let y = 0; y < rows; y++) {
    const crow = [];
    for (let x = 0; x < cols; x++) {
      const p = lab[y][x];
      if (!p) { crow.push('H2'); continue; } // 背景格：直接白，不抖动
      const idx = nearestLabIdx(p);
      const best = _LAB[idx];
      crow.push(_CODES[idx]);
      const er = p[0] - best[0], eg = p[1] - best[1], eb = p[2] - best[2];
      for (const [dx, dy, w] of FS_DIST) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const t = lab[ny][nx];
        if (!t) continue;                     // 不把误差扩散进背景
        const tC = Math.sqrt(t[1] * t[1] + t[2] * t[2]);
        if (tC < 8) {
          // 目标接近中性：只扩散明度误差，避免把色调误差染进黑/白大块
          t[0] = Math.max(0, Math.min(100, t[0] + er * w));
        } else {
          t[0] = Math.max(0, Math.min(100, t[0] + er * w));
          t[1] = Math.max(-128, Math.min(127, t[1] + eg * w));
          t[2] = Math.max(-128, Math.min(127, t[2] + eb * w));
        }
      }
    }
    codes.push(crow);
  }
  return codes;
}

// BFS 连通区合并：相邻且色差小的格子统一主色（去杂色，关闭抖动时可用）
function bfsMerge(codes, threshold) {
  const rows = codes.length, cols = codes[0].length;
  const merged = codes.map(r => r.slice());
  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (visited[y][x]) continue;
      const seed = rgbOf(codes[y][x]);
      const stack = [[x, y]];
      visited[y][x] = true;
      const region = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        region.push([cx, cy]);
        for (const [dx, dy] of neighbors) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (visited[ny][nx]) continue;
          const [r2, g2, b2] = rgbOf(codes[ny][nx]);
          const dr = seed[0] - r2, dg = seed[1] - g2, db = seed[2] - b2;
          const d = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
          if (d < threshold) { visited[ny][nx] = true; stack.push([nx, ny]); }
        }
      }
      const freq = {};
      for (const [rx, ry] of region) {
        const k = codes[ry][rx];
        freq[k] = (freq[k] || 0) + 1;
      }
      let major = region.length ? codes[region[0][1]][region[0][0]] : codes[y][x], majorN = -1;
      for (const k in freq) if (freq[k] > majorN) { majorN = freq[k]; major = k; }
      for (const [rx, ry] of region) merged[ry][rx] = major;
    }
  }
  return merged;
}

// 边界洪水去背景：从四边出发，连通的「接近纯白」格子标记为外部（不计入图纸/用量）
function removeBackground(codes, enabled, threshold) {
  const rows = codes.length, cols = codes[0].length;
  const external = Array.from({ length: rows }, () => new Array(cols).fill(false));
  if (!enabled) return external;
  const t = (typeof threshold === 'number') ? threshold : 230;
  const isBg = (code) => {
    const [r, g, b] = rgbOf(code);
    return r > t && g > t && b > t;
  };
  const stack = [];
  for (let x = 0; x < cols; x++) {
    if (isBg(codes[0][x])) stack.push([x, 0]);
    if (isBg(codes[rows - 1][x])) stack.push([x, rows - 1]);
  }
  for (let y = 0; y < rows; y++) {
    if (isBg(codes[y][0])) stack.push([0, y]);
    if (isBg(codes[y][cols - 1])) stack.push([cols - 1, y]);
  }
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    if (seen[y][x]) continue;
    if (!isBg(codes[y][x])) continue;
    seen[y][x] = true;
    external[y][x] = true;
    for (const [dx, dy] of nb) stack.push([x + dx, y + dy]);
  }
  return external;
}

// 单色清理：把「出现 ≤1 次、且邻格存在某个高频(≥minFreq)近色」的孤格，
// 替换为该近色，让色块更干净、视觉更高级，但不影响整体观感。
// 关键：比较的是「两个色板色」的 Lab 距离，而不是「孤格原始像素」与邻格色板色的
// 距离 —— 因为最终图纸只渲染色板色块，只有两个色板色本身够近，替换后观感才几乎无差。
// 保守策略：仅当孤格色板色与某高频近色的 Lab 距离 ≤ threshold² 才替（ΔE 很小=几乎无差）。
function cleanupSingletons(codes, threshold, minFreq) {
  const rows = codes.length, cols = codes[0].length;
  const freq = {};
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const k = codes[y][x]; freq[k] = (freq[k] || 0) + 1;
  }
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const thr2 = threshold * threshold;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const k = codes[y][x];
      if (freq[k] > 1) continue;
      const idxK = _IDX[k];
      if (idxK === undefined) continue;
      const klab = _LAB[idxK];            // 孤格自身的色板 Lab
      const seen = {};
      let best = null, bestD = Infinity;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nk = codes[ny][nx];
        if (nk === k || seen[nk]) continue;
        seen[nk] = 1;
        if ((freq[nk] || 0) < minFreq) continue;
        const idxN = _IDX[nk];
        if (idxN === undefined) continue;
        const p = _LAB[idxN];             // 邻格高频色的色板 Lab
        const dl = klab[0] - p[0], da = klab[1] - p[1], db = klab[2] - p[2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) { bestD = d; best = nk; }
      }
      if (best && bestD <= thr2) {
        codes[y][x] = best;
        freq[k]--;
        freq[best] = (freq[best] || 0) + 1;
      }
    }
  }
}

// 统计非背景格子的用豆量（按色号）
function countMaterial(codes, external) {
  const map = {};
  for (let y = 0; y < codes.length; y++) {
    for (let x = 0; x < codes[0].length; x++) {
      if (external[y][x]) continue;
      const k = codes[y][x];
      map[k] = (map[k] || 0) + 1;
    }
  }
  const list = Object.keys(map).map(code => ({ code, hex: hexOf(code), count: map[code] }));
  list.sort((a, b) => b.count - a.count);
  return list;
}

/**
 * 生成拼豆图纸
 * @param {Object} p
 * @param {Uint8ClampedArray} p.data  已平滑缩放到 (cols*S)×(rows*S) 的 RGBA 像素
 * @param {number} p.sw  缩放后宽 (= cols*S)
 * @param {number} p.sh  缩放后高 (= rows*S)
 * @param {number} p.cols  横向格子数
 * @param {number} p.rows  纵向格子数
 * @param {number} p.mergeThreshold  合并阈值（0=不合并；仅关闭抖动时生效）
 * @param {boolean} p.removeBg  是否去背景
 * @param {boolean} [p.dither]  Floyd–Steinberg 抖动（默认开；有限色板下细节最好）
 * @param {Array}  [p.palette]  当前品牌色库（{code,hex} 数组）；不传则用默认 MARD
 * @param {boolean}[p.cleanup]  单色清理（默认关；开启后把孤格替换为高频近色）
 * @param {number} [p.cleanupThreshold]  单色清理的 Lab 距离阈值（越小越保守，默认 14）
 */
function generatePattern(p) {
  const { data, sw, sh, cols, rows, mergeThreshold, removeBg, bgThreshold, dither, palette, cleanup, cleanupThreshold } = p;
  if (palette && palette.length) setPalette(palette);
  const useDither = dither !== false;
  const grid = sampleGrid(data, sw, sh, cols, rows);
  let codes = useDither ? fsDither(grid, rows, cols) : bfsMerge(rgbToCodes(grid), mergeThreshold || 0);
  if (cleanup) cleanupSingletons(codes, cleanupThreshold || 14, 2);
  const external = removeBackground(codes, removeBg, bgThreshold);
  const material = countMaterial(codes, external);
  return { grid: codes, external, cols, rows, material };
}

module.exports = { generatePattern, hexOf, rgbOf, S, setPalette, cleanupSingletons };
