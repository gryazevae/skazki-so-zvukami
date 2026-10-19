/*
 * SP1 · Сказки со звуками — процедурные звуки на WebAudio API.
 * Ни одного аудиофайла: каждый звук собирается из осцилляторов, шума и фильтров.
 * API: SFX.play(ctx, out, id, when) -> длительность, с;
 *      SFX.startAmbient(ctx, out) -> функция остановки;
 *      SFX.META — подписи и значки.
 * ctx может быть AudioContext или OfflineAudioContext (так звук проверяется в selftest.html).
 */
(function (global) {
  'use strict';

  var META = {
    birds:       { label: 'Птицы в лесу',     icon: '🐦' },
    door:        { label: 'Скрип двери',      icon: '🚪' },
    spoon:       { label: 'Ложка звякнула',   icon: '🥄' },
    crack:       { label: 'Треск, сломалось', icon: '💥' },
    bear_big:    { label: 'Большой медведь',  icon: '🐻' },
    bear_mid:    { label: 'Медведица',        icon: '🐾' },
    bear_small:  { label: 'Мишутка пищит',    icon: '🧸' },
    whoosh:      { label: 'Шшух! Убежала',    icon: '💨' },
    knock:       { label: 'Стук в дверь',     icon: '✊' },
    goat_song:   { label: 'Песенка козы',     icon: '🐐' },
    lock:        { label: 'Щёлк, замок',      icon: '🔒' },
    water:       { label: 'Вода, ручеёк',     icon: '💧' },
    wolf:        { label: 'Волк воет',        icon: '🐺' },
    heavy_steps: { label: 'Тяжёлые шаги',     icon: '👣' },
    steps:       { label: 'Шаги по листьям',  icon: '🍂' },
    crickets:    { label: 'Сверчки, вечер',   icon: '🌙' },
    wings:       { label: 'Крылья, взлетел',  icon: '🪶' },
    rooster:     { label: 'Ку-ка-ре-ку',      icon: '🐓' },
    fox:         { label: 'Лиса крадётся',    icon: '🦊' },
    bark:        { label: 'Гав! Собака',      icon: '🐕' },
    wind:        { label: 'Ветер',            icon: '🌬️' },
    bell:        { label: 'Колокольчик',      icon: '🔔' }
  };

  // ---------- общие кирпичики ----------
  var noiseCache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function noiseBuffer(ctx) {
    var b = noiseCache && noiseCache.get(ctx);
    if (b) return b;
    var len = Math.floor(ctx.sampleRate * 2);
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = b.getChannelData(0);
    var seed = 20261002;
    for (var i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      d[i] = seed / 4294967296 * 2 - 1;
    }
    if (noiseCache) noiseCache.set(ctx, b);
    return b;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  // огибающая: подъём, удержание, спад (экспоненциально)
  function env(ctx, out, t, attack, hold, release, peak) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.max(attack, 0.001));
    g.gain.setValueAtTime(peak, t + attack + Math.max(hold, 0));
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + Math.max(hold, 0) + Math.max(release, 0.005));
    g.connect(out);
    return g;
  }

  function osc(ctx, type, freq, t, dur) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  function noise(ctx, t, dur) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx);
    s.loop = true;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return s;
  }

  function filt(ctx, type, freq, q) {
    var f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  }

  function shaper(ctx, amount) {
    var ws = ctx.createWaveShaper();
    var n = 1024, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1) * 2 - 1;
      c[i] = Math.tanh(amount * x) / Math.tanh(amount);
    }
    ws.curve = c;
    return ws;
  }

  function lfo(ctx, target, rate, depth, t, dur, type) {
    var l = osc(ctx, type || 'sine', rate, t, dur);
    var g = ctx.createGain();
    g.gain.value = depth;
    l.connect(g);
    g.connect(target);
    return l;
  }

  // металлический «динь» (неравные обертоны)
  function ping(ctx, out, t, f, peak, decay) {
    var ratios = [1, 2.76, 5.4, 8.93];
    for (var i = 0; i < ratios.length; i++) {
      var o = osc(ctx, 'sine', f * ratios[i], t, decay + 0.1);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak / (i + 1), t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay / (i * 0.7 + 1) + 0.02);
      o.connect(g); g.connect(out);
    }
  }

  // колокольчик (мягкий, с длинным хвостом)
  function bellTone(ctx, out, t, f, peak, decay) {
    var parts = [[1, 1], [2, 0.45], [2.76, 0.3], [4.07, 0.18], [5.4, 0.08]];
    for (var i = 0; i < parts.length; i++) {
      var o = osc(ctx, 'sine', f * parts[i][0], t, decay + 0.1);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak * parts[i][1], t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay / (1 + i * 0.6));
      o.connect(g); g.connect(out);
    }
  }

  // рык: пила + дрожание + шум дыхания + перегруз
  function growl(ctx, out, t, p) {
    var dur = p.dur;
    var o = osc(ctx, 'sawtooth', p.f, t, dur);
    o.frequency.linearRampToValueAtTime(p.f * 1.25, t + dur * 0.3);
    o.frequency.linearRampToValueAtTime(p.f * 0.85, t + dur);
    lfo(ctx, o.frequency, p.rough, p.f * 0.08, t, dur);
    var am = ctx.createGain();
    am.gain.value = 0.6;
    lfo(ctx, am.gain, p.rough * 0.45, 0.4, t, dur);
    var ws = shaper(ctx, 3);
    var lp = filt(ctx, 'lowpass', p.cutoff, 1);
    var pk = filt(ctx, 'peaking', p.cutoff * 0.55, 2);
    pk.gain.value = 6;
    var e = env(ctx, out, t, 0.12, dur - 0.4, 0.28, p.peak);
    o.connect(ws); ws.connect(am); am.connect(lp); lp.connect(pk); pk.connect(e);
    var n = noise(ctx, t, dur);
    var nlp = filt(ctx, 'lowpass', p.cutoff * 0.8, 0.7);
    var ng = ctx.createGain(); ng.gain.value = 0.3;
    n.connect(nlp); nlp.connect(ng); ng.connect(am);
    return dur + 0.1;
  }

  // ---------- звуки ----------
  var GEN = {
    birds: function (ctx, out, t) {
      var tt = t, n = 6 + Math.floor(Math.random() * 4);
      for (var i = 0; i < n; i++) {
        var f0 = rnd(2400, 3600), d = rnd(0.06, 0.12);
        var o = osc(ctx, 'sine', f0, tt, d);
        o.frequency.exponentialRampToValueAtTime(f0 * rnd(1.3, 1.8), tt + d * 0.6);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.9, tt + d);
        o.connect(env(ctx, out, tt, 0.005, d * 0.4, d * 0.5, 0.22));
        tt += d + 0.04 + (i % 3 === 2 ? rnd(0.15, 0.3) : rnd(0, 0.06));
      }
      return tt - t + 0.1;
    },

    door: function (ctx, out, t) {
      var dur = 1.4;
      var o = osc(ctx, 'sawtooth', 60, t, dur);
      var curve = new Float32Array(32), v = 55;
      for (var i = 0; i < curve.length; i++) {
        v += (Math.random() - 0.45) * 25;
        v = Math.min(140, Math.max(35, v));
        curve[i] = v;
      }
      o.frequency.setValueCurveAtTime(curve, t + 0.01, dur - 0.02);
      var e = env(ctx, out, t, 0.08, dur - 0.32, 0.2, 0.55);
      var b1 = filt(ctx, 'bandpass', 900, 6), b2 = filt(ctx, 'bandpass', 2100, 8);
      o.connect(b1); o.connect(b2); b1.connect(e); b2.connect(e);
      return dur + 0.1;
    },

    spoon: function (ctx, out, t) {
      ping(ctx, out, t, 2100, 0.25, 0.5);
      ping(ctx, out, t + 0.18, 2350, 0.18, 0.45);
      return 0.8;
    },

    crack: function (ctx, out, t) {
      var o = osc(ctx, 'sine', 140, t, 0.3);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
      o.connect(env(ctx, out, t, 0.003, 0.02, 0.25, 0.6));
      for (var i = 0; i < 10; i++) {
        var tt = t + Math.random() * 0.35;
        var s = noise(ctx, tt, 0.05);
        var bp = filt(ctx, 'bandpass', rnd(1200, 3700), 3);
        s.connect(bp);
        bp.connect(env(ctx, out, tt, 0.001, 0.005, rnd(0.02, 0.05), rnd(0.25, 0.7)));
      }
      return 0.6;
    },

    bear_big: function (ctx, out, t) {
      return growl(ctx, out, t, { f: 65, dur: 1.6, cutoff: 700, peak: 0.42, rough: 28 });
    },

    bear_mid: function (ctx, out, t) {
      return growl(ctx, out, t, { f: 110, dur: 1.1, cutoff: 1000, peak: 0.4, rough: 32 });
    },

    bear_small: function (ctx, out, t) {
      [0, 0.28].forEach(function (off) {
        var tt = t + off;
        var o = osc(ctx, 'square', 520, tt, 0.24);
        o.frequency.exponentialRampToValueAtTime(900, tt + 0.08);
        o.frequency.exponentialRampToValueAtTime(650, tt + 0.22);
        lfo(ctx, o.frequency, 18, 30, tt, 0.24);
        var bp = filt(ctx, 'bandpass', 1800, 2);
        o.connect(bp);
        bp.connect(env(ctx, out, tt, 0.01, 0.12, 0.1, 0.25));
      });
      return 0.65;
    },

    whoosh: function (ctx, out, t) {
      var dur = 0.9;
      var s = noise(ctx, t, dur);
      var bp = filt(ctx, 'bandpass', 300, 1.5);
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(2800, t + dur * 0.45);
      bp.frequency.exponentialRampToValueAtTime(500, t + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.7, t + dur * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(bp); bp.connect(g); g.connect(out);
      return dur + 0.05;
    },

    knock: function (ctx, out, t) {
      [0, 0.24, 0.48].forEach(function (off) {
        var tt = t + off;
        var o = osc(ctx, 'sine', 190, tt, 0.15);
        o.frequency.exponentialRampToValueAtTime(70, tt + 0.1);
        o.connect(env(ctx, out, tt, 0.002, 0.01, 0.1, 0.8));
        var s = noise(ctx, tt, 0.05);
        var lp = filt(ctx, 'lowpass', 1800, 1);
        s.connect(lp);
        lp.connect(env(ctx, out, tt, 0.001, 0.004, 0.03, 0.4));
      });
      return 0.75;
    },

    goat_song: function (ctx, out, t) {
      // ласковая песенка: G5 E5 G5 E5 A5 G5 E5
      var notes = [784, 659, 784, 659, 880, 784, 659];
      var tt = t;
      bellTone(ctx, out, t, 1568, 0.08, 1.2);
      for (var i = 0; i < notes.length; i++) {
        var d = i === notes.length - 1 ? 0.45 : 0.19;
        var o = osc(ctx, 'triangle', notes[i], tt, d);
        lfo(ctx, o.frequency, 6, 6, tt, d);
        o.connect(env(ctx, out, tt, 0.02, d * 0.5, d * 0.5, 0.28));
        tt += d + 0.02;
      }
      return tt - t + 0.2;
    },

    lock: function (ctx, out, t) {
      [0, 0.16].forEach(function (off, i) {
        var tt = t + off;
        var s = noise(ctx, tt, 0.03);
        var hp = filt(ctx, 'highpass', 2500, 0.7);
        s.connect(hp);
        hp.connect(env(ctx, out, tt, 0.001, 0.003, 0.02, 0.6));
        var f = i ? 1400 : 1100;
        var o = osc(ctx, 'square', f, tt, 0.06);
        var bp = filt(ctx, 'bandpass', f, 10);
        o.connect(bp);
        bp.connect(env(ctx, out, tt, 0.001, 0.005, 0.04, 0.12));
      });
      return 0.35;
    },

    water: function (ctx, out, t) {
      var dur = 1.6;
      for (var i = 0; i < 26; i++) {
        var tt = t + Math.random() * dur;
        var f = rnd(500, 1400), d = rnd(0.03, 0.08);
        var o = osc(ctx, 'sine', f, tt, d);
        o.frequency.exponentialRampToValueAtTime(f * 1.8, tt + d);
        o.connect(env(ctx, out, tt, 0.003, 0.005, d, rnd(0.12, 0.24)));
      }
      var s = noise(ctx, t, dur);
      var bp = filt(ctx, 'bandpass', 1200, 0.8);
      s.connect(bp);
      bp.connect(env(ctx, out, t, 0.2, dur - 0.5, 0.3, 0.06));
      return dur + 0.15;
    },

    wolf: function (ctx, out, t) {
      var dur = 2.2;
      var o = osc(ctx, 'sawtooth', 220, t, dur);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.6);
      o.frequency.linearRampToValueAtTime(470, t + 1.5);
      o.frequency.exponentialRampToValueAtTime(300, t + dur);
      lfo(ctx, o.frequency, 5.5, 8, t, dur);
      var lp = filt(ctx, 'lowpass', 500, 3);
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.linearRampToValueAtTime(1100, t + 0.8);
      lp.frequency.linearRampToValueAtTime(600, t + dur);
      o.connect(lp);
      lp.connect(env(ctx, out, t, 0.25, dur - 0.75, 0.5, 0.35));
      return dur + 0.1;
    },

    heavy_steps: function (ctx, out, t) {
      for (var i = 0; i < 4; i++) {
        var tt = t + i * 0.5;
        var o = osc(ctx, 'sine', 75, tt, 0.25);
        o.frequency.exponentialRampToValueAtTime(40, tt + 0.2);
        o.connect(env(ctx, out, tt, 0.005, 0.03, 0.2, 0.9));
        var s = noise(ctx, tt, 0.15);
        var lp = filt(ctx, 'lowpass', 350, 1);
        s.connect(lp);
        lp.connect(env(ctx, out, tt, 0.005, 0.03, 0.12, 0.5));
      }
      return 2.0;
    },

    steps: function (ctx, out, t) {
      for (var i = 0; i < 6; i++) {
        var tt = t + i * 0.32 + Math.random() * 0.04;
        var s = noise(ctx, tt, 0.12);
        var bp = filt(ctx, 'bandpass', rnd(1800, 2600), 0.9);
        s.connect(bp);
        bp.connect(env(ctx, out, tt, 0.005, 0.02, 0.08, 0.35));
        var o = osc(ctx, 'sine', 110, tt, 0.15);
        o.frequency.exponentialRampToValueAtTime(60, tt + 0.1);
        o.connect(env(ctx, out, tt, 0.004, 0.02, 0.1, 0.25));
      }
      return 2.0;
    },

    crickets: function (ctx, out, t) {
      var dur = 2.2;
      [[4200, 0], [4700, 0.2]].forEach(function (c) {
        for (var tr = t + c[1]; tr < t + dur - 0.2; tr += 0.45) {
          for (var p = 0; p < 4; p++) {
            var tt = tr + p * 0.035;
            var o = osc(ctx, 'sine', c[0], tt, 0.03);
            o.connect(env(ctx, out, tt, 0.003, 0.01, 0.012, 0.08));
          }
        }
      });
      return dur;
    },

    wings: function (ctx, out, t) {
      var s = noise(ctx, t, 1.0);
      var bp = filt(ctx, 'bandpass', 700, 0.8);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      for (var k = 0; k < 7; k++) {
        var tk = t + k * 0.13;
        g.gain.setValueAtTime(0.0001, tk);
        g.gain.linearRampToValueAtTime(0.55 * (1 - k / 9), tk + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, tk + 0.12);
      }
      s.connect(bp); bp.connect(g); g.connect(out);
      return 1.0;
    },

    rooster: function (ctx, out, t) {
      // «ку-ка-ре-ку»: четыре слога с формантами
      var syl = [[0, 0.11, 520, 560], [0.14, 0.11, 560, 600], [0.28, 0.13, 640, 700], [0.45, 0.7, 820, 560]];
      syl.forEach(function (s, i) {
        var tt = t + s[0], d = s[1];
        var o = osc(ctx, 'sawtooth', s[2], tt, d);
        o.frequency.linearRampToValueAtTime(s[3] * 1.05, tt + d * 0.3);
        o.frequency.linearRampToValueAtTime(s[3], tt + d);
        if (i === 3) lfo(ctx, o.frequency, 7, 12, tt, d);
        var ws = shaper(ctx, 2);
        var b1 = filt(ctx, 'bandpass', 1100, 3), b2 = filt(ctx, 'bandpass', 2600, 4);
        var e = env(ctx, out, tt, 0.01, d * 0.6, d * 0.35, 0.4);
        o.connect(ws); ws.connect(b1); ws.connect(b2); b1.connect(e); b2.connect(e);
      });
      return 1.25;
    },

    fox: function (ctx, out, t) {
      // крадущееся пиццикато и «подмигивание» в конце
      var notes = [[0, 330], [0.22, 349], [0.44, 370], [0.66, 392], [1.0, 330], [1.12, 494]];
      notes.forEach(function (n) {
        var tt = t + n[0];
        var o = osc(ctx, 'triangle', n[1], tt, 0.2);
        var lp = filt(ctx, 'lowpass', 2000, 1);
        o.connect(lp);
        lp.connect(env(ctx, out, tt, 0.004, 0.01, 0.16, 0.4));
      });
      return 1.4;
    },

    bark: function (ctx, out, t) {
      [0, 0.3].forEach(function (off) {
        var tt = t + off;
        var o = osc(ctx, 'sawtooth', 420, tt, 0.16);
        o.frequency.exponentialRampToValueAtTime(260, tt + 0.14);
        var ws = shaper(ctx, 4);
        var bp = filt(ctx, 'bandpass', 1100, 1.2);
        o.connect(ws); ws.connect(bp);
        bp.connect(env(ctx, out, tt, 0.005, 0.04, 0.1, 0.5));
        var s = noise(ctx, tt, 0.12);
        var bp2 = filt(ctx, 'bandpass', 1500, 1);
        s.connect(bp2);
        bp2.connect(env(ctx, out, tt, 0.003, 0.02, 0.08, 0.25));
      });
      return 0.6;
    },

    wind: function (ctx, out, t) {
      var dur = 2.5;
      var s = noise(ctx, t, dur);
      var bp = filt(ctx, 'bandpass', 500, 2.5);
      lfo(ctx, bp.frequency, 0.6, 300, t, dur);
      s.connect(bp);
      bp.connect(env(ctx, out, t, 0.6, dur - 1.4, 0.8, 0.5));
      return dur + 0.1;
    },

    bell: function (ctx, out, t) {
      bellTone(ctx, out, t, 1320, 0.3, 1.4);
      bellTone(ctx, out, t + 0.25, 1760, 0.2, 1.2);
      return 1.6;
    }
  };

  // Коррекция уровня каждого звука, дБ. Измеряется selftest/loudness.mjs.
  var GAIN_DB = {
    birds: -1.1, door: 6.5, spoon: 1.3, crack: -5.2,
    bear_big: -11.0, bear_mid: -10.0, bear_small: 2.4, whoosh: 5.3,
    knock: -8.1, goat_song: -5.7, lock: 0, water: 1.3,
    wolf: -8.6, heavy_steps: -10.3, steps: 0.4, crickets: 7.4,
    wings: 9.3, rooster: -3.6, fox: -1.7, bark: -1.4,
    wind: 6.9, bell: -1.2
  };

  // Записи необязательны: ошибка сети или декодирования оставляет синтез.
  var buffers = new WeakMap();
  function manifest() { return (global.SP1_AUDIO || {}).sounds || {}; }
  function selected(id) {
    var spec = manifest()[id];
    if (!spec || !spec.variants.length) return 0;
    var n = spec.default || 0;
    try { var saved = localStorage.getItem('sp1_variant_' + id); if (saved !== null) n = Number(saved); } catch (e) {}
    return Number.isInteger(n) && spec.variants[n] ? n : (spec.default || 0);
  }
  function cache(ctx) { if (!buffers.has(ctx)) buffers.set(ctx, {}); return buffers.get(ctx); }
  function load(ctx, id) {
    var spec = manifest()[id], n = selected(id), v = spec && spec.variants[n];
    if (!v || !/^audio\/[a-zA-Z0-9_./-]+\.mp3$/.test(v.file) || v.file.includes('..')) return Promise.resolve(null);
    var key = id + ':' + n, box = cache(ctx);
    if (!box[key]) box[key] = { promise: fetch(v.file).then(function (r) {
      if (!r.ok) throw new Error('audio'); return r.arrayBuffer();
    }).then(function (b) { return ctx.decodeAudioData(b); }).then(function (b) {
      box[key].buffer = b; return b;
    }).catch(function () { return null; }) };
    return box[key].promise;
  }
  function preload(ctx) { return Promise.all(Object.keys(manifest()).map(function (id) { return load(ctx, id); })); }
  function recording(ctx, out, id, when, loop) {
    var spec = manifest()[id], n = selected(id), v = spec && spec.variants[n];
    var item = cache(ctx)[id + ':' + n];
    if (!item || !item.buffer) return null;
    var source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = item.buffer; source.loop = !!loop;
    gain.gain.value = (Number.isFinite(v.gain) ? v.gain : 1) * (loop ? 0.5 : 1);
    source.connect(gain); gain.connect(out);
    source.onended = function () { source.disconnect(); gain.disconnect(); };
    source.start(Math.max(when || 0, ctx.currentTime));
    return { duration: item.buffer.duration, stop: function () { source.stop(); } };
  }

  function play(ctx, out, id, when) {
    var recorded = recording(ctx, out, id, when, false);
    if (recorded) return recorded.duration;
    var fn = GEN[id];
    if (!fn) throw new Error('Нет такого звука: ' + id);
    var t = Math.max(when || 0, ctx.currentTime);
    var gain = ctx.createGain();
    gain.gain.value = Math.pow(10, (GAIN_DB[id] || 0) / 20);
    gain.connect(out);
    return fn(ctx, gain, t);
  }

  // фон «лес»: тихий ветер + редкие птицы. Возвращает функцию остановки.
  function startAmbient(ctx, out) {
    var recorded = recording(ctx, out, "forest", ctx.currentTime, true);
    if (recorded) return recorded.stop;
    var bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 2);
    bus.connect(out);
    var s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx);
    s.loop = true;
    var bp = filt(ctx, 'bandpass', 420, 0.7);
    var l = ctx.createOscillator(); l.frequency.value = 0.07;
    var lg = ctx.createGain(); lg.gain.value = 180;
    l.connect(lg); lg.connect(bp.frequency);
    var wg = ctx.createGain(); wg.gain.value = 0.18;
    s.connect(bp); bp.connect(wg); wg.connect(bus);
    s.start(); l.start();
    var timer = setInterval(function () {
      if (Math.random() < 0.5) {
        var g = ctx.createGain(); g.gain.value = 0.35; g.connect(bus);
        GEN.birds(ctx, g, ctx.currentTime + 0.05);
      }
    }, 5000);
    return function stop() {
      clearInterval(timer);
      var now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value || 0.0001, now);
      bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
      s.stop(now + 0.9); l.stop(now + 0.9);
    };
  }

  global.SFX = {
    META: META,
    preload: preload, load: load, selected: selected, manifest: manifest,
    ids: function () { return Object.keys(META); },
    has: function (id) { return !!GEN[id] && !!META[id]; },
    gainDb: function (id) { return GAIN_DB[id] || 0; },
    play: play,
    startAmbient: startAmbient
  };
})(typeof window !== 'undefined' ? window : globalThis);
