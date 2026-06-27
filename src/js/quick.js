'use strict';

(function () {
  const form = document.getElementById('quickForm');
  const modelSelect = document.getElementById('quickModelSelect');
  const promptInput = document.getElementById('quickPrompt');
  const submitBtn = document.getElementById('btnQuickSubmit');
  const pinBtn = document.getElementById('btnQuickPin');
  let saveTimer = null;
  let pinned = false;

  async function loadModels(preferredId = '') {
    const data = await window.api.models.list();
    const models = data.models || data;
    modelSelect.innerHTML = '';

    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      modelSelect.appendChild(option);
    });

    if (models.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '暂无模型';
      modelSelect.appendChild(option);
      return;
    }

    modelSelect.value = models.some((model) => model.id === preferredId) ? preferredId : models[0].id;
  }

  async function loadQuickState() {
    const state = await window.api.quick.stateGet();
    await loadModels(state.lastModelId);
    promptInput.value = state.draft || '';
    pinned = state.pinned === true;
    renderPinned();
  }

  function buildStatePatch() {
    return {
      draft: promptInput.value,
      lastModelId: modelSelect.value,
      submitMode: 'open',
      pinned,
    };
  }

  function scheduleSaveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      window.api.quick.stateSet(buildStatePatch());
    }, 250);
  }

  async function saveStateNow() {
    clearTimeout(saveTimer);
    await window.api.quick.stateSet(buildStatePatch());
  }

  async function submitQuick(event) {
    event.preventDefault();

    const prompt = promptInput.value.trim();
    if (!prompt) {
      promptInput.focus();
      return;
    }

    const payload = {
      modelId: modelSelect.value,
      prompt,
      mode: 'open',
    };

    submitBtn.disabled = true;
    promptInput.value = '';
    await window.api.quick.stateSet({
      draft: '',
      lastModelId: modelSelect.value,
      submitMode: 'open',
      pinned,
    });
    window.api.quick.hide();
    await window.api.quick.submit(payload);
    submitBtn.disabled = false;
  }

  function renderPinned() {
    pinBtn.classList.toggle('is-pinned', pinned);
    pinBtn.title = pinned ? '已置顶，失焦不隐藏' : '置顶，失焦不隐藏';
  }

  async function togglePinned() {
    pinned = !pinned;
    renderPinned();
    await window.api.quick.setPinned(pinned);
  }

  async function focusPrompt() {
    await loadQuickState();
    setTimeout(() => promptInput.focus(), 50);
  }

  async function hideQuickWindow() {
    await saveStateNow();
    window.api.quick.hide();
  }

  document.addEventListener('DOMContentLoaded', focusPrompt);
  form.addEventListener('submit', submitQuick);
  pinBtn.addEventListener('click', togglePinned);
  modelSelect.addEventListener('change', scheduleSaveState);
  promptInput.addEventListener('input', scheduleSaveState);

  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      submitQuick(event);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideQuickWindow();
    }
  });

  window.api.quick.onShow(focusPrompt);
})();
