/* YouTube helpers: URL parsing, thumbnails, metadata (oEmbed) and the
   optional YouTube Data API v3 (only needed for channels). No build step;
   everything is attached to window.YT_HELPERS. */
(function () {
  'use strict';

  var VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  /* Parse any YouTube URL (or a bare 11-char ID) into
     { type: 'video', id } | { type: 'channel', channelId | handle | username | custom }
     | null when nothing usable was found. */
  function parseYouTubeUrl(input) {
    var text = (input || '').trim();
    if (!text) return null;
    if (VIDEO_ID_RE.test(text)) return { type: 'video', id: text };
    if (/^UC[A-Za-z0-9_-]{22}$/.test(text)) return { type: 'channel', channelId: text };
    if (text[0] === '@') return { type: 'channel', handle: text.slice(1) };

    var url;
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text);
    } catch (e) {
      return null;
    }
    var host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
    var parts = url.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be') {
      return parts[0] && VIDEO_ID_RE.test(parts[0]) ? { type: 'video', id: parts[0] } : null;
    }
    if (host !== 'youtube.com' && host !== 'music.youtube.com' && host !== 'youtube-nocookie.com') {
      return null;
    }

    var v = url.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return { type: 'video', id: v };

    var first = parts[0] || '';
    var second = parts[1] || '';
    if ((first === 'embed' || first === 'shorts' || first === 'live' || first === 'v' || first === 'e') && VIDEO_ID_RE.test(second)) {
      return { type: 'video', id: second };
    }
    if (first === 'watch' && VIDEO_ID_RE.test(second)) return { type: 'video', id: second };
    if (first === 'channel' && /^UC[A-Za-z0-9_-]{22}$/.test(second)) return { type: 'channel', channelId: second };
    if (first[0] === '@') return { type: 'channel', handle: decodeURIComponent(first.slice(1)) };
    if (first === 'user' && second) return { type: 'channel', username: second };
    if (first === 'c' && second) return { type: 'channel', custom: second };
    return null;
  }

  function thumbnailUrl(videoId, quality) {
    return 'https://i.ytimg.com/vi/' + videoId + '/' + (quality || 'hqdefault') + '.jpg';
  }

  function embedUrl(videoId) {
    // rel=0 keeps end-screen suggestions limited to the same channel.
    return 'https://www.youtube-nocookie.com/embed/' + videoId +
      '?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3';
  }

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  /* Title + channel name without an API key. Tries YouTube's oEmbed endpoint,
     then noembed.com. Resolves to null if both fail (the caller can still
     add the video with a placeholder title). */
  function fetchVideoMetadata(videoId) {
    var watchUrl = 'https://www.youtube.com/watch?v=' + videoId;
    var oembed = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(watchUrl);
    var noembed = 'https://noembed.com/embed?url=' + encodeURIComponent(watchUrl);
    function pick(data) {
      if (!data || !data.title) return null;
      return { title: data.title, channelName: data.author_name || '' };
    }
    // oEmbed answers 401/403 for videos whose owner disabled embedding and
    // 404 for private/removed ones, so those are detectable without a key.
    return fetch(oembed).then(function (res) {
      if (res.status === 401 || res.status === 403 || res.status === 404) return { unavailable: true };
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json().then(pick);
    }).catch(function () {
      return fetchJson(noembed).then(function (data) {
        if (data && data.error && /401|403|404|not found|unauthorized/i.test(String(data.error))) return { unavailable: true };
        return pick(data);
      }).catch(function () { return null; });
    });
  }

  /* Whether videos can be played inside an embed: public, embeddable and
     not age-restricted. Returns { id: true|false } for every id found;
     ids YouTube doesn't return (private/removed) come back false. */
  function fetchPlayability(apiKey, ids) {
    var result = {};
    ids.forEach(function (id) { result[id] = false; });
    var chain = Promise.resolve();
    for (var i = 0; i < ids.length; i += 50) {
      (function (chunk) {
        chain = chain.then(function () {
          return apiGet(apiKey, 'videos', { part: 'status,contentDetails', id: chunk.join(','), maxResults: 50 }).then(function (data) {
            (data.items || []).forEach(function (item) {
              var st = item.status || {}, cd = item.contentDetails || {};
              var age = cd.contentRating && cd.contentRating.ytRating === 'ytAgeRestricted';
              result[item.id] = st.embeddable !== false && st.privacyStatus === 'public' && !age;
            });
          });
        });
      })(ids.slice(i, i + 50));
    }
    return chain.then(function () { return result; });
  }

  /* ---------- YouTube Data API v3 (optional, needs an API key) ---------- */

  var API = 'https://www.googleapis.com/youtube/v3/';

  function apiGet(apiKey, resource, params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(API + resource + '?' + qs + '&key=' + encodeURIComponent(apiKey)).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
          throw new Error('YouTube API: ' + msg);
        }
        return data;
      });
    });
  }

  /* Resolve a parsed channel reference into
     { channelId, title, thumbnail, uploadsPlaylistId }. */
  function resolveChannel(apiKey, ref) {
    var params = { part: 'snippet,contentDetails', maxResults: 1 };
    if (ref.channelId) params.id = ref.channelId;
    else if (ref.handle) params.forHandle = ref.handle;
    else if (ref.username) params.forUsername = ref.username;
    else if (ref.custom) params.forHandle = ref.custom; // most /c/ names double as handles

    return apiGet(apiKey, 'channels', params).then(function (data) {
      var item = data.items && data.items[0];
      if (!item && ref.custom) {
        // Fall back to search for legacy custom URLs.
        return apiGet(apiKey, 'search', { part: 'snippet', type: 'channel', q: ref.custom, maxResults: 1 })
          .then(function (s) {
            var hit = s.items && s.items[0];
            if (!hit) throw new Error('Channel not found');
            return resolveChannel(apiKey, { channelId: hit.snippet.channelId });
          });
      }
      if (!item) throw new Error('Channel not found');
      var thumbs = item.snippet.thumbnails || {};
      return {
        channelId: item.id,
        title: item.snippet.title,
        thumbnail: (thumbs.medium || thumbs.default || {}).url || '',
        uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads
      };
    });
  }

  /* Most recent uploads of a channel (up to `max`, default 50 = one API page). */
  function fetchChannelUploads(apiKey, uploadsPlaylistId, max, pageToken) {
    var params = {
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(max || 50, 50)
    };
    if (pageToken) params.pageToken = pageToken;
    return apiGet(apiKey, 'playlistItems', params).then(function (data) {
      var videos = (data.items || []).map(function (item) {
        var s = item.snippet;
        var id = s.resourceId && s.resourceId.videoId;
        return {
          youtubeId: id,
          title: s.title,
          channelName: s.videoOwnerChannelTitle || s.channelTitle || '',
          thumbnail: thumbnailUrl(id),
          publishedAt: (item.contentDetails && item.contentDetails.videoPublishedAt) || s.publishedAt
        };
      }).filter(function (v) { return v.youtubeId && v.title !== 'Private video' && v.title !== 'Deleted video'; });
      videos.nextPageToken = data.nextPageToken || '';
      return videos;
    });
  }

  /* Channels a channel features on its own page ("multipleChannels"
     sections). 1 unit per call. */
  function fetchFeaturedChannels(apiKey, channelId) {
    return apiGet(apiKey, 'channelSections', { part: 'contentDetails', channelId: channelId }).then(function (data) {
      var ids = [];
      (data.items || []).forEach(function (item) {
        var list = item.contentDetails && item.contentDetails.channels;
        if (list) list.forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
      });
      return ids;
    });
  }

  /* Names, pictures and upload playlists for up to 50 channel ids per call. */
  function fetchChannelsInfo(apiKey, ids) {
    var out = [];
    var chain = Promise.resolve();
    for (var i = 0; i < ids.length; i += 50) {
      (function (chunk) {
        chain = chain.then(function () {
          return apiGet(apiKey, 'channels', { part: 'snippet,contentDetails', id: chunk.join(','), maxResults: 50 }).then(function (data) {
            (data.items || []).forEach(function (item) {
              var thumbs = item.snippet.thumbnails || {};
              out.push({
                channelId: item.id,
                title: item.snippet.title,
                thumbnail: (thumbs.medium || thumbs.default || {}).url || '',
                uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads
              });
            });
          });
        });
      })(ids.slice(i, i + 50));
    }
    return chain.then(function () { return out; });
  }

  /* Parent-only search. Strict safe search; videos limited to embeddable
     ones. 100 units per call. */
  function searchYouTube(apiKey, query, type) {
    var params = { part: 'snippet', q: query, type: type === 'channel' ? 'channel' : 'video', maxResults: 20, safeSearch: 'strict' };
    if (params.type === 'video') { params.videoEmbeddable = 'true'; params.videoSyndicated = 'true'; }
    return apiGet(apiKey, 'search', params).then(function (data) {
      return (data.items || []).map(function (item) {
        var sn = item.snippet || {};
        var thumbs = sn.thumbnails || {};
        if (params.type === 'channel') {
          return { kind: 'channel', channelId: item.id.channelId, title: sn.title, thumbnail: (thumbs.medium || thumbs.default || {}).url || '' };
        }
        return { kind: 'video', youtubeId: item.id.videoId, title: sn.title, channelName: sn.channelTitle || '', thumbnail: thumbnailUrl(item.id.videoId), publishedAt: sn.publishedAt };
      }).filter(function (r) { return r.kind === 'channel' ? r.channelId : r.youtubeId; });
    });
  }

  /* Extra video details when a key is available (publish date). */
  function fetchVideoDetails(apiKey, videoId) {
    return apiGet(apiKey, 'videos', { part: 'snippet', id: videoId }).then(function (data) {
      var item = data.items && data.items[0];
      if (!item) return null;
      return {
        title: item.snippet.title,
        channelName: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt
      };
    });
  }

  window.YT_HELPERS = {
    parseYouTubeUrl: parseYouTubeUrl,
    thumbnailUrl: thumbnailUrl,
    embedUrl: embedUrl,
    fetchVideoMetadata: fetchVideoMetadata,
    resolveChannel: resolveChannel,
    fetchChannelUploads: fetchChannelUploads,
    fetchVideoDetails: fetchVideoDetails,
    fetchPlayability: fetchPlayability,
    fetchFeaturedChannels: fetchFeaturedChannels,
    fetchChannelsInfo: fetchChannelsInfo,
    searchYouTube: searchYouTube
  };
})();
