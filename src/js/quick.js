'use strict';

(function () {
  const form = document.getElementById('quickForm');
  const modelPicker = document.getElementById('quickModelPicker');
  const modelTrigger = document.getElementById('quickModelTrigger');
  const modelMenu = document.getElementById('quickModelMenu');
  const promptInput = document.getElementById('quickPrompt');
  const submitBtn = document.getElementById('btnQuickSubmit');
  const pinBtn = document.getElementById('btnQuickPin');
  let saveTimer = null;
  let pinned = false;
  let modelsCache = [];
  let selectedModelIds = new Set();

  async function loadModels(preferredIds = []) {
    const data = await window.api.models.list();
    const models = data.models || data;
    const validIds = new Set(models.map((model) => model.id));
    const nextSelected = preferredIds.filter((id) => validIds.has(id));

    modelsCache = models;
    selectedModelIds = new Set(nextSelected.length > 0 ? nextSelected : (models[0] ? [models[0].id] : []));
    renderModelPicker();
  }

  async function loadQuickState() {
    const state = await window.api.quick.stateGet();
    const preferredIds = Array.isArray(state.lastModelIds) && state.lastModelIds.length > 0
      ? state.lastModelIds
      : (state.lastModelId ? [state.lastModelId] : []);
    await loadModels(preferredIds);
    promptInput.value = state.draft || '';
    pinned = state.pinned === true;
    renderPinned();
  }

  function getSelectedModelIds() {
    const validIds = new Set(modelsCache.map((model) => model.id));
    return Array.from(selectedModelIds).filter((id) => validIds.has(id));
  }

  function buildStatePatch() {
    const selectedIds = getSelectedModelIds();
    return {
      draft: promptInput.value,
      lastModelId: selectedIds[0] || '',
      lastModelIds: selectedIds,
      submitMode: 'open',
      pinned,
    };
  }

  function renderModelPicker() {
    const selectedIds = getSelectedModelIds();
    const selectedNames = selectedIds
      .map((id) => modelsCache.find((model) => model.id === id))
      .filter(Boolean)
      .map((model) => model.name);

    if (modelsCache.length === 0) {
      modelTrigger.textContent = '暂无模型';
      modelTrigger.disabled = true;
      submitBtn.disabled = true;
      modelMenu.innerHTML = '';
      closeModelMenu();
      return;
    }

    modelTrigger.disabled = false;
    submitBtn.disabled = false;
    modelTrigger.textContent = selectedNames.length > 1
      ? `已选 ${selectedNames.length} 个`
      : (selectedNames[0] || modelsCache[0].name);

    modelMenu.innerHTML = '';
    modelsCache.forEach((model) => {
      const label = document.createElement('label');
      label.className = 'quick-model-option';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = model.id;
      input.checked = selectedModelIds.has(model.id);

      const name = document.createElement('span');
      name.textContent = model.name;

      input.addEventListener('change', () => {
        if (input.checked) {
          selectedModelIds.add(model.id);
        } else if (selectedModelIds.size > 1) {
          selectedModelIds.delete(model.id);
        } else {
          input.checked = true;
          return;
        }

        renderModelPicker();
        scheduleSaveState();
      });

      label.appendChild(input);
      label.appendChild(name);
      modelMenu.appendChild(label);
    });
  }

  function toggleModelMenu() {
    if (modelsCache.length === 0) return;
    modelMenu.hidden = !modelMenu.hidden;
  }

  function closeModelMenu() {
    modelMenu.hidden = true;
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
      modelId: getSelectedModelIds()[0] || '',
      modelIds: getSelectedModelIds(),
      prompt,
      mode: 'open',
    };

    submitBtn.disabled = true;
    promptInput.value = '';
    await window.api.quick.stateSet({
      draft: '',
      lastModelId: payload.modelId,
      lastModelIds: payload.modelIds,
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
  modelTrigger.addEventListener('click', toggleModelMenu);
  modelMenu.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  promptInput.addEventListener('input', scheduleSaveState);

  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      submitQuick(event);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!modelMenu.hidden) {
        closeModelMenu();
        return;
      }
      hideQuickWindow();
    }
  });

  document.addEventListener('click', (event) => {
    if (!modelPicker.contains(event.target)) {
      closeModelMenu();
    }
  });

  window.api.models.onUpdated(() => {
    loadModels(getSelectedModelIds());
  });

  window.api.quick.onShow(focusPrompt);
})();
