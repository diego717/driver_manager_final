import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

function loadDashboardHtml() {
  const filePath = path.join(process.cwd(), 'public', 'dashboard.html');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw.replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/i, '');
}

function setupDomWithDashboardScript() {
  const html = loadDashboardHtml();
  const dom = new JSDOM(html, {
    url: 'http://localhost:8787/dashboard',
    runScripts: 'outside-only'
  });

  const { window } = dom;
  const context = dom.getInternalVMContext();

  window.localStorage.clear();
  window.Chart = {
    defaults: {
      color: '#94a3b8',
      borderColor: '#334155',
      font: {}
    }
  };

  window.fetch = async () => ({
    status: 200,
    json: async () => ({})
  });

  window.matchMedia = () => ({
    matches: false,
    addEventListener() {}
  });

  window.EventSource = class {
    close() {}
  };

  const scriptPath = path.join(process.cwd(), 'public', 'dashboard.js');
  const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
  const script = new vm.Script(scriptContent, { filename: 'dashboard.js' });
  script.runInContext(context);

  return dom;
}

test('dashboard icon buttons expose explicit aria-label and pressed state', () => {
  const dom = setupDomWithDashboardScript();
  const { document } = dom.window;

  const themeToggle = document.getElementById('themeToggle');
  const refreshBtn = document.getElementById('refreshBtn');
  const closePhotoBtn = document.querySelector('#photoModal .close');

  assert.equal(themeToggle.tagName, 'BUTTON');
  assert.ok(themeToggle.getAttribute('aria-label'));
  assert.ok(['true', 'false'].includes(themeToggle.getAttribute('aria-pressed')));

  assert.equal(refreshBtn.tagName, 'BUTTON');
  assert.equal(refreshBtn.getAttribute('aria-label'), 'Actualizar dashboard');

  assert.equal(closePhotoBtn.tagName, 'BUTTON');
  assert.equal(closePhotoBtn.getAttribute('type'), 'button');
  assert.equal(closePhotoBtn.getAttribute('aria-label'), 'Cerrar visor de foto');
});

test('login modal keeps keyboard focus trapped and restores focus to trigger on close', () => {
  const dom = setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  const trigger = document.getElementById('themeToggle');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const submitBtn = document.querySelector('#loginForm button[type="submit"]');
  const loginModal = document.getElementById('loginModal');

  trigger.focus();
  window.showLogin();

  assert.ok(loginModal.classList.contains('active'));
  assert.equal(document.activeElement, loginUsername);

  submitBtn.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(document.activeElement, loginUsername);

  loginUsername.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.equal(document.activeElement, submitBtn);

  loginPassword.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.ok(!loginModal.classList.contains('active'));
  assert.equal(document.activeElement, trigger);
});

test('dashboard surface has semantic landmarks and accessible navigation hooks', () => {
  const html = loadDashboardHtml();
  const dom = new JSDOM(html);
  const { document } = dom.window;

  assert.ok(document.querySelector('nav.sidebar'));
  assert.ok(document.querySelector('main.main-content'));

  const navLinks = Array.from(document.querySelectorAll('.nav-links a'));
  assert.ok(navLinks.length >= 4);
  navLinks.forEach((link) => {
    assert.equal(link.getAttribute('href'), '#');
    assert.ok(link.dataset.section);
  });
});
