(function () {
  'use strict';

  var byId = function (id) { return document.getElementById(id); };
  var duration = 2 * 60 * 60 * 1000;
  var bundled;
  try { bundled = JSON.parse(byId('bundledMenu').textContent); } catch (error) { bundled = null; }
  var keyPrefix = 'wangdefu-v2:sample:' + location.pathname + ':';
  var mealKey = keyPrefix + 'meal';
  var ready = false, editing = false, expiryTimer = 0, storageFailed = false;
  var currentMenu = null, session = freshSession();
  var rows = byId('rows'), start = byId('viewStart'), record = byId('viewRecord');
  var people = byId('people'), spend = byId('spend'), veil = byId('veilResult');

  function freshSession() { return { active:false, people:2, spend:'', counts:{}, startedAt:0, finishedAt:0, menu:null }; }
  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (error) { return null; } }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { storageFailed = true; showStorageStatus(); return false; }
  }
  function showStorageStatus() {
    var message = storageFailed ? '当前浏览器无法保存，关掉网页后这餐可能无法恢复。' : '';
    byId('storageStatus').textContent = message;
    byId('storageStatusRecord').textContent = message;
  }
  function probeStorage() {
    try { localStorage.setItem(keyPrefix + 'probe', '1'); localStorage.removeItem(keyPrefix + 'probe'); }
    catch (error) { storageFailed = true; }
    showStorageStatus();
  }
  function validMenu(menu) {
    if (!menu || menu.storeId !== 'wangdefu' || menu.formatVersion !== 1 ||
        !Number.isSafeInteger(menu.version) || menu.version < 1 || !Number.isSafeInteger(menu.savedAt) || menu.savedAt <= 0 ||
        !Array.isArray(menu.items) || !menu.items.length || menu.items.length > 500 ||
        (menu.brandImage !== undefined && (typeof menu.brandImage !== 'string' || menu.brandImage.length > 2000))) return false;
    var ids = new Set(), activeMeat = 0;
    for (var i = 0; i < menu.items.length; i++) {
      var item = menu.items[i];
      if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id) ||
          typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 ||
          typeof item.category !== 'string' || typeof item.active !== 'boolean' ||
          typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0 || item.price > 100000 ||
          typeof item.grams !== 'number' || !Number.isFinite(item.grams) || item.grams <= 0 || item.grams > 100000 ||
          typeof item.image !== 'string' || item.image.length > 2000) return false;
      ids.add(item.id);
      if (item.category === 'meat' && item.active) activeMeat++;
    }
    return activeMeat > 0;
  }
  function validMeal(item) {
    return item && item.active === true && Number.isSafeInteger(item.startedAt) && item.startedAt > 0 &&
      Number.isSafeInteger(item.people) && item.people > 0 && validPaid(String(item.spend)) &&
      item.counts && typeof item.counts === 'object' && !Array.isArray(item.counts) &&
      Object.keys(item.counts).every(function (id) { return /^[a-zA-Z0-9_-]{1,80}$/.test(id) && Number.isSafeInteger(item.counts[id]) && item.counts[id] >= 0 && item.counts[id] <= 999; });
  }
  function restoreMeal() {
    var saved = read(mealKey);
    if (!validMeal(saved) || !validMenu(saved.menu) || Date.now() - saved.startedAt >= duration) return;
    session = saved;
  }
  function validPaid(value) {
    return /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) > 0 && Number.isSafeInteger(Math.round(Number(value) * 100));
  }
  function saveMeal() {
    if (session.active && !session.menuLocked && currentMenu) {
      session.menu = JSON.parse(JSON.stringify(currentMenu)); session.menuLocked = true; currentMenu = session.menu;
    }
    write(mealKey, session);
  }
  function activeItems(menu) { return menu.items.filter(function (item) { return item.category === 'meat' && item.active; }); }
  async function fetchMenu() {
    currentMenu = session.active && validMenu(session.menu) ? session.menu : validMenu(bundled) ? bundled : null;
    if (!currentMenu) {
      byId('priceStatus').textContent = '暂时没有可用菜单，请重新打开网页。';
      byId('priceStatus').hidden = false;
      byId('retryPrices').hidden = false;
      ready = false;
      renderView();
      return;
    }
    byId('priceStatus').hidden = true; byId('retryPrices').hidden = true;
    ready = true;
    byId('startBtn').disabled = byId('resumeBtn').disabled = false;
    if (expireIfNeeded()) return;
    renderAll(); scheduleExpiry();
  }
  async function refreshBundledMenu() {
    if (location.protocol === 'file:') return;
    try {
      var response = await fetch(location.href, {cache:'no-store', signal:AbortSignal.timeout(2000)});
      if (!response.ok) return;
      var page = new DOMParser().parseFromString(await response.text(), 'text/html');
      var next = JSON.parse(page.getElementById('bundledMenu').textContent);
      if (validMenu(next)) bundled = next;
    } catch (error) { /* 保留页面已有菜单 */ }
  }
  function money(value) { return window.BuffetResultEffects.formatMoney(value); }
  function esc(value) { return String(value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function unitCost(item) { return item.price * item.grams / 500; }
  function lineCost(item, count) { return Math.round(unitCost(item) * count * 100 + 1e-8) / 100; }
  function totalPlates() { return Object.keys(session.counts).reduce(function (sum, id) { return sum + session.counts[id]; }, 0); }
  function totals() {
    var cents = 0, items = [];
    activeItems(currentMenu).forEach(function (item) {
      var n = session.counts[item.id] || 0;
      if (!n) return;
      var sub = lineCost(item,n);
      cents += Math.round(sub * 100);
      items.push({name:item.name, n:n, sub:sub});
    });
    items.sort(function (a,b) { return b.sub-a.sub; });
    var cost = cents / 100, paid = Number(session.spend) || 0;
    return {cost:cost, paid:paid, diff:(cents-Math.round(paid*100))/100, items:items};
  }
  function imageUrl(value) {
    if (!value) return '';
    try {
      var url = new URL(value, location.href);
      return /^(https?:|file:)$/.test(url.protocol) ? url.href : '';
    } catch (error) { return ''; }
  }
  function renderRows() {
    rows.replaceChildren();
    if (!currentMenu) return;
    var mark=document.querySelector('header .mark'), logo=imageUrl(currentMenu.brandImage);
    mark.replaceChildren();mark.classList.remove('has-image');
    if(logo){var logoImg=document.createElement('img');logoImg.alt='';logoImg.onerror=function(){logoImg.remove();mark.classList.remove('has-image');};mark.classList.add('has-image');mark.appendChild(logoImg);logoImg.src=logo;}
    byId('brandNote').textContent = '自助小账本';
    byId('sampleTip').textContent = '记下套餐内的肉，就能查看这餐的估算结果。';
    byId('listInfo').textContent = '套餐内肉类';
    activeItems(currentMenu).forEach(function (item, index) {
      var count = session.counts[item.id] || 0, row = document.createElement('div');
      row.className = 'row' + (count ? ' on' : ''); row.dataset.id = item.id;
      row.innerHTML = '<div class="rimg"><b>' + (index+1) + '</b></div>' +
        '<div class="rmain"><div class="rname">' + esc(item.name) + '</div>' +
        '<div class="rprice">' + money(unitCost(item)) + ' / 盘</div></div>' +
        '<div class="stepper sm"><button data-meat="' + item.id + '" data-dir="-1" aria-label="' + esc(item.name) + '减一盘">−</button>' +
        '<input data-meat="' + item.id + '" type="text" inputmode="numeric" aria-label="' + esc(item.name) + '盘数" value="' + count + '">' +
        '<button data-meat="' + item.id + '" data-dir="1" aria-label="' + esc(item.name) + '加一盘">+</button></div>';
      var holder = row.querySelector('.rimg'), icon = item.image.slice(6), src = imageUrl(item.image);
      if (item.image.indexOf('emoji:') === 0 && ['🥩','🥓','🍗'].includes(icon)) {
        var symbol = document.createElement('span');
        symbol.dataset.icon = ''; symbol.textContent = icon; symbol.setAttribute('aria-hidden','true');
        holder.classList.add('has-image'); holder.appendChild(symbol);
      } else if (src) {
        var img = document.createElement('img');
        img.alt = ''; img.onerror = function () { img.remove(); holder.classList.remove('has-image'); };
        holder.classList.add('has-image'); holder.appendChild(img); img.src = src;
      }
      rows.appendChild(row);
    });
  }
  function syncRow(id) {
    var row = rows.querySelector('.row[data-id="' + id + '"]');
    if (!row) return;
    var input = row.querySelector('input'), count = session.counts[id] || 0;
    if (document.activeElement !== input) input.value = count;
    row.classList.toggle('on', count > 0);
  }
  function renderSummary() {
    if (!currentMenu) return;
    var t = totals();
    byId('sCost').textContent = money(t.cost); byId('sPaidSub').textContent = '已付 ' + money(t.paid);
    var d = byId('sDiff'); d.classList.remove('good','bad');
    if (t.diff >= 0) { d.textContent = '+' + money(t.diff); d.classList.add('good'); byId('sDiffK').textContent = '已超出'; }
    else { d.textContent = money(-t.diff); d.classList.add('bad'); byId('sDiffK').textContent = '还差'; }
    byId('barFill').style.width = Math.min(100, t.paid ? t.cost / t.paid * 100 : 0) + '%';
    byId('barFill').style.background = t.diff >= 0 ? 'var(--good)' : 'var(--bad)';
    byId('confirmBtn').disabled = totalPlates() === 0;
  }
  function syncEntry() { people.value = session.people; spend.value = session.spend; }
  function renderView() {
    var recording = ready && session.active && !editing;
    start.classList.toggle('hide',recording); record.classList.toggle('hide',!recording);
    byId('dock').classList.toggle('hide',!recording); byId('editChip').classList.toggle('hide',!recording);
    document.querySelector('.shell').style.paddingBottom = recording ? '112px' : '0';
    byId('editChip').textContent = session.people + ' 人 · ' + money(Number(session.spend) || 0);
    byId('startBtn').textContent = session.active ? '保存并返回记盘' : '开始记这一餐';
    byId('resumeBtn').classList.toggle('hide',!session.active);
    byId('resumeBtn').textContent = '返回记盘';
  }
  function renderAll() { renderRows(); renderSummary(); renderView(); }
  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    if (session.active) expiryTimer = setTimeout(expireIfNeeded, Math.max(0, session.startedAt + duration - Date.now()));
  }
  function expireIfNeeded() {
    if (!session.active || Date.now() - session.startedAt < duration) return false;
    session = freshSession(); editing = false; clearTimeout(expiryTimer);
    syncEntry(); veil.classList.remove('on'); saveMeal(); renderAll();
    byId('entryError').textContent = '这餐已到两小时，请开始新的一餐。';
    return true;
  }
  function touch() { session.finishedAt = 0; saveMeal(); }

  ['click','input'].forEach(function (eventName) {
    document.addEventListener(eventName,function (event) {
      if (expireIfNeeded()) { event.preventDefault(); event.stopImmediatePropagation(); }
    },true);
  });
  rows.addEventListener('click',function (event) {
    var button = event.target.closest('button[data-meat]'); if (!button) return;
    var id = button.dataset.meat, input = rows.querySelector('input[data-meat="' + id + '"]');
    session.counts[id] = Math.max(0,Math.min(999,(session.counts[id] || 0) + Number(button.dataset.dir)));
    if (input) { input.value = session.counts[id]; input.removeAttribute('aria-invalid'); }
    byId('countError').textContent = ''; touch(); syncRow(id); renderSummary();
  });
  rows.addEventListener('input',function (event) {
    var input = event.target.closest('input[data-meat]'); if (!input) return;
    if (!/^\d+$/.test(input.value) || Number(input.value) > 999) {
      input.setAttribute('aria-invalid','true'); byId('countError').textContent = '请填写 0 到 999 的整数盘数。'; return;
    }
    input.removeAttribute('aria-invalid'); byId('countError').textContent = '';
    session.counts[input.dataset.meat] = Number(input.value); touch(); syncRow(input.dataset.meat); renderSummary();
  });
  rows.addEventListener('blur',function (event) {
    var input = event.target.closest('input[data-meat]');
    if (input) { input.value = session.counts[input.dataset.meat] || 0; input.removeAttribute('aria-invalid'); byId('countError').textContent = ''; }
  },true);
  document.querySelectorAll('button[data-step="people"]').forEach(function (button) {
    button.addEventListener('click',function () { var value = Number(people.value); people.value = Math.max(1,(Number.isSafeInteger(value) ? value : 1) + Number(button.dataset.dir)); byId('entryError').textContent = ''; });
  });
  [people,spend].forEach(function (input) { input.addEventListener('input',function () { byId('entryError').textContent = ''; }); });
  byId('startBtn').addEventListener('click',async function () {
    if (!ready) return;
    var value = spend.value.trim(), p = people.value.trim();
    if (!validPaid(value)) { byId('entryError').textContent = '请填写全桌优惠后实际支付的套餐金额，最多两位小数。'; spend.focus(); return; }
    if (!/^\d+$/.test(p) || !Number.isSafeInteger(Number(p)) || Number(p) < 1) { byId('entryError').textContent = '请填写大于零的整数人数。'; people.focus(); return; }
    if (!session.active) {
      byId('startBtn').disabled = people.disabled = spend.disabled = true;
      var peopleButtons = document.querySelectorAll('button[data-step="people"]');
      peopleButtons.forEach(function (button) { button.disabled = true; });
      try { await refreshBundledMenu(); currentMenu = bundled; }
      finally {
        byId('startBtn').disabled = people.disabled = spend.disabled = false;
        peopleButtons.forEach(function (button) { button.disabled = false; });
      }
    }
    session.people = Number(p); session.spend = value;
    if (!session.active) { session.active = true; session.startedAt = Date.now(); session.counts = {}; session.finishedAt = 0; }
    editing = false; syncEntry(); byId('entryError').textContent = ''; saveMeal(); renderAll(); scheduleExpiry(); window.scrollTo(0,0);
  });
  byId('resumeBtn').addEventListener('click',function () { if (!ready) return; editing = false; renderAll(); window.scrollTo(0,0); });
  byId('editChip').addEventListener('click',function () { editing = true; syncEntry(); renderView(); window.scrollTo(0,0); });

  function hhmm(timestamp) { var d = new Date(timestamp); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
  function suggestion(t) {
    if (t.cost >= t.paid) return '';
    var best = null;
    activeItems(currentMenu).forEach(function (item) {
      var n = session.counts[item.id] || 0, existing = lineCost(item,n);
      for (var extra = 1; extra <= 5 && n + extra <= 999; extra++) {
        if (Math.round((t.cost-existing+lineCost(item,n+extra))*100) >= Math.round(t.paid*100)) {
          if (!best || extra < best.count) best = {name:item.name,count:extra};
          break;
        }
      }
    });
    return best ? '再来 ' + best.count + ' 盘' + best.name + '就回本了' : '';
  }
  function renderResult(animate) {
    var t = totals(), box = byId('verdictBox');
    box.innerHTML = t.items.length ? window.BuffetResultEffects.renderResultCard(t.cost,t.paid,animate,suggestion(t)) :
      '<div class="verdict"><div class="pct">—</div><div class="vline">这一餐还没记肉。</div></div>';
    byId('statsBox').innerHTML = '<div><span class="k">盘数</span><span class="v">' + totalPlates() + '</span></div>' +
      '<div><span class="k">人均肉成本</span><span class="v">' + money(t.cost/session.people) + '</span></div>' +
      '<div><span class="k">人均已付</span><span class="v">' + money(t.paid/session.people) + '</span></div>';
    byId('detail').innerHTML = t.items.length ? t.items.map(function (item) {
      return '<div class="li"><span class="l">' + esc(item.name) + '</span><span class="r"><em>×' + item.n + '</em>' + money(item.sub) + '</span></div>';
    }).join('') : '<div class="empty">还没记肉。</div>';
    byId('resultTitle').textContent = session.finishedAt ? '这一餐 · ' + hhmm(session.finishedAt) + ' 确认' : '这一餐的结果';
  }
  function openResult(markDone) {
    if (markDone) { session.finishedAt = Date.now(); saveMeal(); }
    renderResult(markDone); veil.classList.add('on');
  }
  function closeResult() { veil.classList.remove('on'); if (session.finishedAt) { session.finishedAt = 0; saveMeal(); } }
  byId('confirmBtn').addEventListener('click',function () { if (totalPlates()) openResult(true); });
  byId('tapCost').addEventListener('click',function () { openResult(false); });
  byId('tapDiff').addEventListener('click',function () { openResult(false); });
  byId('closeResult').addEventListener('click',closeResult);
  document.querySelectorAll('[data-close]').forEach(function (button) { button.addEventListener('click',closeResult); });
  veil.addEventListener('click',function (event) { if (event.target === veil) closeResult(); });
  byId('newMeal').addEventListener('click',function () {
    if (!confirm('开新的一餐会清除本餐人数、实付和盘数，确定吗？')) return;
    session = freshSession(); editing = false; clearTimeout(expiryTimer); veil.classList.remove('on');
    syncEntry(); saveMeal(); renderAll(); window.scrollTo(0,0); fetchMenu();
  });
  byId('retryPrices').addEventListener('click',function () {
    location.reload();
  });
  document.addEventListener('visibilitychange',function () { if (!document.hidden) expireIfNeeded(); });
  window.addEventListener('focus',expireIfNeeded);
  window.addEventListener('pageshow',function (event) { if (expireIfNeeded()) return; if (event.persisted) fetchMenu(); });
  probeStorage(); restoreMeal(); syncEntry(); fetchMenu();
})();
