(function (root) {
  'use strict';

  function classifyResult(cost, paid) {
    if (!Number.isFinite(cost) || !Number.isFinite(paid) || cost < 0 || paid <= 0) return 'invalid';
    if (cost >= paid * 2) return 'bigwin';
    if (cost >= paid) return 'hit';
    return 'miss';
  }

  function formatPercentage(percent) {
    if (!Number.isFinite(percent) || percent < 0) return '—';
    var rounded = Math.round(percent);
    // 显示值不应提前跨过决定表情的 100% 和 200% 两道门槛。
    if ((percent < 100 && rounded >= 100) || (percent < 200 && rounded >= 200)) {
      return String(Math.floor(percent * 10) / 10);
    }
    return String(rounded);
  }

  function formatMoney(value) {
    var rounded = Math.round(value * 100) / 100;
    if (value > 0 && rounded === 0) return '不到 ¥0.01';
    return '¥' + String(rounded);
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function renderResultCard(cost, paid, animate, suggestion) {
    var kind = classifyResult(cost, paid);
    if (kind === 'invalid') {
      return '<div class="verdict result-invalid"><div class="invalid-icon" aria-hidden="true">✎</div>' +
        '<div class="vline strong">先填写这一桌的实际花费</div>' +
        '<div class="vline">回到记盘页，点顶部的人数和金额就能修改。</div></div>';
    }

    var percentage = formatPercentage(cost / paid * 100);
    var title, detail, tag, picture;
    if (kind === 'miss') {
      tag = '这局老板笑了';
      title = '老板笑开了花';
      detail = '肉肉回本还差 ' + formatMoney(paid - cost);
      picture = '<div class="boss-portrait boss-happy" aria-label="开心大笑的卡通老板" role="img"></div>';
    } else if (kind === 'bigwin') {
      tag = '肉肉回本翻倍啦';
      title = '老板的笑容消失了';
      detail = '肉肉比实付多 ' + formatMoney(cost - paid);
      picture = '<div class="boss-portrait boss-sad" aria-label="灰色哭脸的卡通老板" role="img"></div>';
    } else {
      tag = '今天是回本达人';
      title = '肉肉回本啦';
      detail = '肉肉比实付多 ' + formatMoney(cost - paid);
      picture = '<div class="celebrate-face" aria-hidden="true">🥳</div>';
    }

    return '<div class="verdict result-effect result-' + kind + (animate ? ' is-animated' : '') + '">' +
      '<div class="effect-copy">' +
        '<span class="effect-tag">' + tag + '</span>' +
        '<div class="effect-label">肉肉回本率</div>' +
        '<div class="pct">' + percentage + '<i>%</i></div>' +
        '<div class="effect-headline">' + title + '</div>' +
        '<div class="effect-detail">' + detail + '</div>' +
        '<div class="effect-money">肉成本 ' + formatMoney(cost) + ' / 已付 ' + formatMoney(paid) + '</div>' +
        (kind === 'miss' && suggestion ? '<div class="effect-hint">' + escapeText(suggestion) + '</div>' : '') +
      '</div>' +
      '<div class="effect-stage">' +
        '<span class="effect-rays" aria-hidden="true"></span>' +
        '<span class="effect-spark spark-one" aria-hidden="true">✦</span>' +
        '<span class="effect-spark spark-two" aria-hidden="true">✦</span>' +
        '<span class="effect-spark spark-three" aria-hidden="true">✳</span>' +
        picture +
      '</div>' +
    '</div>';
  }

  var api = {
    classifyResult: classifyResult,
    formatMoney: formatMoney,
    formatPercentage: formatPercentage,
    renderResultCard: renderResultCard
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BuffetResultEffects = api;
})(typeof globalThis === 'object' ? globalThis : this);
