const statusEl = document.getElementById('status');
const state = { sourceFile: null, sourceInfo: null };
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || '';

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

// --- Gestion des onglets source vidéo ---
document.querySelectorAll('input[name="sourceMode"]').forEach((r) => {
  r.addEventListener('change', () => {
    const mode = document.querySelector('input[name="sourceMode"]:checked').value;
    document.getElementById('videoUrl').style.display = mode === 'url' ? 'block' : 'none';
    document.getElementById('sourceVideo').style.display = mode === 'upload' ? 'block' : 'none';
    document.getElementById('analyzeBtn').style.display = mode === 'none' ? 'none' : 'inline-block';
    // On change de source : les infos analysées précédemment ne sont plus valables
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
    // Vidéo source déjà analysée : on réutilise le fichier + le transcript, pas besoin de re-uploader/re-télécharger
    form.append('sourceFile', state.sourceFile);
    if (state.sourceInfo) form.append('sourceInfo', state.sourceInfo);
  } else if (sourceMode === 'url') {
    form.append('videoUrl', document.getElementById('videoUrl').value.trim());
  } else if (sourceMode === 'upload') {
    const file = document.getElementById('sourceVideo').files[0];
    if (file) form.append('sourceVideo', file);
  }

  try {
    const res = await fetch(apiUrl('/api/generate-video'), { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (data.sourceFile) state.sourceFile = data.sourceFile;

    document.getElementById('resultCard').style.display = 'block';
    document.getElementById('resultVideo').src = apiUrl(data.videoUrl);
    document.getElementById('resultScript').value = data.script;
    document.getElementById('resultDescription').value = data.description;
    document.getElementById('resultKeywords').value = data.keywords.join(', ');
    document.getElementById('resultHashtags').value = data.hashtags.join(', ');
    document.getElementById('resultVoiceSelect').value = voiceId;
    setStatus('✅ Terminé');
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
