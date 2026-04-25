 // ─── Supabase Config (Direct – No Node.js needed) ────────────────────────────
const SUPABASE_URL = 'https://xdhjiifaqsnpclsnylmp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGppaWZhcXNucGNsc255bG1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NTIzOTgsImV4cCI6MjA5MjUyODM5OH0.4AnCrSDcMARSYBNOg5BOeGS4I92pTNsUiiH0yzSbjdk';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let allMedia = [];
let flagTargetMediaId = null;
let isDark = true;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const savedTheme = localStorage.getItem('daps_theme') || 'dark';
  isDark = savedTheme === 'dark';
  applyTheme();

  // Check if already logged in
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    currentUser = session.user;
    showDashboard();
  } else {
    showScreen('auth-screen');
  }

  // Listen for auth changes
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
    }
  });
});

// ─── Tab Switch ───────────────────────────────────────────────────────────────
function switchTab(tab) {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const indicator = document.getElementById('tab-indicator');

  if (tab === 'login') {
    loginForm.classList.add('active'); signupForm.classList.remove('active');
    tabLogin.classList.add('active'); tabSignup.classList.remove('active');
    indicator.classList.remove('right');
  } else {
    signupForm.classList.add('active'); loginForm.classList.remove('active');
    tabSignup.classList.add('active'); tabLogin.classList.remove('active');
    indicator.classList.add('right');
  }
  clearErrors();
}

// ─── Signup ───────────────────────────────────────────────────────────────────
async function handleSignup(e) {
  e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const btn = document.getElementById('signup-btn');

  if (password.length < 6) {
    showError('signup-error', 'Password must be at least 6 characters.');
    return;
  }

  setLoading(btn, true);
  clearErrors();

  try {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } }
    });

    if (error) throw error;

    if (data.user && !data.session) {
      // Email confirmation required
      showError('signup-error', '✉️ Check your email to confirm your account, then sign in.');
      setLoading(btn, false);
      return;
    }

    currentUser = data.user;
    showToast('Welcome, ' + name + '! 🎉', 'success');
    showDashboard();
  } catch (err) {
    showError('signup-error', err.message);
  } finally {
    setLoading(btn, false);
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');

  setLoading(btn, true);
  clearErrors();

  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;

    currentUser = data.user;
    const name = currentUser.user_metadata?.full_name || email.split('@')[0];
    showToast('Welcome back, ' + name + '! 👋', 'success');
    showDashboard();
  } catch (err) {
    let msg = err.message;
    if (msg.includes('Invalid login')) msg = 'Invalid email or password.';
    if (msg.includes('Email not confirmed')) msg = '✉️ Please confirm your email first, then try again.';
    showError('login-error', msg);
  } finally {
    setLoading(btn, false);
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────
async function handleLogout() {
  await db.auth.signOut();
  currentUser = null;
  allMedia = [];
  showScreen('auth-screen');
  showToast('Logged out successfully.', 'info');
}

// ─── Show Dashboard ───────────────────────────────────────────────────────────
function showDashboard() {
  showScreen('dashboard-screen');
  const name = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
  document.getElementById('topbar-username').textContent = name;
  document.getElementById('topbar-email').textContent = currentUser.email;
  document.getElementById('user-avatar-display').textContent = name.charAt(0).toUpperCase();
  showSection('overview');
  loadMedia();
}

// ─── Screen / Section ─────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function showSection(name) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const section = document.getElementById('section-' + name);
  const nav = document.getElementById('nav-' + name);
  if (section) section.classList.add('active');
  if (nav) nav.classList.add('active');
  const titles = {
    overview: 'Overview', media: 'My Assets', upload: 'Upload Asset',
    admin: 'Admin Panel', profile: 'My Profile', linkchecker: 'Link Checker'
  };
  document.getElementById('section-title').textContent = titles[name] || name;
  if (name === 'admin') loadAdminData();
  if (name === 'profile') loadProfile();
  if (name === 'linkchecker') loadLinkHistory();
  closeSidebar();
}

// ─── Load Media ───────────────────────────────────────────────────────────────
async function loadMedia() {
  try {
    const { data, error } = await db
      .from('media')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    allMedia = data || [];
    renderMediaGrid(allMedia);
    renderOverviewStats(allMedia);
    renderRecentActivity(allMedia);
  } catch (err) {
    showToast('Error loading media: ' + err.message, 'error');
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function renderOverviewStats(media) {
  const total = media.length;
  const safe = media.filter(m => m.status === 'safe').length;
  const flagged = media.filter(m => m.status === 'flagged').length;
  const rate = total > 0 ? Math.round((safe / total) * 100) : 100;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-safe').textContent = safe;
  document.getElementById('stat-flagged').textContent = flagged;
  document.getElementById('stat-rate').textContent = rate + '%';
}

// ─── Recent Activity ──────────────────────────────────────────────────────────
function renderRecentActivity(media) {
  const container = document.getElementById('recent-activity-list');
  const recent = media.slice(0, 6);
  if (recent.length === 0) {
    container.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="m10 8 6 4-6 4V8z"/></svg><p>No assets yet. Upload your first asset!</p></div>`;
    return;
  }
  container.innerHTML = recent.map(m => `
    <div class="activity-item">
      <div class="activity-dot ${m.status}"></div>
      <div class="activity-info">
        <div class="activity-title">${escHtml(m.title)}</div>
        <div class="activity-sub">${formatDate(m.created_at)} · ${m.status.toUpperCase()}</div>
      </div>
      <span class="badge ${m.status}">${m.status}</span>
    </div>`).join('');
}

// ─── Media Grid ───────────────────────────────────────────────────────────────
function renderMediaGrid(media) {
  const grid = document.getElementById('media-grid');
  if (media.length === 0) {
    grid.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><p>No assets found.</p></div>`;
    return;
  }
  grid.innerHTML = media.map(m => `
    <div class="media-card" id="card-${m.id}">
      <div class="media-thumb">
        ${getMediaIcon(m.media_url)}
        <div class="media-badge"><span class="badge ${m.status}">${m.status}</span></div>
      </div>
      <div class="media-info">
        <div class="media-title" title="${escHtml(m.title)}">${escHtml(m.title)}</div>
        <div class="media-url" title="${escHtml(m.media_url)}">${escHtml(m.media_url)}</div>
        <div class="media-footer">
          <span class="media-date">${formatDate(m.created_at)}</span>
          ${m.status === 'flagged'
            ? '<span class="already-flagged">⚑ Already Flagged</span>'
            : `<button class="flag-btn" onclick="openFlagModal('${m.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>Flag</button>`
          }
        </div>
      </div>
    </div>`).join('');
}

// ─── Filter ───────────────────────────────────────────────────────────────────
function filterMedia() {
  const query = document.getElementById('media-search').value.toLowerCase();
  const filter = document.getElementById('media-filter').value;
  const filtered = allMedia.filter(m => {
    const matchText = m.title.toLowerCase().includes(query) || m.media_url.toLowerCase().includes(query);
    const matchStatus = filter === 'all' || m.status === filter;
    return matchText && matchStatus;
  });
  renderMediaGrid(filtered);
}

// ─── Upload ───────────────────────────────────────────────────────────────────
async function handleUpload(e) {
  e.preventDefault();
  const title = document.getElementById('upload-title').value.trim();
  const media_url = document.getElementById('upload-url').value.trim();
  const description = document.getElementById('upload-desc').value.trim();
  const btn = document.getElementById('upload-btn');
  const errEl = document.getElementById('upload-error');
  const sucEl = document.getElementById('upload-success');

  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');
  setLoading(btn, true);

  try {
    const { error } = await db.from('media').insert([{
      user_id: currentUser.id,
      media_url,
      title: title || 'Untitled Asset',
      description,
      status: 'safe'
    }]);

    if (error) throw error;

    sucEl.textContent = '✓ Asset uploaded successfully!';
    sucEl.classList.remove('hidden');
    document.getElementById('upload-form').reset();
    showToast('Asset uploaded!', 'success');
    await loadMedia();
    setTimeout(() => sucEl.classList.add('hidden'), 3000);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    setLoading(btn, false);
  }
}

// ─── Flag Modal ───────────────────────────────────────────────────────────────
function openFlagModal(mediaId) {
  flagTargetMediaId = mediaId;
  document.getElementById('flag-reason').value = '';
  document.getElementById('flag-error').classList.add('hidden');
  document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('flag-modal').classList.add('open');
}

function closeFlagModal(e) {
  if (!e || e.target === document.getElementById('flag-modal')) {
    document.getElementById('flag-modal').classList.remove('open');
    flagTargetMediaId = null;
  }
}

function selectPreset(chip, text) {
  document.getElementById('flag-reason').value = text;
  document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
}

async function submitFlag() {
  const reason = document.getElementById('flag-reason').value.trim();
  const errEl = document.getElementById('flag-error');
  const btn = document.getElementById('flag-submit-btn');

  if (!reason) {
    errEl.textContent = 'Please provide a reason.';
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');
  setLoading(btn, true);

  try {
    // Insert flag record
    const { error: flagErr } = await db.from('flags').insert([{
      media_id: flagTargetMediaId,
      flagged_by: currentUser.id,
      reason
    }]);
    if (flagErr) throw flagErr;

    // Update media status
    const { error: updateErr } = await db
      .from('media')
      .update({ status: 'flagged' })
      .eq('id', flagTargetMediaId);
    if (updateErr) throw updateErr;

    document.getElementById('flag-modal').classList.remove('open');
    flagTargetMediaId = null;
    showToast('Content flagged for review.', 'success');
    await loadMedia();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    setLoading(btn, false);
  }
}

// ─── Admin ────────────────────────────────────────────────────────────────────
async function loadAdminData() {
  document.getElementById('admin-media-list').innerHTML = '<div class="empty-state">Loading…</div>';
  document.getElementById('admin-flags-list').innerHTML = '<div class="empty-state">Loading…</div>';

  try {
    const { data: mediaData, error: mErr } = await db
      .from('media')
      .select('*')
      .order('created_at', { ascending: false });
    if (mErr) throw mErr;

    const { data: flagsData, error: fErr } = await db
      .from('flags')
      .select('*, media:media_id(title, media_url)')
      .order('flagged_at', { ascending: false });
    if (fErr) throw fErr;

    const total = mediaData?.length || 0;
    const flagged = mediaData?.filter(m => m.status === 'flagged').length || 0;
    const safe = total - flagged;

    document.getElementById('admin-media').textContent = total;
    document.getElementById('admin-flags').textContent = flagsData?.length || 0;
    document.getElementById('admin-safe').textContent = safe;

    // Media table
    const mList = document.getElementById('admin-media-list');
    if (mediaData && mediaData.length > 0) {
      mList.innerHTML = `<table class="admin-table">
        <thead><tr><th>Title</th><th>URL</th><th>Status</th><th>Uploaded</th></tr></thead>
        <tbody>${mediaData.map(m => `
          <tr>
            <td>${escHtml(m.title)}</td>
            <td class="td-url"><a href="${escHtml(m.media_url)}" target="_blank">${escHtml(m.media_url)}</a></td>
            <td><span class="badge ${m.status}">${m.status}</span></td>
            <td>${formatDate(m.created_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    } else {
      mList.innerHTML = '<div class="empty-state"><p>No media assets yet.</p></div>';
    }

    // Flags table
    const fList = document.getElementById('admin-flags-list');
    if (flagsData && flagsData.length > 0) {
      fList.innerHTML = `<table class="admin-table">
        <thead><tr><th>Asset</th><th>Reason</th><th>Date</th></tr></thead>
        <tbody>${flagsData.map(f => `
          <tr>
            <td>${f.media ? escHtml(f.media.title) : '—'}</td>
            <td>${escHtml(f.reason)}</td>
            <td>${formatDate(f.flagged_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    } else {
      fList.innerHTML = '<div class="empty-state"><p>No flags reported yet.</p></div>';
    }
  } catch (err) {
    showToast('Admin data error: ' + err.message, 'error');
  }
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function toggleTheme() {
  isDark = !isDark;
  applyTheme();
  localStorage.setItem('daps_theme', isDark ? 'dark' : 'light');
}

function applyTheme() {
  const body = document.getElementById('app-body');
  body.classList.toggle('dark', isDark);
  const moon = document.getElementById('theme-icon-moon');
  const sun = document.getElementById('theme-icon-sun');
  const label = document.getElementById('theme-label');
  if (moon) moon.style.display = isDark ? 'block' : 'none';
  if (sun) sun.style.display = isDark ? 'none' : 'block';
  if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); }

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const icons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
  };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${icons[type]}<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(30px)'; toast.style.transition = '.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setLoading(btn, loading) {
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  if (text) text.style.display = loading ? 'none' : '';
  if (loader) loader.classList.toggle('hidden', !loading);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function clearErrors() {
  document.querySelectorAll('.form-error').forEach(e => e.classList.add('hidden'));
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

function getMediaIcon(url) {
  const u = (url || '').toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/.test(u)) {
    return `<img src="${escHtml(url)}" alt="preview" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'" />`;
  }
  if (/\.(mp4|webm|mov|avi)(\?|$)/.test(u)) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="m10 8 6 4-6 4V8z"/></svg>`;
  }
  if (/\.(mp3|wav|ogg|m4a)(\?|$)/.test(u)) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
}

// ─── Profile ──────────────────────────────────────────────────────────────────
let currentAvatarColor = '#6366f1';

async function loadProfile() {
  try {
    // Upsert profile row if doesn't exist
    const { data: profile } = await db
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    const name = profile?.full_name || currentUser.user_metadata?.full_name || '';
    const mobile = profile?.mobile || '';
    const bio = profile?.bio || '';
    const color = profile?.avatar_color || '#6366f1';
    currentAvatarColor = color;

    // Populate form fields
    document.getElementById('pf-name').value = name;
    document.getElementById('pf-mobile').value = mobile;
    document.getElementById('pf-email').value = currentUser.email;
    document.getElementById('pf-bio').value = bio;

    // Update avatar card
    const initial = (name || currentUser.email).charAt(0).toUpperCase();
    document.getElementById('profile-avatar-lg').textContent = initial;
    document.getElementById('profile-avatar-lg').style.background = `linear-gradient(135deg, ${color}, ${shiftColor(color)})`;
    document.getElementById('profile-avatar-ring').style.background = `conic-gradient(${color}, ${shiftColor(color)}, ${color})`;
    document.getElementById('profile-display-name').textContent = name || currentUser.email.split('@')[0];
    document.getElementById('profile-display-email').textContent = currentUser.email;

    // Asset badges
    const safe = allMedia.filter(m => m.status === 'safe').length;
    const flagged = allMedia.filter(m => m.status === 'flagged').length;
    document.getElementById('profile-assets-badge').textContent = allMedia.length + ' Assets';
    document.getElementById('profile-flagged-badge').textContent = flagged + ' Flagged';

    // Sync swatch selection
    document.querySelectorAll('.swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === color);
    });
  } catch (err) {
    console.error('Profile load error:', err);
  }
}

async function saveProfileInfo(e) {
  e.preventDefault();
  const name = document.getElementById('pf-name').value.trim();
  const mobile = document.getElementById('pf-mobile').value.trim();
  const bio = document.getElementById('pf-bio').value.trim();
  const btn = document.getElementById('profile-info-btn');
  const errEl = document.getElementById('profile-info-error');
  const sucEl = document.getElementById('profile-info-success');

  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');
  setLoading(btn, true);

  try {
    // Upsert profile in DB
    const { error } = await db.from('profiles').upsert({
      id: currentUser.id,
      full_name: name,
      mobile,
      bio,
      avatar_color: currentAvatarColor,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) throw error;

    // Update Supabase auth metadata
    await db.auth.updateUser({ data: { full_name: name } });

    // Refresh topbar
    if (name) {
      document.getElementById('topbar-username').textContent = name;
      document.getElementById('user-avatar-display').textContent = name.charAt(0).toUpperCase();
      document.getElementById('user-avatar-display').style.background = `linear-gradient(135deg, ${currentAvatarColor}, ${shiftColor(currentAvatarColor)})`;
    }

    // Refresh avatar card
    const initial = (name || currentUser.email).charAt(0).toUpperCase();
    document.getElementById('profile-avatar-lg').textContent = initial;
    document.getElementById('profile-display-name').textContent = name || currentUser.email.split('@')[0];

    sucEl.textContent = '✓ Profile updated successfully!';
    sucEl.classList.remove('hidden');
    showToast('Profile saved!', 'success');
    setTimeout(() => sucEl.classList.add('hidden'), 3000);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    setLoading(btn, false);
  }
}

async function saveNewPassword(e) {
  e.preventDefault();
  const newPw = document.getElementById('pf-new-pw').value;
  const confirmPw = document.getElementById('pf-confirm-pw').value;
  const btn = document.getElementById('profile-pw-btn');
  const errEl = document.getElementById('profile-pw-error');
  const sucEl = document.getElementById('profile-pw-success');

  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');

  if (newPw.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    errEl.classList.remove('hidden');
    return;
  }
  if (newPw !== confirmPw) {
    errEl.textContent = 'Passwords do not match.';
    errEl.classList.remove('hidden');
    return;
  }

  setLoading(btn, true);
  try {
    const { error } = await db.auth.updateUser({ password: newPw });
    if (error) throw error;

    sucEl.textContent = '✓ Password updated successfully!';
    sucEl.classList.remove('hidden');
    document.getElementById('profile-pw-form').reset();
    showToast('Password updated!', 'success');
    setTimeout(() => sucEl.classList.add('hidden'), 3000);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    setLoading(btn, false);
  }
}

function selectAvatarColor(btn, color) {
  currentAvatarColor = color;
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');

  // Live preview
  document.getElementById('profile-avatar-lg').style.background = `linear-gradient(135deg, ${color}, ${shiftColor(color)})`;
  document.getElementById('profile-avatar-ring').style.background = `conic-gradient(${color}, ${shiftColor(color)}, ${color})`;
}

function shiftColor(hex) {
  const map = {
    '#6366f1': '#a855f7', '#a855f7': '#ec4899', '#ec4899': '#f43f5e',
    '#ef4444': '#f97316', '#f59e0b': '#eab308', '#22c55e': '#14b8a6',
    '#3b82f6': '#6366f1', '#14b8a6': '#22c55e'
  };
  return map[hex] || '#a855f7';
}

// ─── Link Safety Checker (fully frontend — no backend needed) ─────────────────

/**
 * Pure client-side URL security analyzer.
 * Returns { status, score, risk_level, reason, recommendation }
 */
function analyzeUrlClient(rawUrl) {
  let parsed;
  const flags = [];
  let deductions = 0;

  // 1. Basic URL parse
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      status: 'Harmful', score: 0, risk_level: 'High',
      reason: 'The URL is malformed and cannot be parsed as a valid web address.',
      recommendation: 'Avoid'
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. HTTPS check
  if (parsed.protocol !== 'https:') {
    flags.push('Does not use HTTPS (insecure connection)');
    deductions += 25;
  }

  // 3. Double-slashes in path
  if (parsed.pathname.includes('//')) {
    flags.push('Contains double slashes in path — common in redirect attacks');
    deductions += 20;
  }

  // 4. @ symbol (credential embedding)
  if (rawUrl.includes('@')) {
    flags.push('Contains @ symbol — may be hiding the real destination');
    deductions += 30;
  }

  // 5. Excessively long URL
  if (rawUrl.length > 200) {
    flags.push(`Unusually long URL (${rawUrl.length} chars) — common in phishing links`);
    deductions += 15;
  }

  // 6. IP address as hostname
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    flags.push('Uses a raw IP address instead of a domain name');
    deductions += 25;
  }

  // 7. Excessive subdomains
  const domainParts = hostname.split('.').filter(Boolean);
  if (domainParts.length > 4) {
    flags.push('Excessive subdomain depth — may disguise the real domain');
    deductions += 15;
  }

  // 8. Suspicious TLDs
  const badTlds = ['.tk','.ml','.ga','.cf','.gq','.xyz','.top','.click','.link','.work','.loan'];
  if (badTlds.some(t => hostname.endsWith(t))) {
    flags.push('Uses a high-risk free TLD commonly associated with phishing');
    deductions += 20;
  }

  // 9. Phishing keywords
  const keywords = ['login','signin','verify','secure','account','update','confirm','banking','paypal','apple','amazon','microsoft','google','facebook'];
  const pathHost = (hostname + parsed.pathname).toLowerCase();
  const found = keywords.filter(k => pathHost.includes(k));
  if (found.length > 0) {
    flags.push(`Contains suspicious keywords: "${found.join('", "')}"`);
    deductions += Math.min(found.length * 10, 25);
  }

  // 10. Punycode domain
  if (hostname.startsWith('xn--')) {
    flags.push('Uses a Punycode domain — check for lookalike characters');
    deductions += 20;
  }

  // 11. Excessive query params
  const paramCount = [...parsed.searchParams].length;
  if (paramCount > 6) {
    flags.push(`Contains ${paramCount} query parameters — unusually high`);
    deductions += 10;
  }

  // 12. URL shorteners
  const shorteners = ['bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','short.link','is.gd','cli.gs','tiny.cc'];
  if (shorteners.includes(hostname)) {
    flags.push('Uses a URL shortener — the real destination is hidden');
    deductions += 15;
  }

  const score = Math.max(0, 100 - deductions);
  let status, risk_level, recommendation;
  if (score >= 75)      { status = 'Safe';       risk_level = 'Low';    recommendation = 'Safe to use'; }
  else if (score >= 45) { status = 'Suspicious'; risk_level = 'Medium'; recommendation = 'Be careful'; }
  else                  { status = 'Harmful';    risk_level = 'High';   recommendation = 'Avoid'; }

  const reason = flags.length > 0
    ? flags.join('. ') + '.'
    : 'No suspicious patterns detected. The URL appears legitimate.';

  return { status, score, risk_level, reason, recommendation };
}

/**
 * Handles form submission: analyzes URL in the browser,
 * saves to Supabase directly (no backend fetch needed).
 */
async function handleLinkCheck(e) {
  e.preventDefault();
  const urlInput = document.getElementById('lsc-url-input');
  const errEl    = document.getElementById('lsc-error');
  const loading  = document.getElementById('lsc-loading');
  const resultEl = document.getElementById('lsc-result');
  const btn      = document.getElementById('lsc-submit-btn');

  const url = urlInput.value.trim();
  errEl.classList.add('hidden');
  resultEl.classList.add('hidden');

  if (!url) {
    errEl.textContent = 'Please enter a URL to check.';
    errEl.classList.remove('hidden');
    return;
  }

  setLoading(btn, true);
  loading.classList.remove('hidden');

  try {
    // Run analysis entirely in the browser — no fetch needed
    const result = analyzeUrlClient(url);

    // Save to Supabase directly (same pattern as handleUpload)
    if (currentUser) {
      const { error: dbErr } = await db.from('link_checks').insert([{
        user_id:        currentUser.id,
        url:            url,
        status:         result.status,
        score:          result.score,
        risk_level:     result.risk_level,
        reason:         result.reason,
        recommendation: result.recommendation
      }]);
      if (dbErr) console.warn('History save skipped:', dbErr.message);
    }

    renderLinkResult({ url, ...result });
    prependToHistory({ url, ...result }, url);
    showToast('Link analyzed successfully!', 'success');
  } catch (err) {
    errEl.textContent = '⚠ ' + (err.message || 'Analysis failed. Please try again.');
    errEl.classList.remove('hidden');
    showToast('Analysis failed.', 'error');
  } finally {
    setLoading(btn, false);
    loading.classList.add('hidden');
  }
}

/**
 * Renders the analysis result card.
 */
function renderLinkResult(data) {
  const statusKey = (data.status || '').toLowerCase();
  const riskKey   = (data.risk_level || '').toLowerCase();

  let scoreColor;
  if (data.score >= 75)      scoreColor = '#22c55e';
  else if (data.score >= 45) scoreColor = '#f59e0b';
  else                        scoreColor = '#ef4444';

  const badge = document.getElementById('lsc-status-badge');
  badge.textContent = data.status;
  badge.className   = 'lsc-badge ' + statusKey;

  const riskBadge = document.getElementById('lsc-risk-badge');
  riskBadge.textContent = data.risk_level + ' Risk';
  riskBadge.className   = 'lsc-risk-badge ' + riskKey;

  document.getElementById('lsc-result-url').textContent = data.url;
  document.getElementById('lsc-score-value').textContent = data.score;
  document.getElementById('lsc-score-value').style.color = scoreColor;
  document.getElementById('lsc-reason').textContent = data.reason;
  document.getElementById('lsc-recommendation').textContent = data.recommendation;
  document.getElementById('lsc-recommendation').style.color = scoreColor;

  const bar = document.getElementById('lsc-progress-bar');
  bar.style.width = '0%';
  bar.style.background = scoreColor;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.width = data.score + '%';
  }));

  document.getElementById('lsc-result').classList.remove('hidden');
}

/**
 * Loads history directly from Supabase — no backend needed.
 */
async function loadLinkHistory() {
  const wrap = document.getElementById('lsc-history-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-state"><div class="lsc-spinner" style="margin:0 auto"></div></div>';

  if (!currentUser) {
    wrap.innerHTML = '<div class="empty-state"><p>Sign in to view your history.</p></div>';
    return;
  }

  try {
    const { data, error } = await db
      .from('link_checks')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('checked_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    renderHistoryTable(data || []);
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state"><p style="color:var(--red)">${escHtml(err.message)}</p></div>`;
  }
}

/**
 * Renders the history table rows.
 */
function renderHistoryTable(rows) {
  const wrap = document.getElementById('lsc-history-wrap');
  if (!rows || rows.length === 0) {
    wrap.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      <p>No links checked yet. Paste a URL above to get started!</p>
    </div>`;
    return;
  }

  const rows_html = rows.map(r => {
    const sk = (r.status || '').toLowerCase();
    let scoreColor;
    if (r.score >= 75)      scoreColor = '#22c55e';
    else if (r.score >= 45) scoreColor = '#f59e0b';
    else                     scoreColor = '#ef4444';
    return `<tr>
      <td class="lsc-hist-url" title="${escHtml(r.url)}">${escHtml(r.url)}</td>
      <td><span class="lsc-badge ${sk}">${escHtml(r.status)}</span></td>
      <td><span style="font-weight:800;color:${scoreColor}">${r.score}</span><span style="color:var(--text2);font-size:.78rem">/100</span></td>
      <td class="lsc-hist-date">${formatDate(r.checked_at)}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="lsc-history-table">
    <thead><tr><th>URL</th><th>Status</th><th>Score</th><th>Checked</th></tr></thead>
    <tbody>${rows_html}</tbody>
  </table>`;
}

/**
 * Prepends a just-checked row to the history table instantly.
 */
function prependToHistory(data, url) {
  const tbody = document.querySelector('.lsc-history-table tbody');
  if (!tbody) { loadLinkHistory(); return; }

  const sk = (data.status || '').toLowerCase();
  let scoreColor;
  if (data.score >= 75)      scoreColor = '#22c55e';
  else if (data.score >= 45) scoreColor = '#f59e0b';
  else                        scoreColor = '#ef4444';

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="lsc-hist-url" title="${escHtml(url)}">${escHtml(url)}</td>
    <td><span class="lsc-badge ${sk}">${escHtml(data.status)}</span></td>
    <td><span style="font-weight:800;color:${scoreColor}">${data.score}</span><span style="color:var(--text2);font-size:.78rem">/100</span></td>
    <td class="lsc-hist-date">Just now</td>
  `;
  tbody.insertBefore(tr, tbody.firstChild);
}

