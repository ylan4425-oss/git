// pages/index/index.js
const { generatePattern, S } = require('../../utils/processor.js');
const { drawChart, exportChartToAlbum, exportChartToFile, exportChartToAlbumWithGrid, exportChartToFileWithGrid, exportBoardsToAlbum } = require('../../utils/export.js');
const { verifyImage } = require('../../utils/security.js');
const { getPalette, getPlate, getBrand, listBrands, DEFAULT_BRAND } = require('../../utils/brands.js');

// 从某品牌色库里抽 12 个代表性色块，用于「品牌辨认」弹窗（带色号，方便对照实物确认品牌）
function sampleSwatches(palette, n) {
  const step = Math.max(1, Math.floor(palette.length / n));
  const out = [];
  for (let i = 0; i < palette.length && out.length < n; i += step) out.push({ hex: palette[i].hex, code: palette[i].code });
  return out;
}

Page({
  data: {
    imagePath: '',
    cols: 40,
    mergeThreshold: 40,
    removeBg: true,
    bgThreshold: 230,
    showCode: true,
    dither: true,
    brand: 'artkal',
    brandName: '',
    plateSize: 29,
    cleanup: true,
    hasResult: false,
    material: [],
    totalBeads: 0,
    exporting: false,
    exportingGrid: false,
    exportingBoards: false,
    showBrandQuiz: false,
    quizBrands: [],
    showDonate: false
  },

  onLoad() {
    const app = getApp();
    if (app && app.globalData) {
      this.setData({
        cols: app.globalData.cols,
        mergeThreshold: app.globalData.mergeThreshold,
        removeBg: app.globalData.removeBg,
        bgThreshold: app.globalData.bgThreshold,
        showCode: app.globalData.showCode
      });
    }
    // 读取已保存的品牌 / 清理偏好（默认 Artkal、清理开）
    const brand = wx.getStorageSync('brand') || app.globalData.brand || DEFAULT_BRAND;
    const cleanup = wx.getStorageSync('cleanup');
    const useCleanup = (typeof cleanup === 'boolean') ? cleanup : true;
    this.setData({
      brand,
      brandName: getBrand(brand).name,
      plateSize: getPlate(brand),
      cleanup: useCleanup
    });
  },

  chooseImage() {
    this.doChooseMedia();
  },

  doChooseMedia() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        that.verifyThenProcess(file.tempFilePath);
      },
      fail: (err) => that.reportFail(err, '选择图片')
    });
  },

  verifyThenProcess(path) {
    const that = this;
    wx.showLoading({ title: '内容合规检测中', mask: true });
    verifyImage(path)
      .then((res) => {
        wx.hideLoading();
        if (res.ok) {
          that.setData({ imagePath: path });
          that.process();
          return;
        }
        if (res.reason === 'risky') {
          wx.showModal({ title: '图片未通过检测', content: '图片含违规信息，无法生成图纸。', showCancel: false });
          return;
        }
        if (res.reason === 'timeout') {
          wx.showModal({ title: '检测排队中', content: '内容安全检测暂时未返回结果，请稍后重试。', showCancel: false });
          return;
        }
        wx.showToast({ title: '检测失败，请稍后重试', icon: 'none' });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '检测失败，请稍后重试', icon: 'none' });
      });
  },

  reportFail(err, action) {
    console.error('[' + action + ' fail]', err);
    const msg = (err && err.errMsg) || '';
    const no = err && (err.errno || err.errCode);
    if (no === 112 || msg.indexOf('not declared') >= 0) {
      wx.showModal({
        title: '隐私接口未声明',
        content: '后台《用户隐私保护指引》没有声明所需信息类型，微信直接禁用了相册接口。需去「提交代码审核」页面补充声明，补充后约 5 分钟生效。',
        showCancel: false
      });
      return;
    }
    if (msg.indexOf('banned') >= 0) {
      wx.showModal({
        title: '相册接口权限被回收',
        content: '提审时勾选了“未采集隐私”或未声明隐私协议，接口权限已被平台回收。请完善《用户隐私保护指引》后重新提审。',
        showCancel: false
      });
      return;
    }
    if (no === 103 || no === 104 || msg.indexOf('privacy') >= 0) {
      wx.showToast({ title: '需先同意隐私保护指引', icon: 'none', duration: 3000 });
      return;
    }
    if (msg.indexOf('cancel') >= 0) return;
    if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
      wx.showModal({ title: '未获得授权', content: '请在「设置」中允许后重试', showCancel: false });
      return;
    }
    wx.showToast({ title: msg || (action + '失败'), icon: 'none', duration: 4000 });
  },

  process() {
    const that = this;
    const cols = this.data.cols;
    if (!this.data.imagePath) return;

    wx.createSelectorQuery()
      .select('#preview')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          wx.showToast({ title: '画布初始化失败', icon: 'none' });
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2;
        const cssW = res[0].width;
        const cssH = res[0].height;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        ctx.scale(dpr, dpr);

        const img = canvas.createImage();
        img.onload = () => {
          const iw = img.width || 1;
          const ih = img.height || 1;
          const rows = Math.max(1, Math.round((cols * ih) / iw));

          const sw = cols * S;
          const sh = rows * S;
          const sample = wx.createOffscreenCanvas({ type: '2d', width: sw, height: sh });
          const sctx = sample.getContext('2d');
          sctx.imageSmoothingEnabled = true;
          sctx.drawImage(img, 0, 0, sw, sh);
          const data = sctx.getImageData(0, 0, sw, sh).data;

          const result = generatePattern({
            data, sw, sh, cols, rows,
            mergeThreshold: that.data.mergeThreshold,
            removeBg: that.data.removeBg,
            bgThreshold: that.data.bgThreshold,
            dither: that.data.dither,
            palette: getPalette(that.data.brand),
            cleanup: that.data.cleanup
          });
          that._result = result;

          const cell = Math.floor(Math.min(cssW / cols, cssH / rows)) || 4;
          const offX = (cssW - cell * cols) / 2;
          const offY = (cssH - cell * rows) / 2;
          ctx.clearRect(0, 0, cssW, cssH);
          ctx.save();
          ctx.translate(offX, offY);
          drawChart(ctx, { grid: result.grid, external: result.external, cell, showCode: that.data.showCode });
          ctx.restore();

          const total = result.material.reduce((s, m) => s + m.count, 0);
          that.setData({ hasResult: true, material: result.material, totalBeads: total });
        };
        img.onerror = () => wx.showToast({ title: '图片加载失败', icon: 'none' });
        img.src = that.data.imagePath;
      });
  },

  onCols(e) { this.setData({ cols: e.detail.value }); if (this.data.hasResult) this.process(); },
  onThreshold(e) { this.setData({ mergeThreshold: e.detail.value }); if (this.data.hasResult) this.process(); },
  onBg(e) { this.setData({ removeBg: e.detail.value }); if (this.data.hasResult) this.process(); },
  onDither(e) { this.setData({ dither: e.detail.value }); if (this.data.hasResult) this.process(); },
  onBgThreshold(e) { this.setData({ bgThreshold: e.detail.value }); if (this.data.hasResult) this.process(); },
  onCode(e) { this.setData({ showCode: e.detail.value }); if (this.data.hasResult) this.process(); },
  onCleanup(e) {
    this.setData({ cleanup: e.detail.value });
    wx.setStorageSync('cleanup', e.detail.value);
    if (this.data.hasResult) this.process();
  },

  // 品牌选择（切换后用该品牌真实色库重新生成）
  onBrand(e) {
    const brand = e.currentTarget.dataset.brand;
    this.applyBrand(brand);
  },
  applyBrand(brand) {
    this.setData({ brand, brandName: getBrand(brand).name, plateSize: getPlate(brand) });
    wx.setStorageSync('brand', brand);
    if (this.data.hasResult) this.process();
  },

  // 品牌辨认弹窗：用代表性色块帮用户判断自己用的是哪个品牌
  openBrandQuiz() {
    const quizBrands = listBrands().map(b => ({
      id: b.id, name: b.name, swatches: sampleSwatches(getPalette(b.id), 12)
    }));
    this.setData({ showBrandQuiz: true, quizBrands });
  },
  closeBrandQuiz() { this.setData({ showBrandQuiz: false }); },
  chooseBrandInQuiz(e) {
    const brand = e.currentTarget.dataset.brand;
    this.applyBrand(brand);
    this.closeBrandQuiz();
  },
  useDefaultBrand() {
    this.applyBrand(DEFAULT_BRAND);
    this.closeBrandQuiz();
  },

  // 赞赏码：右下角胶囊 → 居中浮窗（关了回到胶囊）
  openDonate() { this.setData({ showDonate: true }); },
  closeDonate() { this.setData({ showDonate: false }); },

  exportImage() {
    if (!this._result || this.data.exporting) return;
    this.doExport(false);
  },
  exportImageGrid() {
    if (!this._result || this.data.exportingGrid) return;
    this.doExport(true);
  },
  doExport(withGrid) {
    const that = this;
    const key = withGrid ? 'exportingGrid' : 'exporting';
    this.setData({ [key]: true });
    wx.showLoading({ title: '导出中' });
    const opts = {
      grid: that._result.grid,
      external: that._result.external,
      cell: 28,
      showCode: that.data.showCode,
      plateSize: that.data.plateSize
    };
    const task = withGrid ? exportChartToAlbumWithGrid(opts) : exportChartToAlbum(opts);
    task
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已保存到相册', icon: 'success' });
        that.setData({ [key]: false });
      })
      .catch((err) => {
        wx.hideLoading();
        that.setData({ [key]: false });
        that.reportFail(err, '保存到相册');
      });
  },

  shareImage() {
    if (!this._result || this.data.exporting) return;
    const that = this;
    wx.showLoading({ title: '生成分享图' });
    exportChartToFile({
      grid: that._result.grid, external: that._result.external, cell: 28, showCode: that.data.showCode
    })
      .then((path) => {
        wx.hideLoading();
        wx.showShareImageMenu({ path, fail: () => wx.showToast({ title: '已取消分享', icon: 'none' }) });
      })
      .catch(() => { wx.hideLoading(); wx.showToast({ title: '生成失败', icon: 'none' }); });
  },

  shareImageGrid() {
    if (!this._result || this.data.exportingGrid) return;
    const that = this;
    wx.showLoading({ title: '生成分享图' });
    exportChartToFileWithGrid({
      grid: that._result.grid, external: that._result.external, cell: 28,
      showCode: that.data.showCode, plateSize: that.data.plateSize
    })
      .then((path) => {
        wx.hideLoading();
        wx.showShareImageMenu({ path, fail: () => wx.showToast({ title: '已取消分享', icon: 'none' }) });
      })
      .catch(() => { wx.hideLoading(); wx.showToast({ title: '生成失败', icon: 'none' }); });
  },

  exportBoards() {
    if (!this._result || this.data.exportingBoards) return;
    const that = this;
    this.setData({ exportingBoards: true });
    wx.showLoading({ title: '导出分板中' });
    exportBoardsToAlbum({
      grid: that._result.grid, external: that._result.external,
      cell: 30, showCode: that.data.showCode, plateSize: that.data.plateSize
    })
      .then((total) => {
        wx.hideLoading();
        wx.showToast({ title: '已导出 ' + total + ' 张分板图', icon: 'success' });
        that.setData({ exportingBoards: false });
      })
      .catch((err) => {
        wx.hideLoading();
        that.setData({ exportingBoards: false });
        that.reportFail(err, '导出分板');
      });
  },

  onShareAppMessage() {
    return { title: '拼豆图纸生成器：上传图片一键出品牌色号图纸', path: '/pages/index/index' };
  },

  // 弹窗内部点击不冒泡到遮罩（避免误关）
  noop() {}
});
