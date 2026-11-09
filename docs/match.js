/* Разбор конкретного матча по кнопке: браузер сам ходит в OpenDota (CORS открыт), сервер не нужен. */
(function () {
  'use strict';
  const API = 'https://api.opendota.com/api';
  const D = () => window.DC;
  const mm = s => { if (s == null) return '-'; const neg = s < 0; s = Math.abs(Math.round(s)); return (neg ? '-' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const itemName = k => k ? k.replace(/^item_/, '').replace(/_/g, ' ') : '';
  const KEY_ITEMS = new Set(['black_king_bar', 'blink', 'manta', 'bfury', 'desolator', 'radiance', 'maelstrom', 'orchid', 'diffusal_blade', 'echo_sabre', 'ultimate_scepter', 'sange_and_yasha', 'mjollnir', 'satanic', 'butterfly', 'monkey_king_bar', 'shadow_blade', 'silver_edge', 'hand_of_midas', 'power_treads', 'phase_boots', 'arcane_boots', 'travel_boots', 'aghanims_shard', 'glimmer_cape', 'force_staff', 'aether_lens', 'guardian_greaves', 'pipe', 'crimson_guard', 'heart', 'assault', 'skadi', 'basher', 'abyssal_blade', 'bloodthorn', 'sheepstick', 'refresher', 'octarine_core', 'lotus_orb', 'linken_sphere', 'hurricane_pike', 'dragon_lance', 'solar_crest', 'spirit_vessel', 'vladmir', 'mekansm', 'shivas_guard', 'eternal_shroud', 'harpoon', 'disperser', 'nullifier', 'greater_crit', 'rapier']);
  const LANE = { 1: 'сейфлейн', 2: 'мид', 3: 'оффлейн', 4: 'лес', 5: 'роуминг' };
  const S = { player: null, recent: {}, match: null, focus: null, loading: false, poll: null, status: '' };

  async function api(path, method) {
    const r = await fetch(API + path, { method: method || 'GET' });
    if (!r.ok) throw new Error('OpenDota ответил ' + r.status);
    return r.json();
  }
  function npcToId(npc) {
    const H = D().state.heroes;
    for (const k in H) { if (H[k] && H[k].npc === npc) return +k; }
    const tail = (npc || '').replace('npc_dota_hero_', '').replace(/_/g, '');
    for (const k in H) { if (H[k] && H[k].name && H[k].name.toLowerCase().replace(/[^a-z]/g, '') === tail) return +k; }
    return null;
  }
  function tracked(acc) { return D().state.byAcc[acc]; }

  window.DCMatchPick = acc => { S.player = acc; };
  // ---------- вкладка ----------
  window.renderMatch = function (app) {
    const { el, esc, state } = D();
    const exposed = state.players.filter(p => p.exposed);
    if (!S.player && exposed.length) S.player = exposed[0].account_id;
    const h = (location.hash || '').replace('#', '');
    const m = h.match(/^match[\/=](\d+)/);
    app.insertAdjacentHTML('beforeend', `<header class="phead"><div class="txt"><h1>Разбор матча</h1><p class="lead">Любая игра - по полочкам: кто выиграл линию, где и от кого умирал, когда купил ключевые предметы, какая драка сломала игру. Выбери игрока и игру из списка или вставь номер матча. Список берется из OpenDota прямо сейчас, ждать обновления сайта не нужно.</p></div></header>`);
    const ctl = el('div', { class: 'mctl' });
    ctl.innerHTML = `<label>Чьи игры показать <select id="mPlayer">${exposed.map(p => `<option value="${p.account_id}" ${p.account_id === S.player ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <button class="btn" id="mRefresh" type="button">Обновить список</button>
      <label>Или номер матча (из Dota 2 или OpenDota) <input id="mId" inputmode="numeric" placeholder="например, 9080754345" value="${m ? m[1] : (S.match ? S.match.match_id : '')}"></label>
      <button class="btn primary" id="mGo" type="button">Разобрать этот матч</button>`;
    app.appendChild(ctl);
    const wrap = el('details', { class: 'recent' }); if (!m && !S.match) wrap.setAttribute('open', '');
    wrap.innerHTML = `<summary><span>Последние игры${S.player ? ': ' + esc((state.byAcc[S.player] || {}).name || '') : ''}</span><span class="mini">нажми, чтобы ${m || S.match ? 'раскрыть' : 'свернуть'} список</span></summary>`;
    const list = el('div', { id: 'mList' }); wrap.appendChild(list); app.appendChild(wrap);
    wrap.addEventListener('toggle', () => { const hint = wrap.querySelector('summary .mini'); if (hint) hint.textContent = 'нажми, чтобы ' + (wrap.open ? 'свернуть' : 'раскрыть') + ' список'; });
    const out = el('div', { id: 'mOut' }); app.appendChild(out);
    ctl.querySelector('#mPlayer').addEventListener('change', e => { S.player = +e.target.value; wrap.querySelector('summary span').textContent = 'Последние игры: ' + ((state.byAcc[S.player] || {}).name || ''); wrap.open = true; if (S.recent[S.player]) renderRecent(list); else loadRecent(list, false); });
    ctl.querySelector('#mRefresh').addEventListener('click', () => loadRecent(list, true));
    ctl.querySelector('#mGo').addEventListener('click', () => { const id = ctl.querySelector('#mId').value.trim(); if (/^\d{6,}$/.test(id)) { location.hash = 'match/' + id; } });
    if (S.recent[S.player]) renderRecent(list); else loadRecent(list, false);
    if (m) loadMatch(+m[1], out); else if (S.match) renderMatchView(out);
  };

  async function loadRecent(list, force) {
    const { esc } = D();
    if (!force && S.recent[S.player]) { renderRecent(list); return; }
    list.innerHTML = '<p class="muted">Спрашиваю у OpenDota последние игры...</p>';
    try { S.recent[S.player] = await api(`/players/${S.player}/recentMatches`); } catch (e) { list.innerHTML = `<p class="no">Не удалось получить список: ${esc(e.message)}</p>`; return; }
    renderRecent(list);
  }
  function renderRecent(list) {
    const { esc, dt, heroName, state } = D();
    const rec = S.recent[S.player] || [];
    const upd = state.meta.updated;
    const fresh = rec.filter(r => r.start_time > upd).length;
    const rows = rec.slice(0, 20).map(r => {
      const win = (r.player_slot < 128) === !!r.radiant_win;
      const mode = r.game_mode === 23 ? 'турбо' : r.lobby_type === 7 ? 'рейтинг' : r.lobby_type === 0 ? 'обычная' : 'другое';
      return `<tr class="${r.start_time > upd ? 'fresh' : ''}"><td><a href="#match/${r.match_id}">${dt(r.start_time)} ${new Date(r.start_time * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</a></td><td>${D().hero(r.hero_id)}</td><td>${mode}</td><td class="${win ? 'ok' : 'no'}">${win ? 'победа' : 'поражение'}</td><td class="num">${r.kills}/${r.deaths}/${r.assists}</td><td class="num">${mm(r.duration)}</td><td>${r.version ? '<span class="chip good">реплей готов</span>' : '<span class="chip" title="OpenDota еще не прочитала запись игры">только итоги</span>'}</td><td><a href="#match/${r.match_id}">открыть</a></td></tr>`;
    }).join('');
    list.innerHTML = `<p class="src" style="margin:0 0 8px">Последние ${Math.min(20, rec.length)} игр${fresh ? `, из них <b>${fresh}</b> сыграны после последнего обновления сайта (подсвечены) - в общую статистику они попадут позже, а разобрать можно уже сейчас` : ''}.</p>
      <div class="tscroll sticky-first" style="margin-bottom:22px"><table><tr><th>когда</th><th>герой</th><th>режим</th><th>итог</th><th class="num">K/D/A</th><th class="num">длит.</th><th>реплей</th><th></th></tr>${rows || '<tr><td colspan="8" class="muted">Игр пока нет</td></tr>'}</table></div>`;
  }

  async function loadMatch(id, out) {
    const { esc } = D();
    if (S.poll) { clearInterval(S.poll); S.poll = null; }
    out.innerHTML = `<p class="muted">Загружаю матч ${id} из OpenDota...</p>`;
    try { S.match = await api(`/matches/${id}`); } catch (e) { out.innerHTML = `<p class="no">Не удалось загрузить матч: ${esc(e.message)}</p>`; return; }
    S.focus = pickFocus(S.match);
    renderMatchView(out);
  }
  function pickFocus(M) {
    const ours = (M.players || []).filter(p => tracked(p.account_id));
    if (ours.length) { if (ours.some(p => p.account_id === S.player)) return S.player; return ours[0].account_id; }
    return (M.players && M.players[0] && (M.players[0].account_id || M.players[0].player_slot)) || null;
  }
  function isParsed(M) { return M && M.version != null && M.players && M.players[0] && M.players[0].gold_t; }
  async function requestParse(out) {
    const { esc } = D();
    const id = S.match.match_id;
    S.status = 'Запросил разбор у OpenDota. Проверяю каждые 30 секунд, обычно это занимает 2-10 минут.';
    try { await api(`/request/${id}`, 'POST'); } catch (e) { S.status = 'OpenDota не принял запрос: ' + e.message + '. Возможно, реплей уже недоступен (хранится около двух недель).'; renderMatchView(out); return; }
    renderMatchView(out);
    let tries = 0;
    S.poll = setInterval(async () => {
      tries++;
      try { const M = await api(`/matches/${id}`); if (isParsed(M)) { S.match = M; S.status = ''; clearInterval(S.poll); S.poll = null; renderMatchView(out); return; } } catch (e) { }
      if (tries >= 20) { clearInterval(S.poll); S.poll = null; S.status = 'Разбор не пришел за 10 минут. Попробуй позже кнопкой «Проверить снова».'; renderMatchView(out); }
      else { S.status = `Жду разбор... проверка ${tries} из 20.`; const st = out.querySelector('#mStatus'); if (st) st.textContent = S.status; }
    }, 30000);
  }

  // ---------- рендер матча ----------
  function playerName(p) { const t = tracked(p.account_id); return t ? t.name : (p.personaname || 'аноним'); }
  function renderMatchView(out) {
    const { esc, dt, heroName, lineChart, cssVar, state } = D();
    const M = S.match; if (!M) return;
    const parsed = isParsed(M);
    const rad = M.players.filter(p => p.isRadiant !== false && p.player_slot < 128), dire = M.players.filter(p => p.player_slot >= 128);
    const focus = M.players.find(p => (p.account_id || p.player_slot) === S.focus) || M.players[0];
    const ours = M.players.filter(p => tracked(p.account_id));
    const modeName = M.game_mode === 23 ? 'турбо' : M.lobby_type === 7 ? 'рейтинг' : M.lobby_type === 0 ? 'обычная' : 'режим ' + M.game_mode;
    const tfs = M.teamfights || [];
    const inFight = t => tfs.some(f => t >= f.start - 5 && t <= f.end + 5);
    const focusIsRad = focus.player_slot < 128;
    const focusWin = focusIsRad === !!M.radiant_win;
    let html = `<section class="mhead"><div class="score"><div class="side ${M.radiant_win ? 'won' : ''}">Radiant <b>${M.radiant_score}</b></div><div class="vs">${mm(M.duration)}</div><div class="side ${!M.radiant_win ? 'won' : ''}"><b>${M.dire_score}</b> Dire</div></div>
      <p class="meta"><span class="chip">${modeName}</span><span class="chip">${dt(M.start_time)}</span><span class="chip">${parsed ? 'реплей разобран' : 'реплей не разобран'}</span>${M.patch ? `<span class="chip">патч #${M.patch}</span>` : ''}<a class="chip" href="https://www.opendota.com/matches/${M.match_id}" target="_blank" rel="noopener">OpenDota ${M.match_id}</a><a class="chip" href="https://www.dotabuff.com/matches/${M.match_id}" target="_blank" rel="noopener">Dotabuff</a></p>
      ${ours.length ? `<p class="lead ours" style="margin:0">Наши в этом матче: ${ours.map(p => `<span class="hero">${D().hero(p.hero_id, { noName: true })}<span><b>${esc(playerName(p))}</b> · ${esc(heroName(p.hero_id))} · ${p.kills}/${p.deaths}/${p.assists}</span></span>`).join('')}</p>` : '<p class="lead" style="margin:0">Никого из пяти отслеживаемых игроков в этом матче нет - разбор все равно доступен по любому игроку.</p>'}</section>`;
    if (!parsed) {
      html += `<div class="notice"><h3>OpenDota еще не прочитала запись этой игры</h3><p>Итоговая таблица уже есть, но самого интересного пока нет: золота по минутам, смертей с убийцей, таймингов предметов и драк. Нажми кнопку - OpenDota поставит реплей в очередь, обычно это занимает от 2 до 10 минут, страница проверит сама.</p><p id="mStatus" class="mini">${esc(S.status)}</p><p><button class="btn primary" id="mReq" type="button">${S.poll ? 'Жду, проверяю каждые 30 секунд...' : 'Попросить OpenDota прочитать реплей'}</button> <button class="btn" id="mRecheck" type="button">Проверить сейчас</button></p></div>`;
    }
    // фокус
    const ordered = M.players.slice().sort((a, b) => (tracked(b.account_id) ? 1 : 0) - (tracked(a.account_id) ? 1 : 0));
    html += `<p class="lead" style="margin:14px 0 6px">Кого разбираем: нажми на героя. Наши игроки идут первыми и подписаны.</p><div class="focus" role="group" aria-label="Разбор по игроку">${ordered.map(p => { const tr = tracked(p.account_id); const sideR = p.player_slot < 128; return `<button type="button" class="${sideR ? 'rad' : 'dire'}${tr ? ' ours' : ''}" data-f="${p.account_id || p.player_slot}" aria-pressed="${(p.account_id || p.player_slot) === (focus.account_id || focus.player_slot)}">${D().hero(p.hero_id, { noName: true, big: true })}<span class="fname">${esc(heroName(p.hero_id))}</span><span class="fsub">${tr ? esc(tr.name) : (sideR ? 'Radiant' : 'Dire')}</span></button>`; }).join('')}</div>`;
    // разбор тренера (модель) - первым, если игрок наш
    html += `<div id="aiReview"></div>`;
    // график золота
    if (parsed && M.radiant_gold_adv) html += `<section><h2>Кто вел игру по золоту</h2><p class="lead">Линия выше нуля - впереди Radiant, ниже - Dire. Красные точки - смерти героя ${esc(heroName(focus.hero_id))}: видно, после каких из них перевес уходил.</p><div class="chart cv" style="height:260px"><canvas id="goldChart"></canvas></div></section>`;
    // выводы по фокусу
    html += focusBlock(M, focus, tfs, inFight, parsed);
    // драки
    if (parsed && tfs.length) {
      html += `<section><h2>Командные драки</h2><p class="lead">Все стычки с тремя и больше смертями. Колонка золота - сколько команда ${focusIsRad ? 'Radiant' : 'Dire'} приобрела или потеряла за драку: самые большие минусы и есть моменты, где игра ломалась.</p><div class="tscroll sticky-first"><table><tr><th>минута</th><th class="num">длит.</th><th class="num">смерти Radiant</th><th class="num">смерти Dire</th><th class="num">золото ${focusIsRad ? 'Radiant' : 'Dire'}</th><th>кто умер</th></tr>${tfs.map(f => {
        const pl = f.players || [];
        const dR = pl.slice(0, 5).reduce((a, p) => a + (p.deaths || 0), 0), dD = pl.slice(5).reduce((a, p) => a + (p.deaths || 0), 0);
        const gR = pl.slice(0, 5).reduce((a, p) => a + (p.gold_delta || 0), 0), gD = pl.slice(5).reduce((a, p) => a + (p.gold_delta || 0), 0);
        const mine = focusIsRad ? gR - gD : gD - gR;
        const died = pl.map((p, i) => (p.deaths && M.players[i] ? `<span class="hero" title="${esc(heroName(M.players[i].hero_id))}">${D().hero(M.players[i].hero_id, { noName: true })}${p.deaths > 1 ? '<span>x' + p.deaths + '</span>' : ''}</span>` : null)).filter(Boolean).join(' ');
        return `<tr><td>${mm(f.start)}</td><td class="num">${f.end - f.start}с</td><td class="num">${dR}</td><td class="num">${dD}</td><td class="num ${mine >= 0 ? 'ok' : 'no'}">${mine >= 0 ? '+' : ''}${mine}</td><td>${died}</td></tr>`;
      }).join('')}</table></div></section>`;
    }
    // таблица матча
    const row = p => {
      const t = tracked(p.account_id), isF = p === focus;
      return `<tr class="${isF ? 'focusrow' : ''}"><td>${D().hero(p.hero_id)}${t ? ` <span class="chip good">${esc(t.name)}</span>` : (p.personaname ? ` <span class="mini">${esc(p.personaname)}</span>` : '')}</td><td>${LANE[p.lane_role] || '-'}${p.is_roaming ? ' (роум)' : ''}</td><td class="num">${p.level}</td><td class="num">${p.kills}/${p.deaths}/${p.assists}</td><td class="num">${p.last_hits}/${p.denies}</td><td class="num">${p.gold_per_min}/${p.xp_per_min}</td><td class="num">${(p.total_gold || p.net_worth || 0).toLocaleString('ru-RU')}</td><td class="num">${(p.hero_damage || 0).toLocaleString('ru-RU')}</td><td class="num">${(p.tower_damage || 0).toLocaleString('ru-RU')}</td><td class="num">${p.obs_placed || 0}/${p.sen_placed || 0}</td></tr>`;
    };
    const thead = '<tr><th>герой</th><th>линия</th><th class="num">ур.</th><th class="num">K/D/A</th><th class="num">доб/ден</th><th class="num">GPM/XPM</th><th class="num">золото</th><th class="num">урон героям</th><th class="num">урон башням</th><th class="num">обс/сен</th></tr>';
    html += `<section><h2>Таблица матча</h2><h4>Radiant ${M.radiant_win ? '- победа' : ''}</h4><div class="tscroll sticky-first"><table>${thead}${rad.map(row).join('')}</table></div><h4 style="margin-top:12px">Dire ${!M.radiant_win ? '- победа' : ''}</h4><div class="tscroll sticky-first"><table>${thead}${dire.map(row).join('')}</table></div></section>`;
    // объекты
    const obj = (M.objectives || []).filter(o => ['CHAT_MESSAGE_FIRSTBLOOD', 'CHAT_MESSAGE_ROSHAN_KILL', 'building_kill', 'CHAT_MESSAGE_AEGIS', 'CHAT_MESSAGE_COURIER_LOST'].includes(o.type));
    if (obj.length) html += `<section><h2>Башни, Рошан и первая кровь</h2><div class="tscroll"><table><tr><th>минута</th><th>событие</th></tr>${obj.slice(0, 60).map(o => `<tr><td>${mm(o.time)}</td><td>${esc(objText(o, M))}</td></tr>`).join('')}</table></div></section>`;
    out.innerHTML = html;
    out.querySelectorAll('.focus [data-f]').forEach(b => b.addEventListener('click', () => { S.focus = isNaN(+b.dataset.f) ? b.dataset.f : +b.dataset.f; renderMatchView(out); }));
    renderAiReview(out.querySelector('#aiReview'), M, focus);
    const req = out.querySelector('#mReq'); if (req) req.addEventListener('click', () => { if (!S.poll) requestParse(out); });
    const rc = out.querySelector('#mRecheck'); if (rc) rc.addEventListener('click', () => loadMatch(M.match_id, out));
    if (parsed && M.radiant_gold_adv) {
      const adv = M.radiant_gold_adv;
      const labels = adv.map((_, i) => i + "'");
      const deaths = focusDeaths(M, focus).map(d => Math.round(d.time / 60)).filter(i => i >= 0 && i < adv.length);
      const pts = adv.map((v, i) => deaths.includes(i) ? v : null);
      const c = lineChart(document.getElementById('goldChart'), labels, [
        { label: 'золото Radiant - Dire', data: adv, borderColor: cssVar('--s1'), backgroundColor: cssVar('--s1') + '22', fill: 'origin', borderWidth: 2, pointRadius: 0, tension: .2 },
        { label: 'смерти ' + heroName(focus.hero_id), data: pts, borderColor: cssVar('--bad'), backgroundColor: cssVar('--bad'), pointRadius: 5, pointStyle: 'circle', showLine: false }], false);
    }
  }
  async function renderAiReview(box, M, focus) {
    const { esc, heroName, getJSON } = D();
    if (!box) return;
    const t = tracked(focus.account_id); const AI = D().AI;
    if (!t) { box.innerHTML = `<section class="aibox"><h2>Разбор тренера ${AI}</h2><p class="muted" style="margin:0">Тренер пишет разборы только для пятерых наших игроков. Для чужого героя ниже есть автоматические выводы по правилам.</p></section>`; return; }
    const rev = await getJSON(`data/${focus.account_id}/reviews/${M.match_id}.json`, true);
    if (!rev) {
      const fresh = (Date.now() / 1000 - (M.start_time || 0)) < 14 * 86400;
      box.innerHTML = `<section class="aibox"><h2>Разбор тренера ${AI}</h2><p class="muted" style="margin:0">Для ${esc(t.name)} в этом матче разбора тренера еще нет. ${fresh ? 'Он появится сам в течение часа-двух после того, как OpenDota прочитает реплей (проверка идет каждый час). Ниже - автоматические выводы по правилам, их можно читать уже сейчас.' : 'Матч старше двух недель, запись игры уже недоступна - тренер разбирает только свежие игры. Ниже остаются автоматические выводы по правилам.'}</p></section>`;
      return;
    }
    const tl = (rev.timeline || []).map(x => `<div class="card"><h4>${esc(x.phase)}</h4><p>${esc(x.text)}</p></div>`).join('');
    const km = (rev.key_moments || []).map(x => `<li>${esc(x)}</li>`).join('');
    const adv = (rev.advice || []).map((x, i) => `<article class="plan"><div class="plan-no">Правка ${i + 1}</div><h4>${esc(x.what)}</h4><dl><dt>Почему</dt><dd>${esc(x.why)}</dd><dt>Что меряем</dt><dd>${esc(x.metric)}</dd></dl></article>`).join('');
    const pos = String(rev.position || '-'); const dot = pos.search(/[.!?]\s/); const posShort = dot > 0 ? pos.slice(0, dot + 1) : pos; const posRest = dot > 0 ? pos.slice(dot + 1).trim() : '';
    box.innerHTML = `<section class="aibox"><h2>Разбор тренера ${AI}</h2><p class="lead" style="margin:0 0 ${posRest ? '4' : '10'}px">${D().hero(rev.hero_id)} · ${esc(t.name)} · позиция: ${esc(posShort)} · влияние на исход: <b>${esc(rev.severity || '-')}</b></p>${posRest ? `<details class="mini" style="margin:0 0 10px"><summary>Как тренер определил позицию</summary><p style="margin:4px 0 0">${esc(posRest)}</p></details>` : ''}
      <div class="verdict"><p><b>${esc(rev.verdict)}</b></p><p class="mini" style="margin-top:8px">Текст написан моделью по числам из записи игры, ей запрещено их придумывать. Все цифры можно проверить в таблицах ниже.</p></div>
      <div class="three" style="margin-top:12px">${tl}</div>
      <h3 style="margin-top:14px">Смерти: что было разменом, а что ошибкой</h3><p class="lead" style="max-width:72ch">${esc(rev.deaths || '')}</p>
      ${km ? `<h3>Ключевые моменты</h3><ul class="plain">${km}</ul>` : ''}
      <h3 style="margin-top:14px">Что исправить в следующих 10 играх</h3><div class="plans">${adv}</div></section>`;
  }
  function objText(o, M) {
    const { heroName } = D();
    const slotHero = s => { const p = M.players.find(x => x.player_slot === s); return p ? heroName(p.hero_id) : '?'; };
    if (o.type === 'CHAT_MESSAGE_FIRSTBLOOD') return 'Первая кровь: ' + slotHero(o.player_slot);
    if (o.type === 'CHAT_MESSAGE_ROSHAN_KILL') return 'Рошан убит командой ' + (o.team === 2 ? 'Radiant' : 'Dire');
    if (o.type === 'CHAT_MESSAGE_AEGIS') return 'Аегис взял ' + slotHero(o.player_slot);
    if (o.type === 'CHAT_MESSAGE_COURIER_LOST') return 'Потерян курьер (' + (o.team === 2 ? 'Radiant' : 'Dire') + ')';
    if (o.type === 'building_kill') { const k = o.key || ''; const side = k.includes('goodguys') ? 'Radiant' : 'Dire'; const what = k.includes('tower1') ? 'Т1' : k.includes('tower2') ? 'Т2' : k.includes('tower3') ? 'Т3' : k.includes('tower4') ? 'Т4' : k.includes('melee_rax') ? 'казарма ближн.' : k.includes('range_rax') ? 'казарма дальн.' : k.includes('fort') ? 'трон' : 'строение'; const lane = k.includes('_top') ? ' верх' : k.includes('_mid') ? ' мид' : k.includes('_bot') ? ' низ' : ''; return `Разрушено: ${what}${lane} у ${side}` + (o.unit && o.unit.startsWith('npc_dota_hero_') ? ' (' + heroName(npcToId(o.unit)) + ')' : ''); }
    return o.type;
  }
  function focusDeaths(M, focus) {
    const H = D().state.heroes; const myNpc = (H[String(focus.hero_id)] || {}).npc;
    const out = [];
    M.players.forEach(p => { if ((p.player_slot < 128) !== (focus.player_slot < 128)) (p.kills_log || []).forEach(k => { if (k.key === myNpc || (!myNpc && npcToId(k.key) === focus.hero_id)) out.push({ time: k.time, killer: p.hero_id }); }); });
    return out.sort((a, b) => a.time - b.time);
  }
  function focusBlock(M, f, tfs, inFight, parsed) {
    const { esc, heroName, state, pct, f1, f0 } = D();
    const isRad = f.player_slot < 128, win = isRad === !!M.radiant_win;
    const t = tracked(f.account_id);
    const find = [];
    let body = '';
    if (parsed) {
      const at = (s, i) => s && s.length > i ? s[i] : null;
      const opp = M.players.filter(p => (p.player_slot < 128) !== isRad && p.lane === f.lane && p.lane_role && p.lane_role <= 3);
      const best = opp.length ? opp.reduce((a, b) => (at(b.gold_t, 10) || 0) > (at(a.gold_t, 10) || 0) ? b : a) : null;
      const g10 = at(f.gold_t, 10), gd10 = best && g10 != null && at(best.gold_t, 10) != null ? g10 - at(best.gold_t, 10) : null;
      const xd10 = best && at(f.xp_t, 10) != null && at(best.xp_t, 10) != null ? at(f.xp_t, 10) - at(best.xp_t, 10) : null;
      const deaths = focusDeaths(M, f);
      const early = deaths.filter(d => d.time < 600), outside = deaths.filter(d => !inFight(d.time));
      const items = Object.entries(f.purchase_log ? f.purchase_log.reduce((a, x) => { if (!(x.key in a) && KEY_ITEMS.has(x.key)) a[x.key] = x.time; return a; }, {}) : {}).sort((a, b) => a[1] - b[1]);
      const adv = (M.radiant_gold_adv || []).map(v => isRad ? v : -v);
      const maxLead = Math.max(0, ...adv), minLead = Math.min(0, ...adv);
      const joined = tfs.filter(ft => { const idx = f.player_slot < 128 ? f.player_slot : f.player_slot - 128 + 5; const p = (ft.players || [])[idx]; return p && ((p.damage || 0) > 0 || (p.deaths || 0) > 0 || (p.healing || 0) > 0 || Object.keys(p.ability_uses || {}).length); }).length;
      const bm = f.benchmarks || {};
      const bmNames = { gold_per_min: 'GPM', xp_per_min: 'XPM', kills_per_min: 'убийства/мин', last_hits_per_min: 'добитые/мин', hero_damage_per_min: 'урон/мин', hero_healing_per_min: 'лечение/мин', tower_damage: 'урон по башням', stuns_per_min: 'контроль/мин', lhten: 'добитых на 10 мин' };
      // правила
      if (gd10 != null && gd10 <= -500) find.push({ bad: true, text: `Линия проиграна: на 10 минуте минус ${Math.abs(gd10)} золота к ${heroName(best.hero_id)}${xd10 != null ? ` и ${xd10 >= 0 ? '+' : ''}${xd10} опыта` : ''}.` });
      if (gd10 != null && gd10 >= 500) find.push({ bad: false, text: `Линия выиграна: на 10 минуте плюс ${gd10} золота к ${heroName(best.hero_id)}.` });
      if (early.length >= 2) find.push({ bad: true, text: `${early.length} смерти до 10 минуты (${early.map(d => mm(d.time) + ' от ' + heroName(d.killer)).join(', ')}).` });
      if (outside.length >= 2) find.push({ bad: true, text: `${outside.length} смерти вне командных драк: ${outside.map(d => mm(d.time) + ' от ' + heroName(d.killer)).join(', ')}. Такие смерти - чаще всего фарм или вард без информации о карте.` });
      if (!win && maxLead >= 5000) find.push({ bad: true, text: `Команда вела на ${maxLead.toLocaleString('ru-RU')} золота и проиграла. Смотри драки ниже: где разница ушла.` });
      if (win && minLead <= -5000) find.push({ bad: false, text: `Камбэк с минус ${Math.abs(minLead).toLocaleString('ru-RU')} золота.` });
      if (tfs.length >= 4 && joined < tfs.length / 2) find.push({ bad: true, text: `Участие в драках: ${joined} из ${tfs.length}. Больше половины командных драк прошли без этого героя.` });
      const bkb = items.find(x => x[0] === 'black_king_bar'); if (bkb && bkb[1] > 25 * 60) find.push({ bad: true, text: `BKB только на ${mm(bkb[1])}.` });
      const low = Object.keys(bm).filter(k => bmNames[k] && bm[k] && bm[k].pct != null && bm[k].pct < 0.25), high = Object.keys(bm).filter(k => bmNames[k] && bm[k] && bm[k].pct != null && bm[k].pct > 0.75);
      if (high.length) find.push({ bad: false, text: 'Выше 75% игроков на этом герое: ' + high.map(k => bmNames[k]).join(', ') + '.' });
      if (low.length) find.push({ bad: true, text: 'Ниже 25% игроков на этом герое: ' + low.map(k => bmNames[k]).join(', ') + (f.lane_role && f.lane_role >= 4 || (f.obs_placed || 0) >= 4 ? ' (для сапорта GPM и добитые - норма).' : '.') });
      if (!deaths.length) find.push({ bad: false, text: 'Ни одной смерти за игру.' });
      // сравнение с собственной нормой (из analysis.json, если игрок наш)
      const an = t && state.analysis[f.account_id]; const mode = M.game_mode === 23 ? 'turbo' : M.lobby_type === 7 ? 'ranked' : 'normal';
      const my = an && an.modes && an.modes[mode];
      if (my) {
        const hr = my.heroes.find(h => h.hero_id === f.hero_id);
        if (hr) find.push({ bad: f.deaths > hr.d + 2, text: `Своя норма на ${hr.hero}: ${f1(hr.k)}/${f1(hr.d)}/${f1(hr.a)} за ${hr.n} игр, винрейт ${pct(hr.wr)}. В этой игре ${f.kills}/${f.deaths}/${f.assists}${hr.gpm ? `, GPM ${f.gold_per_min} против обычных ${f0(hr.gpm)}` : ''}.` });
        else find.push({ bad: false, text: `Средние в режиме: ${f1(my.summary.kills)}/${f1(my.summary.deaths)}/${f1(my.summary.assists)}. В этой игре ${f.kills}/${f.deaths}/${f.assists}.` });
      }
      body += `<div class="grid2">
        <div class="chart"><h4>Линия до 10 минуты</h4><p class="src" style="margin:0">Позиция: ${LANE[f.lane_role] || '-'}${f.is_roaming ? ', роуминг' : ''}. Добитых и денаев к 10 минуте: ${at(f.lh_t, 10) ?? '-'} и ${at(f.dn_t, 10) ?? '-'}. Золото к 10 минуте: ${g10 ?? '-'}${best ? `, у соперника по линии (${esc(heroName(best.hero_id))}) - ${at(best.gold_t, 10)}` : ''}. Эффективность линии по OpenDota: ${f.lane_efficiency_pct != null ? f.lane_efficiency_pct + '%' : '-'}.</p></div>
        <div class="chart"><h4>Смерти от героев (${deaths.length} из ${f.deaths})</h4>${deaths.length ? `<ul class="plain" style="font-size:14px">${deaths.map(d => `<li>${mm(d.time)} - от ${esc(heroName(d.killer))}${inFight(d.time) ? '' : ' <span class="chip bad">вне драки</span>'}</li>`).join('')}</ul>` : '<p class="muted" style="margin:0">От героев не умирал.</p>'}${deaths.length < (f.deaths || 0) ? '<p class="mini">Остальные смерти - от крипов, башен или Рошана, в логе убийств их нет.</p>' : ''}</div>
        <div class="chart"><h4>Когда куплены ключевые предметы</h4>${items.length ? `<div class="meta">${items.map(x => `<span class="item">${D().itemImg(x[0], itemName(x[0]))}<b>${mm(x[1])}</b></span>`).join('')}</div>` : '<p class="muted" style="margin:0">Из ключевых предметов ничего не куплено.</p>'}</div>
        <div class="chart"><h4>Карта и активность</h4><p class="src" style="margin:0">Обсерверов ${f.obs_placed || 0}, сентри ${f.sen_placed || 0}, снято вардов ${f.observer_kills || 0}, стаков ${f.camps_stacked || 0}, рун ${f.rune_pickups || 0}, дополнительных ТП куплено ${(f.purchase && f.purchase.tpscroll) || 0} (базовый заряд бесплатный). Драк с участием: ${joined} из ${tfs.length}. Действий в минуту: ${f.actions_per_min || '-'}.</p>
        ${Object.keys(bm).filter(k => bmNames[k]).length ? `<h4 style="margin-top:10px">Сравнение с другими на этом герое</h4><p class="mini">Полоса - доля игроков, которых ты обошел в этой игре. Черта посередине - середина.</p>${Object.keys(bm).filter(k => bmNames[k] && bm[k] && bm[k].pct != null).map(k => `<div class="brow"><div class="blabel">${bmNames[k]}</div><div class="btrack" title="лучше, чем у ${Math.round(bm[k].pct * 100)}% игроков на этом герое"><div class="bfill" style="width:${(bm[k].pct * 100).toFixed(0)}%"></div><div class="bbase" style="left:50%"></div></div><div class="bval"><b>${Math.round(bm[k].pct * 100)}%</b><span class="bn">игроков позади · ${bm[k].raw != null ? (Math.round(bm[k].raw * 100) / 100) : '-'}</span></div></div>`).join('')}` : ''}</div></div>`;
    } else {
      body += `<p class="muted">Без разобранного реплея по игроку доступны только итоговые цифры: ${f.kills}/${f.deaths}/${f.assists}, GPM ${f.gold_per_min}, XPM ${f.xp_per_min}, добитых ${f.last_hits}.</p>`;
    }
    const verdict = find.length ? `<ul class="plain" style="font-size:15px">${find.map(x => `<li class="${x.bad ? 'no' : 'ok'}">${esc(x.text)}</li>`).join('')}</ul>` : (parsed ? '<p class="muted" style="margin:0">По правилам ничего не торчит: линия не провалена, смерти в драках, участие нормальное.</p>' : '');
    return `<section><h2>Автоматика по правилам: ${D().hero(f.hero_id)}${t ? ' · ' + esc(t.name) : ''} - ${win ? 'победа' : 'поражение'}</h2><p class="lead">Это не ИИ: эти выводы считает код по фиксированным правилам - линия на 10 минуте, смерти вне драк, упущенное преимущество, участие в драках, сравнение с другими игроками на этом герое и со своей нормой. Это подсказка, куда смотреть в реплее, а не приговор.</p><div class="verdict">${verdict}</div>${body}</section>`;
  }
})();
