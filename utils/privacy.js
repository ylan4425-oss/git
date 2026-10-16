// utils/privacy.js
// ⚠️ 已停用（2026-09-22）：本项目改用微信「官方隐私弹窗」兜底，无需自建授权流程。
//   本文件及 components/privacy-popup 均不再被任何页面引用，保留仅作参考，请勿重新引入。
//   （自 2023-10-17 起，app.json 的 __usePrivacyCheck__ 字段已失效，隐私校验强制开启；
//     官方弹窗会在开发者未响应 onNeedPrivacyAuthorization 时自动展示，零适配。）
//
// 用户隐私保护指引授权（微信要求：调用相册等隐私接口前需先获得用户同意）
// 老版本基础库没有相关 API 时直接放行，保证兼容。

let privacyResolve = null;   // 微信下发的「已弹窗待用户决定」回调
let popupHandler = null;     // 通知页面/组件显示或隐藏弹窗

// 在 App.onLaunch 调用一次，注册全局拦截
function initPrivacy() {
  if (typeof wx.onNeedPrivacyAuthorization === 'function') {
    wx.onNeedPrivacyAuthorization((resolve) => {
      privacyResolve = resolve;
      if (popupHandler) popupHandler(true);
    });
  }
}

// 由隐私弹窗组件注册
function registerPopup(fn) {
  popupHandler = fn;
}

/**
 * 调用隐私接口（chooseMedia / saveImageToPhotosAlbum）前先调用
 * @returns {Promise<boolean>} true=可继续，false=用户拒绝
 */
function ensurePrivacy() {
  return new Promise((resolve) => {
    if (typeof wx.getPrivacySetting !== 'function') {
      resolve(true); // 老基础库无此机制，放行
      return;
    }
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    wx.getPrivacySetting({
      success: (res) => {
        if (res && res.needAuthorization) {
          if (typeof wx.requirePrivacyAuthorize === 'function') {
            // 安全兜底：防止隐私授权流程卡死（如 buttonId 不匹配）导致按钮无反应
            const timer = setTimeout(() => {
              if (popupHandler) popupHandler(false);
              wx.showToast({ title: '隐私授权超时，请重试', icon: 'none' });
              finish(false);
            }, 20000);
            wx.requirePrivacyAuthorize({
              success: () => { clearTimeout(timer); finish(true); },
              fail: () => { clearTimeout(timer); finish(false); }
            });
          } else {
            finish(true);
          }
        } else {
          finish(true); // 已授权或本账号未开启隐私校验
        }
      },
      fail: () => finish(true)
    });
  });
}

// 用户点「同意」
// 注意：同意按钮带 open-type="agreePrivacyAuthorization"，系统点击后会自动调用
// wx.onNeedPrivacyAuthorization 下发的 resolve，从而触发 requirePrivacyAuthorize 的 success。
// 这里【不要】再手动调 privacyResolve，否则会重复 resolve 导致真机报错。只需关闭弹窗。
function resolveAgree() {
  if (popupHandler) popupHandler(false);
}

// 用户点「不同意」
function resolveDisagree() {
  if (privacyResolve) {
    privacyResolve({ event: 'disagree' });
    privacyResolve = null;
  }
  if (popupHandler) popupHandler(false);
}

function openContract() {
  if (typeof wx.openPrivacyContract === 'function') {
    wx.openPrivacyContract({
      fail: () => {}
    });
  }
}

module.exports = {
  initPrivacy,
  registerPopup,
  ensurePrivacy,
  resolveAgree,
  resolveDisagree,
  openContract
};
