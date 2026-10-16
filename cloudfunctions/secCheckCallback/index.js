// cloudfunctions/secCheckCallback/index.js
// 接收微信「消息推送」回推的 mediaCheckAsync 异步检测结果，写入数据库供前端轮询。
//
// 配置入口（云开发控制台，不是 mp 后台的「开发管理→消息推送」）：
//   云开发控制台 → 设置 → 其他设置 → 消息推送 → 推送模式选「云函数」
//   → 添加消息推送：消息类型 event / 事件类型 wxa_media_check / 云函数 secCheckCallback
// 云函数模式下 event 即微信推送的 JSON 对象（统一 JSON，无 XML，无「明文/加密」开关）。
//
// 微信推送的格式有两种，本函数都兼容：
//   v1：{ trace_id, isrisky: 0|1, ... }                      （旧版）
//   v2：{ trace_id, result:{suggest:'pass'|'risky'|'review'}, detail:[...] }  （version:2）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLL = 'sec_records';

exports.main = async (event) => {
  console.log('[secCallback] event =', JSON.stringify(event));

  if (!event || event.Encrypt) {
    // 云函数模式不会带 Encrypt 字段；出现说明误用了 URL 加密模式。
    console.error(
      '[secCallback] 收到空事件或加密消息，无法解析。云函数模式不应出现此情况；若走 URL 模式请改明文。'
    );
    return { ok: false, reason: 'encrypted_or_empty' };
  }

  const traceId = (event.trace_id || event.traceId || '') + '';
  if (!traceId) {
    console.warn('[secCallback] 事件无 trace_id，忽略');
    return { ok: false, reason: 'no_trace_id' };
  }

  // 只处理媒体内容安全事件（避免其它事件类型误触）
  const evt = (event.Event || event.event || '').toLowerCase();
  if (evt && evt !== 'wxa_media_check') {
    console.log('[secCallback] 非媒体检测事件，忽略：' + evt);
    return { ok: true, ignored: true };
  }

  const status = decideStatus(event);

  const res = await db.collection(COLL).where({ traceId: traceId }).limit(1).get();
  if (!res.data || !res.data.length) {
    console.warn('[secCallback] 找不到对应记录，可能前端已超时清理。traceId=' + traceId);
    return { ok: true, skipped: true };
  }

  const doc = res.data[0];
  await db.collection(COLL).doc(doc._id).update({
    data: {
      status: status,
      suggest: (event.result && event.result.suggest) || '',
      label: event.result && (event.result.label !== undefined ? event.result.label : ''),
      updatedAt: Date.now()
    }
  });

  // 检测完成即删除云存储里的临时图片（不留存用户图片）
  if (doc.fileId) {
    try {
      await cloud.deleteFile({ fileList: [doc.fileId] });
    } catch (e) {
      console.warn('[secCallback] deleteFile 失败', e);
    }
  }

  return { ok: true, traceId: traceId, status: status };
};

// 判定 pass / block，兼容 v1 与 v2；无法确定时从严（block），保证不漏放违规内容。
function decideStatus(event) {
  // v2 格式
  const result = event.result || {};
  const detail = event.detail || [];
  const suggest = result.suggest || (detail[0] && detail[0].suggest) || '';
  if (suggest === 'pass') return 'pass';
  if (suggest === 'risky' || suggest === 'review') return 'block';

  // v1 格式：isrisky 0=安全 1=风险
  if (typeof event.isrisky !== 'undefined') {
    return event.isrisky === 0 ? 'pass' : 'block';
  }

  // 都无法判定：从严拦截并打日志（调用方已记录 event 全文）
  console.warn('[secCallback] 无法从事件判定结果，按违规拦截：trace_id=' + event.trace_id);
  return 'block';
}
