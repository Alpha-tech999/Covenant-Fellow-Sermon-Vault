
(function(){
  "use strict";

  /* ---------------- Icons ---------------- */
  const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.2a7 7 0 1 0 11 11.3z"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
  const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"/></svg>';

  /* ---------------- Cloud storage config (Supabase) ----------------
     1) Create a free project at https://supabase.com
     2) STORAGE: Storage → New bucket → name it exactly "sermons" → mark it PUBLIC
        Then Storage → Policies (for "sermons") → allow public SELECT, INSERT, DELETE
     3) DATABASE: SQL Editor → New query → paste and run:

        create table sermons (
          id text primary key,
          title text not null,
          preacher text not null,
          description text not null,
          file_name text,
          audio_path text,
          audio_url text,
          date_added timestamptz default now(),
          listens int default 0
        );
        alter table sermons enable row level security;
        create policy "public read" on sermons for select using (true);
        create policy "public insert" on sermons for insert with check (true);
        create policy "public update" on sermons for update using (true);
        create policy "public delete" on sermons for delete using (true);

        create table site_stats (id int primary key, views int default 0);
        insert into site_stats (id, views) values (1, 0);
        alter table site_stats enable row level security;
        create policy "public read" on site_stats for select using (true);
        create policy "public update" on site_stats for update using (true);

     (Policies are wide open because admin access in this app is gated by the
      passcode in the UI, not real Supabase auth. Fine for a small church app;
      tighten later if needed.)
     4) Project Settings → API → copy the "Project URL" and "anon public" key below
  ------------------------------------------------------------------- */
  const SUPABASE_URL = "https://pkiavxilbnguvqujxhtc.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBraWF2eGlsYm5ndXZxdWp4aHRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NjM3MzUsImV4cCI6MjA5ODUzOTczNX0.M1RbgCLzaWhVQM5_c9s_WgTPcdqz2uWeTNi2TIw1pIE";
  const BUCKET_NAME = "sermons";
  const sb = (SUPABASE_URL.startsWith("http") && window.supabase)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  /* ---------------- State ---------------- */
  let isAdmin = false;
  let sermons = [];
  let playedThisSession = new Set();
  let expandedId = null;
  let searchTerm = "";

  const $ = (id) => document.getElementById(id);

  /* ---------------- Toasts ---------------- */
  function toast(msg, type) {
    const c = $("toastContainer");
    const el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " error" : "");
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* ---------------- Theme (per-browser, stored locally) ---------------- */
  const mq = window.matchMedia("(prefers-color-scheme: dark)");

  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    $("themeToggle").innerHTML = mode === "dark" ? ICON_SUN : ICON_MOON;
    $("themeToggle").setAttribute("aria-label", mode === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }

  function initTheme() {
    const override = localStorage.getItem("sv_theme_override");
    if (override === "light" || override === "dark") {
      applyTheme(override);
    } else {
      applyTheme(mq.matches ? "dark" : "light");
      mq.addEventListener("change", (e) => {
        const ov = localStorage.getItem("sv_theme_override");
        if (ov !== "light" && ov !== "dark") applyTheme(e.matches ? "dark" : "light");
      });
    }
  }

  $("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("sv_theme_override", next);
  });

  /* ---------------- Modals ---------------- */
  function openModal(id) { $(id).classList.add("show"); }
  function closeModal(id) { $(id).classList.remove("show"); }
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close")));
  });
  document.querySelectorAll(".modal-backdrop").forEach(bd => {
    bd.addEventListener("click", (e) => { if (e.target === bd) bd.classList.remove("show"); });
  });

  /* ---------------- Admin ---------------- */
  $("adminBtn").addEventListener("click", () => {
    if (isAdmin) { setAdmin(false); return; }
    $("passcodeInput").value = "";
    $("passcodeError").textContent = "";
    openModal("adminModalBackdrop");
    setTimeout(() => $("passcodeInput").focus(), 50);
  });

  function checkPasscode() {
    const val = $("passcodeInput").value.trim();
    if (val === "1234") {
      setAdmin(true);
      closeModal("adminModalBackdrop");
      toast("Admin mode unlocked");
    } else {
      $("passcodeError").textContent = "Incorrect passcode. Try again.";
      $("passcodeInput").value = "";
      $("passcodeInput").focus();
    }
  }
  $("passcodeSubmit").addEventListener("click", checkPasscode);
  $("passcodeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") checkPasscode(); });

  function setAdmin(state) {
    isAdmin = state;
    $("adminBtn").textContent = state ? "Admin ●" : "Admin";
    $("adminBtn").classList.toggle("on", state);
    $("adminBar").classList.toggle("show", state);
    renderSermons();
    if (!state) toast("Exited admin mode");
  }
  $("logoutBtn").addEventListener("click", () => setAdmin(false));

  /* ---------------- Upload ---------------- */
  let pendingFile = null;

  $("uploadBtn").addEventListener("click", () => {
    $("upTitle").value = ""; $("upPreacher").value = ""; $("upDesc").value = "";
    $("upFile").value = ""; $("fpName").textContent = "";
    $("uploadError").textContent = "";
    pendingFile = null;
    openModal("uploadModalBackdrop");
  });

  $("upFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    $("uploadError").textContent = "";
    if (!file) { pendingFile = null; $("fpName").textContent = ""; return; }
    const isMp3 = file.type === "audio/mpeg" || file.type === "audio/mp3" || /\.mp3$/i.test(file.name);
    if (!isMp3) {
      $("uploadError").textContent = "Only MP3 audio files are accepted.";
      $("upFile").value = ""; pendingFile = null; $("fpName").textContent = "";
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      $("uploadError").textContent = "File too large (max 200 MB). Try a lower bitrate export.";
      $("upFile").value = ""; pendingFile = null; $("fpName").textContent = "";
      return;
    }
    pendingFile = file;
    $("fpName").textContent = file.name + " (" + (file.size/1024/1024).toFixed(2) + " MB)";
  });

  $("uploadSubmit").addEventListener("click", async () => {
    const title = $("upTitle").value.trim();
    const preacher = $("upPreacher").value.trim();
    const desc = $("upDesc").value.trim();
    $("uploadError").textContent = "";

    if (!title || !preacher || !desc || !pendingFile) {
      $("uploadError").textContent = "Please fill in every field and choose an MP3 file.";
      return;
    }
    if (!sb) {
      $("uploadError").textContent = "Cloud storage isn't configured yet — add your Supabase URL and key in the code (see comment near the top of the script).";
      return;
    }

    $("uploadSubmit").textContent = "Uploading… (this can take a while for long files)";
    $("uploadSubmit").disabled = true;

    try {
      const id = "s_" + Date.now() + "_" + Math.random().toString(36).slice(2,8);
      const safeName = pendingFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = id + "/" + safeName;

      const { error: uploadErr } = await sb.storage.from(BUCKET_NAME).upload(path, pendingFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: pendingFile.type || "audio/mpeg"
      });
      if (uploadErr) throw uploadErr;

      const { data: pub } = sb.storage.from(BUCKET_NAME).getPublicUrl(path);
      const audioUrl = pub.publicUrl;

      const { error: insertErr } = await sb.from("sermons").insert({
        id, title, preacher, description: desc,
        file_name: pendingFile.name, audio_path: path, audio_url: audioUrl,
        listens: 0
      });
      if (insertErr) throw new Error("Could not save sermon details: " + insertErr.message);

      sermons = await loadSermonsMeta();
      renderSermons();
      closeModal("uploadModalBackdrop");
      toast("Sermon published: " + title);
      pendingFile = null; $("upFile").value = ""; $("fpName").textContent = "";
      $("upTitle").value = ""; $("upPreacher").value = ""; $("upDesc").value = "";
    } catch (err) {
      console.error(err);
      $("uploadError").textContent = "Upload failed: " + (err && err.message ? err.message : "please try again.");
    } finally {
      $("uploadSubmit").textContent = "Publish";
      $("uploadSubmit").disabled = false;
    }
  });

  /* ---------------- Delete ---------------- */
  async function deleteSermon(id, title) {
    if (!confirm('Delete "' + title + '"? This cannot be undone.')) return;
    const sermon = sermons.find(s => s.id === id);
    const { error: delErr } = await sb.from("sermons").delete().eq("id", id);
    if (delErr) { toast("Could not delete sermon", "error"); return; }
    if (sb && sermon && sermon.audio_path) {
      try { await sb.storage.from(BUCKET_NAME).remove([sermon.audio_path]); }
      catch (e) { console.error("Could not remove file from storage", e); }
    }
    sermons = await loadSermonsMeta();
    renderSermons();
    toast("Sermon deleted");
  }

  /* ---------------- Load / render ---------------- */
  async function loadSermonsMeta() {
    if (!sb) return [];
    const { data, error } = await sb.from("sermons").select("*").order("date_added", { ascending: false });
    if (error) { console.error(error); return []; }
    return data || [];
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
    } catch(e){ return ""; }
  }

  function updateStatsDisplay(views) {
    $("statViews").textContent = views;
    $("statSermons").textContent = sermons.length;
    $("statListens").textContent = sermons.reduce((a,s) => a + (s.listens||0), 0);
  }

  function renderSermons() {
    const list = $("sermonList");
    const term = searchTerm.trim().toLowerCase();
    const filtered = sermons.filter(s =>
      !term || s.title.toLowerCase().includes(term) || s.preacher.toLowerCase().includes(term)
    );

    $("listCount").textContent = sermons.length ? filtered.length + " of " + sermons.length : "";

    if (sermons.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="em-icon">🎙</div><h3>The vault is empty</h3><p>' +
        (isAdmin ? "Upload the first sermon to begin the archive." : "Check back soon — sermons will appear here once added.") +
        '</p></div>';
      return;
    }
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="em-icon">🔍</div><h3>No matches</h3><p>Try a different search term.</p></div>';
      return;
    }

    list.innerHTML = filtered.map((s, i) => {
      const num = String(sermons.length - sermons.findIndex(x => x.id === s.id)).padStart(2,"0");
      const isExpanded = expandedId === s.id;
      return `
      <article class="sermon-card${isExpanded ? ' playing':''}" data-id="${escapeAttr(s.id)}">
        <div class="sermon-num">${num}</div>
        <div class="sermon-main">
          <h3 class="title">${escapeHtml(s.title)}</h3>
          <div class="meta">${escapeHtml(s.preacher)}<span class="dot">·</span>${fmtDate(s.date_added)}</div>
          <p class="desc">${escapeHtml(s.description)}</p>
          <div class="player-slot" data-slot="${escapeAttr(s.id)}">${isExpanded ? '<div class="hint" style="font-family:var(--mono);">Loading audio…</div>' : ''}</div>
        </div>
        <div class="sermon-side">
          <div style="display:flex; gap:8px;">
            <button class="play-btn" data-play="${escapeAttr(s.id)}" aria-label="Play ${escapeAttr(s.title)}">${isExpanded ? ICON_PAUSE : ICON_PLAY}</button>
            ${s.audio_url ? `<a class="dl-btn" href="${escapeAttr(s.audio_url)}?download=${encodeURIComponent(s.file_name || s.title + '.mp3')}" aria-label="Download ${escapeAttr(s.title)}">${ICON_DOWNLOAD}</a>` : ''}
          </div>
          <div class="waveform"><span></span><span></span><span></span><span></span><span></span><span></span></div>
          <div class="listen-count">${s.listens||0} listens</div>
          ${isAdmin ? `<button class="del-btn" data-del="${escapeAttr(s.id)}">${ICON_TRASH} Delete</button>` : ''}
        </div>
      </article>`;
    }).join("");

    if (expandedId) {
      const slot = list.querySelector('[data-slot="' + cssEscape(expandedId) + '"]');
      const s = sermons.find(x => x.id === expandedId);
      if (slot && s) mountPlayer(slot, s);
    }
  }

  function escapeHtml(str){ return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(str){ return escapeHtml(str); }
  function cssEscape(str){ return String(str).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }

  async function mountPlayer(slot, sermon) {
    if (!sermon.audio_url) {
      slot.innerHTML = '<div class="hint" style="color:#C0392B;">Could not load audio for this sermon.</div>';
      return;
    }
    slot.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "player-wrap";

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.autoplay = true;
    audio.preload = "metadata";
    audio.src = sermon.audio_url;
    wrap.appendChild(audio);

    const dl = document.createElement("a");
    dl.className = "download-link";
    dl.href = sermon.audio_url + "?download=" + encodeURIComponent(sermon.file_name || (sermon.title + ".mp3"));
    dl.innerHTML = ICON_DOWNLOAD + " Download full sermon (MP3)";
    wrap.appendChild(dl);

    slot.appendChild(wrap);

    audio.addEventListener("play", async () => {
      if (!playedThisSession.has(sermon.id)) {
        playedThisSession.add(sermon.id);
        const newCount = (sermon.listens || 0) + 1;
        const { error } = await sb.from("sermons").update({ listens: newCount }).eq("id", sermon.id);
        if (!error) {
          sermon.listens = newCount;
          const idx = sermons.findIndex(x => x.id === sermon.id);
          if (idx > -1) sermons[idx].listens = newCount;
          const countEl = document.querySelector('[data-id="' + cssEscape(sermon.id) + '"] .listen-count');
          if (countEl) countEl.textContent = newCount + " listens";
          $("statListens").textContent = sermons.reduce((a,x) => a + (x.listens||0), 0);
        }
      }
    });
  }

  /* ---------------- Event delegation ---------------- */
  $("sermonList").addEventListener("click", (e) => {
    const playBtn = e.target.closest("[data-play]");
    if (playBtn) {
      const id = playBtn.getAttribute("data-play");
      expandedId = (expandedId === id) ? null : id;
      renderSermons();
      return;
    }
    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      const id = delBtn.getAttribute("data-del");
      const s = sermons.find(x => x.id === id);
      deleteSermon(id, s ? s.title : "this sermon");
    }
  });

  $("searchInput").addEventListener("input", (e) => {
    searchTerm = e.target.value;
    renderSermons();
  });

  /* ---------------- View tracking ---------------- */
  async function trackSiteView() {
    if (!sb) return 0;
    const { data, error } = await sb.from("site_stats").select("views").eq("id", 1).single();
    if (error || !data) return 0;
    const n = (data.views || 0) + 1;
    await sb.from("site_stats").update({ views: n }).eq("id", 1);
    return n;
  }

  /* ---------------- Init ---------------- */
  async function init() {
    $("year").textContent = new Date().getFullYear();
    initTheme();

    if (!sb) {
      $("sermonList").innerHTML = '<div class="empty-state"><div class="em-icon">⚠</div><h3>Cloud storage not configured</h3><p>Add your Supabase URL and anon key near the top of the script to connect the vault.</p></div>';
      updateStatsDisplay(0);
      return;
    }

    const [views, meta] = await Promise.all([trackSiteView(), loadSermonsMeta()]);
    sermons = meta;
    updateStatsDisplay(views);
    renderSermons();
  }

  init();
})();
