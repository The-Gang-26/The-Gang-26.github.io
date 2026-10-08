import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ============================================================
// Fill these in from Supabase → Settings → API
// ============================================================
const SUPABASE_URL = 'https://seizegwhxlyfnwiztcvg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlaXplZ3doeGx5Zm53aXp0Y3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0ODk0NDIsImV4cCI6MjEwNzA2NTQ0Mn0.D_VB6Q1AC0fi6KQ-LfgkIkp-L48LECS0a33NhTl-_RU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const screens = {
  loading: $('loading-screen'),
  login: $('login-screen'),
  gate: $('gate-screen'),
  app: $('app-screen'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ---------- Routing ----------
async function route() {
  showScreen('loading');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    showScreen('login');
    return;
  }

  const member = await checkMembership();
  if (member) {
    showApp(session.user);
  } else {
    showScreen('gate');
  }
}

// Membership check: call the server-side is_member() function.
// It's security definer, so it can read `members` even though
// the client cannot.
async function checkMembership() {
  const { data, error } = await supabase.rpc('is_member');
  if (error) {
    console.error('is_member check failed:', error);
    return false;
  }
  return data === true;
}

supabase.auth.onAuthStateChange(() => route());

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
let feedChannel = null;
let currentUser = null;

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
      () => loadFeed()
    )
    .subscribe();
}

async function loadFeed() {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

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

  const uid = currentUser?.id;
  data.forEach((post) => feed.appendChild(renderPost(post, uid)));
}

function renderPost(post, currentUid) {
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

  const text = document.createElement('div');
  text.className = 'post-text';
  text.textContent = post.text || '';
  article.appendChild(text);

  if (post.author_id === currentUid) {
    const del = document.createElement('button');
    del.className = 'post-delete';
    del.textContent = 'delete';
    del.addEventListener('click', async () => {
      if (!confirm('Delete this post?')) return;
      const { error } = await supabase.from('posts').delete().eq('id', post.id);
      if (error) alert("Couldn't delete: " + error.message);
    });
    article.appendChild(del);
  }

  return article;
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

postBtn.addEventListener('click', async () => {
  const text = postText.value.trim();
  if (!text) return;
  if (!currentUser) return;

  postBtn.disabled = true;
  try {
    const { error } = await supabase.from('posts').insert({
      author_id: currentUser.id,
      author_name: currentUser.email || 'member',
      author_photo: currentUser.user_metadata?.avatar_url || '',
      text,
    });
    if (error) throw error;
    postText.value = '';
  } catch (err) {
    alert("Couldn't post: " + err.message);
  } finally {
    postBtn.disabled = false;
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
