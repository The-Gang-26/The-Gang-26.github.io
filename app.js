import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-analytics.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

// ---------- Firebase init ----------
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

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);
const screens = {
  loading: $("loading"),
  login: $("login-screen"),
  notMember: $("not-member-screen"),
  app: $("app-screen"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

// ---------- Auth ----------
const provider = new GoogleAuthProvider();

$("google-signin").addEventListener("click", async () => {
  $("login-error").classList.add("hidden");
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    $("login-error").textContent = err.message;
    $("login-error").classList.remove("hidden");
  }
});

$("signout").addEventListener("click", () => signOut(auth));
$("signout-nonmember").addEventListener("click", () => signOut(auth));

let unsubscribeFeed = null;

onAuthStateChanged(auth, async (user) => {
  // Tear down previous feed listener on any auth change
  if (unsubscribeFeed) {
    unsubscribeFeed();
    unsubscribeFeed = null;
  }

  if (!user) {
    showScreen("login");
    return;
  }

  showScreen("loading");

  // Membership check — this is the gate. Rules enforce it server-side;
  // this just decides which screen to show.
  try {
    const memberSnap = await getDoc(doc(db, "members", user.uid));
    if (!memberSnap.exists()) {
      $("not-member-email").textContent = user.email || user.uid;
      $("not-member-uid").textContent = user.uid;
      showScreen("notMember");
      return;
    }
  } catch (err) {
    console.error("Membership check failed:", err);
    showScreen("login");
    return;
  }

  // Signed in + verified member
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
});

// ---------- Feed ----------
function subscribeToFeed() {
  const q = query(
    collection(db, "posts"),
    orderBy("createdAt", "desc"),
    limit(100)
  );

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

      const currentUid = auth.currentUser?.uid;
      snap.forEach((docSnap) => {
        feed.appendChild(renderPost(docSnap, currentUid));
      });
    },
    (err) => {
      console.error("Feed error:", err);
      const feed = $("feed");
      feed.innerHTML = "";
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Couldn't load the feed. " + err.message;
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
  meta.appendChild(author);
  meta.appendChild(time);
  head.appendChild(meta);
  article.appendChild(head);

  const text = document.createElement("div");
  text.className = "post-text";
  // textContent, not innerHTML — prevents XSS from post content
  text.textContent = data.text || "";
  article.appendChild(text);

  if (data.authorId === currentUid) {
    const del = document.createElement("button");
    del.className = "post-delete";
    del.textContent = "delete";
    del.addEventListener("click", async () => {
      if (!confirm("Delete this post?")) return;
      try {
        await deleteDoc(doc(db, "posts", docSnap.id));
      } catch (err) {
        alert("Couldn't delete: " + err.message);
      }
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

// Cmd/Ctrl + Enter to post
postText.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    postBtn.click();
  }
});
