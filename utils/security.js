// utils/security.js
// 内容安全（UGC 合规）模块
// 微信要求：小程序只要接收「用户选择的图片」，就必须先接入内容安全检测，否则提审会被驳回
// （驳回文案：「你的小程序【图片】功能在进行内容安全验证时，存在信息安全风险……」）。
//
// 【流程】选图 → 压缩 → 上传云存储 → 云函数 secCheck 调官方检测接口
//         → 同步接口(1.0)可用则立刻出结果；不可用则返回 traceId，前端轮询查询(2.0 异步)
//         → pass 放行；block 提示「图片含违规信息」并拒绝使用
//         → 检测服务异常时「降级放行」并打日志（保证不把用户卡死、不把小程序弄坏）
//
// 【重要】未完成云开发部署时，本模块会自动降级放行。此时功能正常，
//         但**不能提交审核**（审核方会认定未接入内容安全）。
//         部署步骤见项目根目录《接入内容安全-操作步骤.md》。

// ↓↓↓ 开通云开发后，把「环境 ID」填在这里（形如 lazy-shop-1a2b3c）。只有一个环境时可留空。
const ENV_ID = 'cloud1-d2glf0ou433d4a4bc';

const MAX_EDGE = 1000; // 送检图片长边上限（px），小图检测更稳
const MAX_BYTES = 900 * 1024; // 目标体积上限，官方同步接口限制 1MB
const POLL_INTERVAL = 1200; // 异步结果轮询间隔
const POLL_TIMEOUT = 60000; // 异步结果最长等待（实测 8~31s，留足余量防误报「排队中」）

let inited = false;

function ensureCloud() {
  if (!wx.cloud) {
    console.warn('[security] 当前基础库/环境不支持 wx.cloud，已降级放行');
    return false;
  }
  if (!inited) {
    try {
      if (ENV_ID) wx.cloud.init({ env: ENV_ID, traceUser: true });
      else wx.cloud.init({ traceUser: true });
      inited = true;
    } catch (e) {
      console.error('[security] wx.cloud.init 失败，已降级放行', e);
      return false;
    }
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileSize(p) {
  try {
    const st = wx.getFileSystemManager().statSync(p);
    return (st && st.size) || 0;
  } catch (e) {
    return 0;
  }
}

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({ src, success: resolve, fail: reject });
  });
}

function compressOnce(src, quality, width, height) {
  return new Promise((resolve, reject) => {
    const opts = { src: src, quality: quality };
    if (width) opts.compressedWidth = width;
    if (height) opts.compressedHeight = height;
    wx.compressImage({
      src: opts.src,
      quality: opts.quality,
      compressedWidth: opts.compressedWidth,
      compressedHeight: opts.compressedHeight,
      success: (r) => resolve(r.tempFilePath),
      fail: reject
    });
  });
}

// 压缩到「长边 ≤ MAX_EDGE 且体积 ≤ MAX_BYTES」，避免超出官方接口限制
function compressForCheck(src) {
  return getImageInfo(src)
    .then((info) => {
      const w0 = info.width || 1;
      const h0 = info.height || 1;
      const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));
      let quality = 80;
      return compressOnce(src, quality, w, h).then(function retry(path) {
        const size = fileSize(path);
        if (size > MAX_BYTES && quality > 40) {
          quality = quality - 20;
          return compressOnce(src, quality, w, h).then(retry);
        }
        return path;
      });
    })
    .catch((e) => {
      console.warn('[security] 压缩失败，改用原图送检', e);
      return src;
    });
}

function upload(filePath) {
  const ext = /\.png$/i.test(filePath) ? 'png' : 'jpg';
  const cloudPath =
    'seccheck/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: (r) => resolve(r.fileID),
      fail: reject
    });
  });
}

function callSec(data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'secCheck',
      data: data,
      success: (r) => resolve(r.result),
      fail: reject
    });
  });
}

/**
 * 检测一张图片是否可用于本小程序。
 * @param {string} src 本地临时路径
 * @param {(text:string)=>void} [onProgress] 阶段回调（用于更新 loading 文案）
 * @returns {Promise<{ok:boolean, reason?:string, degraded?:boolean}>}
 *   ok=true 放行；ok=false 时 reason: 'risky'(含违规信息) | 'timeout'(排队超时) | 'error'
 */
function verifyImage(src, onProgress) {
  if (!ensureCloud()) return Promise.resolve({ ok: true, degraded: true });

  const tip = (t) => {
    if (onProgress) onProgress(t);
  };
  let fileID = '';

  return compressForCheck(src)
    .then((small) => {
      tip('正在准备检测');
      return upload(small);
    })
    .then((id) => {
      fileID = id;
      tip('内容合规检测中');
      return callSec({ action: 'submit', fileId: fileID });
    })
    .then((r) => {
      if (!r) throw new Error('secCheck 无返回');
      if (r.status === 'pass') return { ok: true };
      if (r.status === 'block') return { ok: false, reason: 'risky' };
      if (r.status === 'pending' && r.traceId) return pollResult(r.traceId, tip);
      throw new Error('secCheck 返回异常：' + JSON.stringify(r));
    })
    .catch((e) => {
      // 关键：任何基础设施异常都「降级放行」，绝不把用户卡死在小程序里
      console.error(
        '[security] 检测流程异常，已降级放行。请确认：云开发已开通、secCheck 已部署、ENV_ID 已填写。',
        e
      );
      return { ok: true, degraded: true };
    })
    .then((r) => {
      // 不论结果如何都清掉刚上传的临时图与记录（不留存用户图片）
      if (fileID) {
        callSec({ action: 'cleanup', fileId: fileID }).catch(() => {});
      }
      return r;
    });
}

function pollResult(traceId, tip) {
  const deadline = Date.now() + POLL_TIMEOUT;
  const step = () => {
    if (Date.now() >= deadline) return Promise.resolve({ ok: false, reason: 'timeout' });
    return sleep(POLL_INTERVAL)
      .then(() => {
        tip('内容合规检测中 ' + Math.ceil((deadline - Date.now()) / 1000) + 's');
        return callSec({ action: 'query', traceId: traceId });
      })
      .then((q) => {
        if (q && q.status === 'pass') return { ok: true };
        if (q && q.status === 'block') return { ok: false, reason: 'risky' };
        return step();
      });
  };
  return step();
}

module.exports = { verifyImage };
