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
// --- Vérification (téléphone ou email) + quota d'essais gratuits ---
// =====================================================================

let verifyToken = localStorage.getItem('aivc_verify_token') || null;
let verifyIdentifier = localStorage.getItem('aivc_verify_identifier') || null;
let verifyType = localStorage.getItem('aivc_verify_type') || 'phone';

function lockMainForm(locked) {
  document.getElementById('mainForm').classList.toggle('locked', locked);
}

// --- Bascule téléphone / email ---
document.querySelectorAll('input[name="otpMode"]').forEach((r) => {
  r.addEventListener('change', () => {
    const mode = document.querySelector('input[name="otpMode"]:checked').value; // 'phone' | 'email'
    const input = document.getElementById('otpIdentifier');
    const label = document.getElementById('otpIdentifierLabel');
    if (mode === 'email') {
      input.type = 'email';
      input.placeholder = 'vous@exemple.com';
      label.textContent = 'Adresse email';
    } else {
      input.type = 'tel';
      input.placeholder = '+212612345678';
      label.textContent = 'Numéro de téléphone';
    }
  });
});

// --- Écran paywall (affiché quand le quota gratuit est épuisé) ---
function showPaywall(identifier) {
  document.getElementById('paywallIdentifier').textContent = identifier || '';
  document.getElementById('paywallStatus').textContent = '';
  document.getElementById('paywallOverlay').style.display = 'flex';
}
function hidePaywall() {
  document.getElementById('paywallOverlay').style.display = 'none';
}
document.getElementById('paywallCloseBtn').addEventListener('click', hidePaywall);

// Bouton de test (dev uniquement, désactivé côté serveur si ENABLE_DEBUG_ROUTES n'est pas défini) :
// épuise le quota gratuit de l'identifiant courant, pour tester le paywall/paiement sans
// consommer 2 vraies générations à chaque fois.
document.getElementById('debugExhaustBtn').addEventListener('click', async () => {
  const otpStatus = document.getElementById('otpStatus');
  try {
    const res = await fetch(apiUrl('/api/otp/debug-exhaust'), {
      method: 'POST',
      headers: { 'x-verify-token': verifyToken || '' },
    });
    const data = await res.json();
    if (res.status === 404) {
      otpStatus.textContent = 'Route de debug désactivée (ENABLE_DEBUG_ROUTES manquant côté serveur).';
      return;
    }
    if (data.error) throw new Error(data.error);
    await refreshOtpStatus();
  } catch (e) {
    otpStatus.textContent = '❌ Erreur: ' + e.message;
  }
});

async function payWithPaypal(plan) {
  const paywallStatus = document.getElementById('paywallStatus');
  paywallStatus.textContent = '⏳ Redirection vers PayPal...';
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
    paywallStatus.textContent = '❌ Erreur PayPal: ' + e.message;
  }
}

async function payWithStripe(plan) {
  const paywallStatus = document.getElementById('paywallStatus');
  paywallStatus.textContent = '⏳ Redirection vers Stripe...';
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
    paywallStatus.textContent = '❌ Erreur Stripe: ' + e.message;
  }
}

async function payWithCmi(plan) {
  const paywallStatus = document.getElementById('paywallStatus');
  paywallStatus.textContent = '⏳ Redirection vers la page de paiement CMI...';
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
    paywallStatus.textContent = '❌ Erreur CMI: ' + e.message;
  }
}

document.querySelectorAll('.pay-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const plan = btn.dataset.plan;
    const provider = btn.dataset.provider;
    if (!verifyIdentifier) {
      document.getElementById('paywallStatus').textContent = '❌ Identifiant non confirmé, revérifiez-vous.';
      return;
    }
    if (provider === 'paypal') payWithPaypal(plan);
    else if (provider === 'stripe') payWithStripe(plan);
    else if (provider === 'cmi') payWithCmi(plan);
  });
});

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

    document.getElementById('otpIdentifierBlock').style.display = 'none';
    document.getElementById('otpCodeBlock').style.display = 'none';

    const hasAccess = data.freeRemaining > 0 || data.subscriptionActive || data.paidCredits > 0;

    let label;
    if (data.subscriptionActive) {
      label = `✅ Vérifié (${data.identifier}) — abonnement actif jusqu'au ${new Date(data.subscriptionUntil).toLocaleDateString('fr-FR')}.`;
    } else if (data.paidCredits > 0) {
      label = `✅ Vérifié (${data.identifier}) — ${data.paidCredits} crédit(s) vidéo payé(s) restant(s).`;
    } else {
      label = `✅ Vérifié (${data.identifier}) — ${data.freeRemaining} génération(s) gratuite(s) restante(s) sur 2.`;
    }
    otpStatus.textContent = label;
    document.getElementById('debugExhaustBtn').style.display = 'inline-block';

    lockMainForm(!hasAccess);
    if (!hasAccess) {
      showPaywall(data.identifier);
    } else {
      hidePaywall();
    }
  } catch (e) {
    verifyToken = null;
    verifyIdentifier = null;
    localStorage.removeItem('aivc_verify_token');
    localStorage.removeItem('aivc_verify_identifier');
    localStorage.removeItem('aivc_verify_type');
    document.getElementById('otpIdentifierBlock').style.display = 'block';
    lockMainForm(true);
    hidePaywall();
  }
}
refreshOtpStatus();

document.getElementById('otpSendBtn').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="otpMode"]:checked').value; // 'phone' | 'email'
  const identifier = document.getElementById('otpIdentifier').value.trim();
  const otpStatus = document.getElementById('otpStatus');
  if (!identifier) { otpStatus.textContent = 'Renseignez ' + (mode === 'email' ? 'un email.' : 'un numéro.'); return; }

  otpStatus.textContent = '⏳ Envoi du code...';
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
    otpStatus.textContent = mode === 'email' ? '✅ Code envoyé par email.' : '✅ Code envoyé par SMS.';
  } catch (e) {
    otpStatus.textContent = '❌ Erreur: ' + e.message;
  }
});

document.getElementById('otpVerifyBtn').addEventListener('click', async () => {
  const code = document.getElementById('otpCode').value.trim();
  const otpStatus = document.getElementById('otpStatus');
  if (!code) { otpStatus.textContent = 'Renseignez le code reçu.'; return; }

  otpStatus.textContent = '⏳ Vérification...';
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
    otpStatus.textContent = '❌ Erreur: ' + e.message;
  }
});

// Retour de paiement (PayPal/Stripe/CMI redirige vers ?payment=success|failed|cancelled|error)
(function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  if (!payment) return;
  const messages = {
    success: '✅ Paiement confirmé — accès débloqué.',
    failed: '❌ Le paiement a échoué.',
    cancelled: 'Paiement annulé.',
    error: '❌ Une erreur est survenue pendant le paiement.',
  };
  setStatus(messages[payment] || '');
  window.history.replaceState({}, document.title, window.location.pathname);
})();

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
  select.innerHTML = '<option>Chargement...</option>';
  try {
    const res = await fetch(apiUrl('/api/voices'));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    select.innerHTML = data.voices
      .map((v) => `<option value="${v.id}">${v.name} (${v.category})</option>`)
      .join('');
    if (selectedId) select.value = selectedId;
  } catch (e) {
    select.innerHTML = `<option value="">Erreur: ${e.message}</option>`;
  }
}
loadVoices('voiceSelect');
loadVoices('resultVoiceSelect');

// --- Clonage de voix ---
document.getElementById('cloneBtn').addEventListener('click', async () => {
  const name = document.getElementById('voiceName').value.trim();
  const fileInput = document.getElementById('voiceSample');
  const cloneStatus = document.getElementById('cloneStatus');

  if (!name || !fileInput.files[0]) {
    cloneStatus.textContent = 'Renseignez un nom et un fichier audio.';
    return;
  }

  cloneStatus.textContent = 'Clonage en cours...';
  const form = new FormData();
  form.append('name', name);
  form.append('sample', fileInput.files[0]);

  try {
    const res = await fetch(apiUrl('/api/voices/clone'), { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    cloneStatus.textContent = `Voix "${data.name}" créée ✅`;
    await loadVoices('voiceSelect', data.voiceId);
    await loadVoices('resultVoiceSelect', data.voiceId);
    document.querySelector('input[name="voiceMode"][value="existing"]').checked = true;
    document.getElementById('existingVoiceBlock').style.display = 'block';
    document.getElementById('cloneVoiceBlock').style.display = 'none';
  } catch (e) {
    cloneStatus.textContent = 'Erreur: ' + e.message;
  }
});

// --- Lire / analyser la vidéo source (transcription + suggestions d'inspiration) ---
document.getElementById('analyzeBtn').addEventListener('click', async () => {
  const analyzeStatus = document.getElementById('analyzeStatus');
  const sourceMode = document.querySelector('input[name="sourceMode"]:checked').value;

  const form = new FormData();
  if (sourceMode === 'url') {
    const url = document.getElementById('videoUrl').value.trim();
    if (!url) { analyzeStatus.textContent = 'Renseignez une URL.'; return; }
    form.append('videoUrl', url);
  } else if (sourceMode === 'upload') {
    const file = document.getElementById('sourceVideo').files[0];
    if (!file) { analyzeStatus.textContent = 'Choisissez un fichier vidéo.'; return; }
    form.append('sourceVideo', file);
  } else {
    return;
  }

  analyzeStatus.textContent = '⏳ Lecture et analyse de la vidéo source...';
  try {
    const res = await fetch(apiUrl('/api/analyze-source'), { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    state.sourceFile = data.sourceFile;
    state.sourceInfo = data.transcript;

    document.getElementById('inspDescription').textContent = data.description || '(vide)';
    document.getElementById('inspKeywords').textContent = (data.keywords || []).join(', ') || '(vide)';
    document.getElementById('inspHashtags').textContent = (data.hashtags || []).join(' ') || '(vide)';
    document.getElementById('inspirationBlock').style.display = 'block';
    analyzeStatus.textContent = '✅ Vidéo analysée — informations réutilisées pour la génération.';
  } catch (err) {
    analyzeStatus.textContent = '❌ Erreur: ' + err.message;
  }
});

// --- Génération de la vidéo ---
document.getElementById('mainForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  setStatus('Génération en cours... (script, voix, montage) cela peut prendre 1-2 minutes');

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
      await refreshOtpStatus();
      return;
    }
    if (res.status === 401) {
      setStatus('❌ Vérifiez-vous ci-dessus avant de générer.');
      return;
    }
    if (data.error) throw new Error(data.error);

    if (data.sourceFile) state.sourceFile = data.sourceFile;

    document.getElementById('resultCard').style.display = 'block';
    document.getElementById('resultVideo').src = apiUrl(data.videoUrl);
    document.getElementById('resultScript').value = data.script;
    document.getElementById('resultDescription').value = data.description;
    document.getElementById('resultKeywords').value = data.keywords.join(', ');
    document.getElementById('resultHashtags').value = data.hashtags.join(', ');
    document.getElementById('resultVoiceSelect').value = voiceId;
    resetTimeline();
    setStatus('✅ Terminé');
    await refreshOtpStatus();
    document.getElementById('resultCard').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    setStatus('❌ Erreur: ' + err.message);
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

  if (!script) { setStatus('❌ Le script est vide.'); return; }

  btn.disabled = true;
  setStatus('🔁 Régénération de la narration et du montage...');

  try {
    const res = await fetch(apiUrl('/api/regenerate-voice'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, voiceId, sourceFile: state.sourceFile, subject }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('resultVideo').src = apiUrl(data.videoUrl);
    setStatus('✅ Voix mise à jour');
  } catch (err) {
    setStatus('❌ Erreur: ' + err.message);
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
      <button type="button" class="remove-seg" data-i="${i}" title="Supprimer ce paragraphe">×</button>
      <textarea data-i="${i}">${seg.text}</textarea>
      <div class="duration">~${dur.toFixed(1)}s (estimation)</div>
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
      durEl.textContent = `~${estimateDuration(e.target.value).toFixed(1)}s (estimation)`;
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
  if (!script) { segmentsStatus.textContent = '❌ Le script est vide.'; return; }

  const paragraphs = script.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) { segmentsStatus.textContent = '❌ Aucun paragraphe détecté.'; return; }

  timelineSegments = paragraphs.map((text) => ({ text, file: null, previewUrl: null }));
  document.getElementById('previewTimelineBtn').style.display = 'inline-block';
  document.getElementById('generateSegmentsBtn').style.display = 'inline-block';
  segmentsStatus.textContent = `${paragraphs.length} paragraphe(s) détecté(s) — associez une image à chacun.`;
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
  closeBtn.textContent = 'Fermer l\'aperçu';
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
    img.alt = seg.previewUrl ? '' : '(pas encore d\'image pour ce paragraphe)';
    label.textContent = `Paragraphe ${i + 1}/${timelineSegments.length} — ${seg.text.slice(0, 90)}${seg.text.length > 90 ? '…' : ''}`;
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
    segmentsStatus.textContent = '❌ Construisez d\'abord la timeline.';
    return;
  }
  if (timelineSegments.some((s) => !s.file)) {
    segmentsStatus.textContent = '❌ Chaque paragraphe doit avoir une image associée.';
    return;
  }

  btn.disabled = true;
  segmentsStatus.textContent = '⏳ Génération finale (narration par paragraphe + montage)... cela peut prendre 1-2 minutes';

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
      segmentsStatus.textContent = '❌ Vérifiez-vous avant de générer.';
      return;
    }
    if (data.error) throw new Error(data.error);

    document.getElementById('resultVideo').src = apiUrl(data.videoUrl);
    segmentsStatus.textContent = '✅ Vidéo finale générée avec vos images par paragraphe.';
    await refreshOtpStatus();
    document.getElementById('resultVideo').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    segmentsStatus.textContent = '❌ Erreur: ' + err.message;
  } finally {
    btn.disabled = false;
  }
});
