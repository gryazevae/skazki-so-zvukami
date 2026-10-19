/*
 * SP1 · ядро автослежения: распознанные слова -> позиция в тексте -> какие звуки играть.
 * Без DOM и без микрофона: одно и то же ядро работает в браузере (follow_vosk.js) и в офлайн-замере (Node).
 *
 * Модель распознавания (Vosk) отдаёт промежуточный результат фразы целиком и растущим
 * («жили» → «жили были» → …), а в конце фразы — окончательный. Ядро помнит, сколько слов
 * текущей фразы уже учтено, и разбирает только новые.
 *
 * API:
 *   var f = FollowCore.create({ tokens: ['жили', 'были', …],        // нормализованные слова текста (norm)
 *                               cues: [{ k: 0, first: 5, last: 6 }, …], // индексы первого и последнего слова звуковой фразы
 *                               window: 20, eager: true, pos: 0 });
 *   f.feed('жили были', false)  -> события [{ type: 'move', pos: 1 }, { type: 'fire', k: 0, skipped: [] }]
 *   f.feed('жили были три', true) — окончательный результат фразы
 *   f.jump(j)                   — человек коснулся слова j или нажал звук вручную: продолжать с j+1
 *   f.markFired(k)              — звук k сыгран вручную; ядро не повторит его
 *   f.state()                   -> { pos, fired }
 *
 * Правила v2 (проверены на сохранённых ASR-потоках):
 *   - 2–4 распознанных куска склеиваются при точном совпадении с токеном в окне;
 *   - переход дальше 6 слов требует следующего значимого слова в трёх
 *     последующих позициях текста; eager допускает только близкий переход.
 * Остальные правила исходного ядра:
 *   - слово короче minLen (3) пропускается: предлоги и союзы распознаются плохо и встречаются везде;
 *   - ищем совпадение в окне из `window` слов после текущей позиции: точное или по началу (≥4 букв);
 *   - последнее слово промежуточного результата ещё может поменяться, поэтому ждём следующего слова;
 *     исключение (eager): последнее слово точно совпало с последним словом звуковой фразы в окне —
 *     тогда звук играет сразу, не дожидаясь паузы и окончательного результата;
 *   - если перескочили сразу несколько меток, играет только последняя, остальные — в skipped.
 */
(function (root) {
  'use strict';

  function norm(w) { return String(w).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, ''); }
  var WORD_RE = /[0-9A-Za-zА-Яа-яЁё]+(?:-[0-9A-Za-zА-Яа-яЁё]+)*/g;
  function words(text) { return (String(text).match(WORD_RE) || []).map(norm).filter(Boolean); }

  function matchWord(a, b) {
    if (a === b) return true;
    var m = Math.min(a.length, b.length);
    if (m < 4) return false;
    var need = Math.min(6, Math.max(4, m - 2));
    return a.slice(0, need) === b.slice(0, need);
  }

  function create(opts) {
    var tokens = opts.tokens, cues = opts.cues;
    var WIN = opts.window || 20, MIN = opts.minLen || 3, EAGER = opts.eager !== false;
    var pos = opts.pos || 0, fired = {}, consumed = 0;
    var cueByLast = {};
    cues.forEach(function (c) { cueByLast[c.last] = c; });

    function find(w) {
      if (w.length < MIN) return -1;
      var to = Math.min(tokens.length, pos + WIN);
      for (var j = pos; j < to; j++) if (matchWord(tokens[j], w)) return j;
      return -1;
    }
    // eager: ближайшее совпадение в окне должно само быть последним словом несыгранной метки и совпасть точно;
    // иначе слово, которое встречается в тексте раньше метки («окно» … «выскочила в окно»), утащит позицию вперёд
    function findEagerCue(w) {
      var j = find(w);
      return j >= 0 && tokens[j] === w && cueByLast[j] && !fired[cueByLast[j].k] ? j : -1;
    }

    function moveTo(j, out) {
      var from = pos, hit = [];
      cues.forEach(function (c) { if (c.last >= from && c.last <= j && !fired[c.k]) hit.push(c.k); });
      pos = j + 1;
      out.push({ type: 'move', pos: j });
      if (hit.length) {
        hit.forEach(function (k) { fired[k] = true; });
        out.push({ type: 'fire', k: hit[hit.length - 1], skipped: hit.slice(0, -1) });
      }
    }

    function confirms(ws, i, j) {
      for (var n = i + 1; n < ws.length; n++) {
        if (ws[n].length < MIN) continue;
        for (var k = j + 1; k < Math.min(tokens.length, j + 4); k++)
          if (matchWord(tokens[k], ws[n])) return true;
        return false;
      }
      return false;
    }
    function feed(text, isFinal) {
      var ws = words(text), out = [];
      // Join only exact text tokens; no story-specific vocabulary.
      for (var a = 0; a < ws.length; a++) {
        var joined = ws[a];
        for (var b = a + 1; b < Math.min(ws.length, a + 4); b++) {
          joined += ws[b];
          if (tokens.slice(pos, pos + WIN).indexOf(joined) >= 0) {
            ws.splice(a, b - a + 1, joined); break;
          }
        }
      }
      if (consumed > ws.length) consumed = ws.length; // модель переписала фразу короче
      var upto = isFinal ? ws.length : Math.max(consumed, ws.length - 1);
      for (var i = consumed; i < upto; i++) { var j = find(ws[i]); if (j >= 0 && (j - pos <= 6 || confirms(ws, i, j))) moveTo(j, out); }
      consumed = upto;
      if (!isFinal && EAGER && ws.length > consumed) {
        var jj = findEagerCue(ws[ws.length - 1]);
        if (jj >= 0 && jj - pos <= 6) { moveTo(jj, out); consumed = ws.length; }
      }
      if (isFinal) consumed = 0;
      return out;
    }

    return {
      feed: feed,
      jump: function (j) { pos = Math.max(0, Math.min(tokens.length, j + 1)); },
      markFired: function (k) { fired[k] = true; },
      reset: function (p) { pos = p || 0; fired = {}; consumed = 0; },
      state: function () { return { pos: pos, fired: Object.assign({}, fired) }; }
    };
  }

  var api = { create: create, norm: norm, words: words, matchWord: matchWord, WORD_RE: WORD_RE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FollowCore = api;
})(typeof self !== 'undefined' ? self : this);
