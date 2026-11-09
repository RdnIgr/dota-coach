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
  const games = n => { const a = n % 10, b = n % 100; return n + ' ' + (b >= 11 && b <= 14 ? 'игр' : a === 1 ? 'игра' : a >= 2 && a <= 4 ? 'игры' : 'игр'); };
  const diff = (wr, base) => { const d = Math.round((wr - base) * 100); return (d > 0 ? '+' : '') + d; };
  const points = n => { const a = n % 10, b = n % 100; return n + ' ' + (b >= 11 && b <= 14 ? 'пунктов' : a === 1 ? 'пункт' : a >= 2 && a <= 4 ? 'пункта' : 'пунктов'); };
  const diffWords = (wr, base) => { const d = Math.round((wr - base) * 100); return d === 0 ? 'как обычно' : `на ${points(Math.abs(d))} ${d > 0 ? 'выше' : 'ниже'} обычного`; };
  const CURIOSITY = new Set(['Час старта', 'День недели', 'Сторона карты', 'Номер игры в сессии', 'По длительности игры']);
  const MODE_NAMES = { ranked: 'Рейтинг', normal: 'Обычные', turbo: 'Турбо' };
  const LANE = { 1: 'сейфлейн', 2: 'мид', 3: 'оффлейн', 4: 'лес' };
  const SLOT = ['s1', 's2', 's3', 's4', 's5'];

  const state = { players: [], byAcc: {}, analysis: {}, narrative: {}, reviews: {}, matches: {}, heroes: {}, mode: 'ranked', meta: null,
    cmp: { sel: null, range: 'all', mode: 'ranked' }, charts: [] };

  // ---------- математика ----------
  function wilson(w, n, z) { z = z || 1.96; if (!n) return [0, 0, 0]; const p = w / n, den = 1 + z * z / n, c = p + z * z / (2 * n), adj = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [p, (c - adj) / den, (c + adj) / den]; }
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // Надежность среза одним словом: p - вероятность, что разница случайна; n - число игр.
  function reli(r) {
    if (r.n < 10) return { label: 'мало игр', cls: 'muted-chip', title: 'Меньше 10 игр - это догадка, а не закономерность' };
    if (r.p == null) return null;
    if (r.p < 0.01 && r.n >= 15) return { label: 'надежно', cls: 'good', title: 'Такая разница случайно возникает реже, чем в 1 случае из 100 (p=' + r.p.toFixed(3) + ')' };
    if (r.p < 0.05) return { label: 'возможно', cls: 'warn', title: 'Разница заметная, но может быть случайной (p=' + r.p.toFixed(3) + ')' };
    return { label: 'случайность', cls: 'muted-chip', title: 'Разница в пределах случайного разброса (p=' + r.p.toFixed(2) + ')' };
  }
  const reliChip = r => { const x = reli(r); return x ? ` <span class="chip ${x.cls}" title="${esc(x.title)}">${x.label}</span>` : ''; };

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
    } catch (e) { $('#app').innerHTML = `<p class="no">Не удалось загрузить данные: ${esc(e.message)}. Обнови страницу через минуту.</p>`; return; }
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
  const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/';
  function heroSlug(id) { const h = state.heroes[String(id)]; return h && h.npc ? h.npc.replace('npc_dota_hero_', '') : null; }
  // Маленькая иконка героя + имя. Картинки - с официального CDN Dota 2, как на OpenDota и Dotabuff.
  function hero(id, opts) { opts = opts || {}; const slug = heroSlug(id); const name = heroName(id); const img = slug ? `<img class="hicon${opts.big ? ' big' : ''}" src="${CDN}heroes/${opts.big ? '' : 'icons/'}${slug}.png" alt="" loading="lazy" width="${opts.big ? 64 : 24}" height="${opts.big ? 36 : 24}">` : ''; return `<span class="hero">${img}${opts.noName ? '' : `<span>${esc(name)}</span>`}</span>`; }
  function itemImg(key, label) { return `<span class="item"><img src="${CDN}items/${esc(key)}.png" alt="" loading="lazy" width="36" height="27"><span>${esc(label || key.replace(/_/g, ' '))}</span></span>`; }
  function medal(tier, size) { if (!tier) return ''; const s = size || 44; return `<span class="medal" style="width:${s}px;height:${s}px" title="${esc(rankName(tier))}"><img src="https://www.opendota.com/assets/images/dota2/rank_icons/rank_icon_${Math.floor(tier / 10)}.png" alt="">${tier % 10 ? `<img src="https://www.opendota.com/assets/images/dota2/rank_icons/rank_star_${tier % 10}.png" alt="">` : ''}</span>`; }
  function rankName(tier) { if (!tier) return 'без ранга'; const n = { 1: 'Herald', 2: 'Guardian', 3: 'Crusader', 4: 'Archon', 5: 'Legend', 6: 'Ancient', 7: 'Divine', 8: 'Immortal' }[Math.floor(tier / 10)] || '?'; return tier >= 80 ? 'Immortal' : `${n} ${tier % 10}`; }
  const AI = '<span class="ai" title="Текст написала модель по цифрам с этой страницы; числа она не придумывает"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>ИИ-тренер</span>';
  function renderNav() {
    const nav = $('#nav'); nav.innerHTML = '';
    nav.appendChild(el('button', { class: 'tab', 'data-slug': 'home', type: 'button' }, 'Обзор'));
    state.players.forEach(p => nav.appendChild(el('button', { class: 'tab' + (p.exposed ? '' : ' off'), 'data-slug': p.slug, type: 'button', title: p.exposed ? '' : 'статистика закрыта в настройках Dota 2' }, (p.avatar ? `<img class="tab-ava" src="${esc(p.avatar)}" alt="">` : '') + esc(p.name))));
    nav.appendChild(el('button', { class: 'tab', 'data-slug': 'compare', type: 'button' }, 'Сравнение'));
    nav.appendChild(el('button', { class: 'tab', 'data-slug': 'match', type: 'button' }, 'Разбор матча'));
    nav.addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) location.hash = b.dataset.slug; });
  }
  function renderFooter() {
    const m = state.meta;
    $('#foot').innerHTML = `<p>Все цифры - из открытой статистики OpenDota, обновляются сами каждые 3 часа; последнее обновление ${esc(new Date(m.updated * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}. Рейтинг, обычные и турбо никогда не смешиваются. Числа считает код, тексты тренера пишет модель по этим числам - ей запрещено их придумывать.</p><p>Методика разбора: atlasagents.uk/g/dota-coach.md.</p>`;
  }
  function route() {
    state.charts.forEach(c => { try { c.destroy(); } catch (e) { } }); state.charts = [];
    const h = (location.hash || '').replace('#', '');
    const slug = state.players.some(p => p.slug === h) ? h : (h === 'compare' ? 'compare' : (h.startsWith('match') ? 'match' : 'home'));
    document.querySelectorAll('.tab').forEach(t => { const on = t.dataset.slug === slug; t.setAttribute('aria-selected', String(on)); if (on && t.scrollIntoView) t.scrollIntoView({ inline: 'center', block: 'nearest' }); });
    const app = $('#app'); app.innerHTML = '';
    if (slug === 'home') renderHome(app); else if (slug === 'compare') renderCompare(app); else if (slug === 'match') { if (window.renderMatch) window.renderMatch(app); } else renderPlayer(app, state.players.find(p => p.slug === slug));
    window.scrollTo(0, 0);
  }

  // ---------- общие куски ----------
  function tile(label, value, note, hint) { return `<div class="tile"${hint ? ` title="${esc(hint)}"` : ''}><div class="tile-label">${esc(label)}</div><div class="tile-value">${value}</div><div class="tile-note">${esc(note || '')}</div></div>`; }
  function barRow(label, wr, lo, hi, n, base, opts) {
    opts = opts || {};
    const tag = opts.tag ? ` <span class="chip ${opts.tagCls || ''}">${esc(opts.tag)}</span>` : '';
    const chip = opts.row ? reliChip(opts.row) : '';
    return `<div class="brow"><div class="blabel">${label}${tag}</div>` +
      `<div class="btrack" title="${pct(wr)} побед в ${games(n)}; с поправкой на случайность от ${pct(lo)} до ${pct(hi)}"><div class="bfill ${opts.cls || 's1'}" style="width:${(wr * 100).toFixed(1)}%"></div>` +
      `<div class="bci" style="left:${(lo * 100).toFixed(1)}%;width:${(Math.max(0, hi - lo) * 100).toFixed(1)}%"></div>` +
      (base != null ? `<div class="bbase" style="left:${(base * 100).toFixed(1)}%"></div>` : '') + `</div>` +
      `<div class="bval"><b>${pct(wr)}</b><span class="bn">${games(n)}${chip}</span></div></div>`;
  }
  function barsFromTable(t, order) {
    let rows = t.rows.slice(); if (order) rows.sort((a, b) => (order.indexOf(a.group) + 99) % 99 - (order.indexOf(b.group) + 99) % 99);
    return rows.map(r => barRow(esc(r.group), r.wr, r.lo, r.hi, r.n, t.base, { row: r })).join('');
  }
  const barLegend = (base, extra) => `<div class="legend">${extra || ''}<span><i class="sw base"></i>твой обычный винрейт ${pct(base)}</span><span><i class="sw ci"></i>разброс из-за случайности</span></div>`;
  function htmlTable(t, open) {
    const body = t.rows.map(r => `<tr><td>${esc(r.group)}</td><td class="num">${r.n}</td><td class="num">${pct(r.wr)}</td><td class="num">${pct(r.lo)}-${pct(r.hi)}</td><td class="num">${diff(r.wr, t.base)}</td><td>${reliChip(r) || ''}</td></tr>`).join('');
    return `<details class="tbl"${open ? ' open' : ''}><summary>${esc(t.title)}</summary><div class="tscroll"><table><tr><th>срез</th><th class="num">игр</th><th class="num">побед</th><th class="num">разброс</th><th class="num">к обычному</th><th>надежность</th></tr>${body}</table></div></details>`;
  }
  function noChart(canvas) { if (typeof Chart !== 'undefined') return false; const box = canvas.parentElement; box.style.height = 'auto'; box.innerHTML = '<p class="muted" style="margin:0">График не загрузился - проверь соединение и обнови страницу. Те же числа есть в таблицах ниже.</p>'; return true; }
  function lineChart(canvas, labels, datasets, yPct) {
    if (noChart(canvas)) return null;
    const ink = cssVar('--ink2'), grid = cssVar('--grid');
    const c = new Chart(canvas, { type: 'line', data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: datasets.length > 1, labels: { color: ink, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + (yPct ? Math.round(ctx.parsed.y * 100) + '%' : ctx.parsed.y) } } },
      scales: { x: { ticks: { color: ink, maxTicksLimit: 6, maxRotation: 0 }, grid: { color: grid } }, y: { min: yPct ? 0 : undefined, max: yPct ? 1 : undefined, ticks: { color: ink, callback: v => yPct ? Math.round(v * 100) + '%' : v }, grid: { color: grid } } } } });
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
  const GLOSSARY = `<details class="tbl glossary"><summary>Как читать эти цифры</summary><div class="gbody">
    <p><b>Твой обычный винрейт</b> - доля побед во всех твоих играх этого режима. Все срезы сравниваются с ним, а не с 50%: вопрос не «хорошо ли это вообще», а «лучше или хуже, чем у тебя обычно».</p>
    <p><b>Разброс</b> - вилка вроде «от 43 до 60%». Винрейт на маленькой выборке скачет сам по себе; вилка показывает, где он на самом деле может быть. Чем больше игр, тем она уже.</p>
    <p><b>Надежность.</b> <span class="chip good">надежно</span> - разница с обычным слишком большая, чтобы быть случайной (и игр не меньше 15). <span class="chip warn">возможно</span> - похоже на закономерность, но может быть совпадением. <span class="chip muted-chip">случайность</span> - разницы, скорее всего, нет. <span class="chip muted-chip">мало игр</span> - меньше 10 игр, это догадка.</p>
    <p><b>Последние 150</b> - свежий срез. Если закономерность есть и во всех играх, и в последних 150, на нее стоит смотреть. Если только в старых - возможно, ты уже это поправил.</p>
    <p><b>Разобранный реплей</b> - OpenDota прочитала запись игры: оттуда видно золото по минутам, кто кого убил и когда, покупки, варды и драки. Без реплея есть только итоговая таблица матча.</p>
  </div></details>`;

  // ---------- обзор ----------
  function latestReviews(limit) {
    const all = [];
    state.players.forEach(p => (state.reviews[p.account_id] || []).forEach(r => all.push(Object.assign({ player: p }, r))));
    return all.sort((a, b) => (b.generated || b.start_time || 0) - (a.generated || a.start_time || 0)).slice(0, limit);
  }
  function reviewCard(r, withPlayer) {
    return `<a class="rev" href="#match/${r.match_id}">${hero(r.hero_id, { noName: true })}<span class="rev-body"><span class="rev-title">${withPlayer ? esc(r.player.name) + ' · ' : ''}${esc(heroName(r.hero_id))}${r.kda ? ' <span class="mono">' + r.kda.join('/') + '</span>' : ''} <span class="chip ${r.win ? 'good' : 'bad'}">${r.win ? 'победа' : 'поражение'}</span> <span class="mini">${dt(r.start_time)} · ${esc(r.mode || '')}</span></span><span class="rev-short">${esc(r.short || 'открыть разбор')}</span></span></a>`;
  }
  function renderHome(app) {
    const cards = state.players.map(p => {
      const an = state.analysis[p.account_id]; const r = an && an.modes && an.modes.ranked; const S = r && r.summary; const R = r && r.recent;
      const nar = state.narrative[p.account_id]; const revs = state.reviews[p.account_id] || [];
      if (!p.exposed || !S) return `<a class="pcard off" href="#${p.slug}">${p.avatar ? `<img class="avatar" src="${esc(p.avatar)}" alt="">` : '<span class="avatar"></span>'}<span class="pcard-body"><b>${esc(p.name)}</b><span class="mini">${esc(rankName(p.rank_tier))}</span><span class="pcard-note">Статистика закрыта в Dota 2 - нужно включить Expose Public Match Data</span></span></a>`;
      return `<a class="pcard" href="#${p.slug}">${p.avatar ? `<img class="avatar" src="${esc(p.avatar)}" alt="">` : '<span class="avatar"></span>'}<span class="pcard-body"><b>${esc(p.name)}</b><span class="pcard-rank">${medal(p.rank_tier, 28)}<span class="mini">${esc(rankName(p.rank_tier))} · последняя игра ${dt(p.last_match)}</span></span>
        <span class="pcard-stats"><span><b>${pct(S.wr)}</b><small>винрейт, ${games(S.n)}</small></span><span><b>${R ? pct(R.wr) : '-'}</b><small>последние ${R ? R.n : 150}</small></span><span><b>${f1(S.deaths)}</b><small>смертей за игру</small></span></span>
        <span class="pcard-note">${nar && nar.verdict ? esc(nar.verdict.split(/(?<=\.)\s/)[0]) : 'Вердикт тренера появится, когда наберется 20 рейтинговых игр.'}</span>
        <span class="pcard-foot">${nar ? AI + ' вердикт есть' : ''}${revs.length ? ` · разборов матчей: ${revs.length}` : ''}</span></span></a>`;
    }).join('');
    const feed = latestReviews(8);
    app.insertAdjacentHTML('beforeend', `<header class="phead"><div class="txt"><h1>Наш стак в цифрах</h1><p class="lead">Сайт собирает статистику пятерых из OpenDota, находит, что на самом деле влияет на результат, а ИИ-тренер пишет по этим цифрам вердикт и разбирает каждую новую игру. Выбери игрока - или открой свежий разбор ниже.</p></div></header>
      <div class="pcards">${cards}</div>
      <section><h2>Свежие разборы ${AI}</h2><p class="lead">После каждой игры тренер ждет, пока OpenDota прочитает реплей, и пишет: что решило игру, какие смерти были ошибкой, что исправить в следующих 10 играх.</p>${feed.length ? `<div class="chart list">${feed.map(r => reviewCard(r, true)).join('')}</div>` : '<p class="muted">Разборов пока нет - появятся после ближайших игр.</p>'}</section>
      <section><h2>Как этим пользоваться</h2><ol class="steps"><li><b>Открой свою вкладку.</b> Сверху - главные цифры и вердикт тренера, ниже - закономерности, герои, привычки и то, что видно по реплеям. Блок «Как читать эти цифры» объясняет пометки.</li><li><b>После игры зайди в «Разбор матча».</b> Там список свежих игр прямо из OpenDota: открой любую - увидишь линию, смерти, предметы, драки, а через час-два и разбор ИИ-тренера.</li><li><b>Раз в 30 рейтинговых игр</b> тренер сам пишет новый отчет с проверкой прошлого плана. В «Сравнении» видно, кто как играет и что получается вместе.</li></ol></section>`);
  }

  // ---------- страница игрока ----------
  function renderPlayer(app, p) {
    const an = state.analysis[p.account_id];
    const nar = state.narrative[p.account_id] || null;
    const head = `<header class="phead">${p.avatar ? `<img class="avatar" src="${esc(p.avatar)}" alt="">` : '<div class="avatar"></div>'}<div class="txt">
      <h1>${esc(p.name)}</h1>
      <p class="meta">${medal(p.rank_tier, 36)}<span class="chip">${esc(rankName(p.rank_tier))}</span><span class="chip">${games(p.matches)} в истории</span>${p.last_match ? `<span class="chip">последняя ${dt(p.last_match)}</span>` : ''}<a class="chip link" href="https://www.opendota.com/players/${p.account_id}" target="_blank" rel="noopener">OpenDota</a><a class="chip link" href="https://steamcommunity.com/profiles/${esc(p.steam_id64)}" target="_blank" rel="noopener">Steam</a></p>
      ${nar && nar.role ? `<p class="lead" style="margin:0">${esc(nar.role)}</p>` : ''}</div></header>`;
    app.insertAdjacentHTML('beforeend', head);
    if (!p.exposed || !an || an.empty || !an.modes || !Object.keys(an.modes).length) {
      app.insertAdjacentHTML('beforeend', `<div class="notice"><h3>Статистика пока закрыта</h3><p>OpenDota не видит матчи этого аккаунта, поэтому разбирать пока нечего. Чтобы открыть: в Dota 2 зайди в Настройки, вкладка Social, включи <b>Expose Public Match Data</b>. Больше ничего делать не нужно - сайт сам подтянет историю при следующем обновлении, обычно в течение нескольких часов.</p><p class="mini">Уже включил? Значит, OpenDota еще не успела забрать историю - загляни позже.</p></div>`);
      return;
    }
    const modes = Object.keys(an.modes).filter(m => an.modes[m].summary.n >= 5);
    if (!modes.includes(state.mode)) state.mode = modes[0];
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Режим игры' });
    modes.forEach(m => { const b = el('button', { type: 'button', 'aria-pressed': String(m === state.mode) }, `${MODE_NAMES[m] || m} <span class="mini">${an.modes[m].summary.n}</span>`); b.addEventListener('click', () => { state.mode = m; route(); }); seg.appendChild(b); });
    app.appendChild(seg);
    const M = an.modes[state.mode], S = M.summary, H = M.history, R = M.recent || null;
    const base = S.wr;
    const modeWord = state.mode === 'ranked' ? 'рейтинговых' : state.mode === 'turbo' ? 'турбо' : 'обычных';
    app.insertAdjacentHTML('beforeend', `<p class="lead intro">Ниже - твоя статистика по ${modeWord} играм: что работает, что сливает игры и что с этим делать. Начни с вердикта тренера и закономерностей, остальное - подробности.</p>
      <p class="actions"><a class="btn primary" href="#match" data-pick="${p.account_id}">Разобрать свежую игру</a></p>
      <nav class="subnav" aria-label="Разделы страницы">${[['coach', 'Вердикт тренера'], ['reviews', 'Разборы матчей'], ['facts', 'Закономерности'], ['deaths', 'Смерти'], ['heroes', 'Герои'], ['habits', 'Привычки'], ['replays', 'Реплеи']].map(([id, t]) => `<a href="#${p.slug}" data-jump="${id}">${t}</a>`).join('')}</nav>`);
    app.querySelector('.subnav').addEventListener('click', e => { const a = e.target.closest('[data-jump]'); if (!a) return; e.preventDefault(); const t = document.getElementById('sec-' + a.dataset.jump); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    app.querySelector('[data-pick]').addEventListener('click', () => { if (window.DCMatchPick) window.DCMatchPick(p.account_id); });
    app.insertAdjacentHTML('beforeend', `<div class="tiles">` +
      tile('Винрейт за все время', pct(S.wr), `${games(S.n)} с ${dt(S.first)}; разброс ${pct(S.ci[0])}-${pct(S.ci[1])}`) +
      (R && R.n >= 20 ? tile(`Последние ${R.n} игр`, pct(R.wr), `с ${dt(R.first)}; разброс ${pct(R.ci[0])}-${pct(R.ci[1])}`) : '') +
      tile('Последние 50 игр', pct(S.last50_wins / Math.max(1, S.last50_n)), `${S.last50_wins} побед из ${S.last50_n}`) +
      tile('Смертей за игру', f1(S.deaths), R ? `в последних ${R.n}: ${f1(R.deaths)}` : '') +
      tile('Убийства / смерти / помощь', `<span class="vsm">${f1(S.kills)} / ${f1(S.deaths)} / ${f1(S.assists)}</span>`, `KDA ${f1(S.kda)}`) +
      (S.gpm ? tile('Золото и опыт в минуту', `<span class="vsm">${f0(S.gpm)} / ${f0(S.xpm)}</span>`, `добитых за игру ${f0(S.lh)}`) : '') + `</div>`);
    app.insertAdjacentHTML('beforeend', GLOSSARY);

    // тренер
    if (nar && nar.verdict && state.mode === 'ranked') {
      app.insertAdjacentHTML('beforeend', `<section class="verdict" id="sec-coach"><h2>Вердикт тренера ${nar.source === 'ai' ? AI : '<span class="ai manual">написан вручную</span>'}</h2><p>${esc(nar.verdict)}</p>${nar.plan_review ? `<p style="margin-top:8px"><b>Как прошел прошлый план.</b> ${esc(nar.plan_review)}</p>` : ''}<p class="mini" style="margin-top:8px">Отчет от ${esc(nar.report_date || '')}. Проверка плана: ${esc(nar.check_date || '')}. Следующий отчет появится сам через 30 рейтинговых игр. Полный разбор - плюсы, минусы и план - ниже на этой странице.</p></section>`);
    } else if (state.mode === 'ranked') {
      app.insertAdjacentHTML('beforeend', `<section class="verdict" id="sec-coach"><h2>Вердикт тренера ${AI}</h2><p class="muted" style="margin:0">Отчета пока нет: тренер пишет его, когда у игрока есть хотя бы 20 рейтинговых игр, и обновляет каждые 30 игр.</p></section>`);
    }

    // закономерности
    const fnd = M.findings || [];
    app.insertAdjacentHTML('beforeend', `<section id="sec-facts"><h2>Что точно влияет на твой результат</h2><p class="lead">Срезы, где разница с обычным винрейтом ${pct(base)} слишком большая, чтобы быть случайной. Зеленая пометка - то же самое видно и на последних ${R ? R.n : 150} играх, значит, это актуально сейчас.</p><div class="chart list">` +
      (fnd.length ? fnd.map(f => `<div class="finding"><b>${pct(f.wr)}</b><span>${esc(f.table.toLowerCase())}: <b>${esc(f.group)}</b> - ${games(f.n)}, ${diffWords(f.wr, f.base)}${f.holds_recent === true ? ` <span class="chip good">держится на последних ${f.recent_n}</span>` : f.holds_recent === false ? ` <span class="chip warn">на последних ${f.recent_n} не повторяется</span>` : ''}${CURIOSITY.has(f.table) ? ' <span class="chip muted-chip" title="На это нельзя повлиять, и такие срезы часто оказываются совпадением">любопытно, но не совет</span>' : ''}</span></div>`).join('') : '<p class="muted" style="margin:0">Пока ни один срез не дотянул до «надежно» - нужно больше игр.</p>') + `</div></section>`);

    // разборы матчей тренером
    const revs = (state.reviews[p.account_id] || []).slice(0, 12);
    app.insertAdjacentHTML('beforeend', `<section id="sec-reviews"><h2>Разборы матчей ${AI}</h2><p class="lead">После каждой игры сайт ждет, пока OpenDota прочитает реплей (обычно час-два), и тренер пишет разбор: что решило игру, какие смерти были ошибкой, что исправить в следующих 10 играх. Нажми на любой.</p>` +
      (revs.length ? `<div class="chart list">${revs.map(r => reviewCard(r, false)).join('')}</div>` : '<p class="muted">Разборов пока нет. Первый появится после ближайшей игры.</p>') + `</section>`);

    // форма
    if (M.series.rolling30.length > 5) {
      const sec = el('section', { id: 'sec-form' }, `<h2>Как идет форма</h2><p class="lead">Винрейт по последним 30 играм на каждую дату. Пунктир - твой обычный винрейт: линия выше него значит, что сейчас ты играешь лучше своего среднего.</p><div class="chart cv" style="height:240px"><canvas id="rollChart"></canvas></div>`);
      app.appendChild(sec);
      const pts = M.series.rolling30;
      lineChart($('#rollChart'), pts.map(x => dt(x[0])), [
        { label: 'винрейт последних 30 игр', data: pts.map(x => x[1]), borderColor: cssVar('--s1'), backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: 'обычный винрейт', data: pts.map(() => base), borderColor: cssVar('--muted'), borderDash: [4, 4], borderWidth: 1, pointRadius: 0 }], true);
    }

    // смерти
    const dT = M.tables.find(t => t.section === 'deaths');
    const rT = R && R.tables.find(t => t.section === 'deaths');
    let groups = '';
    ['0-3', '4-6', '7-9', '10+'].forEach(k => {
      const a = dT && dT.rows.find(x => x.group === k), r = rT && rT.rows.find(x => x.group === k);
      let inner = '';
      if (a) inner += barRow('все игры', a.wr, a.lo, a.hi, a.n, base, { cls: 's1', row: a });
      if (r) inner += barRow(`последние ${R.n}`, r.wr, r.lo, r.hi, r.n, R.wr, { cls: 's2', row: r });
      if (inner) groups += `<div class="bgroup"><div class="bgroup-title">${k} смертей за игру</div>${inner}</div>`;
    });
    app.insertAdjacentHTML('beforeend', `<section id="sec-deaths"><h2>Сколько смертей ты можешь себе позволить</h2><p class="lead">Винрейт в зависимости от числа смертей за игру. Честная оговорка: проигранная игра сама по себе дает больше смертей, так что это связь, а не доказанная причина. Где именно ты умираешь, видно по реплеям ниже.</p>
      <div class="chart">${barLegend(base, `<span><i class="sw s1"></i>все игры</span><span><i class="sw s2"></i>последние ${R ? R.n : 150}</span>`)}${groups}</div>
      <p class="src">Игр с 10 и больше смертями: ${pct(S.share_10plus)} от всех${R ? `, ${pct(R.share_10plus)} среди последних ${R.n}` : ''}. В победах ты умираешь в среднем ${f1(M.deaths.in_wins)} раз, в поражениях ${f1(M.deaths.in_losses)}.</p></section>`);

    // тренер: плюсы/минусы/план
    if (nar && state.mode === 'ranked') {
      const cards = (items, kind) => items.map(it => `<article class="card ${kind}"><h4><span class="mark"></span>${esc(it.title)}</h4><p>${esc(it.text)}</p></article>`).join('');
      app.insertAdjacentHTML('beforeend', `<div class="two" id="sec-plan"><section><h2>Что у тебя получается ${AI}</h2>${cards(nar.pluses || [], 'plus')}</section><section><h2>Что сливает игры ${AI}</h2>${cards(nar.minuses || [], 'minus')}</section></div>`);
      const plan = (nar.plan || []).map((x, i) => `<article class="plan"><div class="plan-no">Совет ${i + 1} из ${(nar.plan || []).length}</div><h4>${esc(x.title)}</h4><dl><dt>Что меряем</dt><dd>${esc(x.metric)}</dd><dt>Сейчас</dt><dd>${esc(x.base)}</dd><dt>Цель</dt><dd>${esc(x.target)}</dd><dt>Как</dt><dd>${esc(x.how)}</dd></dl></article>`).join('');
      app.insertAdjacentHTML('beforeend', `<section><h2>План на следующие 30 рейтинговых игр ${AI}</h2><p class="lead">Три вещи, на которых стоит сосредоточиться. У каждой есть число, по которому через 30 игр будет видно, сработало или нет. Проверка: ${esc(nar.check_date || '')}.</p><div class="plans">${plan}</div></section>`);
      app.insertAdjacentHTML('beforeend', `<div class="two"><section><h2>На что не стоит тратить внимание</h2><p class="lead">Это проверяли - закономерности нет.</p><ul class="plain">${(nar.noise || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></section><section><h2>Вопросы к тебе</h2><p class="lead">Без ответов разбор неполный - напиши их тому, кто ведет сайт.</p><ul class="plain">${(nar.questions || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></section></div>`);
    }

    // герои
    const poolName = x => String(x).split(/\s[-–(]/)[0].trim();
    const keep = new Set(((nar && nar.hero_pool && nar.hero_pool.keep) || []).map(poolName)), drop = new Set(((nar && nar.hero_pool && nar.hero_pool.drop) || []).map(poolName));
    const heroRows = M.heroes.map((r, i) => `<tr${i >= 12 ? ' class="more" hidden' : ''}><td>${hero(r.hero_id)}${keep.has(r.hero) ? ' <span class="chip good">в пул</span>' : ''}${drop.has(r.hero) ? ' <span class="chip bad">убрать</span>' : ''}</td><td class="num">${r.n}</td><td class="num">${pct(r.wr)}</td><td class="num">${pct(r.lo)}-${pct(r.hi)}</td><td>${reliChip(r) || ''}</td><td class="num">${r.recent_n ? r.recent_wins + ' из ' + r.recent_n : '-'}</td><td class="num">${f1(r.k)}/${f1(r.d)}/${f1(r.a)}</td><td class="num">${f0(r.gpm)}</td><td class="num">${f0(r.xpm)}</td><td class="num">${f1(r.lhpm)}</td><td>${(r.roles || []).map(x => x[0] + ' ×' + x[1]).join(', ') || '-'}</td></tr>`).join('');
    const histHeroes = H && H.heroes ? H.heroes.filter(h => h.n >= 20).map(h => barRow(hero(h.hero_id), h.wr, h.lo, h.hi, h.n, H.wr, { tag: keep.has(h.hero) ? 'в пул' : (drop.has(h.hero) ? 'убрать' : ''), tagCls: keep.has(h.hero) ? 'good' : 'bad', cls: keep.has(h.hero) ? 'good' : (drop.has(h.hero) ? 'bad' : 's1'), row: h })).join('') : '';
    app.insertAdjacentHTML('beforeend', `<section id="sec-heroes"><h2>Герои</h2><p class="lead">За все время - ${S.distinct_heroes} разных героев, три самых частых дали ${pct(S.top3_share)} игр${R ? `; за последние ${R.n} игр - ${R.distinct_heroes} героев, топ-3 закрывают ${pct(R.top3_share)}` : ''}. Пометки «в пул» и «убрать» - из плана тренера.</p>
      ${heroRows ? `<div class="tscroll sticky-first"><table><tr><th>герой</th><th class="num">игр</th><th class="num">побед</th><th class="num">разброс</th><th>надежность</th><th class="num">последние ${R ? R.n : 150}</th><th class="num">K/D/A</th><th class="num">GPM</th><th class="num">XPM</th><th class="num">доб/мин</th><th>позиция</th></tr>${heroRows}</table></div>${M.heroes.length > 12 ? `<p class="actions" style="margin:10px 0 0"><button class="btn" type="button" data-more>Показать еще ${games(M.heroes.length - 12).replace(/игр[аы]?/, m => ({ 'игра': 'героя', 'игры': 'героя', 'игр': 'героев' })[m])}</button></p>` : ''}<p class="src">В таблице герои с 10 и больше играми. GPM, XPM и добитые в минуту - средние по этим играм.</p>` : '<p class="muted">Пока нет героев с 10 и больше играми.</p>'}
      ${histHeroes ? `<h3 style="margin-top:18px">Герои с 20+ играми за все время</h3><div class="chart">${barLegend(H.wr)}${histHeroes}</div>` : ''}</section>`);

    const moreBtn = app.querySelector('[data-more]');
    if (moreBtn) moreBtn.addEventListener('click', () => { app.querySelectorAll('tr.more').forEach(tr => tr.hidden = false); moreBtn.closest('p').remove(); });

    // привычки
    const partyT = M.tables.find(t => t.title === 'Соло или пати'), sideT = M.tables.find(t => t.title === 'Сторона карты'), posT = M.tables.find(t => t.title.startsWith('Позиция'));
    app.insertAdjacentHTML('beforeend', `<section id="sec-habits"><h2>Когда и с кем ты играешь лучше</h2><p class="lead">Винрейт по обстоятельствам игры. Смотри на пометки надежности: час старта и сторона карты почти всегда оказываются случайностью.</p><div class="grid2">
      ${partyT ? `<div class="chart"><h4>Один или в пати</h4>${barLegend(base)}${barsFromTable(partyT, ['соло', 'пати из 2', 'пати из 3', 'пати из 4', 'пати из 5'])}</div>` : ''}
      ${sideT ? `<div class="chart"><h4>Сторона карты</h4>${barLegend(base)}${barsFromTable(sideT, ['Radiant', 'Dire'])}</div>` : ''}
      ${posT && posT.rows.length ? `<div class="chart"><h4>Позиция (где она известна)</h4>${barLegend(base)}${barsFromTable(posT)}</div>` : ''}
      </div><h3 style="margin-top:18px">Подробные таблицы</h3><p class="lead">Для тех, кто хочет покопаться: месяцы, длительность, час старта, номер игры в сессии, серии поражений.</p>${M.tables.filter(t => ['layer1', 'habits'].includes(t.section) && !['Соло или пати', 'Сторона карты'].includes(t.title)).map(t => htmlTable(t)).join('')}${H ? H.tables.filter(t => !t.title.startsWith('Смерти')).map(t => htmlTable(t)).join('') : ''}</section>`);

    // разобранные матчи
    renderParsed(app, M, p);
  }

  function renderParsed(app, M, p) {
    const P = M.parsed || { n: 0 };
    if (!P.n) {
      app.insertAdjacentHTML('beforeend', `<section id="sec-replays"><h2>Что видно по реплеям</h2><div class="notice"><p>В этом режиме разобранных реплеев пока нет${P.pending ? ` (${P.pending} ждут очереди в OpenDota)` : ''}. Разбираются только свежие игры, и сайт запрашивает их сам. Как появятся, здесь будет линия на 10 минуте, тайминги предметов, варды и журнал ошибок.</p></div></section>`);
      return;
    }
    const L = P.lane || {};
    const lane = `<div class="chart"><h4>Линия до 10 минуты</h4>
      ${L.won && L.won.n ? barRow('линия выиграна по золоту', L.won.wr, wilson(L.won.wins, L.won.n)[1], wilson(L.won.wins, L.won.n)[2], L.won.n, M.summary.wr, { row: { n: L.won.n, p: L.p } }) : ''}
      ${L.lost && L.lost.n ? barRow('линия проиграна', L.lost.wr, wilson(L.lost.wins, L.lost.n)[1], wilson(L.lost.wins, L.lost.n)[2], L.lost.n, M.summary.wr, { cls: 's2', row: { n: L.lost.n, p: L.p } }) : ''}
      <p class="src">К 10-й минуте ты в среднем ${L.gd10_avg >= 0 ? 'впереди' : 'позади'} соперника по линии на ${Math.abs(Math.round(L.gd10_avg || 0))} золота (в победах ${f0(L.gd10_wins)}, в поражениях ${f0(L.gd10_losses)}). Добитых к 10 минуте: ${f1(L.lh10_avg)}. Смертей до 10 минуты: ${f1(L.early_deaths_per_game)} за игру${L.early_killers && L.early_killers.length ? '; чаще всего убивали ' + L.early_killers.map(x => x[0] + ' ×' + x[1]).join(', ') : ''}. Позиции в этих играх: ${(L.roles || []).map(x => x[0] + ' ×' + x[1]).join(', ')}.</p></div>`;
    const items = (P.items || []).length ? `<div class="tscroll sticky-first"><table><tr><th>герой</th><th>предмет</th><th class="num">игр</th><th class="num">минута, в среднем</th><th class="num">в победах</th><th class="num">в поражениях</th></tr>${P.items.map(x => `<tr><td>${esc(x.hero)}</td><td>${itemImg(x.item)}</td><td class="num">${x.n}</td><td class="num">${f1(x.avg)}</td><td class="num">${f1(x.wins_avg)}</td><td class="num">${f1(x.losses_avg)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Появится, когда наберется 3 разобранных игры на одном герое с одним и тем же предметом.</p>';
    const W = P.wards || {};
    const journal = `<div class="tscroll sticky-first"><table><tr><th>что случилось</th><th class="num">в скольких играх</th><th class="num">винрейт с этим</th><th class="num">без этого</th><th>надежность</th></tr>${(P.journal || []).map(j => `<tr><td>${esc(j.flag)}</td><td class="num">${j.n} из ${P.n}</td><td class="num">${pct(j.wr)}</td><td class="num">${pct(j.wr_without)}</td><td>${reliChip({ n: j.n, p: j.p }) || ''}</td></tr>`).join('')}</table></div>`;
    const bm = P.benchmarks_avg_pct || {};
    const bmNames = { gold_per_min: 'золото в минуту', xp_per_min: 'опыт в минуту', kills_per_min: 'убийства', last_hits_per_min: 'добитые', hero_damage_per_min: 'урон по героям', hero_healing_per_min: 'лечение', tower_damage: 'урон по башням', stuns_per_min: 'контроль', lhten: 'добитых к 10 минуте' };
    const bmRows = Object.keys(bm).filter(k => bmNames[k]).map(k => `<div class="brow"><div class="blabel">${bmNames[k]}</div><div class="btrack" title="лучше, чем у ${Math.round(bm[k] * 100)}% игроков на этом герое"><div class="bfill" style="width:${(bm[k] * 100).toFixed(1)}%"></div><div class="bbase" style="left:50%"></div></div><div class="bval"><b>${Math.round(bm[k] * 100)}%</b><span class="bn">игроков позади</span></div></div>`).join('');
    const recent = (P.matches || []).slice(0, 25).map(m => `<tr><td><a href="#match/${m.match_id}">${dt(m.start_time)}</a></td><td>${hero(m.hero_id)}</td><td>${LANE[m.lane_role] || '-'}</td><td class="${m.win ? 'ok' : 'no'}">${m.win ? 'победа' : 'поражение'}</td><td class="num">${m.kills}/${m.deaths}/${m.assists}</td><td class="num">${m.gd10 == null ? '-' : (m.gd10 > 0 ? '+' : '') + m.gd10}</td><td class="num">${m.early_deaths}</td><td class="num">${m.deaths_outside_fight}</td><td class="num">${m.obs}/${m.sen}</td><td>${m.thrown ? '<span class="chip bad">слили перевес</span>' : ''}${m.comeback ? '<span class="chip good">камбэк</span>' : ''}</td></tr>`).join('');
    app.insertAdjacentHTML('beforeend', `<section id="sec-replays"><h2>Что видно по реплеям</h2><p class="lead">Разобрано ${games(P.n)} этого режима${P.pending ? `, еще ${P.pending} ждут очереди` : ''}${P.too_old ? `, ${P.too_old} старше двух недель и уже не разберутся (Valve хранит реплеи ограниченное время)` : ''}. Это самые точные данные: не итог матча, а то, что происходило внутри.</p>
      <div class="grid2">${lane}<div class="chart"><h4>Карта и активность</h4><p class="src" style="margin:0 0 10px">За игру в среднем: обзорных вардов ${f1(W.obs)}, сентри ${f1(W.sen)}, снято чужих ${f1(W.obs_killed)}, стаков ${f1(W.stacks)}.</p>${bmRows ? `<h4>Сравнение с другими игроками на тех же героях</h4><p class="mini">Полоса - доля игроков, которых ты обходишь. Черта посередине - медиана. Для сапорта низкие золото и добитые - норма, важнее контроль и урон.</p>${bmRows}` : ''}</div></div>
      <h3 style="margin-top:18px">Когда покупаешь ключевые предметы</h3>${items}
      <h3 style="margin-top:18px">Журнал ошибок</h3><p class="lead">Каждая разобранная игра проверяется на типовые ошибки. Сравни винрейт «с этим» и «без этого»: чем больше разрыв, тем дороже ошибка обходится.</p>${journal}
      <h3 style="margin-top:18px">Разобранные матчи</h3><p class="lead">Нажми на дату, чтобы открыть полный разбор игры.</p><div class="tscroll sticky-first"><table><tr><th>дата</th><th>герой</th><th>позиция</th><th>итог</th><th class="num">K/D/A</th><th class="num">золото vs линия, 10 мин</th><th class="num">смертей до 10'</th><th class="num">вне драк</th><th class="num">обс/сен</th><th></th></tr>${recent}</table></div></section>`);
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
    app.insertAdjacentHTML('beforeend', `<header class="phead"><div class="txt"><h1>Сравнение</h1><p class="lead">Кто из стака как играет и что получается вместе. Отметь игроков, выбери режим и период - все пересчитается сразу.</p></div></header>`);
    const checks = el('div', { class: 'checks' });
    exposed.forEach((p, i) => {
      const lab = el('label', null, `<input type="checkbox" ${state.cmp.sel.has(p.account_id) ? 'checked' : ''} data-acc="${p.account_id}"><span class="dot" style="background:var(--${SLOT[i % 5]})"></span>${p.avatar ? `<img class="tab-ava" src="${esc(p.avatar)}" alt="">` : ''}${esc(p.name)}`);
      lab.querySelector('input').addEventListener('change', e => {
        if (e.target.checked) state.cmp.sel.add(p.account_id); else if (state.cmp.sel.size > 1) state.cmp.sel.delete(p.account_id); else { e.target.checked = true; return; }
        route();
      });
      checks.appendChild(lab);
    });
    app.appendChild(checks);
    const row1 = el('div', { class: 'segrow' });
    const ctrl = el('div', { class: 'seg', role: 'group', 'aria-label': 'Режим' });
    [['ranked', 'Рейтинг'], ['normal', 'Обычные'], ['turbo', 'Турбо']].forEach(([k, v]) => { const b = el('button', { type: 'button', 'aria-pressed': String(state.cmp.mode === k) }, v); b.addEventListener('click', () => { state.cmp.mode = k; route(); }); ctrl.appendChild(b); });
    const rng = el('div', { class: 'seg', role: 'group', 'aria-label': 'Период' });
    [['all', 'Все время'], ['last100', 'Последние 100'], ['days90', '90 дней'], ['days30', '30 дней']].forEach(([k, v]) => { const b = el('button', { type: 'button', 'aria-pressed': String(state.cmp.range === k) }, v); b.addEventListener('click', () => { state.cmp.range = k; route(); }); rng.appendChild(b); });
    row1.appendChild(ctrl); row1.appendChild(rng); app.appendChild(row1);
    const body = el('div'); app.appendChild(body); body.innerHTML = '<p class="muted">Считаю...</p>';
    const sel = exposed.filter(p => state.cmp.sel.has(p.account_id));
    await Promise.all(sel.map(async p => { if (!state.matches[p.account_id]) state.matches[p.account_id] = await getJSON(`data/${p.account_id}/matches.json`, true); }));
    const data = sel.map(p => { const all = rowsOf(p.account_id).filter(m => modeOf(m) === state.cmp.mode); const ms = filterRange(all); return { p, color: cssVar('--' + SLOT[exposed.indexOf(p) % 5]), all, ms, M: metrics(ms) }; }).filter(d => d.M);
    body.innerHTML = '';
    if (!data.length) { body.innerHTML = '<p class="muted">За этот период в этом режиме игр нет. Попробуй другой период.</p>'; return; }
    const labels = data.map(d => d.p.name);
    const charts = [['Винрейт', d => d.M.wr, true], ['Смертей за игру', d => +d.M.deaths.toFixed(2), false], ['Игр с 10+ смертями', d => d.M.share10, true], ['KDA', d => +d.M.kda.toFixed(2), false], ['Золото в минуту', d => Math.round(d.M.gpm || 0), false], ['Опыт в минуту', d => Math.round(d.M.xpm || 0), false], ['Помощи за игру', d => +d.M.assists.toFixed(1), false], ['Урон по героям за игру', d => Math.round(d.M.hero_damage || 0), false]];
    const grid = el('div', { class: 'grid3' });
    charts.forEach(([title, fn, isPct], i) => {
      const box = el('div', { class: 'chart cv', style: 'height:200px' }, `<h4 style="margin:0 0 4px">${title}</h4><canvas id="cmp${i}"></canvas>`); grid.appendChild(box);
    });
    body.appendChild(el('section', null, `<h2>Главные цифры</h2><p class="lead">В выборке: ${data.map(d => esc(d.p.name) + ' - ' + games(d.M.n)).join(', ')}.</p>`)).appendChild(grid);
    charts.forEach(([title, fn, isPct], i) => barChart($('#cmp' + i), labels, [{ data: data.map(fn), backgroundColor: data.map(d => d.color), borderRadius: 4, maxBarThickness: 48 }], { pct: isPct }));
    const row = (name, fn) => `<tr><td>${name}</td>${data.map(d => `<td class="num">${fn(d.M)}</td>`).join('')}</tr>`;
    body.insertAdjacentHTML('beforeend', `<section><h2>Все метрики таблицей</h2><div class="tscroll sticky-first"><table class="cmp-table"><tr><th>метрика</th>${data.map(d => `<th class="num"><span class="dot" style="background:${d.color}"></span> ${esc(d.p.name)}</th>`).join('')}</tr>
      ${row('игр', m => m.n)}${row('винрейт', m => pct(m.wr) + ` <span class="mini">${pct(m.ci[1])}-${pct(m.ci[2])}</span>`)}${row('убийства / смерти / помощь', m => f1(m.kills) + ' / ' + f1(m.deaths) + ' / ' + f1(m.assists))}${row('KDA', m => f1(m.kda))}
      ${row('игр с 10+ смертями', m => pct(m.share10))}${row('игр с 6 и меньше смертями', m => pct(m.shareLe6))}${row('золото / опыт в минуту', m => f0(m.gpm) + ' / ' + f0(m.xpm))}${row('добитых в минуту', m => f1(m.lhpm))}${row('урон по героям', m => f0(m.hero_damage))}${row('урон по башням', m => f0(m.tower_damage))}
      ${row('средняя игра, минут', m => f1(m.duration))}${row('разных героев', m => m.distinct)}${row('доля трех самых частых героев', m => pct(m.top3))}${row('самые частые герои', m => m.topHeroes)}${row('в пати из 5', m => m.party5 ? pct(m.party5.wr) + ` <span class="mini">${games(m.party5.n)}</span>` : '-')}${row('соло', m => m.solo ? pct(m.solo.wr) + ` <span class="mini">${games(m.solo.n)}</span>` : '-')}</table></div><p class="src">Маленькие серые цифры рядом с винрейтом - разброс из-за случайности.</p></section>`);
    // форма
    const roll = data.map(d => { const asc = d.all.slice().sort((a, b) => a.start_time - b.start_time).slice(-300); const buf = [], pts = []; asc.forEach(m => { buf.push(m.win); if (buf.length > 30) buf.shift(); if (buf.length >= 10) pts.push({ x: m.start_time, y: buf.reduce((a, b) => a + b, 0) / buf.length }); }); return pts; });
    const allX = [...new Set(roll.flat().map(p => p.x))].sort((a, b) => a - b);
    if (allX.length > 5) {
      body.insertAdjacentHTML('beforeend', `<section><h2>Как идет форма у каждого</h2><p class="lead">Винрейт по последним 30 играм на каждую дату, последние 300 игр режима. Период выше на этот график не влияет.</p><div class="chart cv" style="height:280px"><canvas id="formChart"></canvas></div></section>`);
      const step = Math.max(1, Math.floor(allX.length / 120));
      const xs = allX.filter((_, i) => i % step === 0);
      const ds = data.map((d, i) => { const pts = roll[i]; let j = 0; return { label: d.p.name, borderColor: d.color, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: .25, spanGaps: true, data: xs.map(x => { while (j < pts.length - 1 && pts[j + 1].x <= x) j++; return (pts.length && pts[j].x <= x) ? pts[j].y : null; }) }; });
      lineChart($('#formChart'), xs.map(dt), ds, true);
    }
    // вместе
    if (data.length >= 2) {
      const sets = data.map(d => new Map(d.ms.map(m => [m.match_id, m])));
      const common = [...sets[0].keys()].filter(id => sets.every(s => s.has(id)) && new Set(data.map((d, i) => sets[i].get(id).is_radiant)).size === 1);
      const cw = common.filter(id => sets[0].get(id).win).length;
      const perPlayer = data.map((d, i) => { const tog = common.map(id => sets[i].get(id)); const apart = d.ms.filter(m => !sets.every(s => s.has(m.match_id))); const a = k => tog.length ? tog.reduce((x, m) => x + m[k], 0) / tog.length : null; const aw = apart.length ? apart.filter(m => m.win).length / apart.length : null; return `<tr><td><span class="dot" style="background:${d.color}"></span> ${esc(d.p.name)}</td><td class="num">${f1(a('kills'))} / ${f1(a('deaths'))} / ${f1(a('assists'))}</td><td class="num">${f1(d.M.deaths)}</td><td class="num">${apart.length ? pct(aw) + ` <span class="mini">${games(apart.length)}</span>` : '-'}</td></tr>`; }).join('');
      const pairRows = data.map((a, i) => `<tr><td>${esc(a.p.name)}</td>${data.map((b, j) => { if (i === j) return '<td class="muted">-</td>'; const ids = [...sets[i].keys()].filter(id => sets[j].has(id) && sets[i].get(id).is_radiant === sets[j].get(id).is_radiant); const w = ids.filter(id => sets[i].get(id).win).length; return `<td>${ids.length ? pct(w / ids.length) + `<br><span class="mini">${games(ids.length)}</span>` : '0'}</td>`; }).join('')}</tr>`).join('');
      body.insertAdjacentHTML('beforeend', `<section><h2>Что получается вместе</h2><p class="lead">Игр, где все отмеченные были в одной команде: <b>${common.length}</b>${common.length ? `, выиграно <b>${pct(cw / common.length)}</b> (разброс ${pct(wilson(cw, common.length)[1])}-${pct(wilson(cw, common.length)[2])})` : ''}.</p>
        <div class="grid2"><div class="chart"><h4>Каждый в общих играх</h4><div class="tscroll sticky-first"><table><tr><th>игрок</th><th class="num">K/D/A вместе</th><th class="num">смертей обычно</th><th class="num">винрейт без остальных</th></tr>${perPlayer}</table></div></div>
        <div class="chart"><h4>Парами: винрейт и число общих игр</h4><div class="tscroll sticky-first"><table class="matrix"><tr><th></th>${data.map(d => `<th>${esc(d.p.name)}</th>`).join('')}</tr>${pairRows}</table></div></div></div></section>`);
    }
  }

  window.DC = { state, esc, el, dt, pct, f1, f0, games, heroName, hero, itemImg, medal, rankName, AI, lineChart, barChart, barRow, reliChip, wilson, SLOT, cssVar, route, getJSON };
  boot();
})();
