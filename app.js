import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ============================================================
// Fill these in from Supabase → Settings → API
// ============================================================
const SUPABASE_URL = 'https://seizegwhxlyfnwiztcvg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlaXplZ3doeGx5Zm53aXp0Y3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0ODk0NDIsImV4cCI6MjEwNzA2NTQ0Mn0.D_VB6Q1AC0fi6KQ-LfgkIkp-L48LECS0a33NhTl-_RU';

// Capture BEFORE createClient — the SDK clears the hash/query
// once it processes the recovery link.
const INITIAL_URL = window.location.href;
const IS_RECOVERY_TAB =
  INITIAL_URL.includes('type=recovery') ||
  INITIAL_URL.includes('error_description=recovery');

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- Constants ----------
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm',
];
const SIGNED_URL_TTL = 3600; // seconds

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const screens = {
  loading: $('loading-screen'),
  login: $('login-screen'),
  recovery: $('recovery-screen'),
  gate: $('gate-screen'),
  app: $('app-screen'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ---------- State ----------
let currentUser = null;
let feedChannel = null;
let inRecovery = false;
let routeToken = 0;
let pendingFile = null;

// ---------- Routing ----------
async function route() {
  // If recovery is active, never override its screen.
  if (inRecovery) return;

  const myToken = ++routeToken;
  showScreen('loading');

  const { data: { session } } = await supabase.auth.getSession();

  // Re-check after every await. The recovery event can fire
  // while we're suspended here.
  if (inRecovery) return;
  if (myToken !== routeToken) return;

  if (!session) {
    cleanupSession();
    showScreen('login');
    return;
  }

  const member = await checkMembership();

  if (inRecovery) return;
  if (myToken !== routeToken) return;

  if (member) {
    showApp(session.user);
  } else {
    currentUser = session.user;
    showScreen('gate');
  }
}

async function checkMembership() {
  const { data, error } = await supabase.rpc('is_member');
  if (error) {
    console.error('is_member check failed:', error);
    return false;
  }
  return data === true;
}

function cleanupSession() {
  if (feedChannel) {
    supabase.removeChannel(feedChannel);
    feedChannel = null;
  }
  currentUser = null;
  clearPendingFile();
}

// ---------- Auth listener ----------
// Supabase warns against awaiting Supabase calls inside this callback
// (it can deadlock the client). Defer with setTimeout.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    // Only the tab that actually opened the recovery link should
    // show the recovery screen. Other tabs see auth state change
    // via localStorage but not this event — still, guard anyway.
    if (!IS_RECOVERY_TAB) return;

    inRecovery = true;
    // Bump the route token so any in-flight route() bails out
    // even before it hits its own inRecovery check.
    routeToken++;
    showScreen('recovery');
    $('new-password').value = '';
    clearError('recovery-error');
    return;
  }

  if (event === 'SIGNED_OUT') {
    inRecovery = false;
    cleanupSession();
  }

  setTimeout(() => route(), 0);
});

// Kick things off.
route();

// ---------- Login / signup ----------
let mode = 'signin';

function applyMode() {
  const isSignup = mode === 'signup';
  $('email-submit').textContent = isSignup ? 'Create account' : 'Sign in';
  $('password').autocomplete = isSignup ? 'new-password' : 'current-password';
  $('toggle-mode').textContent = isSignup ? 'Sign in instead' : 'Create an account';
}
applyMode();

$('toggle-mode').addEventListener('click', (e) => {
  e.preventDefault();
  mode = mode === 'signin' ? 'signup' : 'signin';
  applyMode();
  clearError('login-error');
});

$('email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('login-error');

  const email = $('email').value.trim();
  const password = $('password').value;

  try {
    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    showError('login-error', err.message);
  }
});

// ---------- Forgot password ----------
$('forgot-password').addEventListener('click', async (e) => {
  e.preventDefault();
  clearError('login-error');

  const email = $('email').value.trim();
  if (!email) {
    showError('login-error', "Type your email above, then click 'Forgot password?' again.");
    return;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  if (error) {
    showError('login-error', error.message);
  } else {
    showError('login-error', 'Reset link sent. Check your inbox.');
    $('login-error').style.color = 'var(--muted)';
  }
});

// ---------- Recovery ----------
$('recovery-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('recovery-error');

  const newPassword = $('new-password').value;
  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    showError('recovery-error', error.message);
    return;
  }

  inRecovery = false;
  window.history.replaceState(null, '', window.location.pathname);
  route();
});

// ---------- Gate ----------
$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError('gate-error');

  const code = $('gate-code').value;
  if (!code) return;

  const { error } = await supabase.rpc('join_with_code', { input_code: code });

  if (error) {
    if (error.message.includes('Invalid code')) {
      showError('gate-error', "That's not it.");
    } else {
      showError('gate-error', error.message);
    }
    $('gate-code').value = '';
    $('gate-code').focus();
    return;
  }

  $('gate-code').value = '';
  route();
});

$('signout-gate').addEventListener('click', async () => {
  await supabase.auth.signOut();
});

// ---------- App ----------
function showApp(user) {
  currentUser = user;
  $('user-name').textContent = user.email || 'member';

  const photo = $('user-photo');
  const avatar = user.user_metadata?.avatar_url;
  if (avatar) {
    photo.src = avatar;
    photo.style.display = '';
  } else {
    photo.style.display = 'none';
  }

  showScreen('app');
  subscribeToFeed();
}

$('signout').addEventListener('click', async () => {
  await supabase.auth.signOut();
});

function subscribeToFeed() {
  if (feedChannel) {
    supabase.removeChannel(feedChannel);
    feedChannel = null;
  }

  loadFeed();

  feedChannel = supabase
    .channel('posts-feed')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'posts' },
      (payload) => {
        loadFeed();
      }
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Realtime channel error:', status, err);
      } else if (status === 'SUBSCRIBED') {
        console.log('Realtime connected.');
      }
    });
}

// Fallback: refetch whenever the tab regains focus. Covers the case
// where realtime drops on a flaky connection.
window.addEventListener('focus', () => {
  if (currentUser && screens.app && !screens.app.classList.contains('hidden')) {
    loadFeed();
  }
});

let feedLoadToken = 0;

async function loadFeed() {
  const myToken = ++feedLoadToken;
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (myToken !== feedLoadToken) return;

  const feed = $('feed');
  feed.innerHTML = '';

  if (error) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = "Couldn't load the feed.";
    feed.appendChild(p);
    return;
  }

  if (!data || data.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Nothing yet. Be the first.';
    feed.appendChild(p);
    return;
  }

  // Batch-fetch signed URLs for all media in the feed (one request).
  const mediaPaths = [...new Set(
    data.filter((p) => p.media_path).map((p) => p.media_path)
  )];

  const signedUrls = {};
  if (mediaPaths.length > 0) {
    const { data: signed, error: signErr } = await supabase
      .storage.from('media')
      .createSignedUrls(mediaPaths, SIGNED_URL_TTL);

    if (myToken !== feedLoadToken) return;

    if (!signErr && signed) {
      signed.forEach((item) => {
        if (!item.error && item.signedUrl) signedUrls[item.path] = item.signedUrl;
      });
    }
  }

  const uid = currentUser?.id;
  data.forEach((post) => feed.appendChild(renderPost(post, uid, signedUrls)));
}

function renderPost(post, currentUid, signedUrls) {
  const article = document.createElement('article');
  article.className = 'post';

  const head = document.createElement('div');
  head.className = 'post-head';

  if (post.author_photo) {
    const img = document.createElement('img');
    img.src = post.author_photo;
    img.alt = '';
    head.appendChild(img);
  }

  const meta = document.createElement('div');
  const author = document.createElement('div');
  author.className = 'post-author';
  author.textContent = post.author_name || 'unknown';
  const time = document.createElement('div');
  time.className = 'post-time';
  time.textContent = formatTime(post.created_at);
  meta.append(author, time);
  head.appendChild(meta);
  article.appendChild(head);

  if (post.text) {
    const text = document.createElement('div');
    text.className = 'post-text';
    text.textContent = post.text;
    article.appendChild(text);
  }

  if (post.media_path && signedUrls[post.media_path]) {
    const url = signedUrls[post.media_path];
    if (post.media_type === 'image') {
      const img = document.createElement('img');
      img.className = 'post-media';
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      article.appendChild(img);
    } else if (post.media_type === 'video') {
      const video = document.createElement('video');
      video.className = 'post-media';
      video.src = url;
      video.controls = true;
      video.preload = 'metadata';
      article.appendChild(video);
    }
  }

  if (post.author_id === currentUid) {
    const del = document.createElement('button');
    del.className = 'post-delete';
    del.textContent = 'delete';
    del.addEventListener('click', async () => {
      if (!confirm('Delete this post?')) return;
      await deletePost(post);
    });
    article.appendChild(del);
  }

  return article;
}

async function deletePost(post) {
  if (post.media_path) {
    await supabase.storage.from('media').remove([post.media_path]);
  }
  const { error } = await supabase.from('posts').delete().eq('id', post.id);
  if (error) alert("Couldn't delete: " + error.message);
}

function formatTime(ts) {
  if (!ts) return 'just now';
  const date = new Date(ts);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

// ---------- Composer ----------
const postBtn = $('post-btn');
const postText = $('post-text');
const attachBtn = $('attach-btn');
const fileInput = $('file-input');
const mediaPreview = $('media-preview');
const mediaPreviewContent = $('media-preview-content');
const mediaRemove = $('media-remove');

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {
    alert(`File too large. Max ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`);
    return;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    alert('Unsupported file type.');
    return;
  }

  clearPendingFile();

  pendingFile = file;
  const url = URL.createObjectURL(file);
  mediaPreviewContent.innerHTML = '';

  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    mediaPreviewContent.appendChild(img);
  } else {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.muted = true;
    mediaPreviewContent.appendChild(video);
  }

  mediaPreview.dataset.objectUrl = url;
  mediaPreview.classList.remove('hidden');
});

mediaRemove.addEventListener('click', () => clearPendingFile());

function clearPendingFile() {
  pendingFile = null;
  const url = mediaPreview.dataset.objectUrl;
  if (url) URL.revokeObjectURL(url);
  delete mediaPreview.dataset.objectUrl;
  mediaPreviewContent.innerHTML = '';
  mediaPreview.classList.add('hidden');
}

postBtn.addEventListener('click', async () => {
  const text = postText.value.trim();
  const file = pendingFile;

  if (!text && !file) return;
  if (!currentUser) return;

  postBtn.disabled = true;
  attachBtn.disabled = true;
  const originalLabel = postBtn.textContent;
  postBtn.textContent = file ? 'Uploading…' : 'Posting…';

  try {
    let mediaPath = null;
    let mediaType = null;

    if (file) {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const uuid = crypto.randomUUID();
      mediaPath = `${currentUser.id}/${uuid}.${ext}`;
      mediaType = file.type.startsWith('image/') ? 'image'
                : file.type.startsWith('video/') ? 'video'
                : null;

      const { error: uploadErr } = await supabase
        .storage.from('media')
        .upload(mediaPath, file, {
          contentType: file.type,
          upsert: false,
        });
      if (uploadErr) throw uploadErr;
    }

    const { error: insertErr } = await supabase.from('posts').insert({
      author_id: currentUser.id,
      author_name: currentUser.email || 'member',
      author_photo: currentUser.user_metadata?.avatar_url || '',
      text,
      media_path: mediaPath,
      media_type: mediaType,
    });
    if (insertErr) throw insertErr;

    postText.value = '';
    clearPendingFile();
  } catch (err) {
    alert("Couldn't post: " + err.message);
  } finally {
    postBtn.disabled = false;
    attachBtn.disabled = false;
    postBtn.textContent = originalLabel;
  }
});

postText.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') postBtn.click();
});

// ---------- Helpers ----------
function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearError(id) {
  const el = $(id);
  el.textContent = '';
  el.style.color = '';
  el.classList.add('hidden');
}
