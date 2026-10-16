// 隐私授权说明（2026-09-22 改为官方弹窗方案）
// 相册类接口（wx.chooseMedia / wx.saveImageToPhotosAlbum）的隐私授权弹窗，由微信「官方隐私弹窗」自动兜底：
// 只要《用户隐私保护指引》已在后台声明对应信息类型，首次调用时微信会主动弹出官方授权弹窗，
// 开发者无需自行适配（官方文档《小程序隐私协议开发指南》六、官方隐私弹窗功能说明）。
// 因此本项目不再注册 wx.onNeedPrivacyAuthorization、也不使用自定义隐私弹窗，避免自建授权流程卡死。
App({
  globalData: {
    // 默认参数，页面可改
    cols: 40,
    mergeThreshold: 40,
    removeBg: true,
    bgThreshold: 230,
    showCode: true,
    brand: 'artkal',   // 用户不知道品牌时默认最流行（Artkal S 199 色，照片级）
    cleanup: true      // 单色清理默认开
  },
  onLaunch() {}
});
