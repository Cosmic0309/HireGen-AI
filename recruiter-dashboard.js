/* Recruiter dashboard interactions with the live Flask API. */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// Live Server/other static servers return HTML for unknown API paths. Always
// target Flask unless this page is already being served by Flask on port 5000.
const API_BASE = window.location.port === '5000' ? window.location.origin : 'http://127.0.0.1:5000';
const authHeaders = (extra = {}) => ({ Authorization: `Bearer ${localStorage.getItem('hiregen_token') || ''}`, ...extra });

// A restarted server or expired JWT should never leave the dashboard in a
// broken state. Clear stale session data and return the user to sign in.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  if (response.status === 401) {
    ['hiregen_token', 'hiregen_role', 'hiregen_user_id', 'hiregen_fullname'].forEach(key => localStorage.removeItem(key));
    if (!window.location.pathname.endsWith('/login.html')) window.location.href = 'login.html';
  }
  return response;
};

// --- AUTH GUARD ---
// This dashboard is recruiter-only and requires a valid login session.
(function guardRecruiterDashboard() {
  const token = localStorage.getItem('hiregen_token');
  const role = localStorage.getItem('hiregen_role');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }
  if (role && role !== 'recruiter') {
    window.location.href = 'candidate-dashboard.html';
  }
})();

const RecruiterAPI = {
  getProfile: () => fetch(`${API_BASE}/user/profile`, { headers: authHeaders() }),
  getJobs: () => fetch(`${API_BASE}/recruiter/jobs`, { headers: authHeaders() }),
  getApplicants: () => fetch(`${API_BASE}/recruiter/applicants`, { headers: authHeaders() }),
  createJob: payload => fetch(`${API_BASE}/jobs`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) }),
  updateApplicationStatus: (applicationId, status) => fetch(`${API_BASE}/application/${applicationId}/status`, { method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ status }) }),
  inviteToInterview: applicationId => fetch(`${API_BASE}/application/${applicationId}/interview/invite`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: '{}' })
};

function setRecruiterIdentity(name) {
  const safeName = (name || '').trim();
  const displayName = safeName || 'Recruiter';
  const heroName = $('#recruiterName') || $('.hero h1 span');
  if (heroName) heroName.textContent = `${displayName}.`;
  const profile = $('#profileToggle');
  if (profile) profile.textContent = displayName.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || 'R';
}

async function loadRecruiterProfile() {
  setRecruiterIdentity(localStorage.getItem('hiregen_fullname'));
  try {
    const response = await RecruiterAPI.getProfile();
    const result = await response.json();
    if (response.ok && result.profile?.fullname) {
      localStorage.setItem('hiregen_fullname', result.profile.fullname);
      setRecruiterIdentity(result.profile.fullname);
    }
  } catch (_) { /* API errors are shown by the data panels; identity stays safe. */ }
}

function logout() {
  localStorage.removeItem('hiregen_token');
  localStorage.removeItem('hiregen_role');
  localStorage.removeItem('hiregen_user_id');
  localStorage.removeItem('hiregen_fullname');
  window.location.href = 'login.html';
}

function escapeHtml(str) { return String(str ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
function initialsOf(name) { return (name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'; }
function formatShortDate(iso) { try { return new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric' }).format(new Date(iso.replace(' ', 'T'))); } catch (_) { return ''; } }

const STATUS_TO_COLUMN = { applied: 'applied', screened: 'screened', shortlisted: 'shortlisted', interview: 'interview', offer: 'offer', hired: 'hired', rejected: null };

let currentApplicants = [];

async function loadApplicants() {
  const grid = $('#candidateGrid');
  try {
    const response = await RecruiterAPI.getApplicants();
    const result = await response.json();
    currentApplicants = (result.applicants || []).filter(a => a.status !== 'rejected');

    if (!currentApplicants.length) {
      grid.innerHTML = '<p class="empty-state">No applicants yet. Once candidates apply to your job posts, they’ll show up here.</p>';
    } else {
      grid.innerHTML = currentApplicants.slice(0, 6).map((a, i) => `
        <article class="candidate${i === 0 ? ' featured' : ''}" data-application-id="${a.application_id}">
          <div class="candidate-top"><span class="avatar">${escapeHtml(initialsOf(a.fullname))}</span></div>
          <h3>${escapeHtml(a.fullname)}</h3>
          <p>${escapeHtml(a.job_title)}${a.experience_level ? ' · ' + escapeHtml(a.experience_level) : ''}</p>
          ${a.ats_score != null ? `<div class="scoreline"><span>ATS score <b>${a.ats_score}</b></span><i><em style="width:${a.ats_score}%"></em></i></div>` : ''}
          <div class="chips">${(a.extracted_skills || '').split(',').filter(Boolean).slice(0, 3).map(s => `<span>${escapeHtml(s.trim())}</span>`).join('')}</div>
          ${a.interview_status === 'completed' ? `<p class="interview-result">Interview completed · <b>${a.interview_score}%</b></p>` : ''}
          <footer><button class="shortlist" data-action="invite-interview" data-application-id="${a.application_id}">${a.interview_status === 'invited' ? 'Resend invite' : 'Take interview'}</button><button class="reject" data-action="reject" data-application-id="${a.application_id}">×</button></footer>
        </article>`).join('');
    }

    renderKanban(currentApplicants);
    renderRanking(currentApplicants);
    renderInterviews(currentApplicants);
    typeInsight();
    $$('[data-action="invite-interview"], [data-action="reject"]', grid).forEach(btn => btn.onclick = () => runAction(btn.dataset.action, btn));
  } catch (err) {
    grid.innerHTML = '<p class="empty-state">Couldn’t load applicants. Is the HireGen server running?</p>';
  }
}

function renderInterviews(applicants) {
  const list = $('.interview-list');
  if (!list) return;
  const scheduled = applicants.filter(a => ['interview', 'offer', 'hired'].includes(a.status)).slice(0, 3);
  const count = $('.interview-count b');
  if (count) count.textContent = String(scheduled.length).padStart(2, '0');
  if (!scheduled.length) {
    list.innerHTML = '<p class="empty-state">No interviews scheduled from your applicants.</p>';
    return;
  }
  list.innerHTML = scheduled.map((a, i) => {
    const initials = escapeHtml(initialsOf(a.fullname));
    return `<div><time>${['10:00','12:30','03:00'][i]}<small>${i === 2 ? 'PM' : 'AM'}</small></time><span class="avatar">${initials}</span><p><b>${escapeHtml(a.fullname)}</b><small>${escapeHtml(a.job_title || 'Application')}</small></p><span class="status active-status">${escapeHtml(a.status)}</span><button data-action="questions">Questions</button></div>`;
  }).join('');
  $$('[data-action="questions"]', list).forEach(button => button.onclick = () => runAction('questions', button));
}

function removeDemoIdentityContent() {
  const hero = $('.hero h1 span');
  if (hero && !hero.id) hero.id = 'recruiterName';
  const interviewList = $('.interview-list');
  if (interviewList) interviewList.innerHTML = '<p class="empty-state">Loading registered applicants…</p>';
  const suggestions = $('.suggestion-list');
  if (suggestions) suggestions.querySelectorAll('div').forEach(item => {
    if (/Nisha|Rohan|Ananya|Leena/i.test(item.textContent)) item.remove();
  });
  $$('.timeline > div').forEach(item => {
    if (/Nisha|Rohan|Ananya|Leena/i.test(item.textContent)) item.remove();
  });
  const chatMessage = $('.chat-body p');
  if (chatMessage && /Arjun|Nisha/i.test(chatMessage.textContent)) chatMessage.textContent = 'Ask about your registered applicants, job posts, or hiring pipeline.';
}

function renderKanban(applicants) {
  $$('.kanban-col').forEach(col => {
    const status = col.dataset.status;
    const matches = applicants.filter(a => a.status === status);
    const badge = $('[data-count-badge]', col);
    if (badge) badge.textContent = String(matches.length);
    $$('article', col).forEach(el => el.remove());
    matches.forEach(a => {
      const card = document.createElement('article');
      card.draggable = true;
      card.dataset.applicationId = a.application_id;
      card.innerHTML = `<span class="avatar">${escapeHtml(initialsOf(a.fullname))}</span><b>${escapeHtml(a.fullname)}</b><small>${escapeHtml(a.job_title)}${a.ats_score != null ? ' · ' + a.ats_score + '%' : ''}</small>`;
      col.appendChild(card);
    });
  });
  setupKanban();
}

function renderRanking(applicants) {
  const list = $('#rankingList');
  if (!list) return;
  const ranked = [...applicants].filter(a => a.ats_score != null).sort((a, b) => b.ats_score - a.ats_score).slice(0, 4);
  if (!ranked.length) { list.innerHTML = '<li><div><b>No scored applicants yet</b></div></li>'; return; }
  list.innerHTML = ranked.map((a, i) => `<li><span>${String(i + 1).padStart(2, '0')}</span><div><b>${escapeHtml(a.fullname)}</b><small>${escapeHtml(a.job_title)}</small></div><strong>${a.ats_score}</strong></li>`).join('');
}

async function loadJobs() {
  const body = $('#jobsTableBody');
  try {
    const response = await RecruiterAPI.getJobs();
    const result = await response.json();
    const jobs = result.jobs || [];
    if (!jobs.length) { body.innerHTML = '<tr><td colspan="5">You haven’t posted any jobs yet.</td></tr>'; return; }
    body.innerHTML = jobs.map(j => `
      <tr>
        <td><b>${escapeHtml(j.title)}</b><small>${escapeHtml(j.department || '')}${j.department ? ' · ' : ''}Posted ${formatShortDate(j.created_at)}</small></td>
        <td>${escapeHtml(j.location || '—')}</td>
        <td><strong>${j.applicant_count}</strong></td>
        <td><span class="status ${j.status === 'active' ? 'active-status' : 'review-status'}">${escapeHtml(j.status)}</span></td>
        <td><button class="row-action">•••</button></td>
      </tr>`).join('');
  } catch (err) {
    body.innerHTML = '<tr><td colspan="5">Couldn’t load your job posts.</td></tr>';
  }
}

function openJobModal() {
  if ($('#jobModalOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'jobModalOverlay';
  overlay.style = 'position:fixed;inset:0;background:rgba(8,10,20,.6);display:flex;align-items:center;justify-content:center;z-index:999;';
  overlay.innerHTML = `
    <form id="jobModalForm" style="background:#12162a;color:#fff;padding:28px;border-radius:16px;width:min(440px,92vw);display:flex;flex-direction:column;gap:12px;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <h3 style="margin:0 0 4px">Post a new job</h3>
      <input name="title" placeholder="Job title *" required style="padding:10px 12px;border-radius:8px;border:1px solid #333a5c;background:#1b2140;color:#fff">
      <input name="department" placeholder="Department" style="padding:10px 12px;border-radius:8px;border:1px solid #333a5c;background:#1b2140;color:#fff">
      <input name="location" placeholder="Location (e.g. Bengaluru · Hybrid)" style="padding:10px 12px;border-radius:8px;border:1px solid #333a5c;background:#1b2140;color:#fff">
      <input name="job_type" placeholder="Job type (e.g. Full-time)" style="padding:10px 12px;border-radius:8px;border:1px solid #333a5c;background:#1b2140;color:#fff">
      <input name="salary_range" placeholder="Salary range (e.g. ₹18–24L)" style="padding:10px 12px;border-radius:8px;border:1px solid #333a5c;background:#1b2140;color:#fff">
      <input name="experience_required" placeholder="Experience (e.g. 3–5 yrs)" style="padding:10px 12px;border-radius:8px;border:1px solid #333a5c;background:#1b2140;color:#fff">
      <textarea name="description" placeholder="Description" rows="3" style="padding:10px 12px;border-radius:8px;border:1px solid #333a5c;background:#1b2140;color:#fff;resize:vertical"></textarea>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
        <button type="button" id="jobModalCancel" style="padding:10px 16px;border-radius:8px;border:1px solid #333a5c;background:transparent;color:#fff;cursor:pointer">Cancel</button>
        <button type="submit" style="padding:10px 16px;border-radius:8px;border:none;background:#4f7cff;color:#fff;cursor:pointer">Publish job</button>
      </div>
    </form>`;
  document.body.appendChild(overlay);
  $('#jobModalCancel').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  $('#jobModalForm').onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    if (!data.title.trim()) return;
    const submitButton = $('button[type="submit"]', e.target);
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Publishing…'; }
    try {
      const response = await RecruiterAPI.createJob(data);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error(`API unavailable (HTTP ${response.status}). Start Flask on port 5000.`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Could not post job');
      toast('Job published!');
      overlay.remove();
      loadJobs();
    } catch (err) {
      toast(err.message || 'Could not post job right now. Check that you are logged in as a recruiter.');
      if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Publish job'; }
    }
  };
}

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2800); }
function animateCounters() { $$('[data-count]').forEach(el => { const end = Number(el.dataset.count), start = performance.now(), duration = 1150; const draw = now => { const p = Math.min((now - start) / duration, 1), eased = 1 - (1 - p) ** 3; el.textContent = Math.round(end * eased).toLocaleString('en-IN'); if (p < 1) requestAnimationFrame(draw); }; requestAnimationFrame(draw); }); }
function typeInsight() { const el = $('#typedInsight'); if (!el) return; const text = currentApplicants.length ? `You have ${currentApplicants.length} registered applicant${currentApplicants.length === 1 ? '' : 's'} across your job posts.` : 'Your applicant inbox is ready for candidates who apply to your job posts.'; let index = 0; const draw = () => { el.textContent = text.slice(0, ++index); if (index < text.length) setTimeout(draw, 13); }; setTimeout(draw, 350); }
function drawApplicationsChart() { const canvas = $('#applicationsChart'), ctx = canvas.getContext('2d'); const render = () => { const rect = canvas.getBoundingClientRect(), scale = devicePixelRatio || 1; canvas.width = rect.width * scale; canvas.height = rect.height * scale; ctx.scale(scale, scale); const w = rect.width, h = rect.height, values = [82, 116, 105, 158, 190, 248], max = 270, xStep = w / (values.length - 1), points = values.map((v, i) => [i * xStep, h - (v / max) * (h - 20) - 5]); ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(151,171,255,.11)'; ctx.lineWidth = 1; for (let y = 15; y < h; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); } const fill = ctx.createLinearGradient(0, 0, 0, h); fill.addColorStop(0, 'rgba(79,124,255,.33)'); fill.addColorStop(1, 'rgba(79,124,255,0)'); ctx.beginPath(); ctx.moveTo(points[0][0], h); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.lineTo(x, y)); ctx.lineTo(points.at(-1)[0], h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = '#62a0ff'; ctx.lineWidth = 2; ctx.stroke(); points.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = '#00e5ff'; ctx.fill(); }); }; render(); addEventListener('resize', render); }
function particleField() { const canvas = $('#particles'), ctx = canvas.getContext('2d'); let dots = []; const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; dots = Array.from({ length: Math.min(48, innerWidth / 28) }, () => ({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, s: Math.random() * 1.3 + .2, v: Math.random() * .14 + .03 })); }; const loop = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dots.forEach(d => { d.y -= d.v; if (d.y < 0) { d.y = canvas.height; d.x = Math.random() * canvas.width; } ctx.beginPath(); ctx.arc(d.x, d.y, d.s, 0, Math.PI * 2); ctx.fillStyle = 'rgba(112,154,255,.4)'; ctx.fill(); }); requestAnimationFrame(loop); }; resize(); addEventListener('resize', resize); loop(); }
function setupKanban() {
  let dragged;
  $$('.kanban-col article').forEach(card => {
    card.addEventListener('dragstart', () => { dragged = card; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  $$('.kanban-col').forEach(column => {
    column.addEventListener('dragover', e => { e.preventDefault(); column.classList.add('drag-over'); });
    column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
    column.addEventListener('drop', async e => {
      e.preventDefault();
      column.classList.remove('drag-over');
      if (!dragged) return;
      column.append(dragged);
      const newStatus = column.dataset.status;
      const applicationId = dragged.dataset.applicationId;
      try {
        const response = await RecruiterAPI.updateApplicationStatus(applicationId, newStatus);
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Could not update status');
        toast(`Candidate moved to ${column.querySelector('header').childNodes[0].textContent.trim()}.`);
        loadApplicants();
      } catch (err) {
        toast(err.message || 'Could not update candidate status.');
        loadApplicants();
      }
    });
  });
}

async function runAction(action, button) {
  if (action === 'create-job') { openJobModal(); return; }
  if (action === 'invite-interview') {
    const originalText = button.textContent;
    button.disabled = true; button.textContent = 'Sending…';
    try {
      const response = await RecruiterAPI.inviteToInterview(button.dataset.applicationId);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Could not send interview invitation');
      toast(result.message);
      loadApplicants();
    } catch (err) {
      toast(err.message || 'Could not send the n8n interview email.');
      button.disabled = false; button.textContent = originalText;
    }
    return;
  }
  if (action === 'shortlist' || action === 'reject') {
    const applicationId = button.dataset.applicationId;
    const newStatus = action === 'shortlist' ? 'shortlisted' : 'rejected';
    try {
      const response = await RecruiterAPI.updateApplicationStatus(applicationId, newStatus);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Could not update candidate');
      toast(action === 'shortlist' ? 'Candidate added to the shortlist.' : 'Candidate marked as not progressing.');
      loadApplicants();
    } catch (err) {
      toast(err.message || 'Could not update candidate right now.');
    }
    return;
  }
  const messages = { screen: 'AI resume screening has been queued.', resume: 'Opening the candidate resume preview…', 'start-interview': 'AI interview room is being prepared.', questions: 'Tailored interview questions are being generated.', invite: 'Interview invitation draft created.', suggestion: 'AI suggestion applied to the role.' };
  toast(messages[action] || 'Action completed.');
}

document.addEventListener('DOMContentLoaded', () => {
  removeDemoIdentityContent();
  $('#today').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  animateCounters(); particleField(); drawApplicationsChart();
  loadRecruiterProfile(); loadJobs(); loadApplicants();
  const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); }), { threshold: .08 }); $$('.reveal').forEach(el => observer.observe(el));
  addEventListener('mousemove', e => { $('.cursor-glow').style.left = `${e.clientX}px`; $('.cursor-glow').style.top = `${e.clientY}px`; });
  $('#menuToggle').onclick = () => $('#sidebar').classList.toggle('open');
  $$('nav a').forEach(link => link.onclick = () => { $$('.sidebar nav a').forEach(a => a.classList.remove('active')); link.classList.add('active'); $('#sidebar').classList.remove('open'); });
  $$('[data-scroll]').forEach(button => button.onclick = () => $(button.dataset.scroll).scrollIntoView({ behavior: 'smooth' }));
  const toggleChat = open => $('#chatWindow').classList.toggle('open', open ?? !$('#chatWindow').classList.contains('open'));
  $('#chatFab').onclick = () => toggleChat(); $$('[data-chat-open]').forEach(button => button.onclick = () => { toggleChat(true); $('#chatInput').focus(); }); $('#closeChat').onclick = () => toggleChat(false);
  $('#chatForm').onsubmit = event => { event.preventDefault(); const input = $('#chatInput'), value = input.value.trim(); if (!value) return; const safe = value.replace(/[<>&]/g, ''); $('.chat-body').insertAdjacentHTML('beforeend', `<p style="margin-top:9px">I’m preparing tailored hiring guidance for “${safe}”. Connect the Flask AI service here to return a live response.</p>`); input.value = ''; };
  $$('[data-action]').forEach(button => button.onclick = () => runAction(button.dataset.action, button));
  $('#themeToggle').onclick = () => { document.body.classList.toggle('light'); toast('Theme preference saved.'); };
  const logoutBtn = $('.logout'); if (logoutBtn) logoutBtn.onclick = logout;
});
