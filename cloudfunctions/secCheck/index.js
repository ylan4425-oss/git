// cloudfunctions/secCheck/index.js
// 内容安全检测云函数。前端只调这一个函数，通过 action 区分：
//   submit  → 提交检测（先试 1.0 同步接口，不可用则降级 2.0 异步接口）
//   query   → 查询异步检测结果（前端轮询）
//   cleanup → 删除送检的临时图片与记录（不留存用户图片）
//
// 依据：微信官方《内容安全解决方案》security.imgSecCheck(1.0，已停更) / security.mediaCheckAsync(2.0)

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLL = 'sec_records';

// 同步接口(1.0)若仍可用可 1~3 秒直接出结果，省掉「消息推送 + 轮询」；
// 官方已停止维护该接口，失败会自动降级到 2.0 异步，不影响功能。
const SYNC_FASTPATH = true;
const SCENE = 3; // 场景值：1 资料 / 2 评论 / 3 论坛 / 4 社交日志（工具类取 3）
const TYPE_IMAGE = 2; // media_type：1 音频 / 2 图片

exports.main = async (event) => {
  const action = (event && event.action) || 'submit';
  try {
    if (action === 'query') return await query(event.traceId);
    if (action === 'cleanup') return await cleanup(event.fileId);
    return await submit(event.fileId);
  } catch (err) {
    console.error('[secCheck] 异常 action=' + action, err);
    return { status: 'error', message: (err && err.message) || String(err) };
  }
};

async function submit(fileId) {
  if (!fileId) return { status: 'error', message: 'missing fileId' };
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || 'unknown';

  // ---- 1) 先试 1.0 同步接口 ----
  if (SYNC_FASTPATH) {
    try {
      const dl = await cloud.downloadFile({ fileID: fileId });
      const r = await cloud.openapi.security.imgSecCheck({
        media: { contentType: 'image/jpeg', value: dl.fileContent }
      });
      const code = r && (r.errCode !== undefined ? r.errCode : r.errcode);
      if (code === 0) return { status: 'pass', via: 'sync' };
      if (code === 87014) return { status: 'block', via: 'sync', label: 'risky content' };
      console.warn('[secCheck] 同步接口未生效，降级 2.0 异步。errCode=' + code, r && r.errMsg);
    } catch (e) {
      console.warn('[secCheck] 同步接口调用失败，降级 2.0 异步', e && (e.errCode || e.message));
    }
  }

  // ---- 2) 2.0 异步接口（结果由「消息推送」回推到 secCheckCallback）----
  const urlRes = await cloud.getTempFileURL({ fileList: [fileId] });
  const item = urlRes.fileList && urlRes.fileList[0];
  const mediaUrl = item && item.tempFileURL;
  if (!mediaUrl) {
    return { status: 'error', message: 'tempFileURL 获取失败：' + JSON.stringify(item) };
  }

  const r = await cloud.openapi.security.mediaCheckAsync({
    openid: openid,
    scene: SCENE,
    version: 2,
    media_type: TYPE_IMAGE,
    media_url: mediaUrl
  });
  const traceId = r && (r.traceId || r.trace_id);
  if (!traceId) {
    return { status: 'error', message: 'mediaCheckAsync 未返回 traceId：' + JSON.stringify(r) };
  }

  await db.collection(COLL).add({
    data: {
      traceId: traceId,
      fileId: fileId,
      openid: openid,
      status: 'pending',
      createdAt: Date.now()
    }
  });
  return { status: 'pending', traceId: traceId, via: 'async' };
}

async function query(traceId) {
  if (!traceId) return { status: 'error', message: 'missing traceId' };
  const res = await db.collection(COLL).where({ traceId: traceId }).limit(1).get();
  if (!res.data || !res.data.length) return { status: 'unknown' };
  const doc = res.data[0];
  return { status: doc.status, label: doc.label || '' };
}

async function cleanup(fileId) {
  if (!fileId) return { ok: false, message: 'missing fileId' };
  try {
    await cloud.deleteFile({ fileList: [fileId] });
  } catch (e) {
    console.warn('[secCheck] deleteFile 失败', e);
  }
  try {
    await db.collection(COLL).where({ fileId: fileId }).remove();
  } catch (e) {
    console.warn('[secCheck] 清理记录失败', e);
  }
  return { ok: true };
}
