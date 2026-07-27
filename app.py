import os
import re
import json
import random
import datetime
import time
import urllib.request
import urllib.error
import urllib.parse
import jwt
from dotenv import load_dotenv
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import sqlite3 # Default fallback DB for easy running; mysql-connector compatible

# Load environment variables from a local .env file (if present) before
# anything below reads os.environ. Real environment variables (e.g. ones
# set by your host/deployment platform) still take precedence.
load_dotenv()

app = Flask(__name__)
# Only allow browser requests from the app itself. Add deployed origins through
# CORS_ORIGINS (comma-separated) instead of allowing every website by default.
CORS_ORIGINS = [origin.strip() for origin in os.environ.get(
    'CORS_ORIGINS', 'http://127.0.0.1:5000,http://localhost:5000,http://127.0.0.1:5500,http://localhost:5500'
).split(',') if origin.strip()]
CORS(app, resources={r'/*': {'origins': CORS_ORIGINS}}, supports_credentials=False)

# Never commit a signing key. A temporary local key keeps development usable,
# while production must provide SECRET_KEY so tokens survive restarts.
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or os.urandom(32)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10 MB uploads/request
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# --- AI CONFIGURATION ---
# Set GEMINI_API_KEY in your environment to enable real, dynamically
# generated interview questions and answer feedback. Without a key, the app
# gracefully falls back to the static question templates so it keeps working.
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-2.0-flash')
GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
# n8n should expose a POST webhook that sends the email. Keep this value in
# .env so the browser never sees the webhook URL or any mail credentials.
N8N_INTERVIEW_WEBHOOK_URL = os.environ.get('N8N_INTERVIEW_WEBHOOK_URL', '').strip()
UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads')
ALLOWED_RESUME_EXTENSIONS = {'pdf'}
ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg'}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

_login_attempts = {}
LOGIN_ATTEMPT_LIMIT = 8
LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://unpkg.com; "
        "script-src 'self' https://cdn.jsdelivr.net https://unpkg.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
    )
    if request.is_secure:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({'success': False, 'message': 'File or request is too large (maximum 10 MB).'}), 413

# The UI is intentionally kept as plain HTML/CSS/JS files at the project root.
# Serving them from Flask keeps the API and the dashboard on the same origin and
# makes every frontend fetch work when the app is started with `python app.py`.
@app.route('/')
def serve_index():
    return send_from_directory(os.getcwd(), 'index.html')

@app.route('/<path:page>')
def serve_frontend(page):
    if page == 'api':
        return jsonify({'message': 'HireGen API'}), 404
    file_path = os.path.join(os.getcwd(), page)
    project_root = os.path.abspath(os.getcwd())
    if os.path.isfile(file_path) and os.path.commonpath([os.path.abspath(file_path), project_root]) == project_root:
        return send_from_directory(os.getcwd(), page)
    return jsonify({'message': 'Not found'}), 404

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# SQLite Local Setup for immediate testing
def get_db_connection():
    conn = sqlite3.connect('hiregen.db')
    conn.row_factory = sqlite3.Row
    return conn

def init_sqlite_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullname TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE,
            linkedin_url TEXT, github_url TEXT, portfolio_url TEXT,
            preferred_role TEXT, experience_level TEXT, preferred_location TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS recruiters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE,
            company_name TEXT NOT NULL, company_website TEXT NOT NULL,
            company_logo TEXT, company_industry TEXT, company_size TEXT,
            company_description TEXT, recruiter_designation TEXT, hiring_frequency TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS candidate_resumes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE, file_path TEXT, original_filename TEXT,
            file_size_bytes INTEGER, ats_score INTEGER, extracted_skills TEXT, parsed_json TEXT,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recruiter_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            department TEXT,
            location TEXT,
            job_type TEXT,
            salary_range TEXT,
            experience_required TEXT,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(recruiter_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            candidate_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'applied',
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(job_id, candidate_id),
            FOREIGN KEY(job_id) REFERENCES jobs(id),
            FOREIGN KEY(candidate_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS interviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER NOT NULL,
            candidate_id INTEGER NOT NULL,
            recruiter_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'invited',
            role TEXT,
            questions_json TEXT,
            score INTEGER,
            invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            n8n_delivery_status TEXT NOT NULL DEFAULT 'not_configured',
            UNIQUE(application_id),
            FOREIGN KEY(application_id) REFERENCES applications(id)
        );
    ''')
    conn.commit()
    conn.close()

init_sqlite_db()

# --- HELPER FUNCTIONS ---
def allowed_file(filename, allowed_set):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_set

def valid_upload(file_storage, allowed_set):
    """Validate an upload's extension and signature before persisting it."""
    if not file_storage or not allowed_file(file_storage.filename, allowed_set):
        return False
    header = file_storage.stream.read(16)
    file_storage.stream.seek(0)
    extension = file_storage.filename.rsplit('.', 1)[1].lower()
    if extension == 'pdf':
        return header.startswith(b'%PDF-')
    return ((extension == 'png' and header.startswith(b'\x89PNG\r\n\x1a\n')) or
            (extension in {'jpg', 'jpeg'} and header.startswith(b'\xff\xd8\xff')))

def login_is_rate_limited():
    client_ip, now = request.remote_addr or 'unknown', time.time()
    attempts = [stamp for stamp in _login_attempts.get(client_ip, []) if now - stamp < LOGIN_ATTEMPT_WINDOW_SECONDS]
    _login_attempts[client_ip] = attempts
    return len(attempts) >= LOGIN_ATTEMPT_LIMIT

def record_failed_login():
    _login_attempts.setdefault(request.remote_addr or 'unknown', []).append(time.time())

def send_n8n_interview_invite(payload):
    """Trigger n8n without exposing its webhook to the client."""
    if not N8N_INTERVIEW_WEBHOOK_URL:
        return False, 'N8N_INTERVIEW_WEBHOOK_URL is not configured'
    request_data = json.dumps(payload).encode('utf-8')
    webhook_request = urllib.request.Request(
        N8N_INTERVIEW_WEBHOOK_URL,
        data=request_data,
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(webhook_request, timeout=10) as response:
            if 200 <= response.status < 300:
                return True, None
            return False, f'n8n returned HTTP {response.status}'
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
        return False, f'n8n delivery failed: {error}'

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'message': 'Token is missing!'}), 401
        try:
            token = token.split(" ")[1] if " " in token else token
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            current_user_id = data['user_id']
        except (jwt.InvalidTokenError, KeyError, IndexError):
            return jsonify({'message': 'Token is invalid or expired!'}), 401
        return f(current_user_id, *args, **kwargs)
    return decorated

def get_user_role(conn, user_id):
    row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
    return row['role'] if row else None

def role_required(role_name):
    """Stacks on top of @token_required; current_user_id must already be resolved."""
    def decorator(f):
        @wraps(f)
        def decorated(current_user_id, *args, **kwargs):
            conn = get_db_connection()
            role = get_user_role(conn, current_user_id)
            conn.close()
            if role != role_name:
                return jsonify({'message': f'This action requires a {role_name} account.'}), 403
            return f(current_user_id, *args, **kwargs)
        return decorated
    return decorator

def simulate_ai_resume_parser(file_path):
    """Simulates AI Parsing and ATS score calculation on resume text."""
    skills_pool = ["Python", "JavaScript", "React", "Node.js", "Docker", "AWS", "Machine Learning", "SQL", "Git", "TypeScript", "Tailwind CSS", "REST APIs"]
    extracted = random.sample(skills_pool, k=random.randint(4, 7))
    ats_score = random.randint(78, 96)
    
    parsed = {
        "education": "B.S. in Computer Science / Software Engineering",
        "experience": f"{random.randint(2, 6)} Years in Full Stack & AI Development",
        "projects": ["AI Resume Matcher", "Realtime Analytics Dashboard", "E-Commerce Gateway"]
    }
    return ats_score, extracted, parsed

def call_gemini(system, user_message, max_tokens=600):
    """Call the Google Gemini generateContent API with a plain-text prompt.

    Returns the model's text response, or None if no API key is configured
    or the request fails for any reason (network, auth, rate limit, etc.).
    """
    if not GEMINI_API_KEY:
        return None
    url = f'{GEMINI_API_BASE}/{GEMINI_MODEL}:generateContent?key={urllib.parse.quote(GEMINI_API_KEY)}'
    payload = json.dumps({
        'systemInstruction': {
            'role': 'system',
            'parts': [{'text': system}]
        },
        'contents': [
            {'role': 'user', 'parts': [{'text': user_message}]}
        ],
        'generationConfig': {
            'maxOutputTokens': max_tokens
        }
    }).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            candidates = data.get('candidates') or []
            if not candidates:
                return None
            parts = candidates[0].get('content', {}).get('parts', []) or []
            text = ''.join(p.get('text', '') for p in parts if 'text' in p).strip()
            return text or None
    except Exception as e:
        app.logger.warning(f'Gemini API call failed: {e}')
        return None


def _extract_json(raw):
    """Best-effort extraction of a JSON object from a model response,
    tolerating stray markdown code fences."""
    if not raw:
        return None
    cleaned = raw.strip()
    if cleaned.startswith('```'):
        cleaned = re.sub(r'^```(?:json)?\s*|\s*```$', '', cleaned.strip(), flags=re.MULTILINE).strip()
    match = re.search(r'\{.*\}', cleaned, flags=re.DOTALL)
    if match:
        cleaned = match.group(0)
    try:
        return json.loads(cleaned)
    except Exception:
        return None


def ai_generate_interview_questions(target_role, skills, experience_level, preferred_role):
    """Ask Gemini to write fresh, role-specific interview questions for this
    candidate. Returns {'questions': [...], 'tip': '...'} or None on failure."""
    skills_str = ', '.join(skills) if skills else 'general professional skills'
    system = (
        'You are an experienced hiring manager writing an interview question set. '
        'Respond with ONLY a raw JSON object — no markdown fences, no commentary before or after.'
    )
    user_message = (
        f"Write 10 interview questions for a candidate applying to a '{target_role}' role.\n"
        f"Candidate profile — preferred role: {preferred_role or target_role}; "
        f"experience level: {experience_level or 'not specified'}; key skills: {skills_str}.\n"
        'Order them from warm-up to more challenging, mix behavioral and role-specific/technical '
        'questions, and make them specific rather than generic. '
        'Respond with exactly this JSON shape: '
        '{"questions": ["...", "...", "...", "...", "...", "...", "...", "...", "...", "..."], '
        '"tip": "one short, actionable interview tip"}'
    )
    parsed = _extract_json(call_gemini(system, user_message, max_tokens=1200))
    if parsed and isinstance(parsed.get('questions'), list) and parsed['questions']:
        questions = [str(q).strip() for q in parsed['questions'] if str(q).strip()]
        if len(questions) < 10:
            return None
        return {
            'questions': questions[:12],
            'tip': str(parsed.get('tip') or 'Use the STAR structure: situation, task, action, and measurable result.')
        }
    return None


def ai_generate_answer_feedback(target_role, question, answer):
    """Ask Gemini to score and critique a single interview answer.
    Returns {'score', 'feedback', 'strength', 'improve'} or None on failure."""
    system = (
        'You are a supportive, candid interview coach giving quick feedback on one answer. '
        'Respond with ONLY a raw JSON object — no markdown fences, no commentary before or after.'
    )
    user_message = (
        f"Role: {target_role}\nQuestion: {question}\nCandidate's answer: {answer}\n\n"
        'Score the answer from 0-100 on clarity, relevance, and use of concrete evidence/results. '
        'Respond with exactly this JSON shape: '
        '{"score": <integer 0-100>, "feedback": "<2-3 sentence constructive feedback>", '
        '"strength": "<one short phrase on what worked>", "improve": "<one short, actionable tip>"}'
    )
    parsed = _extract_json(call_gemini(system, user_message, max_tokens=400))
    if parsed and 'score' in parsed and 'feedback' in parsed:
        try:
            score = max(0, min(100, int(parsed['score'])))
        except (TypeError, ValueError):
            score = 70
        return {
            'score': score,
            'feedback': str(parsed.get('feedback', '')).strip(),
            'strength': str(parsed.get('strength', '')).strip(),
            'improve': str(parsed.get('improve', '')).strip()
        }
    return None


def build_resume_report(resume):
    """Create a concise, explainable report from the stored resume analysis."""
    skills = [s.strip() for s in (resume.get('extracted_skills') or '').split(',') if s.strip()]
    score = int(resume.get('ats_score') or 0)
    return {
        'headline': 'Strong resume match' if score >= 80 else 'Resume can be improved',
        'summary': f'Your resume scored {score}/100 and highlights {len(skills)} relevant skills.',
        'strengths': skills[:4],
        'recommendations': [
            'Add measurable outcomes to your most recent projects.',
            'Tailor the skills section to each job description.',
            'Keep contact links and formatting consistent.'
        ]
    }

# --- API ENDPOINTS ---

@app.route('/check-email', methods=['GET'])
def check_email():
    email = request.args.get('email', '').strip().lower()
    if not email:
        return jsonify({"valid": False, "message": "Email is required"}), 400
    
    conn = get_db_connection()
    user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    
    if user:
        return jsonify({"exists": True, "message": "Email is already registered"}), 200
    return jsonify({"exists": False, "message": "Email is available"}), 200


@app.route('/signup', methods=['POST'])
def signup():
    data = request.form
    fullname = data.get('fullname', '').strip()
    email = data.get('email', '').strip().lower()
    phone = data.get('phone', '').strip()
    password = data.get('password', '')
    role = data.get('role', 'candidate').lower().strip()

    # Server-Side Validations
    if role not in {'candidate', 'recruiter'}:
        return jsonify({"success": False, "message": "Role must be candidate or recruiter"}), 400
    if not fullname or not email or not phone or not password:
        return jsonify({"success": False, "message": "All required fields must be provided"}), 400

    if len(fullname) > 100 or len(email) > 150 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        return jsonify({"success": False, "message": "Please provide valid account details"}), 400
    if len(password) < 10 or not (re.search(r'[A-Z]', password) and re.search(r'[a-z]', password) and re.search(r'\d', password)):
        return jsonify({"success": False, "message": "Password must have 10+ characters with upper, lower, and a number"}), 400

    conn = get_db_connection()
    existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"success": False, "message": "Email address already registered"}), 409

    pwd_hash = generate_password_hash(password, method='scrypt')
    cursor = conn.cursor()

    try:
        cursor.execute(
            "INSERT INTO users (fullname, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)",
            (fullname, email, phone, pwd_hash, role)
        )
        user_id = cursor.lastrowid

        ats_data = {}

        if role == 'candidate':
            linkedin = data.get('linkedin_url', '')
            github = data.get('github_url', '')
            portfolio = data.get('portfolio_url', '')
            job_role = data.get('preferred_role', '')
            exp_level = data.get('experience_level', '')
            location = data.get('preferred_location', '')

            cursor.execute(
                "INSERT INTO candidates (user_id, linkedin_url, github_url, portfolio_url, preferred_role, experience_level, preferred_location) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (user_id, linkedin, github, portfolio, job_role, exp_level, location)
            )

            # Handle Resume Upload
            if 'resume' in request.files:
                resume_file = request.files['resume']
                if resume_file and valid_upload(resume_file, ALLOWED_RESUME_EXTENSIONS):
                    filename = secure_filename(f"user_{user_id}_{resume_file.filename}")
                    save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                    resume_file.save(save_path)
                    file_size = os.path.getsize(save_path)

                    # AI Parsing
                    ats_score, skills, parsed_data = simulate_ai_resume_parser(save_path)

                    cursor.execute(
                        "INSERT INTO candidate_resumes (user_id, file_path, original_filename, file_size_bytes, ats_score, extracted_skills, parsed_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (user_id, save_path, resume_file.filename, file_size, ats_score, ", ".join(skills), json.dumps(parsed_data))
                    )

                    ats_data = {
                        "ats_score": ats_score,
                        "skills": skills,
                        "resume_uploaded": True
                    }

        elif role == 'recruiter':
            company_name = data.get('company_name', '').strip()
            company_website = data.get('company_website', '').strip()
            company_industry = data.get('company_industry', '')
            company_size = data.get('company_size', '')
            company_description = data.get('company_description', '')
            designation = data.get('recruiter_designation', '')
            hiring_freq = data.get('hiring_frequency', '')

            if not company_name:
                conn.rollback()
                conn.close()
                return jsonify({"success": False, "message": "Company name is required for recruiter accounts"}), 400

            logo_filename = None
            if 'company_logo' in request.files:
                logo_file = request.files['company_logo']
                if logo_file and valid_upload(logo_file, ALLOWED_IMAGE_EXTENSIONS):
                    logo_filename = secure_filename(f"logo_{user_id}_{logo_file.filename}")
                    logo_file.save(os.path.join(app.config['UPLOAD_FOLDER'], logo_filename))

            cursor.execute(
                "INSERT INTO recruiters (user_id, company_name, company_website, company_logo, company_industry, company_size, company_description, recruiter_designation, hiring_frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (user_id, company_name, company_website, logo_filename, company_industry, company_size, company_description, designation, hiring_freq)
            )

        conn.commit()

        # Generate JWT Token
        token = jwt.encode({
            'user_id': user_id,
            'email': email,
            'role': role,
            'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
        }, app.config['SECRET_KEY'], algorithm="HS256")

        conn.close()

        return jsonify({
            "success": True,
            "message": "Account created successfully",
            "token": token,
            "user_id": user_id,
            "role": role,
            "ats_data": ats_data
        }), 201

    except Exception:
        conn.rollback()
        conn.close()
        return jsonify({"success": False, "message": "Could not create the account. Please try again."}), 500


@app.route('/login', methods=['POST'])
def login():
    if login_is_rate_limited():
        return jsonify({"success": False, "message": "Too many login attempts. Please try again in 15 minutes."}), 429
    data = request.json or {}
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    requested_role = (data.get('role') or '').strip().lower()

    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()

    if not user or not check_password_hash(user['password_hash'], password):
        record_failed_login()
        return jsonify({"success": False, "message": "Invalid credentials"}), 401
    if requested_role and requested_role in {'candidate', 'recruiter'} and user['role'] != requested_role:
        record_failed_login()
        return jsonify({"success": False, "message": f"This email is registered as a {user['role']}. Select {user['role']} to continue."}), 403

    _login_attempts.pop(request.remote_addr or 'unknown', None)
    token = jwt.encode({
        'user_id': user['id'],
        'email': user['email'],
        'role': user['role'],
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
    }, app.config['SECRET_KEY'], algorithm="HS256")

    return jsonify({
        "success": True,
        "token": token,
        "user_id": user['id'],
        "role": user['role'],
        "fullname": user['fullname']
    }), 200


@app.route('/user/profile', methods=['GET'])
@token_required
def get_profile(current_user_id):
    conn = get_db_connection()
    user = conn.execute("SELECT id, fullname, email, phone, role FROM users WHERE id = ?", (current_user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"message": "User not found"}), 404

    profile = dict(user)
    if user['role'] == 'candidate':
        cand = conn.execute("SELECT * FROM candidates WHERE user_id = ?", (current_user_id,)).fetchone()
        resume = conn.execute("SELECT original_filename, file_size_bytes, ats_score, extracted_skills, uploaded_at FROM candidate_resumes WHERE user_id = ?", (current_user_id,)).fetchone()
        profile['details'] = dict(cand) if cand else {}
        profile['resume'] = dict(resume) if resume else {}
    else:
        rec = conn.execute("SELECT * FROM recruiters WHERE user_id = ?", (current_user_id,)).fetchone()
        profile['details'] = dict(rec) if rec else {}

    conn.close()
    return jsonify({"success": True, "profile": profile}), 200


@app.route('/upload-resume', methods=['POST'])
@token_required
@role_required('candidate')
def upload_resume(current_user_id):
    """Replace the authenticated candidate's resume and refresh its analysis."""
    resume_file = request.files.get('resume')
    if not resume_file or not resume_file.filename:
        return jsonify({'success': False, 'message': 'A PDF resume is required'}), 400
    if not valid_upload(resume_file, ALLOWED_RESUME_EXTENSIONS):
        return jsonify({'success': False, 'message': 'Only valid PDF resumes are supported'}), 400

    filename = secure_filename(f'user_{current_user_id}_{resume_file.filename}')
    save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    resume_file.save(save_path)
    ats_score, skills, parsed_data = simulate_ai_resume_parser(save_path)
    conn = get_db_connection()
    conn.execute('''
        INSERT INTO candidate_resumes (user_id, file_path, original_filename, file_size_bytes, ats_score, extracted_skills, parsed_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET file_path=excluded.file_path,
          original_filename=excluded.original_filename, file_size_bytes=excluded.file_size_bytes,
          ats_score=excluded.ats_score, extracted_skills=excluded.extracted_skills,
          parsed_json=excluded.parsed_json, uploaded_at=CURRENT_TIMESTAMP
    ''', (current_user_id, save_path, resume_file.filename, os.path.getsize(save_path), ats_score, ', '.join(skills), json.dumps(parsed_data)))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'ats_score': ats_score, 'skills': skills}), 200


@app.route('/candidate/ai-report', methods=['GET'])
@token_required
@role_required('candidate')
def candidate_ai_report(current_user_id):
    conn = get_db_connection()
    row = conn.execute('SELECT * FROM candidate_resumes WHERE user_id = ?', (current_user_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({'success': True, 'report': None, 'message': 'Upload a resume to generate an AI report.'}), 200
    return jsonify({'success': True, 'report': build_resume_report(dict(row))}), 200


@app.route('/candidate/interview', methods=['POST'])
@token_required
@role_required('candidate')
def candidate_interview(current_user_id):
    data = request.json or {}
    role = (data.get('role') or 'your target role').strip()
    application_id = data.get('application_id')
    conn = get_db_connection()
    if application_id:
        invitation = conn.execute('''
            SELECT id FROM interviews WHERE application_id = ? AND candidate_id = ?
            AND status IN ('invited', 'in_progress')
        ''', (application_id, current_user_id)).fetchone()
        if not invitation:
            conn.close()
            return jsonify({'success': False, 'message': 'This interview invitation is no longer available'}), 404
    row = conn.execute('SELECT extracted_skills, preferred_role, experience_level FROM candidate_resumes JOIN candidates ON candidates.user_id = candidate_resumes.user_id WHERE candidate_resumes.user_id = ?', (current_user_id,)).fetchone()
    if not row:
        row = conn.execute('SELECT preferred_role, experience_level FROM candidates WHERE user_id = ?', (current_user_id,)).fetchone()
    conn.close()
    row_dict = dict(row) if row else {}
    skills = [s.strip() for s in (row_dict.get('extracted_skills') or '').split(',') if s.strip()]
    preferred_role = row_dict.get('preferred_role') or ''
    experience_level = row_dict.get('experience_level') or ''

    ai_result = ai_generate_interview_questions(role, skills, experience_level, preferred_role)
    if ai_result:
        interview = {
            'role': role,
            'questions': ai_result['questions'],
            'tip': ai_result['tip'],
            'ai_generated': True
        }
    else:
        # Fallback if no GEMINI_API_KEY is configured or the AI call failed
        top_skill = skills[0] if skills else 'your strongest technical skill'
        second_skill = skills[1] if len(skills) > 1 else 'a skill you had to learn on the job'
        interview = {
            'role': role,
            'questions': [
                f'Walk me through your background and why you are interested in a {role} role.',
                f'Tell me about a project that demonstrates your fit for {role}.',
                f'How did you use {top_skill} to solve a difficult problem?',
                f'Describe a time you had to quickly get up to speed with {second_skill}.',
                'Describe a measurable result you achieved and how you evaluated it.',
                'Tell me about a time you disagreed with a teammate or manager. How did you handle it?',
                'Describe a project that did not go as planned. What did you learn?',
                'How do you prioritize when you have multiple competing deadlines?',
                'Tell me about a time you had to explain something technical to a non-technical audience.',
                'What would you improve if you had more time or resources on your most recent project?'
            ],
            'tip': 'Use the STAR structure: situation, task, action, and measurable result.',
            'ai_generated': False
        }

    if application_id:
        conn = get_db_connection()
        conn.execute('''UPDATE interviews SET status = 'in_progress', role = ?, questions_json = ?,
                        started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
                        WHERE application_id = ? AND candidate_id = ?''',
                     (role, json.dumps(interview['questions']), application_id, current_user_id))
        conn.commit()
        conn.close()
        interview['application_id'] = application_id
    return jsonify({'success': True, 'interview': interview}), 200


@app.route('/candidate/interview/feedback', methods=['POST'])
@token_required
@role_required('candidate')
def candidate_interview_feedback(current_user_id):
    data = request.json or {}
    role = (data.get('role') or 'your target role').strip()
    question = (data.get('question') or '').strip()
    answer = (data.get('answer') or '').strip()
    if not question or not answer:
        return jsonify({'success': False, 'message': 'A question and answer are required'}), 400

    ai_feedback = ai_generate_answer_feedback(role, question, answer)
    if ai_feedback:
        return jsonify({'success': True, 'feedback': ai_feedback, 'ai_generated': True}), 200

    # Deterministic fallback so the flow still works without an API key
    word_count = len(answer.split())
    score = max(35, min(90, 40 + word_count))
    return jsonify({'success': True, 'feedback': {
        'score': score,
        'feedback': 'Thanks for the answer. Add a specific example with a measurable outcome to make it more convincing.',
        'strength': 'Clear and on-topic response.',
        'improve': 'Quantify the result (%, time saved, revenue, users, etc.).'
    }, 'ai_generated': False}), 200

@app.route('/candidate/interview/complete', methods=['POST'])
@token_required
@role_required('candidate')
def complete_candidate_interview(current_user_id):
    data = request.json or {}
    application_id = data.get('application_id')
    scores = data.get('scores') or []
    if not application_id or not isinstance(scores, list) or not scores:
        return jsonify({'success': False, 'message': 'Interview results are required'}), 400
    numeric_scores = [int(score) for score in scores if isinstance(score, (int, float))]
    if not numeric_scores:
        return jsonify({'success': False, 'message': 'No valid interview scores were provided'}), 400
    score = round(sum(numeric_scores) / len(numeric_scores))
    conn = get_db_connection()
    result = conn.execute('''UPDATE interviews SET status = 'completed', score = ?, completed_at = CURRENT_TIMESTAMP
                             WHERE application_id = ? AND candidate_id = ? AND status IN ('invited', 'in_progress')''',
                          (score, application_id, current_user_id))
    conn.commit()
    conn.close()
    if not result.rowcount:
        return jsonify({'success': False, 'message': 'Interview could not be completed'}), 404
    return jsonify({'success': True, 'score': score, 'message': 'Interview submitted to the recruiter'}), 200


@app.route('/assistant', methods=['POST'])
@token_required
def assistant(current_user_id):
    data = request.json or {}
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({'success': False, 'message': 'Message is required'}), 400
    conn = get_db_connection()
    user = conn.execute('SELECT fullname, role FROM users WHERE id = ?', (current_user_id,)).fetchone()
    conn.close()
    name = user['fullname'] if user else 'there'
    if user and user['role'] == 'candidate':
        answer = f'Hi {name.split()[0]}, I can help improve your resume, practise interviews, or find roles matching your skills. Start with a specific job or skill for tailored guidance.'
    else:
        answer = f'Hi {name.split()[0]}, I can summarise your registered applicants, job posts, and hiring pipeline. Ask about a role or candidate.'
    return jsonify({'success': True, 'reply': answer, 'context': message}), 200


# --- JOBS ---

@app.route('/jobs', methods=['GET'])
def list_jobs():
    """Public/candidate-facing list of active jobs, newest first."""
    conn = get_db_connection()
    rows = conn.execute('''
        SELECT jobs.*, recruiters.company_name, recruiters.company_logo
        FROM jobs
        JOIN recruiters ON recruiters.user_id = jobs.recruiter_id
        WHERE jobs.status = 'active'
        ORDER BY jobs.created_at DESC
    ''').fetchall()
    conn.close()
    return jsonify({"success": True, "jobs": [dict(r) for r in rows]}), 200


@app.route('/jobs', methods=['POST'])
@token_required
@role_required('recruiter')
def create_job(current_user_id):
    data = request.json or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({"success": False, "message": "Job title is required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO jobs (recruiter_id, title, department, location, job_type, salary_range, experience_required, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        current_user_id, title, data.get('department', ''), data.get('location', ''),
        data.get('job_type', ''), data.get('salary_range', ''),
        data.get('experience_required', ''), data.get('description', '')
    ))
    conn.commit()
    job_id = cursor.lastrowid
    job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    conn.close()
    return jsonify({"success": True, "job": dict(job)}), 201


@app.route('/recruiter/jobs', methods=['GET'])
@token_required
@role_required('recruiter')
def recruiter_jobs(current_user_id):
    conn = get_db_connection()
    rows = conn.execute('''
        SELECT jobs.*, COUNT(applications.id) AS applicant_count
        FROM jobs
        LEFT JOIN applications ON applications.job_id = jobs.id
        WHERE jobs.recruiter_id = ?
        GROUP BY jobs.id
        ORDER BY jobs.created_at DESC
    ''', (current_user_id,)).fetchall()
    conn.close()
    return jsonify({"success": True, "jobs": [dict(r) for r in rows]}), 200


# --- APPLICATIONS ---

@app.route('/jobs/<int:job_id>/apply', methods=['POST'])
@token_required
@role_required('candidate')
def apply_to_job(current_user_id, job_id):
    conn = get_db_connection()
    job = conn.execute("SELECT id FROM jobs WHERE id = ? AND status = 'active'", (job_id,)).fetchone()
    if not job:
        conn.close()
        return jsonify({"success": False, "message": "This job is no longer available"}), 404

    existing = conn.execute(
        "SELECT id FROM applications WHERE job_id = ? AND candidate_id = ?", (job_id, current_user_id)
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"success": False, "message": "You already applied to this job"}), 409

    conn.execute(
        "INSERT INTO applications (job_id, candidate_id, status) VALUES (?, ?, 'applied')",
        (job_id, current_user_id)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Application submitted"}), 201


@app.route('/candidate/applications', methods=['GET'])
@token_required
@role_required('candidate')
def candidate_applications(current_user_id):
    conn = get_db_connection()
    rows = conn.execute('''
        SELECT applications.id, applications.status, applications.applied_at,
               jobs.id AS job_id, jobs.title, jobs.location,
               recruiters.company_name, interviews.status AS interview_status,
               interviews.score AS interview_score
        FROM applications
        JOIN jobs ON jobs.id = applications.job_id
        JOIN recruiters ON recruiters.user_id = jobs.recruiter_id
        LEFT JOIN interviews ON interviews.application_id = applications.id
        WHERE applications.candidate_id = ?
        ORDER BY applications.applied_at DESC
    ''', (current_user_id,)).fetchall()
    conn.close()
    return jsonify({"success": True, "applications": [dict(r) for r in rows]}), 200


@app.route('/recruiter/applicants', methods=['GET'])
@token_required
@role_required('recruiter')
def recruiter_applicants(current_user_id):
    job_id_filter = request.args.get('job_id')
    conn = get_db_connection()
    query = '''
        SELECT applications.id AS application_id, applications.status, applications.applied_at,
               jobs.id AS job_id, jobs.title AS job_title,
               users.id AS candidate_id, users.fullname, users.email, users.phone,
               candidates.preferred_role, candidates.experience_level, candidates.preferred_location,
               candidates.linkedin_url, candidates.github_url, candidates.portfolio_url,
               candidate_resumes.ats_score, candidate_resumes.extracted_skills,
               interviews.status AS interview_status, interviews.score AS interview_score,
               interviews.completed_at AS interview_completed_at, interviews.n8n_delivery_status
        FROM applications
        JOIN jobs ON jobs.id = applications.job_id
        JOIN users ON users.id = applications.candidate_id
        LEFT JOIN candidates ON candidates.user_id = users.id
        LEFT JOIN candidate_resumes ON candidate_resumes.user_id = users.id
        LEFT JOIN interviews ON interviews.application_id = applications.id
        WHERE jobs.recruiter_id = ?
    '''
    params = [current_user_id]
    if job_id_filter:
        query += ' AND jobs.id = ?'
        params.append(job_id_filter)
    query += ' ORDER BY applications.applied_at DESC'

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify({"success": True, "applicants": [dict(r) for r in rows]}), 200


@app.route('/application/<int:application_id>/interview/invite', methods=['POST'])
@token_required
@role_required('recruiter')
def invite_candidate_to_interview(current_user_id, application_id):
    """Create/re-send an interview invitation and hand email delivery to n8n."""
    data = request.json or {}
    conn = get_db_connection()
    application = conn.execute('''
        SELECT applications.id, applications.candidate_id, jobs.title AS job_title,
               candidates.preferred_role, users.fullname AS candidate_name, users.email AS candidate_email,
               recruiter_users.fullname AS recruiter_name, recruiters.company_name
        FROM applications
        JOIN jobs ON jobs.id = applications.job_id
        JOIN users ON users.id = applications.candidate_id
        JOIN users AS recruiter_users ON recruiter_users.id = jobs.recruiter_id
        JOIN recruiters ON recruiters.user_id = jobs.recruiter_id
        LEFT JOIN interviews ON interviews.application_id = applications.id
        LEFT JOIN candidates ON candidates.user_id = applications.candidate_id
        WHERE applications.id = ? AND jobs.recruiter_id = ?
    ''', (application_id, current_user_id)).fetchone()
    if not application:
        conn.close()
        return jsonify({'success': False, 'message': 'Application not found'}), 404

    role = (data.get('role') or application['job_title'] or application['preferred_role'] or 'the role').strip()
    existing = conn.execute('SELECT id FROM interviews WHERE application_id = ?', (application_id,)).fetchone()
    if existing:
        conn.execute('''UPDATE interviews SET status = 'invited', role = ?, score = NULL, started_at = NULL,
                        completed_at = NULL, n8n_delivery_status = 'pending' WHERE application_id = ?''',
                     (role, application_id))
    else:
        conn.execute('''INSERT INTO interviews (application_id, candidate_id, recruiter_id, status, role, n8n_delivery_status)
                        VALUES (?, ?, ?, 'invited', ?, 'pending')''',
                     (application_id, application['candidate_id'], current_user_id, role))
    conn.execute("UPDATE applications SET status = 'interview', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (application_id,))
    conn.commit()

    payload = {
        'event': 'interview_invitation', 'candidate_name': application['candidate_name'],
        'candidate_email': application['candidate_email'], 'job_title': application['job_title'],
        'interview_role': role, 'recruiter_name': application['recruiter_name'],
        'company_name': application['company_name'], 'application_id': application_id,
        'candidate_dashboard_url': request.url_root.rstrip('/') + '/candidate-dashboard.html'
    }
    delivered, error = send_n8n_interview_invite(payload)
    conn.execute('UPDATE interviews SET n8n_delivery_status = ? WHERE application_id = ?',
                 ('sent' if delivered else 'failed', application_id))
    conn.commit()
    conn.close()
    if not delivered:
        return jsonify({'success': False, 'message': error, 'invitation_created': True}), 503
    return jsonify({'success': True, 'message': f"Interview invitation sent to {application['candidate_email']}"}), 200


@app.route('/application/<int:application_id>/status', methods=['PATCH'])
@token_required
@role_required('recruiter')
def update_application_status(current_user_id, application_id):
    data = request.json or {}
    new_status = (data.get('status') or '').strip().lower()
    allowed = {'applied', 'screened', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'}
    if new_status not in allowed:
        return jsonify({"success": False, "message": "Invalid status"}), 400

    conn = get_db_connection()
    row = conn.execute('''
        SELECT applications.id FROM applications
        JOIN jobs ON jobs.id = applications.job_id
        WHERE applications.id = ? AND jobs.recruiter_id = ?
    ''', (application_id, current_user_id)).fetchone()

    if not row:
        conn.close()
        return jsonify({"success": False, "message": "Application not found"}), 404

    conn.execute(
        "UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (new_status, application_id)
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Status updated"}), 200


if __name__ == '__main__':
    app.run(debug=True, port=5000)
