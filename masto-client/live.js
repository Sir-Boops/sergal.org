/* Account data stays in memory; OAuth credentials are stored on this device. */
const SCOPES='read:accounts read:statuses read:bookmarks read:favourites read:notifications write:statuses write:bookmarks write:favourites';
let accountSession=null, me=null, livePosts=[], nextPage=null, requestNumber=0, replyTo=null, pendingPost=null;
const safeURL=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:''}catch{return ''}};
function serverOrigin(value) {
  const input = value.trim();
  const domain = input.startsWith('@') ? input.split('@').pop() : input;
  const url = new URL(domain.includes('://') ? domain : 'https://' + domain);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || !url.hostname.includes('.') || url.port) {
    throw Error('Enter your server domain, for example mastodon.sergal.org.');
  }
  // Sergal accounts use sergal.org as their handle domain.
  return url.hostname === 'sergal.org' ? 'https://mastodon.sergal.org' : url.origin;
}
const randomString=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function challenge(verifier){return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function request(origin,path,{token,method='GET',body,headers={}}={}){let response;try{response=await fetch(origin+path,{method,mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(25000),headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...headers},body:body?new URLSearchParams(body):undefined})}catch{throw Error('Could not reach your server. Check your connection and that it allows browser clients, then try again.')}let data;try{data=await response.json()}catch{data={}}if(!response.ok){const message=response.status===401?'Your session has expired. Sign out and sign in again.':response.status===429?'Your server is limiting requests. Please wait a moment and retry.':String(data.error_description||data.error||`Server returned ${response.status}.`);throw Object.assign(Error(message),{status:response.status})}return {data,response}}
const api=(path,options={})=>request(accountSession.origin,path,{...options,token:accountSession.token});
function authMessage(text){$('#autherror').textContent=text}
function openAccount(reconnect){ const upgrade = reconnect === true && !!accountSession;
  $('#accountTitle').textContent=upgrade?'Enable notifications':me?'Your Mastodon account':'Sign in to Mastodon';
  $('#signinForm').hidden=!!me&&!upgrade;$('#signedAccount').hidden=!me||upgrade;
  $('#instance').readOnly=upgrade;
  if(upgrade){$('#instance').value=accountSession.origin;authMessage('Approve notification access on your Mastodon server.')}else authMessage('');
  $('#signedName').textContent=me?`@${me.acct.includes('@')?me.acct:me.acct+'@'+new URL(accountSession.origin).hostname}`:'';$('#accountDialog').showModal() }
async function startLogin(event){event.preventDefault();const button=$('#signinSubmit');button.disabled=true;authMessage('Connecting to your server…');try{const origin=serverOrigin($('#instance').value);sessionStorage.setItem('swift-storage-check','1');sessionStorage.removeItem('swift-storage-check');const metadata=(await request(origin,'/.well-known/oauth-authorization-server')).data;if(!metadata.code_challenge_methods_supported?.includes('S256'))throw Error('This client requires a Mastodon server with PKCE support (Mastodon 4.3 or newer).');const redirect=location.origin+'/masto-client/';const app=(await request(origin,'/api/v1/apps',{method:'POST',body:{client_name:'speedy-fedi',redirect_uris:redirect,scopes:SCOPES,website:location.origin}})).data;if(!app.client_id||!app.client_secret)throw Error('Your server did not return application credentials.');const verifier=randomString(), state=randomString();const pending={origin,clientId:app.client_id,clientSecret:app.client_secret,redirect,verifier,state,postID:threadIDFromURL(),returnView:view==='Notifications'?'Notifications':null,created:Date.now()};sessionStorage.setItem('swift-oauth-pending',JSON.stringify(pending));const params=new URLSearchParams({response_type:'code',client_id:app.client_id,redirect_uri:redirect,scope:SCOPES,state,code_challenge:await challenge(verifier),code_challenge_method:'S256'});location.assign(origin+'/oauth/authorize?'+params)}catch(error){authMessage(error.message);button.disabled=false}}
function plainContent(html){const doc=new DOMParser().parseFromString(html||'','text/html');doc.querySelectorAll('script,style').forEach(n=>n.remove());doc.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));doc.querySelectorAll('p').forEach(n=>n.append('\n\n'));return doc.body.textContent.trim()}
function imagePreview(media) {
  return safeURL(media.preview_url) || safeURL(media.url);
}

function mediaDimensions(media) {
  const {width, height} = media.meta?.original || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      width > 100000 || height > 100000) return null;
  return {width, height};
}

function originalMediaMarkup(media) {
  const url = safeURL(media.url) || safeURL(media.remote_url);
  const imageURL = url || (media.type === 'image' ? imagePreview(media) : '');
  if (!imageURL) return '';
  const href = esc(imageURL);
  const description = esc(media.description || 'Post attachment');
  let player = '';
  const size = mediaDimensions(media);
  const dimensions = size ? ` width="${size.width}" height="${size.height}"` : '';
  const ratio = size ? ` style="--media-ratio:${size.width} / ${size.height};--media-width:${size.width}px"` : '';

  if (media.type === 'image') {
    player = `<a class="original-media-image"${ratio} href="${href}" target="_blank" rel="noopener noreferrer"><img src="${href}"${dimensions} alt="${description}" decoding="async" referrerpolicy="no-referrer"></a>`;
  } else if (media.type === 'video' || media.type === 'gifv') {
    const poster = safeURL(media.preview_url);
    player = `<video controls playsinline preload="auto"${dimensions}${ratio} src="${href}"${poster ? ` poster="${esc(poster)}"` : ''} aria-label="${description}"></video>`;
  } else if (media.type === 'audio') {
    player = `<audio controls preload="metadata" src="${href}" aria-label="${description}"></audio>`;
  }

  return `<div class="original-media">${player}<a class="media-link" href="${href}" target="_blank" rel="noopener noreferrer">Open full-size media ↗</a></div>`;
}

function attachmentMarkup(media, post, requiresReveal, prioritizeImages, fullMedia) {
  if (fullMedia) {
    if (!safeURL(media.url) && !safeURL(media.remote_url) &&
        !(media.type === 'image' && imagePreview(media))) return '';
    if (requiresReveal) {
      return `<button class="reveal" data-media="${esc(post.id)}" data-mediaid="${esc(media.id)}" data-full-media>▧ ${esc(media.description || 'Load media')}</button>`;
    }
    return originalMediaMarkup(media);
  }
  const description = esc(media.description || 'Post image');
  if (media.type === 'image') {
    const preview = imagePreview(media);
    if (!preview) return '';
    if (requiresReveal) {
      return `<button class="reveal" data-media="${esc(post.id)}" data-mediaid="${esc(media.id)}">▧ ${esc(media.description || 'Load image')}</button>`;
    }
    const source = prioritizeImages ? `data-home-preview="${esc(preview)}"` : `src="${esc(preview)}"`;
    return `<img class="photo" ${source} loading="eager" alt="${description}" decoding="async" referrerpolicy="no-referrer">`;
  }
  const url = safeURL(media.url);
  return url ? `<a class="media-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open ${esc(media.type)} attachment ↗</a>` : '';
}

function timelineAvatar(account, name) {
  const source = safeURL(account.avatar_static) || safeURL(account.avatar);
  const initials = esc(name.slice(0, 2).toUpperCase());
  const image = source
    ? `<img class="timeline-avatar-image" src="${esc(source)}" width="42" height="42" loading="eager" alt="" referrerpolicy="no-referrer">`
    : '';
  return `<span class="avatar timeline-avatar" aria-hidden="true"><span>${initials}</span>${image}</span>`;
}

$('main').addEventListener('load', event => {
  if (event.target.classList.contains('timeline-avatar-image')) {
    event.target.classList.add('loaded');
  }
}, true);

function customEmojiMarkup(value, emojis) {
  const safeText = esc(value);
  if (!Array.isArray(emojis) || !emojis.length) return safeText;
  const images = new Map();
  for (const emoji of emojis) {
    const source = safeURL(emoji.static_url) || safeURL(emoji.url);
    if (source) images.set(emoji.shortcode, source);
  }
  return safeText.replace(/:([a-zA-Z0-9_]+):/g, (shortcode, name) => {
    const source = images.get(name);
    return source
      ? `<img class="custom-emoji" src="${esc(source)}" alt="${shortcode}" decoding="async" referrerpolicy="no-referrer">`
      : shortcode;
  });
}

document.addEventListener('error', event => {
  const image = event.target;
  if (image.classList?.contains('custom-emoji')) image.replaceWith(image.alt);
}, true);

function statusMarkup(wrapper, prioritizeImages = false, fullMedia = false){const p=wrapper.reblog||wrapper;const a=p.account;const name=a.display_name||a.username;const link=safeURL(p.url);const hidden=!!p.spoiler_text||p.sensitive||p.filtered?.length;const contents=`<div class="livebody">${customEmojiMarkup(plainContent(p.content),p.emojis)}</div>${(p.media_attachments||[]).map(media=>attachmentMarkup(media,p,state.saver||(fullMedia===true?!!p.filtered?.length:hidden),prioritizeImages===true,fullMedia===true)).join('')}${p.poll?'<p class="pollnote">Poll · open the original post to view or vote.</p>':''}${link?`<a class="original" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open original ↗</a>`:''}`;return `<article class="post" data-status="${esc(p.id)}" data-wrapper="${esc(wrapper.id)}">${wrapper.reblog?`<small class="boostnote">⇄ ${customEmojiMarkup(wrapper.account.display_name||wrapper.account.username,wrapper.account.emojis)} boosted</small>`:''}<div class="posttop">${timelineAvatar(a, name)}<div class="author"><b>${customEmojiMarkup(name,a.emojis)}</b><small>@${esc(a.acct)}</small></div><a class="thread-link" data-open-thread="${esc(p.id)}" href="?post=${encodeURIComponent(p.id)}" aria-label="Open post and replies"><time class="time" datetime="${esc(p.created_at)}">${esc(new Date(p.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</time></a></div><div class="body">${hidden?`<details><summary>${customEmojiMarkup(p.spoiler_text||'Sensitive or filtered content',p.emojis)} · show post</summary>${contents}</details>`:contents}</div><div class="actions"><button data-liveaction="reply" data-id="${esc(p.id)}" aria-label="Reply"><span>↩</span>${esc(p.replies_count ?? 0)}</button><button data-liveaction="boost" data-id="${esc(p.id)}" aria-label="Boost" aria-pressed="${!!p.reblogged}" class="${p.reblogged?'on':''}" ${['private','direct'].includes(p.visibility)?'disabled':''}><span>⇄</span>${esc(p.reblogs_count ?? 0)}</button><button data-liveaction="favourite" data-id="${esc(p.id)}" aria-label="Favourite" aria-pressed="${!!p.favourited}" class="${p.favourited?'on':''}"><span>${favouriteIcon(!!p.favourited)}</span>${esc(p.favourites_count ?? 0)}</button><button data-liveaction="bookmark" data-id="${esc(p.id)}" aria-label="Bookmark" aria-pressed="${!!p.bookmarked}" class="${p.bookmarked?'on':''}"><span>▱</span></button></div></article>`}
function startHomeImage(image, priority) {
  image.fetchPriority = priority;
  image.src = image.dataset.homePreview;
  delete image.dataset.homePreview;
}

function loadHomeImages(images) {
  const offscreen = [];
  const viewportHeight = window.innerHeight;
  for (const image of images) {
    const {top, bottom} = image.getBoundingClientRect();
    if (bottom > 0 && top < viewportHeight) startHomeImage(image, 'high');
    else offscreen.push(image);
  }
  if (!offscreen.length) return;
  requestAnimationFrame(() => {
    for (const image of offscreen) {
      if (image.isConnected) startHomeImage(image, 'low');
    }
  });
}

function updateTimelineSubtitle() {
  $('.tabs').hidden = view === 'Notifications';
  $('#subtitle').textContent=view==='Notifications'?'Activity on your Mastodon account.':view==='Live'?liveStatus:view==='Home'?'Your people. Your pace.':view==='Explore'?'Conversations across your server.':'Saved on your Mastodon account.';
}

const notificationLabels = {
  mention: 'mentioned you', status: 'published a new post', reblog: 'boosted your post',
  follow: 'followed you', follow_request: 'requested to follow you', favourite: 'liked your post',
  poll: 'has a poll that ended', update: 'edited a post you boosted',
  quote: 'quoted your post', quoted_update: 'edited a post you quoted',
  'admin.sign_up': 'signed up', 'admin.report': 'submitted a report',
  moderation_warning: 'sent a moderation notice'
};

function timelineRowMarkup(row, prioritizeImages) {
  if (view !== 'Notifications') return statusMarkup(row, prioritizeImages);
  const actor = row.account;
  const name = actor?.display_name || actor?.username || 'Mastodon';
  const profile = safeURL(actor?.url);
  const label = customEmojiMarkup(name, actor?.emojis);
  const identity = profile
    ? `<a href="${esc(profile)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  const action = Object.hasOwn(notificationLabels, row.type)
    ? notificationLabels[row.type] : 'sent a notification';
  return `<section class="notification-row"><div class="notification-heading">${actor ? timelineAvatar(actor, name) : ''}
    <div><strong>${identity}</strong> ${action}<br><time datetime="${esc(row.created_at)}">${esc(new Date(row.created_at).toLocaleString())}</time></div></div>
    ${row.reblog ? statusMarkup(row.reblog, prioritizeImages) : ''}</section>`;
}

function offerNotificationAccess() {
  const error = $('#liveerror');
  error.textContent = 'Reconnect to give speedy-fedi access to your notifications. ';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Reconnect';
  button.onclick = () => openAccount(true);
  error.append(button);
}

function renderLive(appendedPosts, prioritizeImages = false) {
  if (activeThread) {
    renderPostThread();
    return;
  }
  const feed = $('#feed');
  if (appendedPosts && !$('#search').value && !feed.querySelector('.empty')) {
    const page = document.createElement('template');
    page.innerHTML = appendedPosts.map(post => timelineRowMarkup(post, prioritizeImages)).join('');
    const images = page.content.querySelectorAll('[data-home-preview]');
    feed.append(page.content);
    if (prioritizeImages) loadHomeImages(images);
    $('#loadmore').hidden = !nextPage;
    return;
  }
  if(!accountSession)return;document.body.classList.toggle('compact',state.compact);for(const k of ['compact','saver']){ $('#'+k).checked=state[k];$('#modal'+k).checked=state[k] }$('#heading').textContent=view;updateTimelineSubtitle();document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const q=$('#search').value.toLowerCase();const posts=livePosts.filter(w=>{let p=w.reblog||w;return !q||`${plainContent(p.content)} ${p.account?.acct||''} ${p.account?.display_name||''}`.toLowerCase().includes(q)});feed.innerHTML=posts.map(post=>timelineRowMarkup(post,prioritizeImages)).join('')||(view==='Notifications'?'<div class="empty">No notifications to show.</div>':'<div class="empty">No posts to show.<br>Try refreshing or clearing your search.</div>');$('#loadmore').hidden=!nextPage; $('footer').firstChild.textContent='';
  if (prioritizeImages) loadHomeImages(feed.querySelectorAll('[data-home-preview]'));
}
function loadMedia(button) {
  const post = displayedPosts().map(wrapper => wrapper.reblog || wrapper)
    .find(post => post.id === button.dataset.media);
  const attachment = post?.media_attachments?.find(media => media.id === button.dataset.mediaid);
  if (!attachment) return;
  if (button.hasAttribute('data-full-media')) {
    const template = document.createElement('template');
    template.innerHTML = originalMediaMarkup(attachment);
    button.replaceWith(template.content);
    return;
  }
  const preview = imagePreview(attachment);
  if (!preview) return;
  const image = document.createElement('img');
  image.className = 'photo';
  image.alt = attachment.description || 'Post image';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.src = preview;
  button.replaceWith(image);
}
function timelinePath(){if(view==='Notifications')return '/api/v1/notifications';if(view==='Bookmarks')return '/api/v1/bookmarks';if(view==='Favourites')return '/api/v1/favourites';if(view==='Explore'||tab==='Federated')return '/api/v1/timelines/public';if(tab==='Local')return '/api/v1/timelines/public?local=true';return '/api/v1/timelines/home'}
function nextLink(header,origin){const part=(header||'').split(',').find(s=>/rel="next"/.test(s));const match=part?.match(/<([^>]+)>/);if(!match)return null;try{const u=new URL(match[1]);return u.origin===origin&&u.pathname.startsWith('/api/v1/')?u.pathname+u.search:null}catch{return null}}
const AUTO_LOAD_THRESHOLD = 0.4;
let autoLoadPaused = false;
let scrollCheckQueued = false;

function canAutoLoad() {
  return !activeThread && view !== 'Live' && me && nextPage && !autoLoadPaused && !$('#loadmore').disabled && !$('#search').value.trim();
}

window.addEventListener('scroll', () => {
  if (scrollCheckQueued || !canAutoLoad()) return;
  scrollCheckQueued = true;
  requestAnimationFrame(() => {
    scrollCheckQueued = false;
    if (!canAutoLoad()) return;
    const {top, height} = $('#feed').getBoundingClientRect();
    if (height > 0 && -top >= height * AUTO_LOAD_THRESHOLD) void loadTimeline(true);
  });
}, { passive: true });

async function loadTimeline(more = false) {
  if (activeThread) return;
  const loadMore = $('#loadmore');
  if (more && (!nextPage || loadMore.disabled)) return;
  const ticket = ++requestNumber;
  const path = more ? nextPage : timelinePath();
  const pageCount = !more && (view === 'Home' || view === 'Notifications') ? 3 : 1;
  let url = more ? path : path + (path.includes('?') ? '&' : '?') + 'limit=20';
  let loadedPages = 0;
  const refresh = $('#refresh');
  const feed = $('#feed');
  $('#liveerror').textContent = '';
  refresh.disabled = true;
  loadMore.disabled = true;
  loadMore.textContent = more ? 'Loading more posts…' : 'Load more posts';
  feed.setAttribute('aria-busy', 'true');
  if (!more) {
    livePosts = [];
    nextPage = null;
    autoLoadPaused = false;
    stopLiveStream();
    loadMore.hidden = true;
    feed.innerHTML = '<div class="empty">Loading your timeline…</div>';
  }
  try {
    const requestedPages = new Set();
    for (let page = 0; page < pageCount && url; page++) {
      requestedPages.add(url);
      const {data, response} = await api(url);
      if (ticket !== requestNumber || !accountSession) return;
      if (!Array.isArray(data)) throw Error('Your server returned an unexpected timeline.');
      const seen = new Set(livePosts.map(post => post.id));
      const rows = view === 'Notifications' ? data.map(row => ({...row, reblog: row.status || null})) : data;
      const fresh = rows.filter(post => {
        if (seen.has(post.id)) return false;
        seen.add(post.id);
        return true;
      });
      livePosts.push(...fresh);
      const cursor = nextLink(response.headers.get('Link'), accountSession.origin);
      nextPage = !data.length || requestedPages.has(cursor) ? null : cursor;
      autoLoadPaused = (more || page > 0) && fresh.length === 0;
      renderLive(more || page > 0 ? fresh : undefined, pageCount > 1);
      loadedPages++;
      if (autoLoadPaused) break;
      url = nextPage;
    }
  } catch (error) {
    if (ticket !== requestNumber) return;
    if (view === 'Notifications' && (error.status === 401 || error.status === 403)) {
      renderLive();
      offerNotificationAccess();
      return;
    }
    $('#liveerror').textContent = error.message;
    if (more || loadedPages > 0) {
      autoLoadPaused = true;
      toast('Could not load more posts. Use Load more posts to retry.');
    } else {
      renderLive();
    }
  } finally {
    if (ticket === requestNumber) {
      refresh.disabled = false;
      loadMore.disabled = false;
      loadMore.textContent = 'Load more posts';
      feed.removeAttribute('aria-busy');
      if (!more) startLiveStream();
    }
  }
}

let liveConnection = null;
let liveStatus = 'Connecting to the live feed…';
let streamDiscovery = null;

function liveStreamName() {
  if (tab === 'Following') return 'user';
  if (tab === 'Local') return 'public:local';
  return 'public';
}

function setLiveStatus(message) {
  liveStatus = message;
  if (view === 'Live' && !activeThread) $('#subtitle').textContent = message;
}

function stopLiveStream() {
  const connection = liveConnection;
  liveConnection = null;
  liveStatus = 'Connecting to the live feed…';
  if (!connection) return;
  clearTimeout(connection.retry);
  clearTimeout(connection.handshake);
  connection.socket?.close();
}

function startLiveStream() {
  if (activeThread || view !== 'Live' || !accountSession || liveConnection) return;
  const connection = {session: accountSession, stream: liveStreamName(), delay: 1_000};
  liveConnection = connection;
  setLiveStatus('Connecting to the live feed…');
  void openLiveSocket(connection);
}

function discoverStreamingURL(session) {
  if (streamDiscovery?.session === session) return streamDiscovery.url;
  const url = request(session.origin, '/api/v2/instance')
    .then(({data}) => {
      const advertised = new URL(data.configuration?.urls?.streaming);
      if (advertised.protocol !== 'wss:' || advertised.username || advertised.password) {
        throw Error('Invalid streaming URL');
      }
      return new URL('/api/v1/streaming', advertised);
    })
    .catch(() => {
      const fallback = new URL('/api/v1/streaming', session.origin);
      fallback.protocol = 'wss:';
      return fallback;
    });
  streamDiscovery = {session, url};
  return url;
}

function retryLiveSocket(connection) {
  if (liveConnection !== connection) return;
  setLiveStatus('Live feed disconnected. Reconnecting…');
  connection.retry = setTimeout(() => void openLiveSocket(connection), connection.delay);
  connection.delay = Math.min(connection.delay * 2, 30_000);
}

async function openLiveSocket(connection) {
  try {
    const base = await discoverStreamingURL(connection.session);
    if (liveConnection !== connection) return;
    const url = new URL(base);
    url.searchParams.set('stream', connection.stream);
    const socket = new WebSocket(url, connection.session.token);
    connection.socket = socket;
    connection.handshake = setTimeout(() => socket.close(), 12_000);

    socket.addEventListener('open', () => {
      if (liveConnection !== connection) return;
      clearTimeout(connection.handshake);
      setLiveStatus('Connected to the live feed.');
    });
    socket.addEventListener('message', ({data}) => {
      if (liveConnection !== connection || typeof data !== 'string') return;
      connection.delay = 1_000;
      handleLiveEvent(data);
    });
    socket.addEventListener('close', () => {
      if (liveConnection !== connection) return;
      clearTimeout(connection.handshake);
      connection.socket = null;
      retryLiveSocket(connection);
    });
  } catch {
    retryLiveSocket(connection);
  }
}

function handleLiveEvent(raw) {
  let event, post;
  try {
    event = JSON.parse(raw);
    if (event?.event === 'update') post = JSON.parse(event.payload);
  } catch {
    return;
  }

  if (post && typeof post.id === 'string' && post.account &&
      !livePosts.some(existing => existing.id === post.id)) {
    livePosts.unshift(post);
    prependLivePosts([post]);
  } else if (event?.event === 'delete' && typeof event.payload === 'string') {
    const id = event.payload;
    const remaining = livePosts.filter(item => item.id !== id && item.reblog?.id !== id);
    if (remaining.length === livePosts.length) return;
    livePosts = remaining;
    $('#feed').querySelectorAll('[data-status]').forEach(node => {
      if (node.dataset.status === id || node.dataset.wrapper === id) node.remove();
    });
    if (!$('#feed').firstElementChild) renderLive();
  }
}

window.addEventListener('pagehide', stopLiveStream);
window.addEventListener('pageshow', () => {
  if (!$('#refresh').disabled) startLiveStream();
});

function prependLivePosts(posts) {
  const feed = $('#feed');
  if ($('#search').value || feed.querySelector('.empty')) {
    renderLive();
    return;
  }
  const anchor = feed.firstElementChild;
  const top = anchor?.getBoundingClientRect().top;
  feed.insertAdjacentHTML('afterbegin', posts.map(statusMarkup).join(''));
  if (top < 0) {
    const shift = anchor.getBoundingClientRect().top - top;
    if (shift) window.scrollBy({top: shift, behavior: 'instant'});
  }
  $('#loadmore').hidden = !nextPage;
}

let activeThread = null;

function validPostID(id) {
  return typeof id === 'string' && /^\d{1,30}$/.test(id);
}

function threadIDFromURL() {
  const id = new URLSearchParams(location.search).get('post');
  return validPostID(id) ? id : null;
}

function threadURL(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('post', id);
  else url.searchParams.delete('post');
  return url;
}

function displayedPosts() {
  if (!activeThread?.post) return livePosts;
  return [activeThread.post, ...activeThread.parents, ...activeThread.replies];
}

function renderPostThread(thread = activeThread) {
  if (!thread?.post || activeThread !== thread) return;
  const content = $('#threadContent');
  if (!content.firstElementChild) {
    content.innerHTML = '<section data-thread-parents hidden></section>' +
      '<section data-thread-post aria-label="Selected post"></section>' +
      '<section data-thread-replies></section>';
  }
  const rows = posts => posts.map(post => statusMarkup(post)).join('');
  const sections = {
    parents: thread.parents.length ? '<h2>Earlier in the thread</h2>' + rows(thread.parents) : '',
    post: statusMarkup(thread.post, false, true),
    replies: '<h2>Replies (' + thread.replies.length + ')</h2>' +
      (thread.replies.length ? rows(thread.replies) : '<p class="empty">No replies yet.</p>')
  };
  thread.renderedSections ||= {};
  for (const [name, markup] of Object.entries(sections)) {
    if (thread.renderedSections[name] === markup) continue;
    const section = content.querySelector('[data-thread-' + name + ']');
    section.innerHTML = markup;
    section.hidden = !markup;
    thread.renderedSections[name] = markup;
  }
}

function readThreadContext(thread, data) {
  if (!Array.isArray(data?.ancestors) || !Array.isArray(data?.descendants)) {
    throw Error('Your server returned an unexpected thread.');
  }
  thread.parents = data.ancestors;
  thread.replies = data.descendants;
}

function queueThreadRefresh(thread, response, attempt) {
  if (attempt >= 3) {
    $('#threadStatus').textContent = 'Your server may still be checking for replies.';
    return;
  }
  const header = response.headers.get('Mastodon-Async-Refresh');
  const retry = header?.match(/\bretry\s*=\s*(\d+)/i);
  // Some instances start the job without exposing the header to browsers.
  const delay = retry ? Math.max(1, Number(retry[1]))
    : !header && attempt === 0 && thread.post?.account?.acct?.includes('@') ? 5 : null;
  if (delay === null) {
    $('#threadStatus').textContent = '';
    return;
  }
  $('#threadStatus').textContent = 'Checking for newer replies…';
  if (delay > 30) {
    $('#threadStatus').textContent = 'Your server is still checking for replies. Try Refresh thread later.';
    return;
  }
  thread.timer = setTimeout(() => void refreshThreadContext(thread, attempt + 1), delay * 1000);
}

async function refreshThreadContext(thread, attempt) {
  const version = thread.version;
  try {
    const {data, response} = await api('/api/v1/statuses/' + thread.id + '/context');
    if (activeThread !== thread || version !== thread.version) return;
    const previous = JSON.stringify([thread.parents, thread.replies]);
    readThreadContext(thread, data);
    if (previous !== JSON.stringify([thread.parents, thread.replies])) renderPostThread(thread);
    queueThreadRefresh(thread, response, attempt);
  } catch {
    if (activeThread === thread && version === thread.version) {
      $('#threadStatus').textContent = 'Could not check for newer replies. Try Refresh thread.';
    }
  }
}

async function loadPostThread(thread) {
  clearTimeout(thread.timer);
  const version = ++thread.version;
  $('#refreshThread').disabled = true;
  $('#threadStatus').textContent = 'Loading thread…';
  const path = '/api/v1/statuses/' + thread.id;
  try {
    const [post, context] = await Promise.allSettled([api(path), api(path + '/context')]);
    if (activeThread !== thread || version !== thread.version) return;
    if (post.status === 'rejected') throw post.reason;
    if (!post.value.data?.account) throw Error('Your server returned an unexpected post.');
    thread.post = post.value.data;
    if (context.status === 'rejected') {
      renderPostThread(thread);
      $('#threadStatus').textContent = 'Could not load replies. Try Refresh thread.';
      return;
    }
    readThreadContext(thread, context.value.data);
    renderPostThread(thread);
    queueThreadRefresh(thread, context.value.response, 0);
  } catch (error) {
    if (activeThread === thread && version === thread.version) {
      $('#threadStatus').textContent = error.message || 'Could not load this thread.';
    }
  } finally {
    if (activeThread === thread && version === thread.version) $('#refreshThread').disabled = false;
  }
}

function openPostThread(id, push = true) {
  if (!validPostID(id) || !accountSession || activeThread?.id === id) return;
  const previous = activeThread;
  clearTimeout(previous?.timer);
  if (push) history.pushState({speedyThread: true}, '', threadURL(id));
  activeThread = {
    id, version: 0, parents: [], replies: [],
    returnScroll: previous?.returnScroll ?? window.scrollY,
    needsTimeline: previous?.needsTimeline ?? !livePosts.length
  };
  requestNumber++;
  stopLiveStream();
  document.body.classList.add('thread-view');
  $('#thread').hidden = false;
  $('#threadContent').replaceChildren();
  $('#heading').textContent = 'Thread';
  $('#subtitle').textContent = 'Post and replies';
  $('#threadBack').focus({preventScroll: true});
  window.scrollTo({top: 0, behavior: 'instant'});
  void loadPostThread(activeThread);
}

function closePostThread(restore = true) {
  if (!activeThread) return;
  const {timer, returnScroll, needsTimeline} = activeThread;
  clearTimeout(timer);
  activeThread = null;
  document.body.classList.remove('thread-view', 'thread-composing');
  $('#thread').hidden = true;
  $('#threadContent').replaceChildren();
  $('#threadStatus').textContent = '';
  $('#refresh').disabled = false;
  $('#loadmore').disabled = false;
  $('#loadmore').textContent = 'Load more posts';
  $('#feed').removeAttribute('aria-busy');
  if (!restore) return;
  if (needsTimeline) void loadTimeline();
  else {
    $('#heading').textContent = view;
    updateTimelineSubtitle();
    startLiveStream();
  }
  window.scrollTo({top: returnScroll, behavior: 'instant'});
}

$('#refreshThread').onclick = () => { if (activeThread) void loadPostThread(activeThread); };
$('#threadBack').onclick = () => {
  if (history.state?.speedyThread) history.back();
  else {
    history.replaceState(null, '', threadURL(null));
    closePostThread();
  }
};

window.addEventListener('popstate', () => {
  const id = threadIDFromURL();
  if (id) openPostThread(id, false);
  else closePostThread();
});

function paintProfileImages(account, name) {
  const initials = name.slice(0, 2).toUpperCase();
  const staticAvatar = safeURL(account.avatar_static);
  const avatar = safeURL(account.avatar);
  document.querySelectorAll('.you').forEach(slot => {
    slot.textContent = initials;
    if (!staticAvatar && !avatar) return;
    const image = document.createElement('img');
    image.className = 'avatar';
    image.alt = '';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => slot.replaceChildren(image);
    image.onerror = () => {
      if (avatar && image.src !== avatar) image.src = avatar;
    };
    image.src = staticAvatar || avatar;
  });
}

function paintAccount(){const name=me.display_name||me.username;$('#profile b').innerHTML=customEmojiMarkup(name,me.emojis);$('#profile small').textContent='@'+me.acct;paintProfileImages(me, name);$('#draft').placeholder=`What's on your mind, ${name}?`;$('.demo').innerHTML='<span class="dot"></span><span id="connectedLabel"></span> <button id="accountButton">Account / sign out</button>';$('#connectedLabel').textContent='Connected to '+new URL(accountSession.origin).hostname;$('#accountButton').onclick=openAccount;$('#signinTop').textContent='Account';$('.composerbottom>span').innerHTML='<label>Post visibility <select id="visibility"><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private" selected>Followers only</option></select></label>';$('#search').placeholder='Filter loaded posts';$('.note').innerHTML='Connected directly to your Mastodon server.<br>Account data stays in this tab.';$('#loadmore').hidden=true;$('#draft').value='';$('#draft').dispatchEvent(new Event('input'));}
async function connect(){me=(await api('/api/v1/accounts/verify_credentials')).data;if(!me.id)throw Error('Could not verify your Mastodon account.');paintAccount();const id=threadIDFromURL();if(id)openPostThread(id,false);else await loadTimeline()}
const SESSION_KEY = 'swift-account';

function storeAccount(session) {
  const encoded = JSON.stringify(session);
  try {
    localStorage.setItem(SESSION_KEY, encoded);
  } catch {
    try { sessionStorage.setItem(SESSION_KEY, encoded); } catch {}
    return;
  }
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

function restoreAccount() {
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const session = JSON.parse(window[storageName].getItem(SESSION_KEY));
      if (!session?.origin || !session.token) continue;
      if (storageName === 'sessionStorage') storeAccount(session);
      return session;
    } catch {}
  }
  return null;
}

function forgetAccount() {
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try { window[storageName].removeItem(SESSION_KEY); } catch {}
  }
}

function showAccountRetry() {
  const error = $('#liveerror');
  error.textContent = 'Could not reconnect to your Mastodon server. Your sign-in is saved. ';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.dataset.sessionRetry = '';
  retry.textContent = 'Retry';
  retry.onclick = () => {
    retry.disabled = true;
    void finishLogin();
  };
  error.append(retry);
}

async function finishLogin(){const params=new URLSearchParams(location.search);try{if(params.has('code')||params.has('error')){history.replaceState({},'',location.pathname);let pending;try{pending=JSON.parse(sessionStorage.getItem('swift-oauth-pending'))}catch{}sessionStorage.removeItem('swift-oauth-pending');if(!pending||pending.state!==params.get('state')||Date.now()-pending.created>900000)throw Error('Sign-in expired or could not be verified. Please start again.');if(params.has('error'))throw Error('Sign-in was cancelled. You can try again whenever you’re ready.');const result=(await request(pending.origin,'/oauth/token',{method:'POST',body:{grant_type:'authorization_code',code:params.get('code'),client_id:pending.clientId,client_secret:pending.clientSecret,redirect_uri:pending.redirect,code_verifier:pending.verifier}})).data;if(!result.access_token)throw Error('Your server did not return an access token.');accountSession={origin:pending.origin,clientId:pending.clientId,clientSecret:pending.clientSecret,token:result.access_token};storeAccount(accountSession);if(pending.returnView==='Notifications')view='Notifications';if(validPostID(pending.postID))history.replaceState(null,'',threadURL(pending.postID))}else{accountSession=restoreAccount()}if(accountSession){await connect();if($('#liveerror').querySelector('[data-session-retry]'))$('#liveerror').textContent=''}else if(threadIDFromURL())openAccount()}catch(error){$('#liveerror').textContent=error.message;if(accountSession&&!me&&error.status!==401){showAccountRetry();return}if(!me){accountSession=null;if(error.status===401)forgetAccount()}openAccount();authMessage(error.message)}}
async function logout(){stopLiveStream();closePostThread(false);const button=$('#signout');button.disabled=true;let failed=false;try{await request(accountSession.origin,'/oauth/revoke',{method:'POST',body:{client_id:accountSession.clientId,client_secret:accountSession.clientSecret,token:accountSession.token}})}catch{failed=true}requestNumber++;forgetAccount();sessionStorage.removeItem('swift-oauth-pending');sessionStorage.removeItem('swift-draft');if(failed){$('#signedName').textContent='Signed out locally. Your server could not revoke access. You can revoke speedy-fedi under Preferences → Account → Authorized apps on your server.';accountSession=null;me=null;$('#signout').textContent='Back to demo';$('#signout').disabled=false;$('#signout').onclick=()=>location.replace(location.pathname);$('#accountClose').onclick=()=>location.replace(location.pathname);livePosts=[];$('#feed').innerHTML='';return}location.replace(location.pathname)}
// Capture live interactions before the isolated demo handlers run.
function favouriteIcon(selected) {
  return selected ? '♥' : '♡';
}

const reactionFields = {
  favourite: {flag: 'favourited', count: 'favourites_count', add: 'favourite', remove: 'unfavourite'},
  boost: {flag: 'reblogged', count: 'reblogs_count', add: 'reblog', remove: 'unreblog'},
  bookmark: {flag: 'bookmarked', add: 'bookmark', remove: 'unbookmark'}
};
const pendingReactions = new Set();

async function toggleLiveReaction(button, post, type) {
  const fields = reactionFields[type];
  if (!fields) return;
  const key = post.id + ':' + type;
  if (pendingReactions.has(key)) return;
  pendingReactions.add(key);
  button.setAttribute('aria-busy', 'true');
  const session = accountSession;
  try {
    const endpoint = post[fields.flag] ? fields.remove : fields.add;
    const {data} = await api('/api/v1/statuses/' + encodeURIComponent(post.id) + '/' + endpoint, {method: 'POST'});
    if (accountSession !== session) return;
    const fresh = data.reblog || data;
    if (fresh.id !== post.id) throw Error('Your server returned an unexpected post.');
    const update = item => {
      const current = item.reblog || item;
      if (current.id !== post.id) return item;
      const revised = {...current, [fields.flag]: fresh[fields.flag]};
      if (fields.count) revised[fields.count] = fresh[fields.count];
      return item.reblog ? {...item, reblog: revised} : revised;
    };
    livePosts = livePosts.map(update);
    if (activeThread?.post) {
      const before = activeThread.post;
      activeThread.post = update(before);
      activeThread.parents = activeThread.parents.map(update);
      activeThread.replies = activeThread.replies.map(update);
      if (activeThread.post !== before && activeThread.renderedSections) {
        activeThread.renderedSections.post = statusMarkup(activeThread.post, false, true);
      }
    }
    const selected = !!fresh[fields.flag];
    const count = fields.count ? fresh[fields.count] ?? 0 : undefined;
    document.querySelectorAll('button[data-liveaction="' + type + '"]').forEach(control => {
      if (control.dataset.id !== post.id) return;
      const icon = type === 'favourite' ? favouriteIcon(selected) : undefined;
      updateReactionButton(control, selected, count, icon);
    });
  } catch (error) {
    toast(error.message);
  } finally {
    pendingReactions.delete(key);
    button.removeAttribute('aria-busy');
  }
}

document.addEventListener('click',async event=>{if(!accountSession||!me)return;const target=event.target;
  const threadLink = target.closest('[data-open-thread]');
  const clickedPost = target.closest('#feed article[data-status], #threadContent article[data-status]');
  const interactive = target.closest('a,button,input,textarea,select,label,summary,video,audio,[contenteditable]');
  const postID = threadLink?.dataset.openThread || (!interactive && clickedPost?.dataset.status);
  if (validPostID(postID) && event.button === 0 && !event.metaKey && !event.ctrlKey &&
      !event.shiftKey && !event.altKey && !window.getSelection()?.toString()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openPostThread(postID);
    return;
  }
  if (activeThread && target.closest('#compose')) {
    document.body.classList.add('thread-composing');
  }
const navButton=target.closest('[data-view]'), tabButton=target.closest('[data-tab]'), action=target.closest('[data-liveaction]'), media=target.closest('[data-media]');if(navButton){event.stopImmediatePropagation();if(navButton.dataset.view==='Settings'){$('#modal').showModal();return}if(activeThread){history.replaceState(null,'',threadURL(null));closePostThread(false)}view=navButton.dataset.view;$('#search').value='';document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===tab));await loadTimeline();return}if(tabButton){event.stopImmediatePropagation();tab=tabButton.dataset.tab;if(view!=='Live')view='Home';document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===tabButton));await loadTimeline();return}if(target.closest('#refresh')){event.stopImmediatePropagation();await loadTimeline();return}if(target.closest('#profile')){event.stopImmediatePropagation();openAccount();return}if(target.closest('[data-search]')){event.stopImmediatePropagation();$('#search').value=target.closest('[data-search]').dataset.search;renderLive();return}if(media){event.stopImmediatePropagation();loadMedia(media);return}if(action){event.stopImmediatePropagation();const id=action.dataset.id;const p=displayedPosts().map(p=>p.reblog||p).find(p=>p.id===id);if(!p)return;const type=action.dataset.liveaction;if(type==='reply'){replyTo=p.id;$('#draft').value='@'+p.account.acct+' ';$('#replylabel').textContent='Replying to @'+p.account.acct;$('#cancelreply').hidden=false;$('#visibility').value=['private','direct'].includes(p.visibility)?'private':'unlisted';if(p.visibility==='direct'){toast('Open the original post to reply privately.');replyTo=null;$('#draft').value='';$('#replylabel').textContent='';$('#cancelreply').hidden=true;return}if(activeThread)document.body.classList.add('thread-composing');$('#draft').dispatchEvent(new Event('input'));$('#draft').focus();$('.composer').scrollIntoView({behavior:'smooth'});return}await toggleLiveReaction(action,p,type);return}if(target.closest('#post')){event.stopImmediatePropagation();const status=$('#draft').value.trim();if(!status)return;const button=$('#post');button.disabled=true;const visibility=$('#visibility').value;const signature=JSON.stringify([status,visibility,replyTo]);if(!pendingPost||pendingPost.signature!==signature)pendingPost={signature,key:crypto.randomUUID()};try{await api('/api/v1/statuses',{method:'POST',headers:{'Idempotency-Key':pendingPost.key},body:{status,visibility,...(replyTo?{in_reply_to_id:replyTo}:{})}});pendingPost=null;replyTo=null;$('#replylabel').textContent='';$('#cancelreply').hidden=true;$('#draft').value='';$('#draft').dispatchEvent(new Event('input'));if(activeThread){document.body.classList.remove('thread-composing');await loadPostThread(activeThread)}else{if(view!=='Live')view='Home';$('#search').value='';document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===tab));await loadTimeline()}toast('Published to Mastodon.')}catch(error){$('#liveerror').textContent=error.message}finally{button.disabled=false}}},true);
document.addEventListener('input',e=>{if(accountSession&&e.target.id==='search'){e.stopImmediatePropagation();renderLive()}},true);
document.addEventListener('change',e=>{if(!accountSession)return;const id=e.target.id.replace('modal','');if(['compact','saver'].includes(id)){e.stopImmediatePropagation();state[id]=e.target.checked;save();renderLive()}},true);
$('#signinTop').onclick=openAccount;$('#accountClose').onclick=()=>$('#accountDialog').close();$('#signinForm').onsubmit=startLogin;$('#signout').onclick=logout;$('#loadmore').onclick=()=>loadTimeline(true);$('#cancelreply').onclick=()=>{replyTo=null;$('#replylabel').textContent='';$('#cancelreply').hidden=true};
finishLogin();

window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  $('#signinSubmit').disabled = false;
  authMessage('');
});
