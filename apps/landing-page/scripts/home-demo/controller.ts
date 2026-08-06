/*
 * Controller for the workspace demo document: renders the project rail and the
 * design-system chips, drives the transcript, and relays scroll/scene messages
 * to the host page. Emitted into each locale's demo document by
 * `../build-home-demo.ts`.
 *
 * Exported as a source string for the same reason as the artifact runtime: the
 * repository is TypeScript-first, while the demo needs plain classic-script
 * JavaScript at runtime.
 */

export const DEMO_CONTROLLER_JS = String.raw`var SYSTEMS = [], scene = 'web', sysIndex = 0, timers = [];
var log = document.getElementById('log');
var inp = document.getElementById('inp'), send = document.getElementById('send');
var skel = document.getElementById('skel'), aw = document.getElementById('aw');
var art = document.getElementById('art'), cap = document.getElementById('capname');
var ebox = document.getElementById('ebox'), etag = ebox.querySelector('.tag');

function el(cls, html) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; }

function renderSysbar() {
  var bar = document.getElementById('sysbar');
  bar.innerHTML = '';
  SYSTEMS.forEach(function (sys, i) {
    var b = document.createElement('b');
    if (i === sysIndex) b.className = 'on';
    var sw = document.createElement('i');
    sw.style.background = sys.accent;
    b.appendChild(sw);
    b.appendChild(document.createTextNode(sys.label));
    b.addEventListener('click', function () { if (i !== sysIndex) selectSystem(i); });
    bar.appendChild(b);
  });
}

function paint() {
  ODArtifacts.applySystem(art, SYSTEMS[sysIndex]);
  ODArtifacts.guardAccentText(art, SYSTEMS[sysIndex]);
  ODArtifacts.render(art, scene, LOCALE);
  cap.textContent = SYSTEMS[sysIndex].label + ' · ' + STR.capname;
}

function runTranscript() {
  timers.forEach(clearTimeout); timers = [];
  var S = SCENES[scene];
  log.innerHTML = '';
  log.appendChild(el('mu', S.prompt + ' (' + SYSTEMS[sysIndex].label + ')'));
  var sl = el('stepsline', '');
  S.steps.forEach(function (st) { var d = document.createElement('div'); d.textContent = st; sl.appendChild(d); });
  var rd = document.createElement('div'); rd.className = 'ready'; rd.textContent = STR.ready;
  sl.appendChild(rd);
  log.appendChild(sl);
  var kids = sl.querySelectorAll('div:not(.ready)');
  var t = 160;
  kids.forEach(function (st, k) {
    timers.push(setTimeout(function () {
      kids.forEach(function (x, j) { x.className = j < k ? 'ok show' : (j === k ? 'run show' : x.className); });
    }, t));
    t += 420;
  });
  timers.push(setTimeout(function () {
    kids.forEach(function (x) { x.className = 'ok show'; });
    rd.classList.add('show');
  }, t + 120));
}

function selectSystem(i) {
  sysIndex = i; renderSysbar(); hideBox();
  aw.classList.remove('in'); skel.classList.add('show');
  setTimeout(function () { paint(); skel.classList.remove('show'); aw.classList.add('in'); bindEditTracking(); }, 260);
  runTranscript();
}

function selectScene(next) {
  scene = next;
  aw.classList.remove('in'); skel.classList.add('show');
  setTimeout(function () { paint(); skel.classList.remove('show'); aw.classList.add('in'); bindEditTracking(); }, 260);
  runTranscript();
}

/* Hover-to-edit affordance: the artifact is live DOM, so designMode makes the
   "everything stays editable" claim literally true inside the demo. */
var lastEl = null;
function hideBox() { ebox.style.opacity = 0; lastEl = null; }
function placeBox(t) {
  var r = t.getBoundingClientRect(), a = aw.getBoundingClientRect();
  if (r.width < 3 || r.height < 3) { hideBox(); return; }
  ebox.style.left = (r.left - a.left) + 'px';
  ebox.style.top = (r.top - a.top) + 'px';
  ebox.style.width = r.width + 'px';
  ebox.style.height = r.height + 'px';
  etag.textContent = t.tagName.toLowerCase() + ' · editable';
  ebox.style.opacity = 1;
}
function bindEditTracking() {
  art.querySelectorAll('h1,p,b,span,i,li,u').forEach(function (n) {
    n.addEventListener('mouseenter', function () { if ((n.textContent || '').trim()) { lastEl = n; placeBox(n); } });
  });
}
art.addEventListener('mouseleave', hideBox);

var stageEl = document.getElementById('stage'), ehint = document.getElementById('ehint');
stageEl.addEventListener('click', function () {
  if (!document.body.classList.contains('live')) {
    document.body.classList.add('live');
    try { art.contentEditable = 'true'; } catch (e) {}
    ehint.textContent = STR.hint2;
  }
});
stageEl.addEventListener('mouseleave', function () {
  document.body.classList.remove('live');
  try { art.contentEditable = 'false'; } catch (e) {}
  ehint.textContent = STR.hint;
  hideBox();
});

function userSend() {
  var v = (inp.value || '').trim();
  if (!v) return;
  inp.value = '';
  log.appendChild(el('mu', v.replace(/[<>&]/g, '')));
  log.scrollTop = log.scrollHeight;
  setTimeout(function () {
    var a = el('ma', STR.reply + '<br><span class="dlmini"><em><svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 1.2v7.4M2.7 5.4 6 8.7l3.3-3.3"/></svg></em> ' + STR.dl + '</span>');
    log.appendChild(a);
    log.scrollTop = log.scrollHeight;
    a.querySelector('.dlmini').addEventListener('click', function () { parent.postMessage('od-download', '*'); });
  }, 620);
}
send.addEventListener('click', userSend);
inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') userSend(); });

window.addEventListener('message', function (e) {
  if (e.data && e.data.scene && SCENES[e.data.scene]) selectScene(e.data.scene);
});

/* Wheel over the demo scrolls the host page unless a pane can still scroll. */
document.addEventListener('wheel', function (e) {
  var sc = e.target.closest ? e.target.closest('.log') : null;
  if (sc) {
    var can = sc.scrollHeight - sc.clientHeight > 4;
    var atTop = sc.scrollTop <= 0, atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
    if (can && !((e.deltaY > 0 && atEnd) || (e.deltaY < 0 && atTop))) return;
  }
  parent.postMessage({ odScroll: e.deltaY }, '*');
}, { passive: true });

fetch('/home-redesign/design-systems.json')
  .then(function (r) { return r.json(); })
  .then(function (data) {
    SYSTEMS = data; renderSysbar(); paint(); runTranscript();
    aw.classList.add('in');
    bindEditTracking();
  })
  .catch(function () {});
`;
