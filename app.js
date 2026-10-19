/* SP1 · Сказки со звуками — логика страницы. Без сборки и зависимостей. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // localStorage может быть недоступен (приватный режим) — страница работает и без него
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  var WORD_RE = /[0-9A-Za-zА-Яа-яЁё]+(?:-[0-9A-Za-zА-Яа-яЁё]+)*/g;
  function norm(w) { return String(w).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, ''); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  var state = {
    story: null, role: 'solo',
    tokens: [], cues: [], nextCue: 0,
    ambientStop: null, wakeLock: null, follow: null
  };

  // ---------- тосты ----------
  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 3500);
  }

  // ---------- звук ----------
  var ctx = null, master = null;
  function volume() { return LS.get('sp1_volume', 0.9); }
  function ensureAudio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { toast('Браузер не поддерживает WebAudio — звуков не будет'); return null; }
      // Safari 17+: звук как у плеера, не глушится переключателем «без звука» (если поддерживается)
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
      ctx = new AC();
      SFX.preload(ctx);
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = volume();
      master.connect(comp); comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function countPress(id) {
    var p = LS.get('sp1_presses', null);
    if (!p || p.date !== today()) p = { date: today(), counts: {} };
    p.counts[id] = (p.counts[id] || 0) + 1;
    LS.set('sp1_presses', p);
  }

  function play(id, els) {
    var c = ensureAudio();
    if (!c) return 0;
    var dur = 0;
    try { dur = SFX.play(c, master, id, c.currentTime + 0.02); }
    catch (e) { console.error(e); toast('Ошибка звука «' + id + '»: ' + e.message); return 0; }
    countPress(id);
    (els || []).forEach(function (el) {
      if (!el) return;
      el.classList.add('playing');
      setTimeout(function () { el.classList.remove('playing'); }, Math.max(300, dur * 1000));
    });
    return dur;
  }

  function setVolume(v) {
    LS.set('sp1_volume', v);
    if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    $('#volume').value = v; $('#volume2').value = v;
  }

  // ---------- тема и шрифт ----------
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    LS.set('sp1_theme', t);
  }
  function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
  function applyFont(px) {
    px = Math.max(16, Math.min(48, px));
    document.documentElement.style.setProperty('--fs', px + 'px');
    LS.set('sp1_fs', px);
  }

  // ---------- навигация ----------
  var SCREENS = ['home', 'role', 'read', 'sounds', 'diary'];
  function show(id) {
    SCREENS.forEach(function (s) { $('#' + s).hidden = s !== id; });
    $('#dock').hidden = !(id === 'read' && state.role === 'solo');
    if (id !== 'read') leaveReading();
    window.scrollTo(0, 0);
  }

  // ---------- главная ----------
  function storySounds(story) {
    var seen = [], re = /\{[^|}]+\|([a-z_]+)\}/g, m;
    story.paragraphs.forEach(function (p) {
      while ((m = re.exec(p))) if (seen.indexOf(m[1]) < 0) seen.push(m[1]);
    });
    return seen;
  }

  function renderHome() {
    var list = $('#storyList');
    list.textContent = '';
    STORIES.forEach(function (s) {
      var b = document.createElement('button');
      b.className = 'btn card story-card';
      var t = document.createElement('div'); t.className = 't'; t.textContent = s.title;
      var a = document.createElement('div'); a.className = 'a';
      a.textContent = s.author + ' · ' + s.age + ' · ~' + s.minutes + ' мин';
      var ic = document.createElement('div'); ic.className = 's';
      ic.textContent = storySounds(s).map(function (id) { return SFX.META[id].icon; }).join(' ');
      b.appendChild(t); b.appendChild(a); b.appendChild(ic);
      b.addEventListener('click', function () { openRole(s); });
      list.appendChild(b);
    });
  }

  function openRole(s) {
    state.story = s;
    $('#roleTitle').textContent = s.title;
    $('#roleMeta').textContent = s.author + ' · звуков: ' + storySounds(s).length;
    show('role');
  }

  // ---------- разбор и отрисовка текста ----------
  function parseParagraph(p) {
    var out = [], re = /\{([^|}]+)\|([a-z_]+)\}/g, last = 0, m;
    while ((m = re.exec(p))) {
      if (m.index > last) out.push({ type: 'text', s: p.slice(last, m.index) });
      out.push({ type: 'cue', s: m[1], sound: m[2] });
      last = re.lastIndex;
    }
    if (last < p.length) out.push({ type: 'text', s: p.slice(last) });
    return out;
  }

  function appendWords(container, s) {
    var lines = s.split('\n');
    lines.forEach(function (line, li) {
      if (li > 0) container.appendChild(document.createElement('br'));
      var last = 0, m;
      WORD_RE.lastIndex = 0;
      while ((m = WORD_RE.exec(line))) {
        if (m.index > last) container.appendChild(document.createTextNode(line.slice(last, m.index)));
        var sp = document.createElement('span');
        sp.className = 'w';
        sp.dataset.i = state.tokens.length;
        sp.textContent = m[0];
        state.tokens.push({ raw: m[0], n: norm(m[0]), el: sp, cue: -1 });
        container.appendChild(sp);
        last = WORD_RE.lastIndex;
      }
      if (last < line.length) container.appendChild(document.createTextNode(line.slice(last)));
    });
  }

  function renderStory() {
    var s = state.story, art = $('#story');
    art.textContent = '';
    state.tokens = []; state.cues = []; state.nextCue = 0;
    s.paragraphs.forEach(function (p) {
      var el = document.createElement('p');
      parseParagraph(p).forEach(function (seg) {
        if (seg.type === 'text') { appendWords(el, seg.s); return; }
        var k = state.cues.length;
        var meta = SFX.META[seg.sound];
        var b = document.createElement('button');
        b.className = 'cue';
        b.type = 'button';
        b.dataset.k = k;
        var ci = document.createElement('span'); ci.className = 'ci'; ci.textContent = meta ? meta.icon : '?';
        b.appendChild(ci);
        var first = state.tokens.length;
        appendWords(b, seg.s);
        var lastTok = state.tokens.length - 1;
        state.tokens[lastTok].cue = k;
        var before = state.tokens.slice(Math.max(0, first - 5), first).map(function (t) { return t.raw; }).join(' ');
        state.cues.push({ k: k, sound: seg.sound, text: seg.s, el: b, first: first, last: lastTok, ctx: before });
        el.appendChild(b);
      });
      art.appendChild(el);
    });
    $('#storySrc').textContent = 'Текст: ' + s.author + ', «' + s.title + '». Источник: ' + s.source + ' Права: ' + s.rights;
  }

  // ---------- роли и панели ----------
  function soundButton(id, compact) {
    var meta = SFX.META[id];
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'snd';
    b.dataset.sound = id;
    var i = document.createElement('span'); i.className = 'ico'; i.textContent = meta.icon;
    var l = document.createElement('span'); l.className = 'lbl'; l.textContent = meta.label;
    b.appendChild(i); b.appendChild(l);
    b.addEventListener('click', function () { play(id, [b]); });
    return b;
  }

  function fillGrid(grid, ids, compact) {
    grid.textContent = '';
    ids.forEach(function (id) { grid.appendChild(soundButton(id, compact)); });
  }

  function renderSounds() {
    fillGrid($('#allGrid'), SFX.ids());
    var sources = $('#soundSources'); sources.textContent = '';
    Object.keys(SFX.manifest()).forEach(function (id) {
      var spec = SFX.manifest()[id];
      var box = document.createElement('div'); box.className = 'card';
      var title = document.createElement('p'); title.textContent = SFX.META[id] ? SFX.META[id].label : 'Лес'; box.appendChild(title);
      spec.variants.forEach(function (v, n) {
        var b = document.createElement('button'); b.className = 'btn variant'; b.dataset.variant = n; b.dataset.sound = id;
        b.textContent = (n + 1) + ': ' + v.note + (SFX.selected(id) === n ? ' — выбран' : '');
        b.addEventListener('click', function () {
          LS.set('sp1_variant_' + id, n);
          var c = ensureAudio();
          SFX.load(c, id).then(function () { if (id === 'forest') { var stop = SFX.startAmbient(c, master); setTimeout(stop, 2000); } else play(id); });
          renderSounds();
        });
        box.appendChild(b);
        var row = document.createElement('p'); row.textContent = title.textContent + ': ' + v.note + ' · ' + v.author + ' · ' + v.license + ' · ';
        var link = document.createElement('a');
        if (/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(v.page)) link.href = v.page;
        link.textContent = v.page || v.src; link.rel = 'noreferrer'; row.appendChild(link); sources.appendChild(row);
      });
      $('#allGrid').appendChild(box);
    });
  }

  var ROLE_NAMES = { wizard: 'волшебник', reader: 'чтец', solo: 'один телефон' };

  function openReading(role) {
    state.role = role;
    ensureAudio(); // первый жест пользователя — разблокировать звук
    document.body.classList.remove('role-wizard', 'role-reader', 'role-solo');
    document.body.classList.add('role-' + role);
    $('#readTitle').textContent = state.story.title;
    $('#rolePill').textContent = ROLE_NAMES[role];
    renderStory();
    state.session = { story: state.story.id, role: role, start: Date.now(), events: [], extra: [], total: state.cues.length };
    state.sessionDay = today();
    saveSession(true);
    $("#soloHelp").hidden = role !== "solo";
    var ids = storySounds(state.story);
    var extra = SFX.ids().filter(function (id) { return ids.indexOf(id) < 0; });
    $('#wiz').hidden = role !== 'wizard';
    if (role === 'wizard') { fillGrid($('#wizGrid'), ids); fillGrid($('#wizExtra'), extra, true); }
    if (role === 'solo') fillGrid($('#dockGrid'), ids.concat(extra), true);
    $('#followBox').hidden = role === 'wizard';
    $('#ambient').checked = false;
    $('#settings').hidden = true;
    $('#settingsToggle').setAttribute('aria-expanded', 'false');
    updateNext(false);
    show('read');
    requestWake();
    refreshFollowStatus();
  }

  function updateNext(scroll) {
    state.cues.forEach(function (c, i) {
      c.el.classList.toggle('next', i === state.nextCue && state.role !== 'reader');
      c.el.classList.toggle('done', i < state.nextCue && state.role !== 'reader');
    });
    var c = state.cues[state.nextCue];
    var nb = $('#wizNext');
    if (c) {
      var meta = SFX.META[c.sound];
      $('.ico', nb).textContent = meta.icon;
      $('.lbl', nb).textContent = meta.label;
      $('.ctx', nb).textContent = '…' + c.ctx + ' «' + c.text + '»';
    } else {
      $('.ico', nb).textContent = '🌟';
      $('.lbl', nb).textContent = 'Сказка закончилась';
      $('.ctx', nb).textContent = 'Нажмите «Назад», чтобы повторить звук, или выберите другую сказку';
    }
    $('#wizPos').textContent = Math.min(state.nextCue + 1, state.cues.length) + ' / ' + state.cues.length;
    if (scroll && c && state.role === 'wizard') {
      // поставить метку сразу под липкой панелью волшебника, а не под ней
      var panelBottom = $('#wiz').getBoundingClientRect().bottom;
      var r = c.el.getBoundingClientRect();
      window.scrollBy({ top: r.top - panelBottom - 24, behavior: 'smooth' });
    }
  }

  function saveSession(add) {
    var days = LS.get('sp1_sessions', {}), day = state.sessionDay;
    if (!day) return;
    var sessions = days[day] || [];
    if (add) { state.sessionIndex = sessions.length; sessions.push(state.session); }
    else sessions[state.sessionIndex] = state.session;
    days[day] = sessions; LS.set('sp1_sessions', days);
  }
  function logCue(k, by) {
    if (!state.session || !state.cues[k]) return;
    state.session.events.push({ k: k, sound: state.cues[k].sound, by: by, t: Date.now() - state.session.start });
    saveSession(false);
  }
  function dayText(day) {
    var sessions = LS.get('sp1_sessions', {})[day] || [], a = 0, t = 0, skipped = 0, passed = 0, extras = 0, total = 0;
    sessions.forEach(function (s) {
      total += s.total || 0; extras += (s.extra || []).length;
      var seen = {};
      s.events.forEach(function (e) { seen[e.k] = true; if (e.by === 'auto') a++; else if (e.by === 'skipped') skipped++; else t++; });
      passed += Object.keys(seen).length;
    });
    return 'Метки: ' + total + '; автоматически ' + a + ' (' + (total ? Math.round(a/total*100) : 0) + '%), касанием ' + t + ', пропущено ' + skipped + ', лишних ' + extras;
  }
  function variantsText() {
    return 'Выбранные варианты: ' + Object.keys(SFX.manifest()).map(function (id) {
      var n = SFX.selected(id), v = SFX.manifest()[id].variants[n];
      return (SFX.META[id] ? SFX.META[id].label : 'Лес') + ': ' + (n + 1) + ' (' + v.note + ')';
    }).join('; ');
  }
  function fireCue(k, fromText, by, skipped) {
    var c = state.cues[k];
    if (!c) return;
    if (skipped) skipped.forEach(function(j){logCue(j, 'skipped');});
    else for (var j = state.nextCue; j < k; j++) logCue(j, 'skipped');
    if (state.follow && by !== 'auto') { state.follow.core.markFired(k); state.follow.core.jump(c.last); }
    logCue(k, by || (fromText ? 'word' : 'wizard'));
    play(c.sound, [c.el, fromText ? null : $('#wizNext')]);
    state.nextCue = k + 1;
    updateNext(!fromText);
  }

  // ---------- экран не гаснет (только в безопасном контексте) ----------
  function requestWake() {
    var note = $('#wakeNote');
    if (!('wakeLock' in navigator) || !window.isSecureContext) {
      note.textContent = 'Экран может погаснуть: по адресу из локальной сети браузер не даёт держать экран включённым. Увеличьте время автоблокировки в настройках телефона на время сказки.';
      return;
    }
    navigator.wakeLock.request('screen').then(function (l) {
      state.wakeLock = l;
      note.textContent = 'Экран не погаснет, пока открыта сказка.';
    }).catch(function () {
      note.textContent = 'Не удалось запретить гаснуть экрану — увеличьте время автоблокировки.';
    });
  }

  function leaveReading() {
    stopFollow();
    if (state.ambientStop) { state.ambientStop(); state.ambientStop = null; }
    if (state.wakeLock) { try { state.wakeLock.release(); } catch (e) { /* ignore */ } state.wakeLock = null; }
    var amb = $('#ambient'); if (amb) amb.checked = false;
  }

  // ---------- офлайн-распознавание ----------
  function refreshFollowStatus() {
    $('#followStatus').textContent = '';
    $('#followToggle').disabled = false;
    $('#followToggle').textContent = 'Слушать, как я читаю';
  }
  function startFollow() {
    ensureAudio();
    var f = FollowVosk.create({ tokens: state.tokens.map(function(t){return t.n;}), cues: state.cues,
      onStatus: function(s){ if(state.follow === f) $('#followStatus').textContent=s; },
      onReady: function(){ if(state.follow !== f) return; $('#followPill').hidden=false; $('#extraSound').hidden=false; },
      onEvent: function(e){
        if(state.follow !== f) return;
        if(e.type === 'fire') fireCue(e.k, true, 'auto', e.skipped);
        else {
          state.tokens.forEach(function(t,i){t.el.classList.toggle('read',i<e.pos);t.el.classList.toggle('here',i===e.pos);});
          var el=state.tokens[e.pos].el, r=el.getBoundingClientRect();
          if(r.top<80 || r.bottom>innerHeight-100) el.scrollIntoView({block:'center',behavior:'smooth'});
        }
      }, onError: function(s){ if(state.follow === f){stopFollow(); $('#followStatus').textContent=s;} }
    });
    state.follow=f;
    state.session.events.forEach(function(e){f.core.markFired(e.k);});
    if(state.nextCue) f.core.jump(state.cues[state.nextCue-1].last);
    $('#followToggle').textContent='Выключить слушание';
    f.start();
  }
  function stopFollow() {
    if(state.follow) state.follow.stop();
    state.follow=null;
    $('#followPill').hidden=true; $('#extraSound').hidden=true;
    $('#followStatus').textContent='Слушание выключено';
    $('#followToggle').textContent='Слушать, как я читаю';
    state.tokens.forEach(function(t){t.el.classList.remove('read','here');});
  }

  // ---------- дневник ----------
  function renderDiaryForm() {
    $('#dDate').value = today();
    var box = $('#dStories'); box.textContent = '';
    STORIES.forEach(function (s) {
      var l = document.createElement('label');
      var i = document.createElement('input'); i.type = 'checkbox'; i.value = s.title; i.name = 'dStory';
      l.appendChild(i); l.appendChild(document.createTextNode(' ' + s.title));
      box.appendChild(l);
    });
    var p = LS.get('sp1_presses', null);
    $('#dPresses').textContent = (p && p.date === today())
      ? 'Нажатия звуков сегодня (на этом телефоне): ' + pressesText(p.counts)
      : 'Нажатий звуков сегодня на этом телефоне не было.';
    $('#dPresses').textContent += '\n' + dayText($('#dDate').value) + '\n' + variantsText();
    renderDiaryList();
  }

  function pressesText(counts) {
    var ks = Object.keys(counts || {});
    if (!ks.length) return '—';
    return ks.sort(function (a, b) { return counts[b] - counts[a]; })
      .map(function (k) { return (SFX.META[k] ? SFX.META[k].label : k) + ' ×' + counts[k]; }).join(', ');
  }

  function radio(name) { var el = $('input[name="' + name + '"]:checked'); return el ? el.value : ''; }

  function entryText(e) {
    return [
      e.date + ' · вечер ' + e.evening + ' · режим: ' + e.mode,
      'Сказки: ' + (e.stories.join(', ') || '—'),
      'Вовремя: ' + (e.timing || '—') + (e.falsePos !== '' ? ' · ложных: ' + e.falsePos : ''),
      'Просил ещё: ' + (e.more || '—') + ' · кто предложил: ' + (e.who || '—'),
      'Понравились: ' + (e.liked || '—'),
      'Пугали/мешали: ' + (e.bad || '—'),
      'Нажатия: ' + pressesText(e.presses),
      dayText(e.date), e.variants || variantsText(),
      e.note ? 'Комментарий: ' + e.note : ''
    ].filter(Boolean).join('\n');
  }

  function renderDiaryList() {
    var list = $('#diaryList'); list.textContent = '';
    var entries = LS.get('sp1_diary', []);
    if (!entries.length) { var p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Записей пока нет.'; list.appendChild(p); return; }
    entries.forEach(function (e, idx) {
      var c = document.createElement('div'); c.className = 'card';
      var t = document.createElement('div'); t.className = 'entry'; t.textContent = entryText(e);
      var del = document.createElement('button'); del.className = 'btn ghost small'; del.type = 'button'; del.textContent = 'Удалить запись';
      del.addEventListener('click', function () {
        if (del.dataset.armed) {
          var all = LS.get('sp1_diary', []); all.splice(idx, 1); LS.set('sp1_diary', all); renderDiaryList();
        } else { del.dataset.armed = '1'; del.textContent = 'Точно удалить? Нажмите ещё раз'; }
      });
      c.appendChild(t); c.appendChild(del); list.appendChild(c);
    });
  }

  function saveDiary(ev) {
    ev.preventDefault();
    var p = LS.get('sp1_presses', null);
    var e = {
      date: $('#dDate').value, evening: $('#dEvening').value, mode: radio('dMode'),
      stories: $$('input[name="dStory"]:checked').map(function (i) { return i.value; }),
      timing: radio('dTiming'), falsePos: $('#dFalse').value, more: radio('dMore'), who: radio('dWho'),
      liked: $('#dLiked').value.trim(), bad: $('#dBad').value.trim(), note: $('#dNote').value.trim(),
      variants: variantsText(),
      presses: (p && p.date === today()) ? p.counts : {}
    };
    var all = LS.get('sp1_diary', []); all.push(e); LS.set('sp1_diary', all);
    if (!LS.get('sp1_diary', []).length) toast('Браузер не дал сохранить (приватный режим?). Скопируйте текст вручную.', 6000);
    else toast('Вечер сохранён на этом телефоне');
    $('#diaryForm').reset(); renderDiaryForm();
  }

  // ---------- связывание ----------
  function bind() {
    $('#goSounds').addEventListener('click', function () { ensureAudio(); renderSounds(); show('sounds'); });
    $('#goDiary').addEventListener('click', function () { renderDiaryForm(); show('diary'); });
    $('#themeHome').addEventListener('click', toggleTheme);
    $('#themeToggle').addEventListener('click', toggleTheme);
    $('#roleBack').addEventListener('click', function () { show('home'); });
    $('#readBack').addEventListener('click', function () { show('role'); });
    $('#soundsBack').addEventListener('click', function () { show('home'); });
    $('#diaryBack').addEventListener('click', function () { show('home'); });
    $$('.role').forEach(function (b) { b.addEventListener('click', function () { openReading(b.dataset.role); }); });

    $('#settingsToggle').addEventListener('click', function () {
      var s = $('#settings'); s.hidden = !s.hidden;
      this.setAttribute('aria-expanded', String(!s.hidden));
    });
    $('#fontMinus').addEventListener('click', function () { applyFont(LS.get('sp1_fs', 26) - 2); });
    $('#fontPlus').addEventListener('click', function () { applyFont(LS.get('sp1_fs', 26) + 2); });
    $('#volume').addEventListener('input', function () { setVolume(parseFloat(this.value)); });
    $('#volume2').addEventListener('input', function () { setVolume(parseFloat(this.value)); });
    $('#ambient').addEventListener('change', function () {
      if (this.checked) { var c = ensureAudio(); if (c) state.ambientStop = SFX.startAmbient(c, master); }
      else if (state.ambientStop) { state.ambientStop(); state.ambientStop = null; }
    });

    var pointer = null;
    $('#story').addEventListener('pointerdown', function (ev) {
      if (!ev.isPrimary || ev.button !== 0) return;
      pointer = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, time: performance.now(), moved: false };
    });
    $('#story').addEventListener('pointermove', function (ev) {
      if (pointer && pointer.id === ev.pointerId && Math.hypot(ev.clientX - pointer.x, ev.clientY - pointer.y) >= 10) pointer.moved = true;
    });
    $('#story').addEventListener('pointercancel', function () { pointer = null; });
    $('#story').addEventListener('pointerup', function (ev) {
      var p = pointer; pointer = null;
      if (!p || p.id !== ev.pointerId || p.moved || performance.now() - p.time >= 500 || Math.hypot(ev.clientX-p.x, ev.clientY-p.y) >= 10) return;
      if (state.role === 'solo' || state.follow) {
        var cue = ev.target.closest('.cue');
        fireCue(cue ? +cue.dataset.k : state.nextCue, true, cue ? 'word' : 'tap');
      }
    });
    $('#story').addEventListener('click', function (ev) {
      var cue = ev.target.closest('.cue');
      if (cue && (state.role === 'wizard' || ((state.role === 'solo' || state.follow) && ev.detail === 0))) fireCue(+cue.dataset.k, true, 'word');
    });
    $('#soloPrev').addEventListener('click', function () { if(state.follow) fireCue(Math.max(0,state.nextCue-1),true,'tap'); else {state.nextCue = Math.max(0, state.nextCue - 1); updateNext(false);} });
    $('#dDate').addEventListener('change', function () { $('#dPresses').textContent = dayText(this.value) + '\n' + variantsText(); });
    $('#sourcesToggle').addEventListener('click', function () { $('#soundSources').hidden = !$('#soundSources').hidden; });

    $('#wizNext').addEventListener('click', function () {
      if (state.nextCue < state.cues.length) fireCue(state.nextCue, false);
    });
    $('#wizPrev').addEventListener('click', function () { state.nextCue = Math.max(0, state.nextCue - 1); updateNext(true); });
    $('#wizSkip').addEventListener('click', function () { logCue(state.nextCue, 'skipped'); state.nextCue = Math.min(state.cues.length, state.nextCue + 1); updateNext(true); });

    $('#extraSound').addEventListener('click', function(){ state.session.extra.push({t:Date.now()-state.session.start,k:state.session.events.length ? state.session.events[state.session.events.length-1].k : null}); saveSession(false); toast('Лишний звук отмечен'); });
    window.addEventListener('pagehide', stopFollow);
    $('#followToggle').addEventListener('click', function () { if (state.follow) stopFollow(); else startFollow(); });

    $('#diaryForm').addEventListener('submit', saveDiary);
    $('#diaryExport').addEventListener('click', function () {
      var ta = $('#diaryText');
      ta.value = LS.get('sp1_diary', []).map(entryText).join('\n\n---\n\n') || 'Записей нет.';
      ta.hidden = false; ta.focus(); ta.select();
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(ta.value).then(function () { toast('Скопировано'); }, function () { /* ignore */ });
      else toast('Текст выделен — скопируйте вручную');
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !$('#read').hidden && !state.wakeLock) requestWake();
    });
  }

  function init() {
    if (!window.SFX || !window.STORIES) { document.body.textContent = 'Не загрузились sounds.js или stories.js'; return; }
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(LS.get('sp1_theme', prefersDark ? 'dark' : 'light'));
    applyFont(LS.get('sp1_fs', 26));
    $('#volume').value = volume(); $('#volume2').value = volume();
    renderHome();
    bind();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function(){toast('Не удалось сохранить страницу для работы без сети');});
    window.__SP1_READY__ = true;
  }

  init();
})();
