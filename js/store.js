/* Persistence: everything lives in one localStorage key. */
(function () {
  'use strict';

  var KEY = 'kidtube.v1';

  function defaults() {
    return {
      version: 1,
      settings: { parentPinHash: null, childName: 'My Videos', apiKey: '', blockYouTubeLinks: true, useYouTubeSignIn: false, watchMinutes: 15 },
      watch: { until: 0 },
      sources: [],
      videos: []
    };
  }

  function load() {
    var state = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        state.settings = Object.assign(state.settings, parsed.settings || {});
        state.sources = Array.isArray(parsed.sources) ? parsed.sources : [];
        state.videos = Array.isArray(parsed.videos) ? parsed.videos : [];
        if (parsed.watch && typeof parsed.watch.until === 'number') state.watch = parsed.watch;
      }
    } catch (e) {
      console.warn('Could not read saved data', e);
    }
    return state;
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn('Could not save data', e);
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* SHA-256 hex via WebCrypto; falls back to a simple string hash when
     crypto.subtle is unavailable (e.g. some file:// contexts). The PIN only
     guards against accidental access, so the fallback is acceptable. */
  function hashPin(pin) {
    var text = 'kidtube:' + pin;
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      }).catch(function () { return 'fallback:' + simpleHash(text); });
    }
    return Promise.resolve('fallback:' + simpleHash(text));
  }

  function simpleHash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  function exportJson(state) {
    return JSON.stringify({
      app: 'kidtube',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { childName: state.settings.childName, apiKey: state.settings.apiKey, blockYouTubeLinks: state.settings.blockYouTubeLinks, useYouTubeSignIn: state.settings.useYouTubeSignIn, watchMinutes: state.settings.watchMinutes },
      sources: state.sources,
      videos: state.videos
    }, null, 2);
  }

  /* Merges an exported file into `state`. PIN is never imported. */
  function importJson(state, textOrData, replace) {
    var data = typeof textOrData === 'string' ? JSON.parse(textOrData) : textOrData;
    if (!data || !Array.isArray(data.sources) || !Array.isArray(data.videos)) {
      throw new Error('That file does not look like a Kid Tube export.');
    }
    if (replace) { state.sources = []; state.videos = []; }
    var haveSource = {}, haveChannel = {};
    state.sources.forEach(function (s) { haveSource[s.id] = true; if (s.type === 'channel') haveChannel[s.youtubeId] = true; });
    var haveVideo = {};
    state.videos.forEach(function (v) { haveVideo[v.youtubeId] = true; });

    var added = 0;
    data.sources.forEach(function (s) {
      if (!s || !s.id || haveSource[s.id]) return;
      if (s.type === 'channel' && haveChannel[s.youtubeId]) return;
      state.sources.push(s); haveSource[s.id] = true; added++;
      if (s.type === 'channel') haveChannel[s.youtubeId] = true;
    });
    data.videos.forEach(function (v) {
      if (v && v.youtubeId && !haveVideo[v.youtubeId] && haveSource[v.sourceId]) {
        state.videos.push(v); haveVideo[v.youtubeId] = true;
      }
    });
    if (data.settings) {
      if (data.settings.childName) state.settings.childName = data.settings.childName;
      if (data.settings.apiKey && !state.settings.apiKey) state.settings.apiKey = data.settings.apiKey;
      if (typeof data.settings.blockYouTubeLinks === 'boolean') state.settings.blockYouTubeLinks = data.settings.blockYouTubeLinks;
      if (typeof data.settings.useYouTubeSignIn === 'boolean') state.settings.useYouTubeSignIn = data.settings.useYouTubeSignIn;
      if (typeof data.settings.watchMinutes === 'number') state.settings.watchMinutes = data.settings.watchMinutes;
    }
    return added;
  }

  /* ---------- share links ----------
     The library is packed into the URL fragment: deflate-compressed JSON in
     base64url, prefixed "z." (or "j." for plain JSON where compression is
     unavailable). Nothing leaves the device unless the user shares the link. */

  function bytesToBase64Url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToBytes(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /* Compact share link: only channel ids, video ids, hidden ids and a few
     settings. The receiving device looks up titles and channel uploads
     itself, so a 60-video library fits in well under 1,000 characters. */
  function encodeCompact(state, includeApiKey) {
    var channels = [], videos = [], hidden = [];
    state.sources.forEach(function (src) {
      if (src.type === 'channel') channels.push(src.youtubeId);
      else if (src.type === 'video') videos.push(src.youtubeId);
    });
    state.videos.forEach(function (v) { if (v.hidden) hidden.push(v.youtubeId); });
    var parts = [];
    if (channels.length) parts.push('c=' + channels.join(','));
    if (videos.length) parts.push('v=' + videos.join(','));
    if (hidden.length) parts.push('h=' + hidden.join(','));
    if (state.settings.childName && state.settings.childName !== 'My Videos') parts.push('n=' + encodeURIComponent(state.settings.childName));
    if (typeof state.settings.watchMinutes === 'number') parts.push('m=' + state.settings.watchMinutes);
    if (state.settings.blockYouTubeLinks === false) parts.push('b=0');
    if (state.settings.useYouTubeSignIn) parts.push('s=1');
    if (includeApiKey && state.settings.apiKey) parts.push('k=' + encodeURIComponent(state.settings.apiKey));
    return '2.' + parts.join('&');
  }

  var ID_RE = /^[A-Za-z0-9_-]{11}$/;
  var CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;

  /* Expand a compact link into the same shape as a full export. Titles are
     placeholders that the app fills in after import. */
  function decodeCompact(body) {
    var q = {};
    body.split('&').forEach(function (part) {
      var i = part.indexOf('=');
      if (i > 0) q[part.slice(0, i)] = part.slice(i + 1);
    });
    var now = new Date().toISOString();
    var sources = [], videos = [];
    (q.c ? q.c.split(',') : []).forEach(function (id) {
      if (!CHANNEL_RE.test(id)) return;
      sources.push({ id: 'ch-' + id, type: 'channel', youtubeId: id, uploadsPlaylistId: 'UU' + id.slice(2),
        title: 'Channel ' + id.slice(2, 8) + '…', channelName: '', thumbnail: '', addedAt: now, lastSyncedAt: null, needsDetails: true });
    });
    (q.v ? q.v.split(',') : []).forEach(function (id) {
      if (!ID_RE.test(id)) return;
      sources.push({ id: 'v-' + id, type: 'video', youtubeId: id, title: 'YouTube video ' + id, channelName: '', addedAt: now });
      videos.push({ youtubeId: id, title: 'YouTube video ' + id, channelName: '', sourceId: 'v-' + id, publishedAt: '', addedAt: now });
    });
    if (!sources.length) throw new Error('This link does not contain any videos or channels.');
    var settings = {};
    if (q.n) settings.childName = decodeURIComponent(q.n);
    if (q.m !== undefined && !isNaN(parseInt(q.m, 10))) settings.watchMinutes = parseInt(q.m, 10);
    if (q.b === '0') settings.blockYouTubeLinks = false;
    if (q.s === '1') settings.useYouTubeSignIn = true;
    if (q.k) settings.apiKey = decodeURIComponent(q.k);
    return { app: 'kidtube', version: 2, compact: true, settings: settings, sources: sources, videos: videos,
      hiddenIds: (q.h ? q.h.split(',') : []).filter(function (id) { return ID_RE.test(id); }) };
  }

  function sharePayload(state, includeApiKey) {
    var settings = {
      childName: state.settings.childName,
      blockYouTubeLinks: state.settings.blockYouTubeLinks,
      useYouTubeSignIn: state.settings.useYouTubeSignIn,
      watchMinutes: state.settings.watchMinutes
    };
    if (includeApiKey && state.settings.apiKey) settings.apiKey = state.settings.apiKey;
    return {
      app: 'kidtube',
      version: 1,
      settings: settings,
      sources: state.sources,
      videos: state.videos.map(function (v) {
        var copy = Object.assign({}, v);
        // The default thumbnail is derived from the ID; drop it to keep links short.
        if (copy.thumbnail === 'https://i.ytimg.com/vi/' + v.youtubeId + '/hqdefault.jpg') delete copy.thumbnail;
        return copy;
      })
    };
  }

  function encodeShare(obj) {
    var json = JSON.stringify(obj);
    if (typeof CompressionStream === 'undefined') {
      return Promise.resolve('j.' + bytesToBase64Url(new TextEncoder().encode(json)));
    }
    var stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return 'z.' + bytesToBase64Url(new Uint8Array(buf));
    });
  }

  function decodeShare(str) {
    var kind = str.slice(0, 2), body = str.slice(2);
    if (kind === '2.') {
      return Promise.resolve().then(function () { return decodeCompact(body); });
    }
    var bytes;
    try { bytes = base64UrlToBytes(body); } catch (e) { return Promise.reject(new Error('This link is damaged or incomplete.')); }
    if (kind === 'j.') {
      return Promise.resolve().then(function () { return JSON.parse(new TextDecoder().decode(bytes)); });
    }
    if (kind !== 'z.') return Promise.reject(new Error('This is not a Kid Tube share link.'));
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('This browser is too old to open share links. Please update it.'));
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text().then(function (json) { return JSON.parse(json); })
      .catch(function () { throw new Error('This link is damaged or incomplete.'); });
  }

  window.STORE = {
    encodeCompact: encodeCompact,
    sharePayload: sharePayload,
    encodeShare: encodeShare,
    decodeShare: decodeShare,
    load: load,
    save: save,
    clear: clear,
    uid: uid,
    hashPin: hashPin,
    exportJson: exportJson,
    importJson: importJson
  };
})();
