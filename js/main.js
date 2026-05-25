/* ============================================================
   BRRRR8 — main.js
   Nav · Hamburger · FAQ accordion · Smooth scroll
   Course accordions · Enroll form
   ============================================================ */

(function () {
  'use strict';

  /* ── run after DOM ready ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    initNav();
    initFaq();
    initCourseAccordions();
    initSmoothScroll();
    initEnrollForm();
  }

  /* ============================================================
     NAV — scroll shadow + mobile hamburger
     ============================================================ */
  function initNav() {
    var nav        = document.getElementById('nav');
    var hamburger  = document.getElementById('hamburger');
    var mobileMenu = document.getElementById('mobile-menu');

    if (!nav) return;

    /* Scroll shadow */
    function onScroll() {
      nav.classList.toggle('scrolled', window.scrollY > 10);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* Hamburger toggle */
    if (hamburger && mobileMenu) {
      hamburger.addEventListener('click', function () {
        var open = mobileMenu.classList.toggle('open');
        hamburger.classList.toggle('open', open);
        hamburger.setAttribute('aria-expanded', String(open));
      });

      /* Close drawer when a link inside it is clicked */
      mobileMenu.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') {
          mobileMenu.classList.remove('open');
          hamburger.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
        }
      });

      /* Close drawer on outside click */
      document.addEventListener('click', function (e) {
        if (!nav.contains(e.target)) {
          mobileMenu.classList.remove('open');
          hamburger.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
        }
      });

      /* Close on Escape */
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && mobileMenu.classList.contains('open')) {
          mobileMenu.classList.remove('open');
          hamburger.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
          hamburger.focus();
        }
      });
    }
  }

  /* ============================================================
     SMOOTH SCROLL — offset for fixed nav (68px)
     ============================================================ */
  function initSmoothScroll() {
    var NAV_H = 68;

    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;

      var hash   = link.getAttribute('href');
      var target = document.querySelector(hash);
      if (!target) return;

      e.preventDefault();
      var top = target.getBoundingClientRect().top + window.scrollY - NAV_H - 8;
      window.scrollTo({ top: top, behavior: 'smooth' });

      /* Update URL without triggering jump */
      history.pushState(null, '', hash);
    });
  }

  /* ============================================================
     FAQ ACCORDION — one panel open at a time
     ============================================================ */
  function initFaq() {
    var items = document.querySelectorAll('.accordion__item');
    if (!items.length) return;

    items.forEach(function (item) {
      var trigger = item.querySelector('.accordion__trigger');
      if (!trigger) return;

      trigger.addEventListener('click', function () {
        var isOpen = item.classList.contains('open');

        /* Close all */
        items.forEach(function (other) {
          other.classList.remove('open');
          var t = other.querySelector('.accordion__trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        });

        /* Open clicked (unless it was already open — acts as toggle) */
        if (!isOpen) {
          item.classList.add('open');
          trigger.setAttribute('aria-expanded', 'true');
        }
      });

      /* Keyboard: Enter / Space already fire click on <button>; also support arrow keys */
      trigger.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          focusAdjacentAccordion(items, item, 1);
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          focusAdjacentAccordion(items, item, -1);
        }
      });
    });
  }

  function focusAdjacentAccordion(items, current, dir) {
    var arr = Array.from(items);
    var idx = arr.indexOf(current);
    var next = arr[idx + dir];
    if (next) {
      var t = next.querySelector('.accordion__trigger');
      if (t) t.focus();
    }
  }

  /* ============================================================
     COURSE ACCORDIONS — track cards + module items
     ============================================================ */
  function initCourseAccordions() {

    /* ── Track cards ── */
    var trackHeaders = document.querySelectorAll('[data-track-toggle]');
    trackHeaders.forEach(function (header) {
      header.addEventListener('click', toggleTrack.bind(null, header));
      header.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleTrack(header);
        }
      });
    });

    function toggleTrack(header) {
      var card = header.closest('.track-card');
      if (!card) return;
      var open = card.classList.toggle('open');
      header.setAttribute('aria-expanded', String(open));

      /* Auto-open first module when track opens, close when track closes */
      if (open) {
        var firstModule = card.querySelector('.module-item');
        if (firstModule && !firstModule.classList.contains('open')) {
          openModule(firstModule);
        }
      }
    }

    /* ── Module items (nested inside track cards) ── */
    var moduleTriggers = document.querySelectorAll('[data-module-toggle]');
    moduleTriggers.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.module-item');
        if (!item) return;
        var opening = !item.classList.contains('open');
        if (opening) {
          openModule(item);
        } else {
          closeModule(item);
        }
      });
    });

    function openModule(item) {
      item.classList.add('open');
      var btn = item.querySelector('[data-module-toggle]');
      if (btn) btn.setAttribute('aria-expanded', 'true');
    }

    function closeModule(item) {
      item.classList.remove('open');
      var btn = item.querySelector('[data-module-toggle]');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    /* ── Track thumbnails — click to scroll to + open track card ── */
    var thumbs = document.querySelectorAll('.track-thumb');
    thumbs.forEach(function (thumb, i) {
      thumb.addEventListener('click', function () {
        var cards = document.querySelectorAll('.track-card');
        var target = cards[i];
        if (!target) return;

        /* Open if not already open */
        if (!target.classList.contains('open')) {
          var header = target.querySelector('[data-track-toggle]');
          if (header) toggleTrack(header);
        }

        /* Scroll to card */
        var NAV_H = 68;
        var top = target.getBoundingClientRect().top + window.scrollY - NAV_H - 16;
        window.scrollTo({ top: top, behavior: 'smooth' });
      });
    });
  }

  /* ============================================================
     ENROLL FORM — step navigation, validation, review, submit
     ============================================================ */
  function initEnrollForm() {
    /* Guard: only run on enroll page */
    if (!document.querySelector('[data-step]')) return;

    /* ── State ── */
    var state = {
      step:       1,
      plan:       'all-access',
      planLabel:  'All Access',
      planPrice:  '$1,997'
    };

    var planMap = {
      'starter':    { label: 'Starter',      price: '$1,497' },
      'all-access': { label: 'All Access',    price: '$1,997' },
      'vip':        { label: 'VIP Coaching',  price: '$2,497' }
    };

    /* ── Show cancelled banner if returning from Stripe cancel ── */
    (function () {
      if (new URLSearchParams(window.location.search).get('cancelled') !== '1') return;
      var banner = document.createElement('div');
      banner.setAttribute('role', 'alert');
      banner.style.cssText =
        'background:#FFF3CD;border:1px solid #FFEAA7;color:#856404;padding:12px 20px;' +
        'border-radius:8px;font-size:14px;text-align:center;margin-bottom:20px;';
      banner.textContent = 'Your payment was cancelled — no charge was made. Pick up where you left off below.';
      var wrap = document.querySelector('.enroll-wrap');
      if (wrap) wrap.insertBefore(banner, wrap.firstChild);
      // Clean URL without reloading
      history.replaceState(null, '', location.pathname);
    })();

    /* ── DOM refs ── */
    var steps      = document.querySelectorAll('.form-step');
    var indicators = document.querySelectorAll('[data-step-indicator]');
    var progressEl = document.getElementById('enrollProgress');
    var successEl  = document.getElementById('enrollSuccess');

    /* ── Step navigation ── */
    function goTo(n) {
      state.step = n;

      steps.forEach(function (el) {
        el.classList.remove('active');
      });

      var target = document.querySelector('[data-step="' + n + '"]');
      if (target) target.classList.add('active');

      indicators.forEach(function (el, i) {
        el.classList.remove('active', 'completed');
        var num = i + 1;
        if (num < n)  el.classList.add('completed');
        if (num === n) el.classList.add('active');
      });

      /* Mark connector lines completed */
      indicators.forEach(function (el, i) {
        var num = i + 1;
        if (num < n) el.classList.add('completed');
      });

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ── Plan selection ── */
    var planCards = document.querySelectorAll('.plan-select-card');

    function selectPlan(val) {
      if (!planMap[val]) return;
      state.plan      = val;
      state.planLabel = planMap[val].label;
      state.planPrice = planMap[val].price;

      planCards.forEach(function (card) {
        var radio   = card.querySelector('input[type="radio"]');
        var isMatch = card.dataset.plan === val;
        card.classList.toggle('selected', isMatch);
        if (radio) radio.checked = isMatch;
      });
    }

    planCards.forEach(function (card) {
      card.addEventListener('click', function (e) {
        /* Don't re-fire when clicking an already-focused radio */
        selectPlan(card.dataset.plan);
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectPlan(card.dataset.plan);
        }
      });
    });

    /* Pre-select from URL query param (?plan=starter etc.) */
    (function () {
      var params = new URLSearchParams(window.location.search);
      var p = params.get('plan');
      if (p && planMap[p]) selectPlan(p);
    })();

    /* ── Field helpers ── */
    function val(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }

    function setError(groupId, msg) {
      var grp = document.getElementById('grp-' + groupId);
      if (!grp) return;
      grp.classList.add('has-error');
      var errEl = grp.querySelector('.field-error');
      if (errEl) errEl.textContent = msg;
    }

    function clearError(groupId) {
      var grp = document.getElementById('grp-' + groupId);
      if (!grp) return;
      grp.classList.remove('has-error');
      var errEl = grp.querySelector('.field-error');
      if (errEl) errEl.textContent = '';
    }

    function isValidEmail(s) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    }

    function isValidPhone(s) {
      return /^[\d\s\-().+]{7,20}$/.test(s);
    }

    function escHtml(s) {
      return String(s)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;');
    }

    /* ── Step 2 validation ── */
    function validateStep2() {
      var ok = true;
      var required = ['firstName', 'lastName', 'email', 'city', 'state', 'howHeard'];

      required.forEach(function (id) {
        clearError(id);
        if (!val(id)) {
          setError(id, 'This field is required.');
          ok = false;
        }
      });

      if (val('email') && !isValidEmail(val('email'))) {
        setError('email', 'Please enter a valid email address.');
        ok = false;
      }

      var phone = val('phone');
      clearError('phone');
      if (phone && !isValidPhone(phone)) {
        setError('phone', 'Please enter a valid phone number.');
        ok = false;
      }

      if (!ok) {
        var first = document.querySelector('.has-error .form-input, .has-error .form-select');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return ok;
    }

    /* ── Step 3 validation ── */
    function validateStep3() {
      var ok = true;

      clearError('doorsOwned');
      if (!val('doorsOwned')) {
        setError('doorsOwned', 'Please select how many doors you own.');
        ok = false;
      }

      var checked   = document.querySelectorAll('[name="topics"]:checked');
      var topicsErr = document.getElementById('topicsError');
      if (topicsErr) {
        if (checked.length === 0) {
          topicsErr.classList.add('visible');
          ok = false;
        } else {
          topicsErr.classList.remove('visible');
        }
      }

      clearError('goal');
      if (!val('goal')) {
        setError('goal', 'Please describe your 12-month goal.');
        ok = false;
      }

      if (!ok) {
        var first = document.querySelector('.has-error .form-input, .has-error .form-select, .has-error .form-textarea, .topics-error.visible');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return ok;
    }

    /* ── Step 4 validation ── */
    function validateStep4() {
      var ack1   = document.getElementById('ack1');
      var ack2   = document.getElementById('ack2');
      var errEl  = document.getElementById('ackError');
      var label1 = document.getElementById('ack1Label');
      var label2 = document.getElementById('ack2Label');

      if (!ack1 || !ack2) return true;

      if (!ack1.checked || !ack2.checked) {
        if (errEl) errEl.style.display = 'block';
        if (!ack1.checked && label1) label1.classList.add('error');
        if (!ack2.checked && label2) label2.classList.add('error');
        return false;
      }

      if (errEl) errEl.style.display = 'none';
      return true;
    }

    /* ── Checkbox-item toggle (topics) ── */
    document.querySelectorAll('.checkbox-item').forEach(function (item) {
      var input = item.querySelector('input[type="checkbox"]');
      if (!input) return;

      function toggle() {
        input.checked = !input.checked;
        item.classList.toggle('checked', input.checked);
        if (input.checked) {
          var err = document.getElementById('topicsError');
          if (err) err.classList.remove('visible');
        }
      }

      item.addEventListener('click', toggle);
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });

    /* ── Acknowledgment toggles ── */
    ['ack1', 'ack2'].forEach(function (id) {
      var label = document.getElementById(id + 'Label');
      var input = document.getElementById(id);
      if (!label || !input) return;

      function toggle() {
        input.checked = !input.checked;
        label.classList.toggle('checked', input.checked);
        label.classList.remove('error');
      }

      label.addEventListener('click', toggle);
      label.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });

    /* ── Build review screen ── */
    function buildReview() {
      /* Plan */
      var planNameEl  = document.getElementById('reviewPlanName');
      var planPriceEl = document.getElementById('reviewPlanPrice');
      if (planNameEl)  planNameEl.textContent  = state.planLabel;
      if (planPriceEl) planPriceEl.textContent = state.planPrice + ' — one-time enrollment';

      /* Contact */
      var phone = val('phone') || '—';
      var contactFields = [
        { key: 'Name',             value: val('firstName') + ' ' + val('lastName') },
        { key: 'Email',            value: val('email') },
        { key: 'Phone',            value: phone },
        { key: 'Location',         value: val('city') + ', ' + val('state') },
        { key: 'How You Found Us', value: val('howHeard') }
      ];

      var contactGrid = document.getElementById('reviewContactGrid');
      if (contactGrid) {
        contactGrid.innerHTML = contactFields.map(function (f) {
          return '<div class="review-field">' +
            '<div class="review-field__key">' + f.key + '</div>' +
            '<div class="review-field__val">' + escHtml(f.value) + '</div>' +
            '</div>';
        }).join('');
      }

      /* Profile */
      var checked   = document.querySelectorAll('[name="topics"]:checked');
      var topics    = Array.from(checked).map(function (el) { return el.value; });
      var goalTxt   = val('goal');
      var extraTxt  = val('anythingElse');

      var profileEl = document.getElementById('reviewProfileContent');
      if (!profileEl) return;

      var html =
        '<div class="review-field" style="margin-bottom:var(--space-4);">' +
          '<div class="review-field__key">Doors Owned</div>' +
          '<div class="review-field__val">' + escHtml(val('doorsOwned')) + '</div>' +
        '</div>' +
        '<div class="review-field" style="margin-bottom:var(--space-4);">' +
          '<div class="review-field__key" style="margin-bottom:var(--space-2);">Topics of Interest</div>' +
          '<div class="review-topics">' +
            topics.map(function (t) {
              return '<span class="review-topic-pill">' + escHtml(t) + '</span>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="review-field"' + (extraTxt ? ' style="margin-bottom:var(--space-4);"' : '') + '>' +
          '<div class="review-field__key">12-Month Goal</div>' +
          '<div class="review-field__val" style="line-height:1.6;">' + escHtml(goalTxt) + '</div>' +
        '</div>';

      if (extraTxt) {
        html +=
          '<div class="review-field">' +
            '<div class="review-field__key">Additional Notes</div>' +
            '<div class="review-field__val" style="line-height:1.6;">' + escHtml(extraTxt) + '</div>' +
          '</div>';
      }

      profileEl.innerHTML = html;
    }

    /* ── Wire step buttons ── */
    var btn = function (id) { return document.getElementById(id); };

    if (btn('step1Next')) {
      btn('step1Next').addEventListener('click', function () { goTo(2); });
    }

    if (btn('step2Back')) btn('step2Back').addEventListener('click', function () { goTo(1); });
    if (btn('step2Next')) {
      btn('step2Next').addEventListener('click', function () {
        if (validateStep2()) goTo(3);
      });
    }

    if (btn('step3Back')) btn('step3Back').addEventListener('click', function () { goTo(2); });
    if (btn('step3Next')) {
      btn('step3Next').addEventListener('click', function () {
        if (validateStep3()) { buildReview(); goTo(4); }
      });
    }

    if (btn('step4Back')) btn('step4Back').addEventListener('click', function () { goTo(3); });

    /* "Edit" links on review screen */
    document.querySelectorAll('[data-goto]').forEach(function (el) {
      el.addEventListener('click', function () {
        goTo(parseInt(el.dataset.goto, 10));
      });
    });

    /* ── Submit → Stripe Checkout ── */
    var submitBtn = btn('submitBtn');
    if (submitBtn) {
      submitBtn.addEventListener('click', async function () {
        if (!validateStep4()) return;

        submitBtn.disabled = true;
        submitBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2.5" stroke-linecap="round" style="animation:spin .8s linear infinite" ' +
          'aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Redirecting to payment…';

        // Map UI plan key (hyphen) → API plan key (underscore)
        var planApiKey = state.plan.replace('-', '_');  // 'all-access' → 'all_access'

        try {
          var res = await fetch('/api/stripe/create-checkout', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              plan:      planApiKey,
              email:     val('email'),
              firstName: val('firstName'),
              lastName:  val('lastName')
            })
          });

          var data = await res.json();

          if (!res.ok || !data.url) {
            throw new Error(data.error || 'Could not start checkout. Please try again.');
          }

          // Redirect to Stripe hosted checkout
          window.location.href = data.url;

        } catch (err) {
          // Show inline error, re-enable button
          var ackErrEl = document.getElementById('ackError');
          if (ackErrEl) {
            ackErrEl.textContent = err.message;
            ackErrEl.style.display = 'block';
          }
          submitBtn.disabled = false;
          submitBtn.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2.5" stroke-linecap="round" aria-hidden="true">' +
            '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Complete Enrollment';
        }
      });
    }

    /* ── Live error clearing ── */
    ['firstName', 'lastName', 'email', 'phone', 'city', 'state', 'howHeard', 'doorsOwned', 'goal'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input',  function () { clearError(id); });
      el.addEventListener('change', function () { clearError(id); });
    });
  }

  /* ── Spinner keyframe (injected once) ── */
  (function () {
    if (document.getElementById('brrrr8-keyframes')) return;
    var style = document.createElement('style');
    style.id  = 'brrrr8-keyframes';
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  })();

})();
