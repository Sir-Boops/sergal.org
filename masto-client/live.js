/* Account data stays in memory; OAuth credentials are scoped to this browser tab. */
const SCOPES='read:accounts read:statuses read:bookmarks read:favourites write:statuses write:bookmarks write:favourites';
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
async function request(origin,path,{token,method='GET',body,headers={}}={}){let response;try{response=await fetch(origin+path,{method,mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(25000),headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...headers},body:body?new URLSearchParams(body):undefined})}catch{throw Error('Could not reach your server. Check your connection and that it allows browser clients, then try again.')}let data;try{data=await response.json()}catch{data={}}if(!response.ok){const message=response.status===401?'Your session has expired. Sign out and sign in again.':response.status===429?'Your server is limiting requests. Please wait a moment and retry.':String(data.error_description||data.error||`Server returned ${response.status}.`);throw Error(message)}return {data,response}}
const api=(path,options={})=>request(accountSession.origin,path,{...options,token:accountSession.token});
function authMessage(text){$('#autherror').textContent=text}
function openAccount(){ $('#accountTitle').textContent=me?'Your Mastodon account':'Sign in to Mastodon';$('#signinForm').hidden=!!me;$('#signedAccount').hidden=!me;$('#signedName').textContent=me?`@${me.acct.includes('@')?me.acct:me.acct+'@'+new URL(accountSession.origin).hostname}`:'';$('#accountDialog').showModal() }
async function startLogin(event){event.preventDefault();const button=$('#signinSubmit');button.disabled=true;authMessage('Connecting to your server…');try{const origin=serverOrigin($('#instance').value);sessionStorage.setItem('swift-storage-check','1');sessionStorage.removeItem('swift-storage-check');const metadata=(await request(origin,'/.well-known/oauth-authorization-server')).data;if(!metadata.code_challenge_methods_supported?.includes('S256'))throw Error('This client requires a Mastodon server with PKCE support (Mastodon 4.3 or newer).');const redirect=location.origin+'/masto-client/';const app=(await request(origin,'/api/v1/apps',{method:'POST',body:{client_name:'speedy-fedi',redirect_uris:redirect,scopes:SCOPES,website:location.origin}})).data;if(!app.client_id||!app.client_secret)throw Error('Your server did not return application credentials.');const verifier=randomString(), state=randomString();const pending={origin,clientId:app.client_id,clientSecret:app.client_secret,redirect,verifier,state,created:Date.now()};sessionStorage.setItem('swift-oauth-pending',JSON.stringify(pending));const params=new URLSearchParams({response_type:'code',client_id:app.client_id,redirect_uri:redirect,scope:SCOPES,state,code_challenge:await challenge(verifier),code_challenge_method:'S256'});location.assign(origin+'/oauth/authorize?'+params)}catch(error){authMessage(error.message);button.disabled=false}}
function plainContent(html){const doc=new DOMParser().parseFromString(html||'','text/html');doc.querySelectorAll('script,style').forEach(n=>n.remove());doc.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));doc.querySelectorAll('p').forEach(n=>n.append('\n\n'));return doc.body.textContent.trim()}
function imagePreview(media) {
  return safeURL(media.preview_url) || safeURL(media.url);
}

function attachmentMarkup(media, post, requiresReveal) {
  const description = esc(media.description || 'Post image');
  if (media.type === 'image') {
    const preview = imagePreview(media);
    if (!preview) return '';
    if (requiresReveal) {
      return `<button class="reveal" data-media="${esc(post.id)}" data-mediaid="${esc(media.id)}">▧ ${esc(media.description || 'Load image')}</button>`;
    }
    return `<img class="photo" src="${esc(preview)}" loading="eager" alt="${description}" decoding="async" referrerpolicy="no-referrer">`;
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

$('#feed').addEventListener('load', event => {
  if (event.target.classList.contains('timeline-avatar-image')) {
    event.target.classList.add('loaded');
  }
}, true);

function statusMarkup(wrapper){const p=wrapper.reblog||wrapper;const a=p.account;const name=a.display_name||a.username;const link=safeURL(p.url);const hidden=!!p.spoiler_text||p.sensitive||p.filtered?.length;const contents=`<div class="livebody">${esc(plainContent(p.content))}</div>${(p.media_attachments||[]).map(media=>attachmentMarkup(media,p,hidden||state.saver)).join('')}${p.poll?'<p class="pollnote">Poll · open the original post to view or vote.</p>':''}${link?`<a class="original" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open original ↗</a>`:''}`;return `<article class="post" data-status="${esc(p.id)}">${wrapper.reblog?`<small class="boostnote">⇄ ${esc(wrapper.account.display_name||wrapper.account.username)} boosted</small>`:''}<div class="posttop">${timelineAvatar(a, name)}<div class="author"><b>${esc(name)}</b><small>@${esc(a.acct)}</small></div><time class="time" datetime="${esc(p.created_at)}">${esc(new Date(p.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</time></div><div class="body">${hidden?`<details><summary>${esc(p.spoiler_text||'Sensitive or filtered content')} · show post</summary>${contents}</details>`:contents}</div><div class="actions"><button data-liveaction="reply" data-id="${esc(p.id)}" aria-label="Reply"><span>↩</span>${p.replies_count}</button><button data-liveaction="boost" data-id="${esc(p.id)}" aria-label="Boost" aria-pressed="${!!p.reblogged}" class="${p.reblogged?'on':''}" ${['private','direct'].includes(p.visibility)?'disabled':''}><span>⇄</span>${p.reblogs_count}</button><button data-liveaction="favourite" data-id="${esc(p.id)}" aria-label="Favourite" aria-pressed="${!!p.favourited}" class="${p.favourited?'on':''}"><span>♡</span>${p.favourites_count}</button><button data-liveaction="bookmark" data-id="${esc(p.id)}" aria-label="Bookmark" aria-pressed="${!!p.bookmarked}" class="${p.bookmarked?'on':''}"><span>▱</span></button></div></article>`}
function renderLive(appendedPosts) {
  const feed = $('#feed');
  if (appendedPosts && !$('#search').value && !feed.querySelector('.empty')) {
    const page = document.createElement('template');
    page.innerHTML = appendedPosts.map(statusMarkup).join('');
    feed.append(page.content);
    $('#loadmore').hidden = !nextPage;
    return;
  }
  if(!accountSession)return;document.body.classList.toggle('compact',state.compact);for(const k of ['compact','saver']){ $('#'+k).checked=state[k];$('#modal'+k).checked=state[k] }$('#heading').textContent=view;$('#subtitle').textContent=view==='Live'?'New posts every 15 seconds.':view==='Home'?'Your people. Your pace.':view==='Explore'?'Conversations across your server.':'Saved on your Mastodon account.';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const q=$('#search').value.toLowerCase();const posts=livePosts.filter(w=>{let p=w.reblog||w;return !q||`${plainContent(p.content)} ${p.account.acct} ${p.account.display_name}`.toLowerCase().includes(q)});feed.innerHTML=posts.map(statusMarkup).join('')||'<div class="empty">No posts to show.<br>Try refreshing or clearing your search.</div>';$('#loadmore').hidden=!nextPage; $('footer').firstChild.textContent=''}
function loadMedia(button) {
  const post = livePosts.map(wrapper => wrapper.reblog || wrapper)
    .find(post => post.id === button.dataset.media);
  const attachment = post?.media_attachments?.find(media => media.id === button.dataset.mediaid);
  const preview = attachment && imagePreview(attachment);
  if (!preview) return;
  const image = document.createElement('img');
  image.className = 'photo';
  image.alt = attachment.description || 'Post image';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.src = preview;
  button.replaceWith(image);
}
function timelinePath(){if(view==='Bookmarks')return '/api/v1/bookmarks';if(view==='Favourites')return '/api/v1/favourites';if(view==='Explore'||tab==='Federated')return '/api/v1/timelines/public';if(tab==='Local')return '/api/v1/timelines/public?local=true';return '/api/v1/timelines/home'}
function nextLink(header,origin){const part=(header||'').split(',').find(s=>/rel="next"/.test(s));const match=part?.match(/<([^>]+)>/);if(!match)return null;try{const u=new URL(match[1]);return u.origin===origin&&u.pathname.startsWith('/api/v1/')?u.pathname+u.search:null}catch{return null}}
const AUTO_LOAD_THRESHOLD = 0.4;
let autoLoadPaused = false;
let scrollCheckQueued = false;

function canAutoLoad() {
  return me && nextPage && !autoLoadPaused && !$('#loadmore').disabled && !$('#search').value.trim();
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
  const loadMore = $('#loadmore');
  if (more && (!nextPage || loadMore.disabled)) return;
  const ticket = ++requestNumber;
  const path = more ? nextPage : timelinePath();
  const url = more ? path : path + (path.includes('?') ? '&' : '?') + 'limit=20';
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
    nextLiveCheck = 0;
    loadMore.hidden = true;
    feed.innerHTML = '<div class="empty">Loading your timeline…</div>';
  }
  try {
    const {data, response} = await api(url);
    if (ticket !== requestNumber || !accountSession) return;
    if (!Array.isArray(data)) throw Error('Your server returned an unexpected timeline.');
    const seen = new Set(livePosts.map(post => post.id));
    const fresh = data.filter(post => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
    livePosts.push(...fresh);
    const cursor = nextLink(response.headers.get('Link'), accountSession.origin);
    nextPage = cursor === url || !data.length ? null : cursor;
    autoLoadPaused = more && fresh.length === 0;
    renderLive(more ? fresh : undefined);
  } catch (error) {
    if (ticket !== requestNumber) return;
    $('#liveerror').textContent = error.message;
    if (more) {
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
    }
  }
}

const LIVE_REFRESH_MS = 15_000;
let liveRefreshPending = false;
let nextLiveCheck = 0;

async function refreshLiveFeed() {
  if (view !== 'Live' || !accountSession || !me || document.hidden ||
      liveRefreshPending || $('#refresh').disabled || Date.now() < nextLiveCheck) return;

  const ticket = requestNumber;
  const session = accountSession;
  const path = timelinePath();
  const latest = livePosts[0]?.id;
  const params = new URLSearchParams({limit: '20'});
  if (latest) params.set('min_id', latest);
  const url = path + (path.includes('?') ? '&' : '?') + params;
  liveRefreshPending = true;
  nextLiveCheck = Date.now() + LIVE_REFRESH_MS;

  try {
    const {data, response} = await api(url);
    if (view !== 'Live' || ticket !== requestNumber || accountSession !== session ||
        !Array.isArray(data)) return;
    const seen = new Set(livePosts.map(post => post.id));
    const fresh = data.filter(post => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
    if (!fresh.length) return;
    livePosts.unshift(...fresh);
    if (!latest) nextPage = nextLink(response.headers.get('Link'), session.origin);
    prependLivePosts(fresh);
  } catch {
    nextLiveCheck = Date.now() + 60_000;
  } finally {
    liveRefreshPending = false;
  }
}

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

window.setInterval(refreshLiveFeed, LIVE_REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshLiveFeed();
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

function paintAccount(){const name=me.display_name||me.username;$('#profile b').textContent=name;$('#profile small').textContent='@'+me.acct;paintProfileImages(me, name);$('#draft').placeholder=`What's on your mind, ${name}?`;$('.demo').innerHTML='<span class="dot"></span><span id="connectedLabel"></span> <button id="accountButton">Account / sign out</button>';$('#connectedLabel').textContent='Connected to '+new URL(accountSession.origin).hostname;$('#accountButton').onclick=openAccount;$('#signinTop').textContent='Account';$('.composerbottom>span').innerHTML='<label>Post visibility <select id="visibility"><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private" selected>Followers only</option></select></label>';$('#search').placeholder='Filter loaded posts';$('.note').innerHTML='Connected directly to your Mastodon server.<br>Account data stays in this tab.';$('#loadmore').hidden=true;$('#draft').value='';$('#draft').dispatchEvent(new Event('input'));}
async function connect(){me=(await api('/api/v1/accounts/verify_credentials')).data;if(!me.id)throw Error('Could not verify your Mastodon account.');paintAccount();await loadTimeline()}
async function finishLogin(){const params=new URLSearchParams(location.search);try{if(params.has('code')||params.has('error')){history.replaceState({},'',location.pathname);let pending;try{pending=JSON.parse(sessionStorage.getItem('swift-oauth-pending'))}catch{}sessionStorage.removeItem('swift-oauth-pending');if(!pending||pending.state!==params.get('state')||Date.now()-pending.created>900000)throw Error('Sign-in expired or could not be verified. Please start again.');if(params.has('error'))throw Error('Sign-in was cancelled. You can try again whenever you’re ready.');const result=(await request(pending.origin,'/oauth/token',{method:'POST',body:{grant_type:'authorization_code',code:params.get('code'),client_id:pending.clientId,client_secret:pending.clientSecret,redirect_uri:pending.redirect,code_verifier:pending.verifier}})).data;if(!result.access_token)throw Error('Your server did not return an access token.');accountSession={origin:pending.origin,clientId:pending.clientId,clientSecret:pending.clientSecret,token:result.access_token};sessionStorage.setItem('swift-account',JSON.stringify(accountSession))}else{accountSession=JSON.parse(sessionStorage.getItem('swift-account')||'null')}if(accountSession)await connect()}catch(error){$('#liveerror').textContent=error.message;if(!me){accountSession=null;sessionStorage.removeItem('swift-account')}openAccount();authMessage(error.message)}}
async function logout(){const button=$('#signout');button.disabled=true;let failed=false;try{await request(accountSession.origin,'/oauth/revoke',{method:'POST',body:{client_id:accountSession.clientId,client_secret:accountSession.clientSecret,token:accountSession.token}})}catch{failed=true}requestNumber++;sessionStorage.removeItem('swift-account');sessionStorage.removeItem('swift-oauth-pending');sessionStorage.removeItem('swift-draft');if(failed){$('#signedName').textContent='Signed out locally. Your server could not revoke access. You can revoke speedy-fedi under Preferences → Account → Authorized apps on your server.';accountSession=null;me=null;$('#signout').textContent='Back to demo';$('#signout').disabled=false;$('#signout').onclick=()=>location.replace(location.pathname);$('#accountClose').onclick=()=>location.replace(location.pathname);livePosts=[];$('#feed').innerHTML='';return}location.replace(location.pathname)}
// Capture live interactions before the isolated demo handlers run.
document.addEventListener('click',async event=>{if(!accountSession||!me)return;const target=event.target;const navButton=target.closest('[data-view]'), tabButton=target.closest('[data-tab]'), action=target.closest('[data-liveaction]'), media=target.closest('[data-media]');if(navButton){event.stopImmediatePropagation();if(navButton.dataset.view==='Settings'){$('#modal').showModal();return}view=navButton.dataset.view;$('#search').value='';document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===tab));await loadTimeline();return}if(tabButton){event.stopImmediatePropagation();tab=tabButton.dataset.tab;if(view!=='Live')view='Home';document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===tabButton));await loadTimeline();return}if(target.closest('#refresh')){event.stopImmediatePropagation();await loadTimeline();return}if(target.closest('#profile')){event.stopImmediatePropagation();openAccount();return}if(target.closest('[data-search]')){event.stopImmediatePropagation();$('#search').value=target.closest('[data-search]').dataset.search;renderLive();return}if(media){event.stopImmediatePropagation();loadMedia(media);return}if(action){event.stopImmediatePropagation();const id=action.dataset.id;const p=livePosts.map(p=>p.reblog||p).find(p=>p.id===id);if(!p)return;const type=action.dataset.liveaction;if(type==='reply'){replyTo=p.id;$('#draft').value='@'+p.account.acct+' ';$('#replylabel').textContent='Replying to @'+p.account.acct;$('#cancelreply').hidden=false;$('#visibility').value=['private','direct'].includes(p.visibility)?'private':'unlisted';if(p.visibility==='direct'){toast('Open the original post to reply privately.');replyTo=null;$('#draft').value='';$('#replylabel').textContent='';$('#cancelreply').hidden=true;return}$('#draft').dispatchEvent(new Event('input'));$('#draft').focus();$('.composer').scrollIntoView({behavior:'smooth'});return}action.disabled=true;try{const endpoint=type==='boost'?(p.reblogged?'unreblog':'reblog'):type==='favourite'?(p.favourited?'unfavourite':'favourite'):(p.bookmarked?'unbookmark':'bookmark');const {data}=await api(`/api/v1/statuses/${encodeURIComponent(id)}/${endpoint}`,{method:'POST'});const fresh=data.reblog||data;livePosts=livePosts.map(w=>(w.reblog||w).id===id?(w.reblog?{...w,reblog:fresh}:fresh):w);renderLive()}catch(error){toast(error.message);action.disabled=false}return}if(target.closest('#post')){event.stopImmediatePropagation();const status=$('#draft').value.trim();if(!status)return;const button=$('#post');button.disabled=true;const visibility=$('#visibility').value;const signature=JSON.stringify([status,visibility,replyTo]);if(!pendingPost||pendingPost.signature!==signature)pendingPost={signature,key:crypto.randomUUID()};try{await api('/api/v1/statuses',{method:'POST',headers:{'Idempotency-Key':pendingPost.key},body:{status,visibility,...(replyTo?{in_reply_to_id:replyTo}:{})}});pendingPost=null;replyTo=null;$('#replylabel').textContent='';$('#cancelreply').hidden=true;$('#draft').value='';$('#draft').dispatchEvent(new Event('input'));if(view!=='Live')view='Home';$('#search').value='';document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===tab));await loadTimeline();toast('Published to Mastodon.')}catch(error){$('#liveerror').textContent=error.message}finally{button.disabled=false}}},true);
document.addEventListener('input',e=>{if(accountSession&&e.target.id==='search'){e.stopImmediatePropagation();renderLive()}},true);
document.addEventListener('change',e=>{if(!accountSession)return;const id=e.target.id.replace('modal','');if(['compact','saver'].includes(id)){e.stopImmediatePropagation();state[id]=e.target.checked;save();renderLive()}},true);
$('#signinTop').onclick=openAccount;$('#accountClose').onclick=()=>$('#accountDialog').close();$('#signinForm').onsubmit=startLogin;$('#signout').onclick=logout;$('#loadmore').onclick=()=>loadTimeline(true);$('#cancelreply').onclick=()=>{replyTo=null;$('#replylabel').textContent='';$('#cancelreply').hidden=true};
finishLogin();

window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  $('#signinSubmit').disabled = false;
  authMessage('');
});
