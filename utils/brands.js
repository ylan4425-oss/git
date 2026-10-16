// utils/brands.js
// 多品牌色库注册表。生成图纸时按所选品牌「用它自己的真实色库」匹配，
// 而不是给 MARD 色板换标签（否则屏幕色块仍是 MARD 色，对不上用户手里的豆）。
//
// 数据来源（均为可核实的开放数据，MIT）：
//   · MARD  —— 见 palette.js（本项目原 221 色，已验证）
//   · Artkal S 系列(5mm) —— 199 色，craft-color-codes（社区从实物采样，jsDelivr 发布）
//   · Hama Midi(5mm) —— 92 色，craft-color-codes（社区从实物采样）
//   · Nabbi BioBeads(5mm) —— 30 色，craft-color-codes（社区从实物采样）
const { MARD_PALETTE } = require('./palette.js');
const { ARTKAL_PALETTE } = require('./artkal.js');
const { HAMA_PALETTE } = require('./hama.js');
const { NABBI_PALETTE } = require('./nabbi.js');

// plate = 标准拼豆板边长（格）。midi 5mm 全品牌通用 29×29。
const BRANDS = {
  artkal: { id: 'artkal', name: 'Artkal（S系列 5mm）',   palette: ARTKAL_PALETTE, plate: 29, popular: true },
  mard:   { id: 'mard',   name: 'MARD（5mm）',            palette: MARD_PALETTE,   plate: 29 },
  hama:  { id: 'hama',  name: 'Hama（Midi 5mm）',       palette: HAMA_PALETTE,  plate: 29, popular: true },
  nabbi: { id: 'nabbi', name: 'Nabbi（BioBeads 5mm）',  palette: NABBI_PALETTE, plate: 29 }
};

// 用户不知道自己品牌时，默认市面最流行的（照片级 199 色、亚洲拼豆圈最常用、渐变最好）
const DEFAULT_BRAND = 'artkal';

function getBrand(id) {
  return BRANDS[id] || BRANDS[DEFAULT_BRAND];
}
function getPalette(id) {
  return getBrand(id).palette;
}
function getPlate(id) {
  return getBrand(id).plate || 29;
}
function listBrands() {
  return Object.keys(BRANDS).map(k => ({
    id: BRANDS[k].id, name: BRANDS[k].name, plate: BRANDS[k].plate, popular: !!BRANDS[k].popular
  }));
}

module.exports = { BRANDS, DEFAULT_BRAND, getBrand, getPalette, getPlate, listBrands };
