/**
 * HireGen AI - Modern ES6 Client Logic
 */

document.addEventListener('DOMContentLoaded', () => {

    const BACKEND_URL = 'http://127.0.0.1:5000';

    // 1. Continuous Terminal Simulator
    const typingTextElement = document.getElementById('typing-text');
    const phrases = [
        "Creating Smart Profile...",
        "Uploading Resume...",
        "Calculating ATS Score...",
        "Preparing AI Interview...",
        "Matching Skills...",
        "Ready."
    ];

    let phraseIdx = 0, charIdx = 0, isDeleting = false;

    function typeLoop() {
        const current = phrases[phraseIdx];
        typingTextElement.textContent = isDeleting
            ? current.substring(0, charIdx - 1)
            : current.substring(0, charIdx + 1);

        charIdx += isDeleting ? -1 : 1;
        let speed = isDeleting ? 30 : 70;

        if (!isDeleting && charIdx === current.length) {
            speed = 1800;
            isDeleting = true;
        } else if (isDeleting && charIdx === 0) {
            isDeleting = false;
            phraseIdx = (phraseIdx + 1) % phrases.length;
            speed = 400;
        }
        setTimeout(typeLoop, speed);
    }
    typeLoop();


    // 2. Role Selector Switcher
    const btnRecruiter = document.getElementById('btn-recruiter');
    const btnCandidate = document.getElementById('btn-candidate');
    const roleSlider = document.getElementById('role-slider');
    const recruiterFields = document.getElementById('recruiter-fields');
    const candidateFields = document.getElementById('candidate-fields');
    let currentRole = 'recruiter';

    function setRole(role) {
        currentRole = role;
        if (role === 'recruiter') {
            btnRecruiter.classList.add('active');
            btnCandidate.classList.remove('active');
            roleSlider.style.transform = 'translateX(0%)';

            candidateFields.classList.remove('active');
            setTimeout(() => {
                candidateFields.style.display = 'none';
                recruiterFields.style.display = 'block';
                setTimeout(() => recruiterFields.classList.add('active'), 10);
            }, 200);
        } else {
            btnCandidate.classList.add('active');
            btnRecruiter.classList.remove('active');
            roleSlider.style.transform = 'translateX(100%)';

            recruiterFields.classList.remove('active');
            setTimeout(() => {
                recruiterFields.style.display = 'none';
                candidateFields.style.display = 'block';
                setTimeout(() => candidateFields.classList.add('active'), 10);
            }, 200);
        }
    }

    btnRecruiter.addEventListener('click', () => setRole('recruiter'));
    btnCandidate.addEventListener('click', () => setRole('candidate'));


    // 3. Password Field Toggles
    document.querySelectorAll('.toggle-pwd').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.getAttribute('data-target'));
            input.type = input.type === 'password' ? 'text' : 'password';
            btn.style.color = input.type === 'text' ? 'var(--secondary)' : 'var(--text-dark)';
        });
    });


    // 4. Live Validation & Borders
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const phoneInput = document.getElementById('phone');
    const companyWebsiteInput = document.getElementById('company-website');
    const strengthBar = document.getElementById('strength-bar');
    const strengthText = document.getElementById('strength-text');
    const termsCheckbox = document.getElementById('terms-checkbox');
    const submitBtn = document.getElementById('submit-btn');

    let emailDebounceTimer;

    function applyInputState(inputEl, isValid, errorId, errorMsg = '') {
        const errorEl = document.getElementById(errorId);
        if (isValid) {
            inputEl.classList.remove('invalid-input');
            inputEl.classList.add('valid-input');
            if (errorEl) errorEl.textContent = '';
        } else {
            inputEl.classList.remove('valid-input');
            inputEl.classList.add('invalid-input');
            if (errorEl) errorEl.textContent = errorMsg;
        }
    }

    // Live Email Check
    emailInput.addEventListener('input', () => {
        clearTimeout(emailDebounceTimer);
        const email = emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            applyInputState(emailInput, false, 'error-email', 'Enter a valid email address');
            return;
        }

        emailDebounceTimer = setTimeout(async () => {
            try {
                const res = await fetch(`${BACKEND_URL}/check-email?email=${encodeURIComponent(email)}`);
                const data = await res.json();
                if (data.exists) {
                    applyInputState(emailInput, false, 'error-email', 'Email already in use');
                } else {
                    applyInputState(emailInput, true, 'error-email');
                }
            } catch (err) {
                applyInputState(emailInput, true, 'error-email');
            }
        }, 400);
    });

    // Live Phone Check
    phoneInput.addEventListener('input', () => {
        const valid = phoneInput.value.trim().length >= 7;
        applyInputState(phoneInput, valid, 'error-phone', valid ? '' : 'Invalid phone number');
    });

    // Live URL Check
    if (companyWebsiteInput) {
        companyWebsiteInput.addEventListener('input', () => {
            const val = companyWebsiteInput.value.trim();
            const valid = !val || /^(https?:\/\/)?([\w\d\-]+\.)+[\w]{2,}(\/.*)?$/i.test(val);
            applyInputState(companyWebsiteInput, valid, 'error-company-website', valid ? '' : 'Invalid URL');
        });
    }

    // Password Strength & Match Indicator
    passwordInput.addEventListener('input', () => {
        const val = passwordInput.value;
        if (!val) {
            strengthBar.style.width = '0%';
            strengthText.textContent = 'Password strength';
            applyInputState(passwordInput, false, 'error-password', 'Password required');
            return;
        }

        let score = 0;
        if (val.length >= 10) score++;
        if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
        if (/[0-9]/.test(val)) score++;
        if (/[^A-Za-z0-9]/.test(val)) score++;

        const colors = ['var(--error)', '#FFBD2E', '#3B82F6', 'var(--success)'];
        const labels = ['Weak', 'Fair', 'Good', 'Strong'];

        strengthBar.style.width = `${score * 25}%`;
        strengthBar.style.backgroundColor = colors[score - 1] || colors[0];
        strengthText.textContent = labels[score - 1] || labels[0];
        strengthText.style.color = colors[score - 1] || colors[0];

        const validPassword = val.length >= 10 && /[A-Z]/.test(val) && /[a-z]/.test(val) && /[0-9]/.test(val);
        applyInputState(passwordInput, validPassword, 'error-password', validPassword ? '' : 'Use 10+ characters with uppercase, lowercase, and a number');
    });

    confirmPasswordInput.addEventListener('input', () => {
        const matches = confirmPasswordInput.value === passwordInput.value && confirmPasswordInput.value.length > 0;
        applyInputState(confirmPasswordInput, matches, 'error-confirm-password', matches ? '' : 'Passwords do not match');
    });


    // 5. Drag-and-Drop Resume File Handler
    const resumeDropzone = document.getElementById('resume-dropzone');
    const resumeFileInput = document.getElementById('resume-file');
    const resumeFileInfo = document.getElementById('resume-file-info');
    const fileNameDisplay = document.getElementById('file-name-display');
    const fileSizeDisplay = document.getElementById('file-size-display');
    const removeResumeBtn = document.getElementById('remove-resume-btn');
    const progressBar = document.getElementById('upload-progress-bar');
    const progressContainer = document.getElementById('upload-progress-container');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        resumeDropzone.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    ['dragenter', 'dragover'].forEach(name => resumeDropzone.addEventListener(name, () => resumeDropzone.classList.add('dragover')));
    ['dragleave', 'drop'].forEach(name => resumeDropzone.addEventListener(name, () => resumeDropzone.classList.remove('dragover')));

    resumeDropzone.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        if (files.length) handleResumeSelected(files[0]);
    });

    resumeFileInput.addEventListener('change', e => {
        if (e.target.files.length) handleResumeSelected(e.target.files[0]);
    });

    function handleResumeSelected(file) {
        if (file.type !== 'application/pdf') {
            applyInputState(resumeFileInput, false, 'error-resume-file', 'Only PDF files allowed');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            applyInputState(resumeFileInput, false, 'error-resume-file', 'File size exceeds 10MB limit');
            return;
        }

        fileNameDisplay.textContent = file.name;
        fileSizeDisplay.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;

        // Progress simulation
        progressContainer.classList.remove('hidden');
        progressBar.style.width = '0%';
        let p = 0;
        const interval = setInterval(() => {
            p += 25;
            progressBar.style.width = `${p}%`;
            if (p >= 100) {
                clearInterval(interval);
                setTimeout(() => progressContainer.classList.add('hidden'), 300);
            }
        }, 100);

        resumeFileInfo.classList.remove('hidden');
        applyInputState(resumeFileInput, true, 'error-resume-file');
    }

    removeResumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resumeFileInput.value = '';
        resumeFileInfo.classList.add('hidden');
    });


    // // 6. Recruiter Company Logo Dropzone Handler
    // const logoDropzone = document.getElementById('logo-dropzone');
    // const logoFileInput = document.getElementById('company-logo');
    // const logoPreviewContainer = document.getElementById('logo-preview-container');
    // const logoPreviewImg = document.getElementById('logo-preview-img');
    // const logoDropzoneContent = document.getElementById('logo-dropzone-content');
    // const removeLogoBtn = document.getElementById('remove-logo-btn');

    // logoFileInput.addEventListener('change', (e) => {
    //     if (e.target.files.length) {
    //         const file = e.target.files[0];
    //         const reader = new FileReader();
    //         reader.onload = (evt) => {
    //             logoPreviewImg.src = evt.target.result;
    //             logoDropzoneContent.classList.add('hidden');
    //             logoPreviewContainer.classList.remove('hidden');
    //         };
    //         reader.readAsDataURL(file);
    //     }
    // });

    // removeLogoBtn.addEventListener('click', (e) => {
    //     e.stopPropagation();
    //     logoFileInput.value = '';
    //     logoPreviewContainer.classList.add('hidden');
    //     logoDropzoneContent.classList.remove('hidden');
    // });


    // 7. Checkbox Enabling Submit Button
    function validateFullForm() {
        const isTermsChecked = termsCheckbox.checked;
        const isEmailValid = emailInput.classList.contains('valid-input');
        const isPasswordValid = passwordInput.classList.contains('valid-input');
        const isConfirmValid = confirmPasswordInput.value === passwordInput.value && confirmPasswordInput.value !== '';
        const isPhoneValid = phoneInput.value.trim().length >= 7;

        submitBtn.disabled = !(isTermsChecked && isEmailValid && isPasswordValid && isConfirmValid && isPhoneValid);
    }

    // Attach listener to inputs
    [termsCheckbox, emailInput, passwordInput, confirmPasswordInput, phoneInput].forEach(el => {
        el.addEventListener('input', validateFullForm);
        el.addEventListener('change', validateFullForm);
    });


    // 8. Multi-Step AI Stepper & Form Submission
    const signupForm = document.getElementById('signup-form');
    const aiModal = document.getElementById('ai-modal-overlay');
    const successModal = document.getElementById('success-modal-overlay');

    async function runAiStepperAnimation(atsData) {
        aiModal.classList.remove('hidden');
        const steps = [1, 2, 3, 4, 5, 6];

        for (let i = 0; i < steps.length; i++) {
            const stepEl = document.getElementById(`step-${steps[i]}`);
            stepEl.classList.add('active');
            await new Promise(r => setTimeout(r, 450));
            stepEl.classList.remove('active');
            stepEl.classList.add('completed');
        }

        aiModal.classList.add('hidden');
    }

    function showSuccessModal(atsData) {
        successModal.classList.remove('hidden');
        triggerConfetti();

        if (atsData && atsData.ats_score) {
            document.getElementById('ats-result-container').classList.remove('hidden');
            document.getElementById('ats-score-value').textContent = atsData.ats_score;

            const tagsBox = document.getElementById('skills-tags-container');
            tagsBox.innerHTML = '';
            (atsData.skills || []).forEach(skill => {
                const tag = document.createElement('span');
                tag.className = 'skill-tag';
                tag.textContent = skill;
                tagsBox.appendChild(tag);
            });
        }

        // Redirect Countdown
        let count = 3;
        const countdownEl = document.getElementById('countdown-timer');
        const interval = setInterval(() => {
            count--;
            countdownEl.textContent = count;
            if (count <= 0) {
                clearInterval(interval);
                const redirectTarget = currentRole === 'candidate' ? 'candidate-dashboard.html' : 'recruiter-dashboard.html';
                window.location.href = redirectTarget;
            }
        }, 1000);
    }

    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(signupForm);
        formData.append('role', currentRole);

        // Append explicit files if drag-dropped
        if (currentRole === 'candidate' && resumeFileInput.files.length) {
            formData.set('resume', resumeFileInput.files[0]);
        }

        submitBtn.disabled = true;

        try {
            // The overlay communicates progress but does not decide whether signup succeeded.
            const animation = runAiStepperAnimation();
            const response = await fetch(`${BACKEND_URL}/signup`, {
                method: 'POST',
                body: formData
            });

            const result = await response.json();
            await animation;

            if (response.ok && result.success) {
                // Store JWT Token & Session Data
                localStorage.setItem('hiregen_token', result.token);
                localStorage.setItem('hiregen_role', result.role);
                localStorage.setItem('hiregen_user_id', result.user_id);
                localStorage.setItem('hiregen_fullname', formData.get('fullname').trim());
                showSuccessModal(result.ats_data);
            } else {
                aiModal.classList.add('hidden');
                submitBtn.disabled = false;
                alert(`Signup Error: ${result.message}`);
            }
        } catch (err) {
            aiModal.classList.add('hidden');
            submitBtn.disabled = false;
            alert('Unable to reach HireGen AI. Start the Flask server with "py app.py" and try again.');
        }
    });


    // 9. Confetti Particle Generator
    function triggerConfetti() {
        const canvas = document.getElementById('confetti-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const pieces = [];
        const colors = ['#6C63FF', '#00E5FF', '#8B5CF6', '#10B981', '#FFBD2E'];

        for (let i = 0; i < 80; i++) {
            pieces.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height - canvas.height,
                size: Math.random() * 8 + 4,
                color: colors[Math.floor(Math.random() * colors.length)],
                speed: Math.random() * 5 + 2,
                rotation: Math.random() * 360
            });
        }

        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            pieces.forEach(p => {
                ctx.save();
                ctx.fillStyle = p.color;
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
                ctx.restore();

                p.y += p.speed;
                p.rotation += 2;
            });

            if (pieces.some(p => p.y < canvas.height)) {
                requestAnimationFrame(draw);
            }
        }
        draw();
    }
});
