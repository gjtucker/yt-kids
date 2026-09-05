/* Persistence: everything lives in one localStorage key. */
(function () {
  'use strict';

  var KEY = 'kidtube.v1';

  function defaults() {
    return {
      version: 1,
      settings: { parentPinHash: null, childName: 'My Videos', apiKey: '', blockYouTubeLinks: true, useYouTubeSignIn: false },
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
      settings: { childName: state.settings.childName, apiKey: state.settings.apiKey, blockYouTubeLinks: state.settings.blockYouTubeLinks, useYouTubeSignIn: state.settings.useYouTubeSignIn },
      sources: state.sources,
      videos: state.videos
    }, null, 2);
  }

  /* Merges an exported file into `state`. PIN is never imported. */
  function importJson(state, text) {
    var data = JSON.parse(text);
    if (!data || !Array.isArray(data.sources) || !Array.isArray(data.videos)) {
      throw new Error('That file does not look like a Kid Tube export.');
    }
    var haveSource = {};
    state.sources.forEach(function (s) { haveSource[s.id] = true; });
    var haveVideo = {};
    state.videos.forEach(function (v) { haveVideo[v.youtubeId] = true; });

    var added = 0;
    data.sources.forEach(function (s) {
      if (s && s.id && !haveSource[s.id]) { state.sources.push(s); haveSource[s.id] = true; added++; }
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
    }
    return added;
  }

  window.STORE = {
    load: load,
    save: save,
    clear: clear,
    uid: uid,
    hashPin: hashPin,
    exportJson: exportJson,
    importJson: importJson
  };
})();
