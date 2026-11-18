// 加载诊断与致命提示。网址加 ?diag=1 后，屏幕左下角实时显示加载每一步的状态和报错，方便截图反馈。
const on = new URLSearchParams(location.search).get('diag') === '1';
let box = null; const lines = [];
const t0 = performance.now();
export const diagOn = on;
export function diag(msg) {
  if (!on) return;
  lines.push(((performance.now() - t0) / 1000).toFixed(1) + 's ' + msg);
  if (lines.length > 16) lines.shift();
  if (!box) {
    box = document.createElement('pre'); box.id = 'diag-box';
    box.style.cssText = 'position:fixed;right:4px;top:64px;z-index:99999;margin:0;max-width:46vw;max-height:70vh;overflow:hidden;padding:4px 6px;background:rgba(0,0,0,.72);color:#9fe6a0;font:10px/1.35 monospace;white-space:pre-wrap;word-break:break-all;pointer-events:none;border-radius:4px';
    (document.body || document.documentElement).appendChild(box);
  }
  box.textContent = lines.join('\n');
}
if (on) {
  window.addEventListener('error', e => diag('ERROR ' + (e.message || '') + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : '')));
  window.addEventListener('unhandledrejection', e => diag('REJECT ' + (e.reason && e.reason.message || e.reason)));
}
// 盖满全屏的中文提示（显卡上下文丢失等无法继续的情况），避免黑屏没有任何说明
let fatalEl = null;
export function showFatal(text) {
  if (fatalEl) { fatalEl.firstChild.textContent = text; return; }
  fatalEl = document.createElement('div');
  fatalEl.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(8,9,12,.92);color:#f2e3c4;font:600 18px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;text-align:center;padding:24px';
  const p = document.createElement('div'); p.textContent = text; fatalEl.appendChild(p);
  document.body.appendChild(fatalEl);
}
