/* Dota Coach - статический фронтенд. Данные: docs/data/*.json, их пишет pipeline/ в GitHub Actions. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, attrs, html) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = x => (x == null || isNaN(x)) ? '-' : Math.round(x * 100) + '%';
  const f1 = x => (x == null || isNaN(x)) ? '-' : (Math.round(x * 10) / 10).toFixed(1);
  const f0 = x => (x == null || isNaN(x)) ? '-' : Math.round(x).toString();
  const dt = ts => ts ? new Date(ts * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
  const MODE_NAMES = { ranked: 'рейтинг', normal: 'обычные', turbo: 'турбо' };
  const LANE = { 1: 'сейфлейн', 2: 'мид', 3: 'оффлейн', 4: 'лес' };
  const SLOT = ['s1', 's2', 's3', 's4', 's5'];

  const state = { players: [], byAcc: {}, analysis: {}, narrative: {}, reviews: {}, matches: {}, heroes: {}, mode: 'ranked', meta: null,
    cmp: { sel: null, range: 'all', mode: 'ranked' }, charts: [] };

  // ---------- математика ----------
  function wilson(w, n, z) { z = z || 1.96; if (!n) return [0, 0, 0]; const p = w / n, den = 1 + z * z / n, c = p + z * z / (2 * n), adj = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [p, (c - adj) / den, (c + adj) / den]; }
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------- загрузка ----------
  async function getJSON(url, optional) {
    try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) { if (optional) return null; throw new Error(r.status + ' ' + url); } return await r.json(); }
    catch (e) { if (optional) return null; throw e; }
  }
  async function boot() {
    try {
      state.meta = await getJSON('data/players.json');
      state.heroes = (await getJSON('data/heroes.json', true)) || {};
      state.players = state.meta.players;
      state.players.forEach(p => state.byAcc[p.account_id] = p);
      await Promise.all(state.players.map(async p => {
        state.analysis[p.account_id] = await getJSON(`data/${p.account_id}/analysis.json`, true);
        state.narrative[p.account_id] = await getJSON(`data/narrative/${p.account_id}.json`, true);
        state.reviews[p.account_id] = (await getJSON(`data/${p.account_id}/reviews.json`, true)) || [];
      }));
    } catch (e) { $('#app').innerHTML = `<p class="no">Не удалось загрузить данные: ${esc(e.message)}</p>`; return; }
    try { const t = localStorage.getItem('dc-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) { }
    $('#themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      const next = dark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('dc-theme', next); } catch (e) { }
      route();
    });
    renderNav(); renderFooter();
    window.addEventListener('hashchange', route);
    route();
  }

  function heroName(id) { const h = state.heroes[String(id)]; return h && h.name ? h.name : ('#' + id); }
  function renderNav() {
    const nav = $('#nav'); nav.innerHTML = '';
    state.players.forEach(p => nav.appendChild(el('button', { class: 'tab' + (p.exposed ? '' : ' off'), 'data-slug': p.slug, type: 'button', title: p.exposed ? '' : 'статистика закрыта' }, esc(p.name))));
    nav.appendChild(el('button', { class: 'tab', 'data-slug': 'compare', type: 'button' }, 'Сравнение'));
    nav.appendChild(el('button', { class: 'tab', 'data-slug': 'match', type: 'button' }, 'Разбор матча'));
    nav.addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) location.hash = b.dataset.slug; });
  }
  function renderFooter() {
    const m = state.meta;
    $('#foot').innerHTML = `<p>Данные: открытая статистика OpenDota (история матчей, агрегаты, разобранные реплеи). Обновляется автоматически через GitHub Actions; последнее обновление ${esc(new Date(m.updated * 1000).toLocaleString('ru-RU'))}. Режимы не смешиваются. Доверительные интервалы - Вилсона 95%, тест на случайность - точный тест Фишера; «надежно» - p &lt; 0.01 при 15+ играх, меньше 10 игр - догадка.</p><p>Методика: atlasagents.uk/g/dota-coach.md. Числа считает код (pipeline/analyze.py), текст тренера - отдельно.</p>`;
  }
  function route() {
    state.charts.forEach(c => { try { c.destroy(); } catch (e) { } }); state.charts = [];
    const h = (location.hash || '').replace('#', '');
    const slug = state.players.some(p => p.slug === h) ? h : (h === 'compare' ? 'compare' : (h.startsWith('match') ? 'match' : state.players[0].slug));
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.slug === slug)));
    const app = $('#app'); app.innerHTML = '';
    if (slug === 'compare') renderCompare(app); else if (slug === 'match') { if (window.renderMatch) window.renderMatch(app); } else renderPlayer(app, state.players.find(p => p.slug === slug));
    window.scrollTo(0, 0);
  }

  // ---------- общие куски ----------
  function tile(label, value, note) { return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${value}</div><div class="tile-note">${esc(note || '')}</div></div>`; }
  function barRow(label, wr, lo, hi, n, base, opts) {
    opts = opts || {};
    const chip = opts.tag ? ` <span class="chip ${opts.tagCls || ''}">${esc(opts.tag)}</span>` : '';
    const note = opts.note ? ' · ' + esc(opts.note) : '';
    return `<div class="brow"><div class="blabel">${label}${chip}</div>` +
      `<div class="btrack" title="${pct(wr)}, ${n} игр, 95% ДИ ${pct(lo)}-${pct(hi)}"><div class="bfill ${opts.cls || 's1'}" style="width:${(wr * 100).toFixed(1)}%"></div>` +
      `<div class="bci" style="left:${(lo * 100).toFixed(1)}%;width:${(Math.max(0, hi - lo) * 100).toFixed(1)}%"></div>` +
      (base != null ? `<div class="bbase" style="left:${(base * 100).toFixed(1)}%"></div>` : '') + `</div>` +
      `<div class="bval"><b>${pct(wr)}</b><span class="bn">${n} игр${note}</span></div></div>`;
  }
  function pNote(r) { if (r.p == null) return ''; return 'p=' + r.p.toFixed(3) + ((r.p < 0.01 && r.n >= 15) ? ' надежно' : (r.p < 0.05 ? ' слабый сигнал' : '')); }
  function barsFromTable(t, order) {
    let rows = t.rows.slice(); if (order) rows.sort((a, b) => (order.indexOf(a.group) + 99) % 99 - (order.indexOf(b.group) + 99) % 99);
    return rows.map(r => barRow(esc(r.group) + (r.n < 10 ? ' <span class="mini">(догадка)</span>' : ''), r.wr, r.lo, r.hi, r.n, t.base, { note: pNote(r) })).join('');
  }
  function htmlTable(t) {
    const body = t.rows.map(r => {
      const flag = r.p == null ? '-' : r.p.toFixed(3) + ((r.p < 0.01 && r.n >= 15) ? ' <span class="chip good">надежно</span>' : (r.p < 0.05 ? ' <span class="chip">слабый сигнал</span>' : ''));
      return `<tr><td>${esc(r.group)}${r.n < 10 ? ' <span class="mini">(догадка)</span>' : ''}</td><td class="num">${r.n}</td><td class="num">${pct(r.wr)}</td><td class="num">${pct(r.lo)}-${pct(r.hi)}</td><td class="num">${((r.wr - t.base) * 100 > 0 ? '+' : '') + Math.round((r.wr - t.base) * 100)} п.п.</td><td>${flag}</td></tr>`;
    }).join('');
    return `<details class="tbl"><summary>${esc(t.title)}</summary><div class="tscroll"><table><tr><th>группа</th><th class="num">игр</th><th class="num">винрейт</th><th class="num">95% ДИ</th><th class="num">vs база</th><th>p</th></tr>${body}</table></div></details>`;
  }
  function noChart(canvas) { if (typeof Chart !== 'undefined') return false; const box = canvas.parentElement; box.style.height = 'auto'; box.innerHTML = '<p class="muted" style="margin:0">График не загрузился (нет доступа к cdnjs.cloudflare.com). Числа есть в таблицах ниже.</p>'; return true; }
  function lineChart(canvas, labels, datasets, yPct) {
    if (noChart(canvas)) return null;
    const ink = cssVar('--ink2'), grid = cssVar('--grid');
    const c = new Chart(canvas, { type: 'line', data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: datasets.length > 1, labels: { color: ink, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + (yPct ? Math.round(ctx.parsed.y * 100) + '%' : ctx.parsed.y) } } },
      scales: { x: { ticks: { color: ink, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: grid } }, y: { min: yPct ? 0 : undefined, max: yPct ? 1 : undefined, ticks: { color: ink, callback: v => yPct ? Math.round(v * 100) + '%' : v }, grid: { color: grid } } } } });
    state.charts.push(c); return c;
  }
  function barChart(canvas, labels, datasets, opts) {
    if (noChart(canvas)) return null;
    opts = opts || {};
    const ink = cssVar('--ink2'), grid = cssVar('--grid');
    const c = new Chart(canvas, { type: 'bar', data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, indexAxis: opts.horizontal ? 'y' : 'x',
      plugins: { legend: { display: datasets.length > 1, labels: { color: ink, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + (opts.pct ? Math.round((opts.horizontal ? ctx.parsed.x : ctx.parsed.y) * 100) + '%' : (opts.horizontal ? ctx.parsed.x : ctx.parsed.y)) } } },
      scales: { x: { ticks: { color: ink, callback: v => opts.pct && opts.horizontal ? Math.round(v * 100) + '%' : (opts.horizontal ? v : labels[v]) }, grid: { color: grid }, max: opts.pct && opts.horizontal ? 1 : undefined, beginAtZero: true },
        y: { beginAtZero: true, max: opts.pct && !opts.horizontal ? 1 : undefined, ticks: { color: ink, callback: v => opts.pct && !opts.horizontal ? Math.round(v * 100) + '%' : v }, grid: { color: grid } } } } });
    state.charts.push(c); return c;
  }

  // ---------- страница игрока ----------
  function renderPlayer(app, p) {
    const an = state.analysis[p.account_id];
    const nar = state.narrative[p.account_id] || null;
    const prof = (an && an.profile) || {};
    const head = `<header class="phead">${p.avatar ? `<img class="avatar" src="${esc(p.avatar)}" alt="">` : '<div class="avatar"></div>'}<div class="txt">
      <p class="eyebrow">Игрок · OpenDota ${p.account_id}</p><h1>${esc(p.name)}</h1>
      <p class="meta"><span class="chip">${esc(p.rank || '')}</span><span class="chip">${p.matches} игр в истории</span>${p.last_match ? `<span class="chip">последняя ${dt(p.last_match)}</span>` : ''}<a class="chip" href="https://www.opendota.com/players/${p.account_id}" target="_blank" rel="noopener">OpenDota</a><a class="chip" href="https://steamcommunity.com/profiles/${esc(p.steam_id64)}" target="_blank" rel="noopener">Steam</a></p>
      ${nar && nar.role ? `<p class="lead" style="margin:0">${esc(nar.role)}</p>` : ''}</div></header>`;
    app.insertAdjacentHTML('beforeend', head);
    if (!p.exposed || !an || an.empty || !an.modes || !Object.keys(an.modes).length) {
      app.insertAdjacentHTML('beforeend', `<div class="notice"><h3>Статистика закрыта</h3><p>OpenDota не видит ни одного матча этого аккаунта. Игроку нужно в клиенте Dota 2 открыть Настройки, вкладку Social и включить <b>Expose Public Match Data</b>. После этого сбор подтянет историю автоматически (он запускается каждые 3 часа), первые цифры появятся в течение дня.</p><p class="mini">Если настройка уже включена - подождите следующего обновления: OpenDota подтягивает историю не мгновенно.</p></div>`);
      return;
    }
    const modes = Object.keys(an.modes).filter(m => an.modes[m].summary.n >= 5);
    if (!modes.includes(state.mode)) state.mode = modes[0];
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Режим' });
    modes.forEach(m => { const b = el('button', { type: 'button', 'aria-pressed': String(m === state.mode) }, `${MODE_NAMES[m] || m} · ${an.modes[m].summary.n}`); b.addEventListener('click', () => { state.mode = m; route(); }); seg.appendChild(b); });
    seg.insertAdjacentHTML('beforeend', `<a class="btn primary" href="#match" style="text-decoration:none" data-pick="${p.account_id}">Свежие игры и разбор матча</a>`);
    seg.querySelector('[data-pick]').addEventListener('click', () => { if (window.DCMatchPick) window.DCMatchPick(p.account_id); });
    app.appendChild(seg);
    const M = an.modes[state.mode], S = M.summary, H = M.history, R = M.recent || null;
    const base = S.wr;
    app.insertAdjacentHTML('beforeend', `<div class="tiles">` +
      tile('Все игры режима', pct(S.wr), `${S.n} игр, ДИ ${pct(S.ci[0])}-${pct(S.ci[1])}, с ${dt(S.first)}`) +
      (R && R.n >= 20 ? tile(`Последние ${R.n}`, pct(R.wr), `ДИ ${pct(R.ci[0])}-${pct(R.ci[1])}, с ${dt(R.first)}`) : '') +
      tile('Последние 50', pct(S.last50_wins / Math.max(1, S.last50_n)), `${S.last50_wins} побед из ${S.last50_n}`) +
      tile('Смертей за игру', f1(S.deaths), R ? `последние ${R.n}: ${f1(R.deaths)}` : '') +
      tile('K / D / A', `${f1(S.kills)} / ${f1(S.deaths)} / ${f1(S.assists)}`, `KDA ${f1(S.kda)}`) +
      (S.gpm ? tile('GPM / XPM', `${f0(S.gpm)} / ${f0(S.xpm)}`, `добитых за игру ${f0(S.lh)}`) : '') + `</div>`);

    // тренер или автонаходки
    if (nar && nar.verdict && state.mode === 'ranked') {
      app.insertAdjacentHTML('beforeend', `<section class="verdict"><h2>Главное от тренера</h2><p>${esc(nar.verdict)}</p>${nar.plan_review ? `<p style="margin-top:8px"><b>Проверка прошлого плана.</b> ${esc(nar.plan_review)}</p>` : ''}<p class="mini" style="margin-top:6px">Отчет от ${esc(nar.report_date || '')}${nar.source === 'ai' ? ', написан моделью ' + esc(nar.model || '') + ' по данным выше' : ', написан вручную'}. Проверка плана: ${esc(nar.check_date || '')}. Следующий отчет - автоматически через 30 рейтинговых игр.</p></section>`);
    }
    const fnd = M.findings || [];
    app.insertAdjacentHTML('beforeend', `<section><h2>Что данные говорят сами</h2><p class="lead">Срезы по всем ${S.n} играм режима, где разница с базой ${pct(base)} проходит тест на случайность (p &lt; 0.01, 15+ игр). Отдельно отмечено, повторяется ли разница на последних ${R ? R.n : 150} играх. Остальное - шум или слишком маленькая выборка.</p><div class="chart">` +
      (fnd.length ? fnd.map(f => `<div class="finding"><b>${pct(f.wr)}</b><span>${esc(f.table)}: <b>${esc(f.group)}</b> - ${f.n} игр, против базы ${(f.wr - f.base) * 100 > 0 ? '+' : ''}${Math.round((f.wr - f.base) * 100)} п.п., p=${f.p < 0.001 ? '<0.001' : f.p.toFixed(3)}${f.holds_recent === true ? ` <span class="chip good">держится на последних ${f.recent_n}</span>` : f.holds_recent === false ? ` <span class="chip warn">на последних ${f.recent_n} не подтверждается</span>` : ''}</span></div>`).join('') : '<p class="muted" style="margin:0">Пока ни один срез не прошел порог надежности - мало игр.</p>') + `</div></section>`);

    // разборы матчей тренером
    const revs = (state.reviews[p.account_id] || []).slice(0, 12);
    app.insertAdjacentHTML('beforeend', `<section><h2>Разборы последних матчей</h2><p class="lead">Каждый час сбор проверяет новые игры, просит OpenDota разобрать реплей и, когда он готов, модель пишет разбор по методике: позиция, хронология, смерти, ключевые моменты и три правки.</p>` +
      (revs.length ? `<div class="chart" style="padding:4px 14px">${revs.map(r => `<div class="finding"><span class="chip ${r.win ? 'good' : 'bad'}">${r.win ? 'победа' : 'поражение'}</span><span><b>${dt(r.start_time)}</b> ${esc(heroName(r.hero_id))}${r.kda ? ' ' + r.kda.join('/') : ''} · ${esc(r.mode || '')} · <a href="#match/${r.match_id}">${esc(r.short || 'разбор')}</a>${r.severity ? ` <span class="mini">влияние на исход: ${esc(r.severity)}</span>` : ''}</span></div>`).join('')}</div>` : '<p class="muted">Разборов пока нет: появятся после следующей игры, когда OpenDota разберет реплей (обычно в течение часа-двух после матча).</p>') + `</section>`);

    // форма
    if (M.series.rolling30.length > 5) {
      const sec = el('section', null, `<h2>Форма</h2><p class="lead">Скользящий винрейт по последним 30 играм. Линия базы - винрейт всей локальной истории в этом режиме.</p><div class="chart cv" style="height:240px"><canvas id="rollChart"></canvas></div>`);
      app.appendChild(sec);
      const pts = M.series.rolling30;
      lineChart($('#rollChart'), pts.map(x => dt(x[0])), [
        { label: 'скользящий винрейт (30 игр)', data: pts.map(x => x[1]), borderColor: cssVar('--s1'), backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: 'база', data: pts.map(() => base), borderColor: cssVar('--muted'), borderDash: [4, 4], borderWidth: 1, pointRadius: 0 }], true);
    }

    // смерти
    const dT = M.tables.find(t => t.section === 'deaths');
    const rT = R && R.tables.find(t => t.section === 'deaths');
    let groups = '';
    ['0-3', '4-6', '7-9', '10+'].forEach(k => {
      const a = dT && dT.rows.find(x => x.group === k), r = rT && rT.rows.find(x => x.group === k);
      let inner = '';
      if (a) inner += barRow('все игры', a.wr, a.lo, a.hi, a.n, base, { cls: 's1', note: pNote(a) });
      if (r) inner += barRow(`последние ${R.n}`, r.wr, r.lo, r.hi, r.n, R.wr, { cls: 's2', note: pNote(r) });
      if (inner) groups += `<div class="bgroup"><div class="bgroup-title">${k} смертей</div>${inner}</div>`;
    });
    app.insertAdjacentHTML('beforeend', `<section><h2>Смерти и исход игры</h2><p class="lead">Винрейт по числу смертей за игру. Это связь, а не доказанная причина: проигранная игра сама дает больше смертей. Где именно они случаются, показывают разобранные реплеи ниже.</p>
      <div class="chart"><div class="legend"><span><i class="sw s1"></i>все игры режима</span><span><i class="sw s2"></i>последние ${R ? R.n : 150}</span><span><i class="sw base"></i>база</span><span><i class="sw ci"></i>95% ДИ</span></div>${groups}</div>
      <p class="src">Доля игр с 10+ смертями: ${pct(S.share_10plus)} за все игры${R ? ', ' + pct(R.share_10plus) + ` за последние ${R.n}` : ''}. Смертей в победах ${f1(M.deaths.in_wins)}, в поражениях ${f1(M.deaths.in_losses)}.</p></section>`);

    // тренер: плюсы/минусы/план
    if (nar && state.mode === 'ranked') {
      const cards = (items, kind) => items.map(it => `<article class="card ${kind}"><h4><span class="mark"></span>${esc(it.title)}</h4><p>${esc(it.text)}</p></article>`).join('');
      app.insertAdjacentHTML('beforeend', `<div class="two"><section><h2>Где сильный</h2>${cards(nar.pluses || [], 'plus')}</section><section><h2>Где теряет игры</h2>${cards(nar.minuses || [], 'minus')}</section></div>`);
      const plan = (nar.plan || []).map((x, i) => `<article class="plan"><div class="plan-no">Совет ${i + 1}</div><h4>${esc(x.title)}</h4><dl><dt>Метрика</dt><dd>${esc(x.metric)}</dd><dt>База</dt><dd>${esc(x.base)}</dd><dt>Цель</dt><dd>${esc(x.target)}</dd><dt>Как</dt><dd>${esc(x.how)}</dd></dl></article>`).join('');
      app.insertAdjacentHTML('beforeend', `<section><h2>План на следующие 30 рейтинговых игр</h2><p class="lead">Проверка ${esc(nar.check_date || '')}. Сравниваем с базой игрока, не с 50%.</p><div class="plans">${plan}</div></section>`);
      app.insertAdjacentHTML('beforeend', `<div class="two"><section><h2>Что не влияет</h2><ul class="plain">${(nar.noise || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></section><section><h2>Вопросы к игроку</h2><ul class="plain">${(nar.questions || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></section></div>`);
    }

    // герои
    const poolName = x => String(x).split(/\s[-–(]/)[0].trim();
    const keep = new Set(((nar && nar.hero_pool && nar.hero_pool.keep) || []).map(poolName)), drop = new Set(((nar && nar.hero_pool && nar.hero_pool.drop) || []).map(poolName));
    const heroRows = M.heroes.map(r => `<tr><td>${esc(r.hero)}${keep.has(r.hero) ? ' <span class="chip good">в пул</span>' : ''}${drop.has(r.hero) ? ' <span class="chip bad">убрать</span>' : ''}</td><td class="num">${r.n}</td><td class="num">${pct(r.wr)}</td><td class="num">${pct(r.lo)}-${pct(r.hi)}</td><td class="num">${r.p == null ? '-' : r.p.toFixed(3)}</td><td class="num">${r.recent_n ? r.recent_wins + '/' + r.recent_n : '-'}</td><td class="num">${f1(r.k)}/${f1(r.d)}/${f1(r.a)}</td><td class="num">${f0(r.gpm)}</td><td class="num">${f0(r.xpm)}</td><td class="num">${f1(r.lhpm)}</td><td>${(r.roles || []).map(x => x[0] + ' x' + x[1]).join(', ') || '-'}</td></tr>`).join('');
    const histHeroes = H && H.heroes ? H.heroes.filter(h => h.n >= 20).map(h => barRow(esc(h.hero), h.wr, h.lo, h.hi, h.n, H.wr, { tag: keep.has(h.hero) ? 'в пул' : (drop.has(h.hero) ? 'убрать' : ''), tagCls: keep.has(h.hero) ? 'good' : 'bad', cls: keep.has(h.hero) ? 'good' : (drop.has(h.hero) ? 'bad' : 's1'), note: 'последняя ' + dt(h.last) })).join('') : '';
    app.insertAdjacentHTML('beforeend', `<section><h2>Герои</h2><p class="lead">За все ${S.n} игр - ${S.distinct_heroes} разных героев, три самых частых дали ${pct(S.top3_share)} игр${R ? `; за последние ${R.n} игр - ${R.distinct_heroes} героев, топ-3 закрывают ${pct(R.top3_share)}` : ''}. Ниже герои с 10+ играми; GPM, XPM и добитые - средние по этим играм.</p>
      ${heroRows ? `<div class="tscroll" style="padding:0"><table><tr><th>герой</th><th class="num">игр</th><th class="num">винрейт</th><th class="num">95% ДИ</th><th class="num">p</th><th class="num">последние ${R ? R.n : 150}: W/игр</th><th class="num">K/D/A</th><th class="num">GPM</th><th class="num">XPM</th><th class="num">доб/мин</th><th>позиция</th></tr>${heroRows}</table></div>` : '<p class="muted">Нет героев с 10+ играми в локальной истории.</p>'}
      ${histHeroes ? `<h3 style="margin-top:18px">Герои с 20+ играми по агрегатам OpenDota</h3><div class="chart"><div class="legend"><span><i class="sw base"></i>база ${pct(H.wr)}</span><span><i class="sw ci"></i>95% ДИ</span></div>${histHeroes}</div>` : ''}</section>`);

    // привычки
    const partyT = M.tables.find(t => t.title === 'Соло или пати'), sideT = M.tables.find(t => t.title === 'Сторона карты'), posT = M.tables.find(t => t.title.startsWith('Позиция'));
    app.insertAdjacentHTML('beforeend', `<section><h2>Привычки и контекст</h2><div class="grid2">
      ${partyT ? `<div class="chart"><h4>Соло или пати</h4>${barsFromTable(partyT, ['соло', 'пати из 2', 'пати из 3', 'пати из 4', 'пати из 5'])}</div>` : ''}
      ${sideT ? `<div class="chart"><h4>Сторона карты</h4>${barsFromTable(sideT, ['Radiant', 'Dire'])}</div>` : ''}
      ${posT && posT.rows.length ? `<div class="chart"><h4>Позиция (где известна)</h4>${barsFromTable(posT)}</div>` : ''}
      </div><div style="margin-top:12px">${M.tables.filter(t => ['layer1', 'habits'].includes(t.section) && !['Соло или пати', 'Сторона карты'].includes(t.title)).map(htmlTable).join('')}${H ? H.tables.filter(t => !t.title.startsWith('Смерти')).map(htmlTable).join('') : ''}</div></section>`);

    // разобранные матчи
    renderParsed(app, M, p);
  }

  function renderParsed(app, M, p) {
    const P = M.parsed || { n: 0 };
    if (!P.n) {
      app.insertAdjacentHTML('beforeend', `<section><h2>Разобранные реплеи</h2><div class="notice"><p>Пока нет разобранных матчей в этом режиме${P.pending ? ` (ждут парса: ${P.pending})` : ''}. OpenDota разбирает только свежие реплеи, сбор запрашивает их при каждом обновлении. Здесь появятся линия на 10 минуте, тайминги предметов, варды и журнал ошибок.</p></div></section>`);
      return;
    }
    const L = P.lane || {};
    const lane = `<div class="chart"><h4>Линия (до 10 минуты)</h4>
      ${L.won && L.won.n ? barRow('линия выиграна по золоту', L.won.wr, wilson(L.won.wins, L.won.n)[1], wilson(L.won.wins, L.won.n)[2], L.won.n, M.summary.wr) : ''}
      ${L.lost && L.lost.n ? barRow('линия проиграна', L.lost.wr, wilson(L.lost.wins, L.lost.n)[1], wilson(L.lost.wins, L.lost.n)[2], L.lost.n, M.summary.wr, { cls: 's2' }) : ''}
      <p class="src">Разница золота с соперником по линии на 10 мин: в среднем ${f0(L.gd10_avg)} (в победах ${f0(L.gd10_wins)}, в поражениях ${f0(L.gd10_losses)}). Добитых на 10 мин: ${f1(L.lh10_avg)}. Смертей до 10 минуты за игру: ${f1(L.early_deaths_per_game)}${L.early_killers && L.early_killers.length ? '; чаще всего убивали: ' + L.early_killers.map(x => x[0] + ' x' + x[1]).join(', ') : ''}. Позиции: ${(L.roles || []).map(x => x[0] + ' x' + x[1]).join(', ')}.${L.p != null ? ' p разницы линия выиграна/проиграна = ' + L.p.toFixed(3) + '.' : ''}</p></div>`;
    const items = (P.items || []).length ? `<div class="tscroll" style="padding:0"><table><tr><th>герой</th><th>предмет</th><th class="num">игр</th><th class="num">мин, среднее</th><th class="num">в победах</th><th class="num">в поражениях</th></tr>${P.items.map(x => `<tr><td>${esc(x.hero)}</td><td>${esc(x.item)}</td><td class="num">${x.n}</td><td class="num">${f1(x.avg)}</td><td class="num">${f1(x.wins_avg)}</td><td class="num">${f1(x.losses_avg)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Нужно 3+ разобранных игры на одном герое с одним предметом.</p>';
    const W = P.wards || {};
    const journal = `<div class="tscroll" style="padding:0"><table><tr><th>ошибка</th><th class="num">игр с ней</th><th class="num">винрейт с ней</th><th class="num">без нее</th><th class="num">p</th></tr>${(P.journal || []).map(j => `<tr><td>${esc(j.flag)}</td><td class="num">${j.n} из ${P.n}</td><td class="num">${pct(j.wr)}</td><td class="num">${pct(j.wr_without)}</td><td class="num">${j.p == null ? '-' : j.p.toFixed(3)}</td></tr>`).join('')}</table></div>`;
    const bm = P.benchmarks_avg_pct || {};
    const bmNames = { gold_per_min: 'GPM', xp_per_min: 'XPM', kills_per_min: 'убийства/мин', last_hits_per_min: 'добитые/мин', hero_damage_per_min: 'урон по героям/мин', hero_healing_per_min: 'лечение/мин', tower_damage: 'урон по башням', stuns_per_min: 'контроль/мин', lhten: 'добитых на 10 мин' };
    const bmRows = Object.keys(bm).filter(k => bmNames[k]).map(k => `<div class="brow"><div class="blabel">${bmNames[k]}</div><div class="btrack" title="перцентиль ${Math.round(bm[k] * 100)}"><div class="bfill" style="width:${(bm[k] * 100).toFixed(1)}%"></div><div class="bbase" style="left:50%"></div></div><div class="bval"><b>${Math.round(bm[k] * 100)}</b><span class="bn">перцентиль</span></div></div>`).join('');
    const recent = (P.matches || []).slice(0, 25).map(m => `<tr><td>${dt(m.start_time)}</td><td>${esc(heroName(m.hero_id))}</td><td>${LANE[m.lane_role] || '-'}</td><td class="${m.win ? 'ok' : 'no'}">${m.win ? 'победа' : 'поражение'}</td><td class="num">${m.kills}/${m.deaths}/${m.assists}</td><td class="num">${m.gd10 == null ? '-' : (m.gd10 > 0 ? '+' : '') + m.gd10}</td><td class="num">${m.early_deaths}</td><td class="num">${m.deaths_outside_fight}</td><td class="num">${m.obs}/${m.sen}</td><td>${m.thrown ? '<span class="chip bad">слив</span>' : ''}${m.comeback ? '<span class="chip good">камбэк</span>' : ''}</td><td><a href="https://www.opendota.com/matches/${m.match_id}" target="_blank" rel="noopener">${m.match_id}</a></td></tr>`).join('');
    app.insertAdjacentHTML('beforeend', `<section><h2>Разобранные реплеи</h2><p class="lead">Разобрано ${P.n} игр в этом режиме${P.pending ? `, еще ${P.pending} ждут парса` : ''}${P.too_old ? `, ${P.too_old} старше двух недель и уже не будут разобраны (реплеи у Valve хранятся ограниченное время)` : ''}. Здесь данные из самих реплеев: линия, предметы, варды, драки.</p>
      <div class="grid2">${lane}<div class="chart"><h4>Обзор карты и активность</h4><p class="src" style="margin:0">За игру в среднем: обсерверов ${f1(W.obs)}, сентри ${f1(W.sen)}, снято обсерверов ${f1(W.obs_killed)}, стаков ${f1(W.stacks)}.</p>${bmRows ? `<h4 style="margin-top:12px">Бенчмарки OpenDota (перцентиль среди игроков на этом герое)</h4><p class="mini">Для сапортов GPM и добитые ниже медианы - норма, смотреть надо на контроль и урон.</p>${bmRows}` : ''}</div></div>
      <h3 style="margin-top:18px">Тайминги ключевых предметов</h3>${items}
      <h3 style="margin-top:18px">Журнал ошибок</h3><p class="lead">Каждая разобранная игра раскладывается на повторяющиеся ошибки. Винрейт с ошибкой против винрейта без нее показывает, какая из них стоит дороже.</p>${journal}
      <h3 style="margin-top:18px">Последние разобранные матчи</h3><div class="tscroll" style="padding:0"><table><tr><th>дата</th><th>герой</th><th>позиция</th><th>итог</th><th class="num">K/D/A</th><th class="num">золото vs линия, 10 мин</th><th class="num">смертей до 10'</th><th class="num">вне драк</th><th class="num">обс/сен</th><th></th><th>матч</th></tr>${recent}</table></div></section>`);
  }

  // ---------- сравнение ----------
  function rowsOf(acc) {
    const m = state.matches[acc]; if (!m) return [];
    const C = m.cols; const idx = {}; C.forEach((c, i) => idx[c] = i);
    return m.rows.filter(r => r[idx.win] != null).map(r => { const o = {}; C.forEach((c, i) => o[c] = r[i]); return o; });
  }
  function modeOf(m) { if (m.game_mode === 23) return 'turbo'; if (m.lobby_type === 7) return 'ranked'; if (m.lobby_type === 0) return 'normal'; return 'other'; }
  function filterRange(ms) {
    const r = state.cmp.range;
    const sorted = ms.slice().sort((a, b) => b.start_time - a.start_time);
    if (r === 'last100') return sorted.slice(0, 100);
    if (r === 'days30') { const t = Date.now() / 1000 - 30 * 86400; return sorted.filter(m => m.start_time >= t); }
    if (r === 'days90') { const t = Date.now() / 1000 - 90 * 86400; return sorted.filter(m => m.start_time >= t); }
    return sorted;
  }
  function metrics(ms) {
    const n = ms.length; if (!n) return null;
    const avg = k => { const v = ms.filter(m => m[k] != null).map(m => m[k]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const wins = ms.filter(m => m.win).length;
    const party5 = ms.filter(m => m.party_size === 5), solo = ms.filter(m => !m.party_size || m.party_size === 1);
    const heroes = {}; ms.forEach(m => heroes[m.hero_id] = (heroes[m.hero_id] || 0) + 1);
    const top = Object.entries(heroes).sort((a, b) => b[1] - a[1]);
    const lh = ms.filter(m => m.lh != null && m.duration).map(m => m.lh / (m.duration / 60));
    return { n, wins, wr: wins / n, ci: wilson(wins, n), kills: avg('kills'), deaths: avg('deaths'), assists: avg('assists'),
      kda: ms.reduce((a, m) => a + (m.kills + m.assists) / Math.max(1, m.deaths), 0) / n, gpm: avg('gpm'), xpm: avg('xpm'),
      lhpm: lh.length ? lh.reduce((a, b) => a + b, 0) / lh.length : null, hero_damage: avg('hero_damage'), tower_damage: avg('tower_damage'),
      share10: ms.filter(m => m.deaths >= 10).length / n, shareLe6: ms.filter(m => m.deaths <= 6).length / n,
      distinct: Object.keys(heroes).length, top3: top.slice(0, 3).reduce((a, x) => a + x[1], 0) / n,
      topHeroes: top.slice(0, 3).map(x => heroName(x[0]) + ' ' + x[1]).join(', '),
      party5: party5.length ? { n: party5.length, wr: party5.filter(m => m.win).length / party5.length } : null,
      solo: solo.length ? { n: solo.length, wr: solo.filter(m => m.win).length / solo.length } : null,
      duration: (avg('duration') || 0) / 60 };
  }
  async function renderCompare(app) {
    const exposed = state.players.filter(p => p.exposed && state.analysis[p.account_id] && !state.analysis[p.account_id].empty);
    if (!state.cmp.sel) state.cmp.sel = new Set(exposed.map(p => p.account_id));
    app.insertAdjacentHTML('beforeend', `<header class="phead"><div class="txt"><p class="eyebrow">Сравнение игроков стака</p><h1>Сравнение</h1><p class="lead">Отметь, кого сравнивать (минимум одного). Все метрики считаются в браузере из одной и той же локальной истории, режимы не смешиваются.</p></div></header>`);
    const checks = el('div', { class: 'checks' });
    exposed.forEach((p, i) => {
      const lab = el('label', null, `<input type="checkbox" ${state.cmp.sel.has(p.account_id) ? 'checked' : ''} data-acc="${p.account_id}"><span class="dot" style="background:var(--${SLOT[i % 5]})"></span>${esc(p.name)}`);
      lab.querySelector('input').addEventListener('change', e => {
        if (e.target.checked) state.cmp.sel.add(p.account_id); else if (state.cmp.sel.size > 1) state.cmp.sel.delete(p.account_id); else { e.target.checked = true; return; }
        route();
      });
      checks.appendChild(lab);
    });
    app.appendChild(checks);
    const ctrl = el('div', { class: 'seg', role: 'group' });
    [['ranked', 'рейтинг'], ['normal', 'обычные'], ['turbo', 'турбо']].forEach(([k, v]) => { const b = el('button', { type: 'button', 'aria-pressed': String(state.cmp.mode === k) }, v); b.addEventListener('click', () => { state.cmp.mode = k; route(); }); ctrl.appendChild(b); });
    app.appendChild(ctrl);
    const rng = el('div', { class: 'seg', role: 'group', style: 'margin-left:8px' });
    [['all', 'вся локальная история'], ['last100', 'последние 100 игр'], ['days90', '90 дней'], ['days30', '30 дней']].forEach(([k, v]) => { const b = el('button', { type: 'button', 'aria-pressed': String(state.cmp.range === k) }, v); b.addEventListener('click', () => { state.cmp.range = k; route(); }); rng.appendChild(b); });
    app.appendChild(rng);
    const body = el('div'); app.appendChild(body); body.innerHTML = '<p class="muted">Считаю...</p>';
    const sel = exposed.filter(p => state.cmp.sel.has(p.account_id));
    await Promise.all(sel.map(async p => { if (!state.matches[p.account_id]) state.matches[p.account_id] = await getJSON(`data/${p.account_id}/matches.json`, true); }));
    const data = sel.map(p => { const all = rowsOf(p.account_id).filter(m => modeOf(m) === state.cmp.mode); const ms = filterRange(all); return { p, color: cssVar('--' + SLOT[exposed.indexOf(p) % 5]), all, ms, M: metrics(ms) }; }).filter(d => d.M);
    body.innerHTML = '';
    if (!data.length) { body.innerHTML = '<p class="muted">В этом режиме и периоде игр нет.</p>'; return; }
    const labels = data.map(d => d.p.name);
    const charts = [['Винрейт', d => d.M.wr, true], ['Смертей за игру', d => +d.M.deaths.toFixed(2), false], ['Доля игр с 10+ смертями', d => d.M.share10, true], ['KDA', d => +d.M.kda.toFixed(2), false], ['GPM', d => Math.round(d.M.gpm || 0), false], ['XPM', d => Math.round(d.M.xpm || 0), false], ['Помощи за игру', d => +d.M.assists.toFixed(1), false], ['Урон по героям', d => Math.round(d.M.hero_damage || 0), false]];
    const grid = el('div', { class: 'grid2' });
    charts.forEach(([title, fn, isPct], i) => {
      const box = el('div', { class: 'chart cv', style: 'height:220px' }, `<h4 style="margin:0 0 4px">${title}</h4><canvas id="cmp${i}"></canvas>`); grid.appendChild(box);
    });
    body.appendChild(el('section', null, `<h2>Ключевые метрики</h2><p class="lead">Игр в выборке: ${data.map(d => esc(d.p.name) + ' - ' + d.M.n).join(', ')}. Винрейт показан с 95% интервалом в таблице ниже.</p>`)).appendChild(grid);
    charts.forEach(([title, fn, isPct], i) => barChart($('#cmp' + i), labels, [{ data: data.map(fn), backgroundColor: data.map(d => d.color), borderRadius: 4, maxBarThickness: 48 }], { pct: isPct }));
    // таблица
    const row = (name, fn) => `<tr><td>${name}</td>${data.map(d => `<td class="num">${fn(d.M)}</td>`).join('')}</tr>`;
    body.insertAdjacentHTML('beforeend', `<section><h2>Таблица</h2><div class="tscroll" style="padding:0"><table class="cmp-table"><tr><th>метрика</th>${data.map(d => `<th class="num"><span class="dot" style="background:${d.color}"></span> ${esc(d.p.name)}</th>`).join('')}</tr>
      ${row('игр', m => m.n)}${row('винрейт', m => pct(m.wr) + ` <span class="mini">${pct(m.ci[1])}-${pct(m.ci[2])}</span>`)}${row('убийства / смерти / помощь', m => f1(m.kills) + ' / ' + f1(m.deaths) + ' / ' + f1(m.assists))}${row('KDA', m => f1(m.kda))}
      ${row('игр с 10+ смертями', m => pct(m.share10))}${row('игр с 6 и меньше смертями', m => pct(m.shareLe6))}${row('GPM / XPM', m => f0(m.gpm) + ' / ' + f0(m.xpm))}${row('добитых в минуту', m => f1(m.lhpm))}${row('урон по героям', m => f0(m.hero_damage))}${row('урон по башням', m => f0(m.tower_damage))}
      ${row('средняя игра, мин', m => f1(m.duration))}${row('разных героев', m => m.distinct)}${row('доля топ-3 героев', m => pct(m.top3))}${row('самые частые герои', m => m.topHeroes)}${row('пати из 5', m => m.party5 ? pct(m.party5.wr) + ` <span class="mini">${m.party5.n} игр</span>` : '-')}${row('соло', m => m.solo ? pct(m.solo.wr) + ` <span class="mini">${m.solo.n} игр</span>` : '-')}</table></div></section>`);
    // форма
    const roll = data.map(d => { const asc = d.all.slice().sort((a, b) => a.start_time - b.start_time).slice(-300); const buf = [], pts = []; asc.forEach(m => { buf.push(m.win); if (buf.length > 30) buf.shift(); if (buf.length >= 10) pts.push({ x: m.start_time, y: buf.reduce((a, b) => a + b, 0) / buf.length }); }); return pts; });
    const allX = [...new Set(roll.flat().map(p => p.x))].sort((a, b) => a - b);
    if (allX.length > 5) {
      body.insertAdjacentHTML('beforeend', `<section><h2>Форма</h2><p class="lead">Скользящий винрейт по последним 30 играм каждого, последние 300 игр режима (без фильтра периода).</p><div class="chart cv" style="height:280px"><canvas id="formChart"></canvas></div></section>`);
      const step = Math.max(1, Math.floor(allX.length / 120));
      const xs = allX.filter((_, i) => i % step === 0);
      const ds = data.map((d, i) => { const pts = roll[i]; let j = 0; return { label: d.p.name, borderColor: d.color, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: .25, spanGaps: true, data: xs.map(x => { while (j < pts.length - 1 && pts[j + 1].x <= x) j++; return (pts.length && pts[j].x <= x) ? pts[j].y : null; }) }; });
      lineChart($('#formChart'), xs.map(dt), ds, true);
    }
    // вместе
    if (data.length >= 2) {
      const sets = data.map(d => new Map(d.ms.map(m => [m.match_id, m])));
      const common = [...sets[0].keys()].filter(id => sets.every(s => s.has(id)) && new Set(data.map((d, i) => sets[i].get(id).is_radiant)).size === 1);
      const wrTog = common.length ? common.filter(id => sets[0].get(id).win).length / common.length : null;
      const perPlayer = data.map((d, i) => { const tog = common.map(id => sets[i].get(id)); const apart = d.ms.filter(m => !sets.every(s => s.has(m.match_id))); const a = k => tog.length ? tog.reduce((x, m) => x + m[k], 0) / tog.length : null; const aw = apart.length ? apart.filter(m => m.win).length / apart.length : null; return `<tr><td><span class="dot" style="background:${d.color}"></span> ${esc(d.p.name)}</td><td class="num">${f1(a('kills'))} / ${f1(a('deaths'))} / ${f1(a('assists'))}</td><td class="num">${f1(d.M.deaths)}</td><td class="num">${apart.length ? pct(aw) + ` <span class="mini">${apart.length} игр</span>` : '-'}</td></tr>`; }).join('');
      // попарная матрица
      const pairRows = data.map((a, i) => `<tr><td>${esc(a.p.name)}</td>${data.map((b, j) => { if (i === j) return '<td class="muted">-</td>'; const ids = [...sets[i].keys()].filter(id => sets[j].has(id) && sets[i].get(id).is_radiant === sets[j].get(id).is_radiant); const w = ids.filter(id => sets[i].get(id).win).length; return `<td>${ids.length ? pct(w / ids.length) + `<br><span class="mini">${ids.length} игр</span>` : '0'}</td>`; }).join('')}</tr>`).join('');
      body.insertAdjacentHTML('beforeend', `<section><h2>Вместе</h2><p class="lead">Игры, где все отмеченные были в одной команде: <b>${common.length}</b>${common.length ? `, винрейт вместе <b>${pct(wrTog)}</b> (ДИ ${pct(wilson(common.filter(id => sets[0].get(id).win).length, common.length)[1])}-${pct(wilson(common.filter(id => sets[0].get(id).win).length, common.length)[2])})` : ''}.</p>
        <div class="grid2"><div class="chart"><h4>В общих играх</h4><div class="tscroll" style="padding:0"><table><tr><th>игрок</th><th class="num">K/D/A вместе</th><th class="num">смертей в среднем (все игры)</th><th class="num">винрейт без остальных</th></tr>${perPlayer}</table></div></div>
        <div class="chart"><h4>Попарно: винрейт и число общих игр</h4><div class="tscroll" style="padding:0"><table class="matrix"><tr><th></th>${data.map(d => `<th>${esc(d.p.name)}</th>`).join('')}</tr>${pairRows}</table></div></div></div></section>`);
    }
  }

  window.DC = { state, esc, el, dt, pct, f1, f0, heroName, lineChart, barChart, barRow, wilson, SLOT, cssVar, route, getJSON };
  boot();
})();
