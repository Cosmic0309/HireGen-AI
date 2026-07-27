// ======================================================
// HireGen AI - Login Page
// login.js
// ======================================================


// =============================
// SELECTORS
// =============================

const password = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");

const loginForm = document.getElementById("loginForm");

const loading = document.getElementById("loading");

const toast = document.getElementById("toast");

const typing = document.getElementById("typing-text");

const roles = document.querySelectorAll(".role");

const email = document.getElementById("email");

const emailError = document.getElementById("emailError");

const passwordError = document.getElementById("passwordError");
let selectedRole = document.querySelector('.role.active')?.dataset.role || 'recruiter';


// =============================
// PASSWORD SHOW / HIDE
// =============================

togglePassword.addEventListener("click", () => {

    if (password.type === "password") {

        password.type = "text";

        togglePassword.classList.remove("bi-eye-fill");

        togglePassword.classList.add("bi-eye-slash-fill");

    }

    else {

        password.type = "password";

        togglePassword.classList.remove("bi-eye-slash-fill");

        togglePassword.classList.add("bi-eye-fill");

    }

});



// =============================
// ROLE SELECTOR
// =============================

roles.forEach(role => {

    role.addEventListener("click", () => {

        roles.forEach(btn => btn.classList.remove("active"));

        role.classList.add("active");
        selectedRole = role.dataset.role || role.textContent.trim().toLowerCase();

    });

});



// =============================
// EMAIL VALIDATION
// =============================

email.addEventListener("keyup", () => {

    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (regex.test(email.value)) {

        emailError.innerHTML = "";

    }

    else {

        emailError.innerHTML = "Enter a valid email.";

    }

});



// =============================
// PASSWORD VALIDATION
// =============================

password.addEventListener("keyup", () => {

    if (password.value.length >= 6) {

        passwordError.innerHTML = "";

    }

    else {

        passwordError.innerHTML =
            "Password should contain at least 6 characters.";

    }

});



// =============================
// TOAST
// =============================

function showToast(message) {

    toast.innerHTML = message;

    toast.classList.add("show");

    setTimeout(() => {

        toast.classList.remove("show");

    }, 3000);

}



// =============================
// FORM SUBMIT
// =============================

loginForm.addEventListener("submit", async function (e) {

    e.preventDefault();

    if (email.value === "") {

        emailError.innerHTML = "Email is required.";

        return;

    }

    if (password.value.length < 6) {

        passwordError.innerHTML = "Invalid password.";

        return;

    }

    loading.style.display = "flex";

    document.querySelector(".login-btn").disabled = true;

    try {
        const response = await fetch("http://127.0.0.1:5000/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.value.trim(), password: password.value, role: selectedRole })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to log in.");

        localStorage.setItem("hiregen_token", result.token);
        localStorage.setItem("hiregen_role", result.role);
        localStorage.setItem("hiregen_user_id", result.user_id);
        localStorage.setItem("hiregen_fullname", result.fullname || "Candidate");
        loading.style.display = "none";
        showToast("Login Successful!");
        const target = result.role === "recruiter" ? "recruiter-dashboard.html" : "candidate-dashboard.html";
        setTimeout(() => { window.location.replace(target); }, 700);
    } catch (error) {
        loading.style.display = "none";
        document.querySelector(".login-btn").disabled = false;
        passwordError.innerHTML = error.message === "Failed to fetch" ? "Cannot reach the server. Start it with py app.py." : error.message;
    }

});




// =============================
// AI TYPING EFFECT
// =============================

const messages = [

    "Parsing Resume...",

    "Matching Skills...",

    "Checking ATS Score...",

    "Preparing AI Interview...",

    "Finding Best Candidates...",

    "AI Ready."

];

let msgIndex = 0;

function typingAnimation() {

    typing.innerHTML = messages[msgIndex];

    msgIndex++;

    if (msgIndex >= messages.length) {

        msgIndex = 0;

    }

}

setInterval(typingAnimation, 2200);




// =============================
// ENTER KEY
// =============================

document.addEventListener("keydown", function (e) {

    if (e.key === "Enter") {

        loginForm.requestSubmit();

    }

});




// =============================
// INPUT ANIMATION
// =============================

const inputs = document.querySelectorAll("input");

inputs.forEach(input => {

    input.addEventListener("focus", () => {

        input.parentElement.style.transform =
            "translateY(-2px)";

    });

    input.addEventListener("blur", () => {

        input.parentElement.style.transform =
            "translateY(0px)";

    });

});




// =============================
// BUTTON RIPPLE
// =============================

const buttons = document.querySelectorAll("button");

buttons.forEach(button => {

    button.addEventListener("click", function (e) {

        const ripple = document.createElement("span");

        const diameter = Math.max(
            this.clientWidth,
            this.clientHeight
        );

        ripple.style.width = ripple.style.height =
            diameter + "px";

        ripple.style.left =
            e.clientX -
            this.getBoundingClientRect().left -
            diameter / 2 + "px";

        ripple.style.top =
            e.clientY -
            this.getBoundingClientRect().top -
            diameter / 2 + "px";

        ripple.style.position = "absolute";

        ripple.style.borderRadius = "50%";

        ripple.style.background =
            "rgba(255,255,255,.35)";

        ripple.style.transform = "scale(0)";

        ripple.style.animation =
            "ripple .6s linear";

        ripple.style.pointerEvents = "none";

        this.appendChild(ripple);

        setTimeout(() => {

            ripple.remove();

        }, 600);

    });

});




// =============================
// RIPPLE STYLE
// =============================

const style = document.createElement("style");

style.innerHTML = `

@keyframes ripple{

to{

transform:scale(4);

opacity:0;

}

}

button{

position:relative;

overflow:hidden;

}

`;

document.head.appendChild(style);




// =============================
// PAGE LOADED
// =============================

window.addEventListener("load", () => {

    document.body.classList.add("fade-up");

    console.log("HireGen AI Login Ready");

});
