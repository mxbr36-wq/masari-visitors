import { connectionProblem, db } from './supabase.js';
import { AuthError, loadProfile, signIn, signOut } from './auth.js';
import { canLeaveLayout, leaveLayout, mountLayout } from './layout.js';
import { leaveParties, mountParties } from './parties.js';
import { leaveSeating, mountSeating } from './assign.js';

const $ = (id) => document.getElementById(id);
const ROLE_LABELS = { admin: 'مدير رئيسي', supervisor: 'مشرف' };
const ADMIN_NAV = [
  { icon: 'home', label: 'الرئيسية', view: 'home' },
  { icon: 'parties', label: 'إدارة الحفلات', view: 'parties' },
  { icon: 'layout', label: 'المخطط', view: 'layout' },
  { icon: 'bookings', label: 'الحجوزات' },
  { icon: 'supervisors', label: 'توزيع المشرفين' },
  { icon: 'reports', label: 'التقارير' },
  { icon: 'users', label: 'إدارة المستخدمين' },
  { icon: 'log', label: 'سجل التعديلات' },
];

const messageOf = (err) => (err instanceof AuthError ? err.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.');

function show(viewId) {
  ['boot', 'login-view', 'app-view'].forEach((id) => { $(id).hidden = id !== viewId; });
}

function setError(message) {
  $('login-error').textContent = message;
  $('login-error').hidden = !message;
}

function setLoading(isLoading) {
  $('login-btn').disabled = isLoading;
  $('login-spinner').hidden = !isLoading;
  $('login-btn-text').textContent = isLoading ? 'جارٍ تسجيل الدخول...' : 'تسجيل الدخول';
}

function showLogin(message = '') {
  setError(message);
  show('login-view');
}

let currentView = 'home';

// البنود المفعلة أزرار، وغير المفعلة نص عادي مع وسم "قريباً" وليست أزراراً.
function navItem({ icon, label, view }) {
  const svg = `<svg class="icon"><use href="#i-${icon}"/></svg>`;
  if (!view) return `<span class="nav-item is-disabled" aria-disabled="true">${svg}${label}<span class="nav-soon">قريباً</span></span>`;
  const on = view === currentView || (view === 'parties' && currentView === 'seating');
  return `<button class="nav-item${on ? ' is-active' : ''}" data-view="${view}"${on ? ' aria-current="page"' : ''}>${svg}${label}</button>`;
}

const VIEW_TITLES = { home: 'لوحة الإدارة', parties: 'إدارة الحفلات', seating: 'توزيع العائلات', layout: 'مخطط القاعة' };
async function setView(view, arg = null) {
  if (view === currentView || (currentView === 'layout' && !(await canLeaveLayout()))) return;
  leaveLayout();
  leaveParties();
  leaveSeating();
  currentView = view;
  $('nav').innerHTML = ADMIN_NAV.map(navItem).join('');
  $('page-title').textContent = VIEW_TITLES[view];
  $('app-view').classList.remove('sidebar-open');
  $('content').replaceChildren();
  if (view === 'layout') mountLayout($('content'), arg);
  else if (view === 'parties') mountParties($('content'), { openLayout: (id) => setView('layout', id), openSeating: (id) => setView('seating', id) });
  else if (view === 'seating') mountSeating($('content'), { partyId: arg, back: () => setView('parties'), openLayout: (id) => setView('layout', id) });
  else $('content').replaceChildren($('admin-tpl').content.cloneNode(true));
}

function showApp(profile) {
  const isAdmin = profile.role === 'admin';
  $('app-view').classList.remove('sidebar-open');
  $('app-view').classList.toggle('shell-supervisor', !isAdmin);
  $('sidebar').hidden = !isAdmin;
  $('menu-btn').hidden = !isAdmin;
  currentView = 'home';
  $('nav').innerHTML = isAdmin ? ADMIN_NAV.map(navItem).join('') : '';
  $('page-title').textContent = isAdmin ? 'لوحة الإدارة' : 'لوحة المشرف';
  $('user-name').textContent = profile.full_name;
  $('user-meta').textContent = `${ROLE_LABELS[profile.role]} · ${profile.username}`;
  $('content').replaceChildren($(isAdmin ? 'admin-tpl' : 'supervisor-tpl').content.cloneNode(true));
  show('app-view');
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!username || !password) return setError('أدخل اسم المستخدم وكلمة المرور.');

  setError('');
  setLoading(true);
  try {
    showApp(await signIn(username, password));
    $('password').value = '';
  } catch (err) {
    setError(messageOf(err));
  } finally {
    setLoading(false);
  }
});

$('logout-btn').addEventListener('click', async () => {
  if (currentView === 'layout' && !(await canLeaveLayout())) return;
  leaveLayout();
  leaveParties();
  leaveSeating();
  try { await signOut(); } finally { showLogin(); }
});
$('nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) setView(b.dataset.view);
});
$('menu-btn').addEventListener('click', () => $('app-view').classList.toggle('sidebar-open'));
$('scrim').addEventListener('click', () => $('app-view').classList.remove('sidebar-open'));

async function init() {
  if (connectionProblem) {
    $('login-btn').disabled = true;
    return showLogin(connectionProblem);
  }
  // إن انتهت الجلسة من مكان آخر نعود لشاشة الدخول.
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !$('app-view').hidden) { leaveLayout(); leaveParties(); leaveSeating(); showLogin(); }
  });
  try {
    const profile = await loadProfile();
    profile ? showApp(profile) : showLogin();
  } catch (err) {
    showLogin(messageOf(err));
  }
}

init();
