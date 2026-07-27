/* UI behavior and live API calls for HireGen AI candidate dashboard */
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const API_BASE = window.location.port === '5000' ? window.location.origin : 'http://127.0.0.1:5000';
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('hiregen_token') || ''}` });

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
// This dashboard is candidate-only and requires a valid login session.
(function guardCandidateDashboard() {
  const token = localStorage.getItem('hiregen_token');
  const role = localStorage.getItem('hiregen_role');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }
  if (role && role !== 'candidate') {
    // A recruiter account landed here — send them to the right dashboard instead.
    window.location.href = 'recruiter-dashboard.html';
  }
})();

const CandidateAPI = {
  getProfile: () => fetch(`${API_BASE}/user/profile`, { headers: authHeaders() }),
  getJobs: () => fetch(`${API_BASE}/jobs`),
  applyToJob: (jobId) => fetch(`${API_BASE}/jobs/${jobId}/apply`, { method: 'POST', headers: authHeaders() }),
  getApplications: () => fetch(`${API_BASE}/candidate/applications`, { headers: authHeaders() }),
  getAiReport: () => fetch(`${API_BASE}/candidate/ai-report`, { headers: authHeaders() }),
  startInterview: payload => fetch(`${API_BASE}/candidate/interview`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  completeInterview: payload => fetch(`${API_BASE}/candidate/interview/complete`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  assistant: message => fetch(`${API_BASE}/assistant`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) }),
  uploadResume: (formData) => fetch(`${API_BASE}/upload-resume`, { method: 'POST', headers: authHeaders(), body: formData }),
};

function logout() {
  localStorage.removeItem('hiregen_token');
  localStorage.removeItem('hiregen_role');
  localStorage.removeItem('hiregen_user_id');
  localStorage.removeItem('hiregen_fullname');
  window.location.href = 'login.html';
}

function escapeHtml(str) { return String(str ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
function initialLetter(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }
function formatShortDate(iso) { try { return new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric' }).format(new Date(iso.replace(' ', 'T'))); } catch (_) { return ''; } }

const STATUS_LABELS = {
  applied: { text: 'Applied', cls: 'applied' },
  screened: { text: 'AI screened', cls: 'review' },
  shortlisted: { text: 'Shortlisted', cls: 'interview-status' },
  interview: { text: 'Interview scheduled', cls: 'interview-status' },
  offer: { text: 'Offer extended', cls: 'interview-status' },
  hired: { text: 'Hired', cls: 'applied' },
  rejected: { text: 'Not selected', cls: 'review' }
};

let openJobIds = new Set();
let candidateApplications = [];

async function loadJobs() {
  const track = $('#roleTrack');
  try {
    const response = await CandidateAPI.getJobs();
    const result = await response.json();
    const jobs = (result.jobs || []);
    openJobIds = new Set(jobs.map(j => j.id));
    if (!jobs.length) { track.innerHTML = '<p class="empty-state">No open roles yet. Check back soon.</p>'; return; }

    let appliedIds = new Set();
    try {
      const appsRes = await CandidateAPI.getApplications();
      const appsResult = await appsRes.json();
      appliedIds = new Set((appsResult.applications || []).map(a => a.job_id));
    } catch (_) { /* not fatal for browsing jobs */ }

    track.innerHTML = jobs.map((job, i) => `
      <article class="role-card${i === 0 ? ' featured' : ''}" data-job-id="${job.id}">
        <div class="role-top"><span class="company-logo">${escapeHtml(initialLetter(job.company_name))}</span></div>
        <h3>${escapeHtml(job.title)}</h3>
        <p>${escapeHtml(job.company_name || '')}${job.location ? ' · ' + escapeHtml(job.location) : ''}</p>
        <div class="role-meta">${job.salary_range ? `<span>${escapeHtml(job.salary_range)}</span>` : ''}${job.experience_required ? `<span>${escapeHtml(job.experience_required)}</span>` : ''}</div>
        <button class="apply-btn" data-job-id="${job.id}" ${appliedIds.has(job.id) ? 'disabled' : ''}>${appliedIds.has(job.id) ? '✓ Applied' : 'Apply now'} <span>→</span></button>
      </article>`).join('');

    $$('.apply-btn', track).forEach(btn => btn.addEventListener('click', () => applyToJob(btn.dataset.jobId, btn)));
  } catch (err) {
    track.innerHTML = '<p class="empty-state">Couldn’t load open roles. Is the HireGen server running?</p>';
  }
}

async function applyToJob(jobId, button) {
  if (button) { button.disabled = true; button.textContent = 'Applying…'; }
  try {
    const response = await CandidateAPI.applyToJob(jobId);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Could not apply');
    toast('Application submitted!');
    if (button) button.innerHTML = '✓ Applied';
    loadApplications();
  } catch (err) {
    toast(err.message || 'Could not apply right now.');
    if (button) { button.disabled = false; button.innerHTML = 'Apply now <span>→</span>'; }
  }
}

async function loadApplications() {
  const body = $('#applicationsTableBody');
  if (!body) return;
  try {
    const response = await CandidateAPI.getApplications();
    const result = await response.json();
    const apps = result.applications || [];
    candidateApplications = apps;
    if (!apps.length) { body.innerHTML = '<tr><td colspan="4">You haven’t applied to any roles yet.</td></tr>'; return; }
    body.innerHTML = apps.map(a => {
      const status = a.interview_status === 'completed'
        ? { text: `Interview completed · ${a.interview_score}%`, cls: 'applied' }
        : (STATUS_LABELS[a.status] || { text: a.status, cls: 'applied' });
      return `<tr>
        <td><span class="company-logo">${escapeHtml(initialLetter(a.company_name))}</span><b>${escapeHtml(a.company_name || '')}<small>${escapeHtml(a.title)}</small></b></td>
        <td>${formatShortDate(a.applied_at)}</td>
        <td><span class="status ${status.cls}">${status.text}</span></td>
        <td>→</td>
      </tr>`;
    }).join('');
  } catch (err) {
    body.innerHTML = '<tr><td colspan="4">Couldn’t load your applications.</td></tr>';
  }
}

function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2800); }
function animateCounters() { $$('[data-count]').forEach(el => { const target = +el.dataset.count, start = performance.now(); const step = now => { const p = Math.min((now - start) / 1200, 1); el.textContent = Math.floor(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }); }
function typeGreeting() { const el = $('#typedGreeting'), text = 'Your profile is looking sharp today. Three high-fit roles are waiting — your next great opportunity may be closer than you think.'; let i = 0; const tick = () => { el.textContent = text.slice(0, ++i); if (i < text.length) setTimeout(tick, 15); }; setTimeout(tick, 420); }
function setCandidateIdentity(name) { const safeName = (name || 'Candidate').trim() || 'Candidate'; $('#candidateName').textContent = `${safeName}.`; const initials = safeName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); $('#profileToggle').textContent = initials || 'CD'; }
function setResumeIdentity(resume) {
  const heading = $('.resume-panel h2');
  const fileTitle = $('.resume-file strong');
  const fileMeta = $('.resume-file p');
  if (!heading || !fileTitle || !fileMeta) return;
  if (!resume?.original_filename) {
    heading.textContent = 'No resume uploaded';
    fileTitle.textContent = 'Upload your resume';
    fileMeta.textContent = 'PDF files are supported';
    return;
  }
  heading.textContent = resume.original_filename;
  fileTitle.textContent = 'Resume uploaded';
  const size = resume.file_size_bytes ? `${(resume.file_size_bytes / 1048576).toFixed(1)} MB` : '';
  fileMeta.textContent = `${resume.uploaded_at ? `Updated ${formatShortDate(resume.uploaded_at)}` : 'Uploaded'}${size ? ` · ${size}` : ''}`;
}
async function loadAiReport() {
  const target = $('.suggestion-inline p');
  if (!target || !localStorage.getItem('hiregen_token')) return;
  try {
    const response = await CandidateAPI.getAiReport();
    const result = await response.json();
    if (result.report) target.innerHTML = `<b>AI report:</b> ${escapeHtml(result.report.summary)} ${escapeHtml(result.report.recommendations?.[0] || '')}`;
  } catch (_) { /* optional enhancement */ }
}
async function loadCandidateIdentity() { setCandidateIdentity(localStorage.getItem('hiregen_fullname')); setResumeIdentity(null); if (!localStorage.getItem('hiregen_token')) return; try { const response = await CandidateAPI.getProfile(); const result = await response.json(); if (response.ok && result.profile) { if (result.profile.fullname) { localStorage.setItem('hiregen_fullname', result.profile.fullname); setCandidateIdentity(result.profile.fullname); } setResumeIdentity(result.profile.resume); } } catch (_) { /* Dashboard still works with the locally stored signup name. */ } }
function particleField() { const c = $('#particles'), x = c.getContext('2d'); let pts = []; function resize() { c.width = innerWidth; c.height = innerHeight; pts = Array.from({ length: Math.min(42, innerWidth / 30) }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, r: Math.random() * 1.4 + .3, v: Math.random() * .16 + .04 })); } function draw() { x.clearRect(0, 0, c.width, c.height); pts.forEach(p => { p.y -= p.v; if (p.y < 0) { p.y = c.height; p.x = Math.random() * c.width; } x.beginPath(); x.arc(p.x, p.y, p.r, 0, Math.PI * 2); x.fillStyle = 'rgba(115,151,255,.45)'; x.fill(); }); requestAnimationFrame(draw); } resize(); addEventListener('resize', resize); draw(); }

document.addEventListener('DOMContentLoaded', () => {
  $('#today').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  loadCandidateIdentity();
  loadAiReport();
  loadJobs(); loadApplications();
  animateCounters(); typeGreeting(); particleField();
  const observer = new IntersectionObserver(entries => entries.forEach(e => e.isIntersecting && e.target.classList.add('visible')), { threshold: .08 }); $$('.reveal').forEach(el => observer.observe(el));
  addEventListener('mousemove', e => { $('.cursor-glow').style.left = e.clientX + 'px'; $('.cursor-glow').style.top = e.clientY + 'px'; });
  $('#menuToggle').onclick = () => $('#sidebar').classList.toggle('open');
  $$('[data-scroll]').forEach(b => b.onclick = () => $(b.dataset.scroll).scrollIntoView({ behavior: 'smooth' }));
  const toggleChat = () => $('#chatWindow').classList.toggle('open'); $('#chatFab').onclick = toggleChat; $('[data-chat-open]').onclick = () => { $('#chatWindow').classList.add('open'); $('#chatInput').focus(); }; $('#closeChat').onclick = () => $('#chatWindow').classList.remove('open');
  $('#chatForm').onsubmit = e => { e.preventDefault(); const input = $('#chatInput'); if (!input.value.trim()) return; $('.chat-body').insertAdjacentHTML('beforeend', `<div class="bot-msg" style="margin-top:10px">I’m preparing tailored guidance for “${input.value.replace(/[<>&]/g, '')}”. Backend chat connection will plug in here.</div>`); input.value = ''; };
  $('#uploadButton').onclick = () => $('#resumeInput').click(); $('#updateResume').onclick = () => $('#resumeInput').click();
  $('#resumeInput').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      e.target.value = '';
      toast('Please select a PDF resume.');
      return;
    }
    const formData = new FormData();
    formData.append('resume', file);
    toast('Uploading resume…');
    try {
      const response = await CandidateAPI.uploadResume(formData);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error(`API unavailable (HTTP ${response.status}). Start Flask on port 5000.`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Upload failed');
      toast(`Resume uploaded. ATS score: ${result.ats_score}/100`);
      await loadCandidateIdentity();
    } catch (err) {
      toast(err.message || 'Could not upload resume.');
    }
  };
  $('#startInterview').onclick = openInterviewOverlay;
  initInterviewModal();
  $$('.missing-list button').forEach(b => b.onclick = () => { b.textContent = '✓ Added'; b.disabled = true; toast('Skill added to your profile checklist.'); });
  $('#roleNext').onclick = () => $('#roleTrack').scrollBy({ left: 260, behavior: 'smooth' }); $('#rolePrev').onclick = () => $('#roleTrack').scrollBy({ left: -260, behavior: 'smooth' });
  $$('.apply-btn').forEach(b => b.onclick = () => toast('Opening job details…'));
  $('#themeToggle').onclick = () => { document.body.classList.toggle('light'); toast('Theme preference saved.'); };
  const logoutBtn = $('.logout'); if (logoutBtn) logoutBtn.onclick = logout;
});

/* --- AI Interview modal flow --- */
const InterviewAPI = {
  answerFeedback: payload => fetch(`${API_BASE}/candidate/interview/feedback`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
};

const interviewState = { role: '', questions: [], tip: '', index: 0, scores: [], applicationId: null };

function openInterviewOverlay() {
  const overlay = $('#interviewOverlay');
  overlay.classList.add('open');
  showInterviewStep('setup');
  const roleInput = $('#interviewRoleInput');
  const savedRole = localStorage.getItem('hiregen_target_role');
  if (savedRole) roleInput.value = savedRole;
  setTimeout(() => roleInput.focus(), 150);
}

function closeInterviewOverlay() {
  $('#interviewOverlay').classList.remove('open');
}

function showInterviewStep(step) {
  $('#interviewSetup').hidden = step !== 'setup';
  $('#interviewLoading').hidden = step !== 'loading';
  $('#interviewFlow').hidden = step !== 'flow';
  $('#interviewSummary').hidden = step !== 'summary';
}

async function beginInterview() {
  const invitation = candidateApplications.find(app => app.interview_status === 'invited' || app.interview_status === 'in_progress');
  const role = $('#interviewRoleInput').value.trim() || invitation?.title || 'your target role';
  interviewState.role = role;
  interviewState.applicationId = invitation?.id || null;
  localStorage.setItem('hiregen_target_role', role);
  $('#interviewRoleTitle').textContent = `Practice interview · ${role}`;
  showInterviewStep('loading');
  try {
    const response = await CandidateAPI.startInterview({ role, application_id: interviewState.applicationId });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Could not start interview');
    interviewState.questions = result.interview.questions || [];
    interviewState.tip = result.interview.tip || '';
    interviewState.index = 0;
    interviewState.scores = [];
    if (!interviewState.questions.length) throw new Error('No questions were generated.');
    renderInterviewQuestion();
    showInterviewStep('flow');
  } catch (err) {
    toast(err.message || 'Could not start AI interview.');
    showInterviewStep('setup');
  }
}

function renderInterviewQuestion() {
  const { questions, index } = interviewState;
  $('#interviewStep').textContent = `Question ${index + 1} of ${questions.length}`;
  $('#interviewQuestion').textContent = questions[index];
  $('#interviewProgressBar').style.width = `${((index) / questions.length) * 100}%`;
  $('#interviewTip').textContent = interviewState.tip;
  $('#interviewAnswer').value = '';
  $('#interviewAnswer').disabled = false;
  $('#interviewSubmitAnswer').disabled = false;
  $('#interviewSubmitAnswer').textContent = 'Submit answer →';
  $('#interviewFeedback').hidden = true;
  setTimeout(() => $('#interviewAnswer').focus(), 100);
}

async function submitInterviewAnswer() {
  const answer = $('#interviewAnswer').value.trim();
  if (!answer) { toast('Type an answer before submitting.'); return; }
  const btn = $('#interviewSubmitAnswer');
  btn.disabled = true; btn.textContent = 'Scoring…';
  $('#interviewAnswer').disabled = true;
  try {
    const response = await InterviewAPI.answerFeedback({ role: interviewState.role, question: interviewState.questions[interviewState.index], answer });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Could not score that answer');
    const fb = result.feedback;
    interviewState.scores.push(fb.score);
    $('#interviewScoreValue').textContent = fb.score;
    $('#interviewFeedbackText').textContent = fb.feedback;
    $('#interviewStrength').textContent = fb.strength ? `✓ ${fb.strength}` : '';
    $('#interviewStrength').hidden = !fb.strength;
    $('#interviewImprove').textContent = fb.improve ? `↻ ${fb.improve}` : '';
    $('#interviewImprove').hidden = !fb.improve;
    $('#interviewProgressBar').style.width = `${((interviewState.index + 1) / interviewState.questions.length) * 100}%`;
    $('#interviewFeedback').hidden = false;
    $('#interviewNext').textContent = interviewState.index + 1 < interviewState.questions.length ? 'Next question →' : 'See summary →';
  } catch (err) {
    toast(err.message || 'Could not score that answer.');
    btn.disabled = false; btn.textContent = 'Submit answer →';
    $('#interviewAnswer').disabled = false;
  }
}

function goToNextInterviewStep() {
  interviewState.index += 1;
  if (interviewState.index >= interviewState.questions.length) {
    renderInterviewSummary();
    showInterviewStep('summary');
  } else {
    renderInterviewQuestion();
  }
}

function renderInterviewSummary() {
  const scores = interviewState.scores;
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  $('#interviewAvgScore').textContent = avg;
  const copy = avg >= 80
    ? `Strong session — your answers for ${interviewState.role} were clear and specific.`
    : avg >= 60
      ? `Solid start for ${interviewState.role}. A bit more specificity and measurable results will push this higher.`
      : `Good rep for ${interviewState.role}. Try adding concrete examples and outcomes to each answer next time.`;
  $('#interviewSummaryCopy').textContent = copy;
  if (interviewState.applicationId) submitCompletedInterview();
}

async function submitCompletedInterview() {
  try {
    const response = await CandidateAPI.completeInterview({ application_id: interviewState.applicationId, scores: interviewState.scores });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || 'Could not submit interview');
    $('#interviewSummaryCopy').textContent += ' Your completed interview has been shared with the recruiter.';
    loadApplications();
  } catch (err) {
    toast(err.message || 'Your recruiter interview could not be submitted.');
  }
}

function initInterviewModal() {
  $('#closeInterview').onclick = closeInterviewOverlay;
  $('#interviewOverlay').addEventListener('click', e => { if (e.target.id === 'interviewOverlay') closeInterviewOverlay(); });
  $('#interviewSetupStart').onclick = beginInterview;
  $('#interviewRoleInput').addEventListener('keydown', e => { if (e.key === 'Enter') beginInterview(); });
  $('#interviewSubmitAnswer').onclick = submitInterviewAnswer;
  $('#interviewNext').onclick = goToNextInterviewStep;
  $('#interviewRestart').onclick = () => showInterviewStep('setup');
  $('#interviewDone').onclick = closeInterviewOverlay;
}
