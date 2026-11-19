// Demo website glue: find this visit's embed key and load the real widget bundle with it,
// exactly as a customer's website would (`<script src=".../v1/luciel.js" data-key="...">`).
// The key comes from ?key= (the dashboard's "Try it on the demo website" link) or from the
// last key used on this page; a key typed into the bar replaces it.
(function () {
  'use strict';

  var STORAGE_KEY = 'luciel-demo-embed-key';
  // Embed keys are public ids such as vm_live_1a2b3c4d5e6f; this only rejects typos.
  var KEY_SHAPE = /^[A-Za-z0-9_-]{6,80}$/;

  var status = document.getElementById('demo-status');
  var toggle = document.querySelector('.demo-bar__toggle');
  var panel = document.getElementById('key-panel');
  var form = document.getElementById('key-form');
  var input = document.getElementById('key-input');

  function setStatus(text) {
    status.textContent = text;
  }

  function openPanel() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    input.focus();
  }

  function storedKey() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function storeKey(key) {
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch (e) {
      // Private windows can refuse storage; the ?key= link still works.
    }
  }

  toggle.addEventListener('click', function () {
    if (panel.hidden) {
      openPanel();
    } else {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var key = input.value.trim();
    if (!KEY_SHAPE.test(key)) {
      setStatus('That does not look like an embed key. Copy it from the dashboard and try again.');
      input.focus();
      return;
    }
    var url = new URL(window.location.href);
    url.searchParams.set('key', key);
    window.location.assign(url.toString());
  });

  // The widget refuses plain-http pages on any host other than "localhost".
  if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
    setStatus(
      'Open this page at http://localhost:' +
        (window.location.port || '80') +
        ' — the chat only runs on https pages or on localhost.',
    );
    return;
  }

  var fromLink = new URLSearchParams(window.location.search).get('key');
  var key = fromLink && KEY_SHAPE.test(fromLink) ? fromLink : storedKey();
  if (!key || !KEY_SHAPE.test(key)) {
    setStatus(
      'No Luciel chosen yet. Sign in to the dashboard (http://localhost:3000), open Embed & launch, and click "Try it on the demo website".',
    );
    document.getElementById('chat-hint').hidden = true;
    return;
  }
  if (fromLink) storeKey(key);
  input.value = key;

  var script = document.createElement('script');
  script.src = '/v1/luciel.js';
  script.setAttribute('data-key', key);
  script.onerror = function () {
    setStatus('The chat script did not load. Is the demo-site container running?');
  };
  document.body.appendChild(script);
  setStatus(
    'The chat in the bottom-right corner is Luciel, answering from this Luciel’s own knowledge.',
  );
})();
