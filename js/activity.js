/* Activity log for parents: how long kid mode was open and how long videos
   actually played, in 15-minute slots per local day. Kept in its own
   localStorage entry (written every few seconds while watching), separate
   from the library, and trimmed to the last DAYS_KEPT days. */
(function () {
  'use strict';

  var KEY = 'kidtube.activity';
  var DAYS_KEPT = 60;
  var SLOT_MIN = 15;
  var SLOTS = 24 * 60 / SLOT_MIN;
  var SAVE_EVERY_MS = 15000;

  // days[YYYY-MM-DD] = { w: {slot: seconds watching}, o: {slot: seconds open}, ch: {channel: seconds watching} }
  var data = load();
  var dirty = false, lastSave = 0;

  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.days && typeof d.days === 'object') return d;
    } catch (e) { /* ignore */ }
    return { days: {} };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function dayKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function prune() {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAYS_KEPT);
    var min = dayKey(cutoff);
    Object.keys(data.days).forEach(function (k) { if (k < min) delete data.days[k]; });
  }

  function save() {
    if (!dirty) return;
    prune();
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    dirty = false; lastSave = Date.now();
  }

  /* Add `seconds` of kid-mode time ending now. `watching` means a video was
     playing; `channel` is credited with the watching time. */
  function add(seconds, watching, channel) {
    if (!(seconds > 0)) return;
    var now = new Date();
    var key = dayKey(now);
    var slot = Math.floor((now.getHours() * 60 + now.getMinutes()) / SLOT_MIN);
    var day = data.days[key] || (data.days[key] = { w: {}, o: {}, ch: {} });
    day.o[slot] = Math.round(((day.o[slot] || 0) + seconds) * 10) / 10;
    if (watching) {
      day.w[slot] = Math.round(((day.w[slot] || 0) + seconds) * 10) / 10;
      if (channel) day.ch[channel] = Math.round(((day.ch[channel] || 0) + seconds) * 10) / 10;
    }
    dirty = true;
    if (Date.now() - lastSave > SAVE_EVERY_MS) save();
  }

  /* The last `count` days, newest first, each with per-slot arrays. */
  function recentDays(count) {
    var out = [];
    var d = new Date();
    for (var i = 0; i < count; i++) {
      var key = dayKey(d);
      var day = data.days[key] || { w: {}, o: {}, ch: {} };
      var w = [], o = [], watch = 0, open = 0;
      for (var s = 0; s < SLOTS; s++) {
        w.push(day.w[s] || 0); o.push(day.o[s] || 0);
        watch += day.w[s] || 0; open += day.o[s] || 0;
      }
      out.push({ key: key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), w: w, o: o, ch: day.ch || {}, watch: watch, open: open });
      d.setDate(d.getDate() - 1);
    }
    return out;
  }

  function hasAny() {
    return Object.keys(data.days).length > 0;
  }

  function clear() {
    data = { days: {} };
    dirty = false;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

  window.ACTIVITY = {
    SLOT_MIN: SLOT_MIN,
    SLOTS: SLOTS,
    add: add,
    save: save,
    recentDays: recentDays,
    hasAny: hasAny,
    clear: clear
  };
})();
