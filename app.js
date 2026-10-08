import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-analytics.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

// ---------- Firebase ----------
const firebaseConfig = {
  apiKey: "AIzaSyCLYVm33S4hV7uuZGz-2Gpt6dRK-ecYX3o",
  authDomain: "the-gang-f8938.firebaseapp.com",
  projectId: "the-gang-f8938",
  storageBucket: "the-gang-f8938.firebasestorage.app",
  messagingSenderId: "383868918752",
  appId: "1:383868918752:web:f7ec1af85790548493a985",
  measurementId: "G-1R1DGQM9QC",
};

const app = initializeApp(firebaseConfig);
getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const screens = {
  loading: $("loading-screen"),
  login: $("login-screen"),
  verify: $("verify-screen"),
  gate: $("gate-screen"),
  app: $("app-screen"),
};
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

// ---------- Auth providers ----------
const googleProvider = new GoogleAuthProvider();

// ---------- Routing ----------
// Runs after every auth change. Decides which screen the user sees.
async function route(user) {
  if (!user) return showScreen("login");
  // Bail if the user changed while we were awaiting.
  if (auth.currentUser?.uid !== user.uid) return;

  if (!user.emailVerified) {
    $("verify-email-addr").textContent = user.email || "";
    return showScreen("verify");
  }

  const member = await checkMembership();
  if (auth.currentUser?.uid !== user.uid) return;

  if (member) showApp(user);
  else showScreen("gate");
}

// Membership is enforced by the rules on /posts. If we can read a post,
// we're a member. If the rules deny the read, we're not.
async function checkMembership() {
  try {
    await getDocs(query(collection(db, "posts"), limit(1)));
    return true;
  } catch (err) {
    if (err.code === "permission-denied" || err.code === "firestore/permission-denied") {
      return false;
    }
    console.error("Membership probe failed:", err);
    return false;
  }
}

onAuthStateChanged(auth, route);

// ---------- Google sign-in ----------
$("google-signin").addEventListener("click", async () => {
  clearError("login-error");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    showError("login-error", prettyAuthError(err));
  }
});

// ---------- Email/password sign-in & sign-up ----------
let mode = "signin"; // or "signup"

function applyMode() {
  const isSignup = mode === "signup";
  $("email-submit").textContent = isSignup ? "Create account" : "Sign in";
  $("password").autocomplete = isSignup ? "new-password" : "current-password";
  $("toggle-mode").textContent = isSignup ? "Sign in instead" : "Create an account";
}
applyMode();

$("toggle-mode").addEventListener("click", (e) => {
  e.preventDefault();
  mode = mode === "signin" ? "signup" : "signin";
  applyMode();
  clearError("login-error");
});

$("email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError("login-error");

  const email = $("email").value.trim();
  const password = $("password").value;

  try {
    if (mode === "signup") {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      // Send the verification email. Until they click it, rules will
      // refuse to let them join /members even if they know the gate code.
      await sendEmailVerification(cred.user);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    showError("login-error", prettyAuthError(err));
  }
});

$("forgot-password").addEventListener("click", async (e) => {
  e.preventDefault();
  clearError("login-error");

  const email = $("email").value.trim();
  if (!email) {
    showError("login-error", "Type your email above, then click 'Forgot password?' again.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showError("login-error", "Reset link sent. Check your inbox.");
    $("login-error").style.color = "var(--muted)";
  } catch (err) {
    $("login-error").style.color = "";
    showError("login-error", prettyAuthError(err));
  }
});

// ---------- Verify screen ----------
$("resend-verify").addEventListener("click", async () => {
  clearError("verify-error");
  if (!auth.currentUser) return;
  try {
    await sendEmailVerification(auth.currentUser);
    showError("verify-error", "Sent. Check your inbox.");
    $("verify-error").style.color = "var(--muted)";
  } catch (err) {
    $("verify-error").style.color = "";
    showError("verify-error", prettyAuthError(err));
  }
});

$("refresh-verify").addEventListener("click", async () => {
  clearError("verify-error");
  if (!auth.currentUser) return;
  try {
    await auth.currentUser.reload();
  } catch (err) {
    showError("verify-error", prettyAuthError(err));
    return;
  }
  if (auth.currentUser.emailVerified) {
    route(auth.currentUser);
  } else {
    showError("verify-error", "Still not verified. Click the link in your inbox first.");
  }
});

$("signout-verify").addEventListener("click", () => signOut(auth));

// ---------- Gate screen ----------
$("gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError("gate-error");

  const code = $("gate-code").value;
  if (!code) return;
  const user = auth.currentUser;
  if (!user) return;

  // Attempt to create our membership doc. The rules will only allow this
  // if the submitted code matches the secret one in /config/gate.
  // Success = we're in. Permission denied = wrong code.
  try {
    await setDoc(doc(db, "members", user.uid), {
      code,
      joinedAt: serverTimestamp(),
    });
  } catch (err) {
    if (err.code !== "permission-denied" && err.code !== "firestore/permission-denied") {
      console.error(err);
      showError("gate-error", "Something went wrong. Try again.");
      return;
    }
    // Fall through — we probe below to disambiguate
    // "wrong code" from "already a member".
  }

  const member = await checkMembership();
  if (member) {
    $("gate-code").value = "";
    showApp(user);
  } else {
    showError("gate-error", "That's not it.");
    $("gate-code").value = "";
    $("gate-code").focus();
  }
});

$("signout-gate").addEventListener("click", () => signOut(auth));

// ---------- The app ----------
let unsubscribeFeed = null;

function showApp(user) {
  $("user-name").textContent = user.displayName || user.email || "member";
  const photo = $("user-photo");
  if (user.photoURL) {
    photo.src = user.photoURL;
    photo.style.display = "";
  } else {
    photo.style.display = "none";
  }
  showScreen("app");
  subscribeToFeed();
}

$("signout").addEventListener("click", () => signOut(auth));

function subscribeToFeed() {
  if (unsubscribeFeed) unsubscribeFeed();
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(100));

  unsubscribeFeed = onSnapshot(
    q,
    (snap) => {
      const feed = $("feed");
      feed.innerHTML = "";
      if (snap.empty) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "Nothing yet. Be the first.";
        feed.appendChild(p);
        return;
      }
      const uid = auth.currentUser?.uid;
      snap.forEach((d) => feed.appendChild(renderPost(d, uid)));
    },
    (err) => {
      console.error("Feed error:", err);
      const feed = $("feed");
      feed.innerHTML = "";
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Couldn't load the feed.";
      feed.appendChild(p);
    }
  );
}

function renderPost(docSnap, currentUid) {
  const data = docSnap.data();
  const article = document.createElement("article");
  article.className = "post";

  const head = document.createElement("div");
  head.className = "post-head";
  if (data.authorPhoto) {
    const img = document.createElement("img");
    img.src = data.authorPhoto;
    img.alt = "";
    head.appendChild(img);
  }
  const meta = document.createElement("div");
  const author = document.createElement("div");
  author.className = "post-author";
  author.textContent = data.authorName || "unknown";
  const time = document.createElement("div");
  time.className = "post-time";
  time.textContent = formatTime(data.createdAt);
  meta.append(author, time);
  head.appendChild(meta);
  article.appendChild(head);

  const text = document.createElement("div");
  text.className = "post-text";
  text.textContent = data.text || "";
  article.appendChild(text);

  if (data.authorId === currentUid) {
    const del = document.createElement("button");
    del.className = "post-delete";
    del.textContent = "delete";
    del.addEventListener("click", async () => {
      if (!confirm("Delete this post?")) return;
      try { await deleteDoc(doc(db, "posts", docSnap.id)); }
      catch (err) { alert("Couldn't delete: " + err.message); }
    });
    article.appendChild(del);
  }

  return article;
}

function formatTime(ts) {
  if (!ts) return "just now";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

// ---------- Composer ----------
const postBtn = $("post-btn");
const postText = $("post-text");

postBtn.addEventListener("click", async () => {
  const text = postText.value.trim();
  if (!text) return;
  const user = auth.currentUser;
  if (!user) return;

  postBtn.disabled = true;
  try {
    await addDoc(collection(db, "posts"), {
      text,
      authorId: user.uid,
      authorName: user.displayName || user.email || "member",
      authorPhoto: user.photoURL || "",
      createdAt: serverTimestamp(),
    });
    postText.value = "";
  } catch (err) {
    alert("Couldn't post: " + err.message);
  } finally {
    postBtn.disabled = false;
  }
});

postText.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") postBtn.click();
});

// ---------- Helpers ----------
function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearError(id) {
  const el = $(id);
  el.textContent = "";
  el.style.color = "";
  el.classList.add("hidden");
}

function prettyAuthError(err) {
  switch (err.code) {
    case "auth/invalid-email": return "That email doesn't look right.";
    case "auth/user-not-found": return "No account with that email.";
    case "auth/wrong-password":
    case "auth/invalid-credential": return "Wrong email or password.";
    case "auth/email-already-in-use": return "That email already has an account. Try signing in.";
    case "auth/weak-password": return "Password must be at least 6 characters.";
    case "auth/too-many-requests": return "Too many attempts. Try again in a bit.";
    case "auth/popup-closed-by-user": return "Sign-in cancelled.";
    case "auth/network-request-failed": return "Network error. Check your connection.";
    default: return err.message || "Something went wrong.";
  }
}
