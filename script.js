/* HireGen AI – interaction layer */
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

window.addEventListener('load', () => {
  document.body.classList.add('is-ready');
  const preloader = document.getElementById('preloader');
  setTimeout(() => preloader?.classList.add('is-hidden'), 250);
});

if (window.AOS) {
  AOS.init({ duration: 700, once: true, offset: 80, easing: 'ease-out-cubic' });
}

const navbar = document.querySelector('.navbar');
const menuButton = document.querySelector('.menu');
const navLinks = document.querySelector('.nav-links');

const updateNavbar = () => navbar?.classList.toggle('is-scrolled', window.scrollY > 24);
updateNavbar();
window.addEventListener('scroll', updateNavbar, { passive: true });

const toggleMenu = () => {
  const isOpen = navLinks.classList.toggle('active');
  menuButton.classList.toggle('is-open', isOpen);
  menuButton.setAttribute('aria-expanded', String(isOpen));
};
menuButton?.addEventListener('click', toggleMenu);
menuButton?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleMenu(); }
});

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (event) => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    navLinks?.classList.remove('active');
    menuButton?.classList.remove('is-open');
  });
});

const navItems = document.querySelectorAll('.nav-links a');
const sections = [...document.querySelectorAll('section[id]')];
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    navItems.forEach((item) => item.classList.toggle('active', item.getAttribute('href') === `#${entry.target.id}`));
  });
}, { rootMargin: '-35% 0px -55% 0px' });
sections.forEach((section) => sectionObserver.observe(section));

const counters = document.querySelectorAll('.count');
const animateCounter = (counter) => {
  const original = counter.dataset.value || counter.textContent.trim();
  counter.dataset.value = original;
  const number = Number.parseInt(original.replace(/\D/g, ''), 10);
  const suffix = original.replace(/[\d]/g, '');
  const start = performance.now();
  const duration = 1300;
  const tick = (time) => {
    const progress = Math.min((time - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    counter.textContent = `${Math.round(number * eased)}${suffix}`;
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const counterSection = document.querySelector('.counter-section');
if (counterSection) {
  new IntersectionObserver(([entry], observer) => {
    if (!entry.isIntersecting) return;
    counters.forEach(animateCounter);
    observer.disconnect();
  }, { threshold: .35 }).observe(counterSection);
}

document.querySelectorAll('.faq-item').forEach((item, index) => {
  const question = item.querySelector('h3');
  const answer = item.querySelector('p');
  question?.setAttribute('role', 'button');
  question?.setAttribute('tabindex', '0');
  question?.setAttribute('aria-expanded', 'false');
  const toggle = () => {
    const open = !item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach((other) => {
      other.classList.remove('open');
      other.querySelector('h3')?.setAttribute('aria-expanded', 'false');
      other.querySelector('p').style.maxHeight = null;
    });
    if (open) {
      item.classList.add('open');
      question?.setAttribute('aria-expanded', 'true');
      answer.style.maxHeight = `${answer.scrollHeight}px`;
    }
  };
  question?.addEventListener('click', toggle);
  question?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
  });
  if (index === 0) answer.style.maxHeight = null;
});

const showToast = (message) => {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 250); }, 3200);
};

document.querySelector('.contact-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  event.currentTarget.reset();
  showToast('Thanks — your message has been sent.');
});

document.querySelectorAll('.btn-primary, .btn-outline').forEach((button) => {
  button.addEventListener('click', (event) => {
    if (prefersReducedMotion) return;
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);
  });
});

const topButton = document.createElement('button');
topButton.className = 'top-btn';
topButton.type = 'button';
topButton.setAttribute('aria-label', 'Back to top');
topButton.innerHTML = '<i class="bi bi-arrow-up"></i>';
document.body.appendChild(topButton);
window.addEventListener('scroll', () => topButton.classList.toggle('show', window.scrollY > 520), { passive: true });
topButton.addEventListener('click', () => window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' }));

const copyright = document.querySelector('.copyright');
if (copyright) copyright.innerHTML = `&copy; ${new Date().getFullYear()} HireGen AI. All rights reserved.`;
