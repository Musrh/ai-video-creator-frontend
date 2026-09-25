const statusEl = document.getElementById('status');
const state = { sourceFile: null, sourceInfo: null };
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || '';

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

// =====================================================================
// --- Internationalisation (fr / en / ar) ---
// =====================================================================

const SUPPORTED_LANGS = ['fr', 'en', 'ar'];
let currentLang = localStorage.getItem('aivc_lang') || (navigator.language || 'fr').slice(0, 2);
if (!SUPPORTED_LANGS.includes(currentLang)) currentLang = 'fr';

function t(key, vars) {
  let str = (I18N[currentLang] && I18N[currentLang][key]) || I18N.fr[key] || key;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replace(`{${k}}`, v);
    });
  }
  return str;
}

function applyTranslations() {
  document.documentElement.lang = currentLang;
  document.documentElement.dir = RTL_LANGS.includes(currentLang) ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });

  // Le label/placeholder du champ identifiant dépend aussi du mode (téléphone/email) sélectionné
  updateOtpModeLabels();
}

document.getElementById('langSwitcher').value = currentLang;
document.getElementById('langSwitcher').addEventListener('change', (e) => {
  currentLang = e.target.value;
  localStorage.setItem('aivc_lang', currentLang);
  applyTranslations();
  // Reformate les libellés dynamiques déjà affichés (plan, paywall...) dans la nouvelle langue
  refreshOtpStatus();
});

// =====================================================================
// --- Vérification (téléphone ou email) + quota + menu compte ---
// =====================================================================

let verifyToken = localStorage.getItem('aivc_verify_token') || null;
let verifyIdentifier = localStorage.getItem('aivc_verify_identifier') || null;
let verifyType = localStorage.getItem('aivc_verify_type') || 'phone';

function lockMainForm(locked) {
  document.getElementById('mainForm').classList.toggle('locked', locked);
}

function updateOtpModeLabels() {
  const mode = document.querySelector('input[name="otpMode"]:checked').value; // 'phone' | 'email'
  const input = document.getElementById('otpIdentifier');
  const label = document.getElementById('otpIdentifierLabel');
  if (mode === 'email') {
    input.type = 'email';
    input.placeholder = t('otpEmailPlaceholder');
    label.textContent = t('otpEmailLabel');
  } else {
    input.type = 'tel';
    input.placeholder = t('otpPhonePlaceholder');
    label.textContent = t('otpPhoneLabel');
  }
}
document.querySelectorAll('input[name="otpMode"]').forEach((r) => {
  r.addEventListener('change', updateOtpModeLabels);
});

// --- Menu compte (dans le header) ---
document.getElementById('accountMenuBtn').addEventListener('click', () => {
  const dropdown = document.getElementById('accountMenuDropdown');
  dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
});

// --- Écran paywall (2 vidéos gratuites épuisées) ---
function showPaywall(identifier) {
  document.getElementById('paywallDesc').textContent = t('paywallDesc', { identifier: identifier || '' });
  document.getElementById('paywallStatus').textContent = '';
  document.getElementById('paywallOverlay').style.display = 'flex';
}
function hidePaywall() {
  document.getElementById('paywallOverlay').style.display = 'none';
}
document.getElementById('paywallCloseBtn').addEventListener('click', hidePaywall);

// --- Page "Plans" (ouverte depuis le menu compte) ---
function showPlans() {
  document.getElementById('plansStatus').textContent = '';
  document.getElementById('plansOverlay').style.display = 'flex';
  document.getElementById('accountMenuDropdown').style.display = 'none';
}
function hidePlans() {
  document.getElementById('plansOverlay').style.display = 'none';
}
document.getElementById('upgradeBtn').addEventListener('click', showPlans);
document.getElementById('plansCloseBtn').addEventListener('click', hidePlans);

async function payWithPaypal(plan, statusEl) {
  statusEl.textContent = t('redirectingPaypal');
  try {
    const res = await fetch(apiUrl('/api/payment/paypal/create'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: verifyIdentifier, type: verifyType, plan }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    window.location.href = data.approveUrl;
  } catch (e) {
    statusEl.textContent = t('errPaypal', { message: e.message });
  }
}

async function payWithStripe(plan, statusEl) {
  statusEl.textContent = t('redirectingStripe');
  try {
    const res = await fetch(apiUrl('/api/payment/stripe/create'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: verifyIdentifier, type: verifyType, plan }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    window.location.href = data.checkoutUrl;
  } catch (e) {
    statusEl.textContent = t('errStripe', { message: e.message });
  }
}

async function payWithCmi(plan, statusEl) {
  statusEl.textContent = t('redirectingCmi');
  try {
    const res = await fetch(apiUrl('/api/payment/cmi/create'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: verifyIdentifier, type: verifyType, plan }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const form = document.getElementById('cmiRedirectForm');
    form.action = data.gatewayUrl;
    form.innerHTML = '';
    Object.entries(data.params).forEach(([key, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    });
    form.submit();
  } catch (e) {
    statusEl.textContent = t('errCmi', { message: e.message });
  }
}

document.querySelectorAll('.pay-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const plan = btn.dataset.plan;
    const provider = btn.dataset.provider;
    const statusEl = btn.closest('.paywall-box').querySelector('.pay-status');
    if (!verifyIdentifier) {
      statusEl.textContent = t('planNoIdentifier');
      return;
    }
    if (provider === 'paypal') payWithPaypal(plan, statusEl);
    else if (provider === 'stripe') payWithStripe(plan, statusEl);
    else if (provider === 'cmi') payWithCmi(plan, statusEl);
  });
});

function logout() {
  verifyToken = null;
  verifyIdentifier = null;
  localStorage.removeItem('aivc_verify_token');
  localStorage.removeItem('aivc_verify_identifier');
  localStorage.removeItem('aivc_verify_type');

  document.getElementById('otpCard').style.display = 'block';
  document.getElementById('otpIdentifierBlock').style.display = 'block';
  document.getElementById('otpCodeBlock').style.display = 'none';
  document.getElementById('otpIdentifier').value = '';
  document.getElementById('otpCode').value = '';
  document.getElementById('otpStatus').textContent = '';

  document.getElementById('accountMenu').style.display = 'none';
  document.getElementById('accountMenuDropdown').style.display = 'none';

  lockMainForm(true);
  hidePaywall();
  hidePlans();
}
document.getElementById('logoutBtn').addEventListener('click', logout);

async function refreshOtpStatus() {
  const otpStatus = document.getElementById('otpStatus');
  if (!verifyToken) {
    lockMainForm(true);
    hidePaywall();
    return;
  }
  try {
    const res = await fetch(apiUrl('/api/otp/status'), {
      headers: { 'x-verify-token': verifyToken },
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const hasAccess = data.freeRemaining > 0 || data.subscriptionActive || data.paidCredits > 0;

    let planLabel;
    if (data.subscriptionActive) {
      planLabel = t('planLabelMonthlyActive', { date: new Date(data.subscriptionUntil).toLocaleDateString(currentLang) });
    } else if (data.paidCredits > 0) {
      planLabel = t('planLabelSinglePaid', { n: data.paidCredits });
    } else if (data.freeRemaining > 0) {
      planLabel = t('planLabelFreeRemaining', { n: data.freeRemaining });
    } else {
      planLabel = t('planLabelFreeExhausted');
    }

    document.getElementById('otpCard').style.display = 'none';
    document.getElementById('accountMenu').style.display = 'block';
    document.getElementById('accountEmail').textContent = data.identifier;
    document.getElementById('accountPlan').textContent = planLabel;
    document.getElementById('debugExhaustBtn').style.display = 'inline-block';

    lockMainForm(!hasAccess);
    if (!hasAccess) {
      showPaywall(data.identifier);
    } else {
      hidePaywall();
    }
  } catch (e) {
    logout();
  }
}

document.getElementById('otpSendBtn').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="otpMode"]:checked').value;
  const identifier = document.getElementById('otpIdentifier').value.trim();
  const otpStatus = document.getElementById('otpStatus');
  if (!identifier) { otpStatus.textContent = mode === 'email' ? t('errEmailRequired') : t('errPhoneRequired'); return; }

  otpStatus.textContent = t('sendingCode');
  try {
    const res = await fetch(apiUrl('/api/otp/send'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, type: mode }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    verifyIdentifier = identifier;
    verifyType = mode;
    document.getElementById('otpCodeBlock').style.display = 'block';
    otpStatus.textContent = mode === 'email' ? t('codeSentEmail') : t('codeSentSms');
  } catch (e) {
    otpStatus.textContent = t('genericError', { message: e.message });
  }
});

document.getElementById('otpVerifyBtn').addEventListener('click', async () => {
  const code = document.getElementById('otpCode').value.trim();
  const otpStatus = document.getElementById('otpStatus');
  if (!code) { otpStatus.textContent = t('errCodeRequired'); return; }

  otpStatus.textContent = t('verifying');
  try {
    const res = await fetch(apiUrl('/api/otp/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: verifyIdentifier, type: verifyType, code }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    verifyToken = data.token;
    localStorage.setItem('aivc_verify_token', verifyToken);
    localStorage.setItem('aivc_verify_identifier', verifyIdentifier);
    localStorage.setItem('aivc_verify_type', verifyType);
    await refreshOtpStatus();
  } catch (e) {
    otpStatus.textContent = t('genericError', { message: e.message });
  }
});

document.getElementById('debugExhaustBtn').addEventListener('click', async () => {
  try {
    const res = await fetch(apiUrl('/api/otp/debug-exhaust'), {
      method: 'POST',
      headers: { 'x-verify-token': verifyToken || '' },
    });
    const data = await res.json();
    if (res.status === 404) {
      document.getElementById('accountPlan').textContent = t('debugRouteDisabled');
      return;
    }
    if (data.error) throw new Error(data.error);
    await refreshOtpStatus();
  } catch (e) {
    document.getElementById('accountPlan').textContent = t('genericError', { message: e.message });
  }
});

(function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  if (!payment) return;
  const keys = {
    success: 'paymentSuccess',
    failed: 'paymentFailed',
    cancelled: 'paymentCancelled',
    error: 'paymentError',
  };
  setStatus(keys[payment] ? t(keys[payment]) : '');
  window.history.replaceState({}, document.title, window.location.pathname);
})();

// Applique les traductions puis affiche le bon statut de connexion, une fois tout prêt
applyTranslations();
refreshOtpStatus();

// =====================================================================

// --- Gestion des onglets source vidéo ---
document.querySelectorAll('input[name="sourceMode"]').forEach((r) => {
  r.addEventListener('change', () => {
    const mode = document.querySelector('input[name="sourceMode"]:checked').value;
    document.getElementById('videoUrl').style.display = mode === 'url' ? 'block' : 'none';
    document.getElementById('sourceVideo').style.display = mode === 'upload' ? 'block' : 'none';
    document.getElementById('analyzeBtn').style.display = mode === 'none' ? 'none' : 'inline-block';
    state.sourceFile = null;
    state.sourceInfo = null;
    document.getElementById('inspirationBlock').style.display = 'none';
    document.getElementById('analyzeStatus').textContent = '';
  });
});

// --- Gestion des onglets voix ---
document.querySelectorAll('input[name="voiceMode"]').forEach((r) => {
  r.addEventListener('change', () => {
    const mode = document.querySelector('input[name="voiceMode"]:checked').value;
    document.getElementById('existingVoiceBlock').style.display = mode === 'existing' ? 'block' : 'none';
    document.getElementById('cloneVoiceBlock').style.display = mode === 'clone' ? 'block' : 'none';
  });
});

// --- Chargement des voix disponibles (utilisé pour les 2 sélecteurs) ---
async function loadVoices(selectId, selectedId) {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option>...</option>';
  try {
    const res = await fetch(apiUrl('/api/voices'));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    select.innerHTML = data.voices
      .map((v) => `<option value="${v.id}">${v.name} (${v.category})</option>`)
      .join('');
    if (selectedId) select.value = selectedId;
  } catch (e) {
    select.innerHTML = `<option value="">${t('genericError', { message: e.message })}</option>`;
  }
}
loadVoices('voiceSelect').then(restorePendingForm);
loadVoices('resultVoiceSelect');

// Restaure le formulaire sauvegardé juste avant un paiement (voir mainForm submit, cas 402) —
// nécessaire car le retour de PayPal/Stripe/CMI est un vrai rechargement de page, qui efface
// tout ce que l'utilisateur avait tapé si on ne le restaure pas explicitement ici.
function restorePendingForm() {
  const raw = localStorage.getItem('aivc_pending_form');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data.subject) document.getElementById('subject').value = data.subject;
    if (data.sourceMode) {
      const radio = document.querySelector(`input[name="sourceMode"][value="${data.sourceMode}"]`);
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
      }
    }
    if (data.videoUrl) document.getElementById('videoUrl').value = data.videoUrl;
    if (data.voiceId) document.getElementById('voiceSelect').value = data.voiceId;
  } catch {
    // ignore, formulaire sauvegardé corrompu/illisible
  }
  localStorage.removeItem('aivc_pending_form');
}

// --- Clonage de voix ---
document.getElementById('cloneBtn').addEventListener('click', async () => {
  const name = document.getElementById('voiceName').value.trim();
  const fileInput = document.getElementById('voiceSample');
  const cloneStatus = document.getElementById('cloneStatus');

  if (!name || !fileInput.files[0]) {
    cloneStatus.textContent = t('errCloneFields');
    return;
  }

  cloneStatus.textContent = t('cloningStatus');
  const form = new FormData();
  form.append('name', name);
  form.append('sample', fileInput.files[0]);

  try {
    const res = await fetch(apiUrl('/api/voices/clone'), { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    cloneStatus.textContent = t('cloneSuccess', { name: data.name });
    await loadVoices('voiceSelect', data.voiceId);
    await loadVoices('resultVoiceSelect', data.voiceId);
    document.querySelector('input[name="voiceMode"][value="existing"]').checked = true;
    document.getElementById('existingVoiceBlock').style.display = 'block';
    document.getElementById('cloneVoiceBlock').style.display = 'none';
  } catch (e) {
    cloneStatus.textContent = t('genericError', { message: e.message });
  }
});

// --- Lire / analyser la vidéo source (transcription + suggestions d'inspiration) ---
document.getElementById('analyzeBtn').addEventListener('click', async () => {
  const analyzeStatus = document.getElementById('analyzeStatus');
  const sourceMode = document.querySelector('input[name="sourceMode"]:checked').value;

  const form = new FormData();
  if (sourceMode === 'url') {
    const url = document.getElementById('videoUrl').value.trim();
    if (!url) { analyzeStatus.textContent = t('errUrlRequired'); return; }
    form.append('videoUrl', url);
  } else if (sourceMode === 'upload') {
    const file = document.getElementById('sourceVideo').files[0];
    if (!file) { analyzeStatus.textContent = t('errFileRequired'); return; }
    form.append('sourceVideo', file);
  } else {
    return;
  }

  analyzeStatus.textContent = t('analyzingStatus');
  try {
    const res = await fetch(apiUrl('/api/analyze-source'), { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    state.sourceFile = data.sourceFile;
    state.sourceInfo = data.transcript;

    document.getElementById('inspDescription').textContent = data.description || t('emptyValue');
    document.getElementById('inspKeywords').textContent = (data.keywords || []).join(', ') || t('emptyValue');
    document.getElementById('inspHashtags').textContent = (data.hashtags || []).join(' ') || t('emptyValue');
    document.getElementById('inspirationBlock').style.display = 'block';
    analyzeStatus.textContent = t('analyzeSuccess');
  } catch (err) {
    analyzeStatus.textContent = t('genericError', { message: err.message });
  }
});

// --- Génération de la vidéo ---
document.getElementById('mainForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  setStatus(t('generatingStatus'));

  const subject = document.getElementById('subject').value.trim();
  const sourceMode = document.querySelector('input[name="sourceMode"]:checked').value;
  const voiceId = document.getElementById('voiceSelect').value;

  const form = new FormData();
  form.append('subject', subject);
  form.append('voiceId', voiceId);

  if (state.sourceFile) {
    form.append('sourceFile', state.sourceFile);
    if (state.sourceInfo) form.append('sourceInfo', state.sourceInfo);
  } else if (sourceMode === 'url') {
    form.append('videoUrl', document.getElementById('videoUrl').value.trim());
  } else if (sourceMode === 'upload') {
    const file = document.getElementById('sourceVideo').files[0];
    if (file) form.append('sourceVideo', file);
  }

  try {
    const res = await fetch(apiUrl('/api/generate-video'), {
      method: 'POST',
      headers: { 'x-verify-token': verifyToken || '' },
      body: form,
    });
    const data = await res.json();

    if (res.status === 402) {
      setStatus('');
      // On sauvegarde le formulaire AVANT le paywall : payer redirige vers PayPal/Stripe/CMI
      // puis revient sur cette page — un vrai rechargement complet, qui efface tout l'état
      // JavaScript en mémoire (dont ce que l'utilisateur avait tapé) si on ne le fait pas.
      localStorage.setItem('aivc_pending_form', JSON.stringify({
        subject,
        sourceMode,
        videoUrl: document.getElementById('videoUrl').value.trim(),
        voiceId,
      }));
      await refreshOtpStatus();
      return;
    }
    if (res.status === 401) {
      setStatus(t('errVerifyBeforeGenerate'));
      return;
    }
    if (data.error) throw new Error(data.error);

    localStorage.removeItem('aivc_pending_form');
    if (data.sourceFile) state.sourceFile = data.sourceFile;

    document.getElementById('resultCard').style.display = 'block';
    document.getElementById('resultVideo').src = apiUrl(data.videoUrl);
    const downloadLink = document.getElementById('downloadVideoLink');
    downloadLink.href = apiUrl(data.videoUrl);
    downloadLink.style.display = 'inline-block';
    document.getElementById('resultScript').value = data.script;
    document.getElementById('resultDescription').value = data.description;
    document.getElementById('resultKeywords').value = data.keywords.join(', ');
    document.getElementById('resultHashtags').value = data.hashtags.join(', ');
    document.getElementById('resultVoiceSelect').value = voiceId;
    resetTimeline();
    setStatus(t('generateDone'));
    await refreshOtpStatus();
    document.getElementById('resultCard').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    setStatus(t('genericError', { message: err.message }));
  } finally {
    btn.disabled = false;
  }
});

// --- Changer la voix sur la vidéo déjà générée (sans tout régénérer) ---
document.getElementById('regenerateVoiceBtn').addEventListener('click', async () => {
  const btn = document.getElementById('regenerateVoiceBtn');
  const script = document.getElementById('resultScript').value.trim();
  const voiceId = document.getElementById('resultVoiceSelect').value;
  const subject = document.getElementById('subject').value.trim();

  if (!script) { setStatus(t('errScriptEmpty')); return; }

  btn.disabled = true;
  setStatus(t('regeneratingStatus'));

  try {
    const res = await fetch(apiUrl('/api/regenerate-voice'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, voiceId, sourceFile: state.sourceFile, subject }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('resultVideo').src = apiUrl(data.videoUrl);
    const downloadLink = document.getElementById('downloadVideoLink');
    downloadLink.href = apiUrl(data.videoUrl);
    downloadLink.style.display = 'inline-block';
    setStatus(t('regenDone'));
  } catch (err) {
    setStatus(t('genericError', { message: err.message }));
  } finally {
    btn.disabled = false;
  }
});

// =====================================================================
// --- Éditeur "Images par paragraphe" : timeline, aperçu, génération ---
// =====================================================================

const WORDS_PER_SECOND = 2.5;
let timelineSegments = [];

function estimateDuration(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, words / WORDS_PER_SECOND);
}

function resetTimeline() {
  timelineSegments = [];
  document.getElementById('timeline').innerHTML = '';
  document.getElementById('previewTimelineBtn').style.display = 'none';
  document.getElementById('generateSegmentsBtn').style.display = 'none';
  document.getElementById('segmentsStatus').textContent = '';
}

function renderTimeline() {
  const el = document.getElementById('timeline');
  el.innerHTML = '';

  timelineSegments.forEach((seg, i) => {
    const dur = estimateDuration(seg.text);
    const div = document.createElement('div');
    div.className = 'segment';
    div.innerHTML = `
      <button type="button" class="remove-seg" data-i="${i}" title="${t('removeSegmentTitle')}">×</button>
      <textarea data-i="${i}">${seg.text}</textarea>
      <div class="duration">${t('durationEstimate', { s: dur.toFixed(1) })}</div>
      ${seg.previewUrl ? `<img class="thumb" src="${seg.previewUrl}" />` : '<div class="thumb"></div>'}
      <input type="file" accept="image/*" data-i="${i}" />
    `;
    el.appendChild(div);
  });

  el.querySelectorAll('textarea').forEach((ta) => {
    ta.addEventListener('input', (e) => {
      const i = Number(e.target.dataset.i);
      timelineSegments[i].text = e.target.value;
      const durEl = e.target.parentElement.querySelector('.duration');
      durEl.textContent = t('durationEstimate', { s: estimateDuration(e.target.value).toFixed(1) });
    });
  });

  el.querySelectorAll('input[type="file"]').forEach((inp) => {
    inp.addEventListener('change', (e) => {
      const i = Number(e.target.dataset.i);
      const file = e.target.files[0];
      if (file) {
        timelineSegments[i].file = file;
        timelineSegments[i].previewUrl = URL.createObjectURL(file);
        renderTimeline();
      }
    });
  });

  el.querySelectorAll('.remove-seg').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const i = Number(e.target.dataset.i);
      timelineSegments.splice(i, 1);
      renderTimeline();
    });
  });
}

document.getElementById('buildTimelineBtn').addEventListener('click', () => {
  const script = document.getElementById('resultScript').value.trim();
  const segmentsStatus = document.getElementById('segmentsStatus');
  if (!script) { segmentsStatus.textContent = t('errScriptEmptyTimeline'); return; }

  const paragraphs = script.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) { segmentsStatus.textContent = t('errNoParagraphs'); return; }

  timelineSegments = paragraphs.map((text) => ({ text, file: null, previewUrl: null }));
  document.getElementById('previewTimelineBtn').style.display = 'inline-block';
  document.getElementById('generateSegmentsBtn').style.display = 'inline-block';
  segmentsStatus.textContent = t('paragraphsDetected', { count: paragraphs.length });
  renderTimeline();
});

document.getElementById('previewTimelineBtn').addEventListener('click', () => {
  if (timelineSegments.length === 0) return;

  const overlay = document.createElement('div');
  overlay.className = 'preview-overlay';
  const img = document.createElement('img');
  const label = document.createElement('div');
  label.className = 'preview-label';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = t('closePreview');
  overlay.appendChild(img);
  overlay.appendChild(label);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);

  let i = 0;
  let timer;

  function showNext() {
    if (i >= timelineSegments.length) { cleanup(); return; }
    const seg = timelineSegments[i];
    img.src = seg.previewUrl || '';
    img.alt = seg.previewUrl ? '' : t('noImageYetAlt');
    const preview = seg.text.slice(0, 90) + (seg.text.length > 90 ? '…' : '');
    label.textContent = t('paragraphLabel', { i: i + 1, n: timelineSegments.length, text: preview });
    const dur = estimateDuration(seg.text);
    timer = setTimeout(() => { i += 1; showNext(); }, dur * 1000);
  }

  function cleanup() {
    clearTimeout(timer);
    overlay.remove();
  }

  closeBtn.addEventListener('click', cleanup);
  showNext();
});

document.getElementById('generateSegmentsBtn').addEventListener('click', async () => {
  const btn = document.getElementById('generateSegmentsBtn');
  const segmentsStatus = document.getElementById('segmentsStatus');
  const voiceId = document.getElementById('resultVoiceSelect').value;
  const subject = document.getElementById('subject').value.trim();

  if (timelineSegments.length === 0) {
    segmentsStatus.textContent = t('errBuildTimelineFirst');
    return;
  }
  if (timelineSegments.some((s) => !s.file)) {
    segmentsStatus.textContent = t('errMissingImages');
    return;
  }

  btn.disabled = true;
  segmentsStatus.textContent = t('segmentsGenerating');

  const form = new FormData();
  form.append('voiceId', voiceId);
  form.append('subject', subject);
  form.append('segments', JSON.stringify(timelineSegments.map((s) => s.text)));
  timelineSegments.forEach((s) => form.append('images', s.file));

  try {
    const res = await fetch(apiUrl('/api/generate-video-segments'), {
      method: 'POST',
      headers: { 'x-verify-token': verifyToken || '' },
      body: form,
    });
    const data = await res.json();

    if (res.status === 402) {
      segmentsStatus.textContent = '';
      await refreshOtpStatus();
      return;
    }
    if (res.status === 401) {
      segmentsStatus.textContent = t('errVerifyBeforeGenerate');
      return;
    }
    if (data.error) throw new Error(data.error);

    document.getElementById('resultVideo').src = apiUrl(data.videoUrl);
    const downloadLink = document.getElementById('downloadVideoLink');
    downloadLink.href = apiUrl(data.videoUrl);
    downloadLink.style.display = 'inline-block';
    segmentsStatus.textContent = t('segmentsDone');
    await refreshOtpStatus();
    document.getElementById('resultVideo').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    segmentsStatus.textContent = t('genericError', { message: err.message });
  } finally {
    btn.disabled = false;
  }
});
