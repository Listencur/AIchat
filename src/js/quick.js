'use strict';

(function () {
  const form = document.getElementById('quickForm');
  const modelSelect = document.getElementById('quickModelSelect');
  const promptInput = document.getElementById('quickPrompt');
  const closeBtn = document.getElementById('btnQuickClose');
  const note = document.getElementById('quickNote');
  const submitBtn = document.getElementById('btnQuickSubmit');
  const historyList = document.getElementById('quickHistoryList');
  const clearDraftBtn = document.getElementById('btnClearDraft');
  let modelsCache = [];
  let saveTimer = null;

  async function loadModels(preferredId = '') {
    const data = await window.api.models.list();
    const models = data.models || data;
    modelsCache = models;
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

    const hasPreferred = models.some((model) => model.id === preferredId);
    modelSelect.value = hasPreferred ? preferredId : models[0].id;
  }

  async function loadQuickState() {
    const state = await window.api.quick.stateGet();
    await loadModels(state.lastModelId);
    promptInput.value = state.draft || '';
    setMode(state.submitMode || 'open');
    renderHistory(state.history || []);
    updateSubmitText();
  }

  function getMode() {
    const checked = document.querySelector('input[name="quickMode"]:checked');
    return checked ? checked.value : 'open';
  }

  function setMode(mode) {
    const value = mode === 'copy' ? 'copy' : 'open';
    const target = document.querySelector(`input[name="quickMode"][value="${value}"]`);
    if (target) {
      target.checked = true;
    }
  }

  function updateSubmitText() {
    submitBtn.textContent = getMode() === 'copy' ? '复制' : '打开';
  }

  function renderHistory(history) {
    historyList.innerHTML = '';

    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'quick-history-empty';
      empty.textContent = '暂无最近输入';
      historyList.appendChild(empty);
      return;
    }

    history.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-history-item';
      button.textContent = item;
      button.title = item;
      button.addEventListener('click', () => {
        promptInput.value = item;
        scheduleSaveState();
        promptInput.focus();
      });
      historyList.appendChild(button);
    });
  }

  function buildStatePatch() {
    return {
      draft: promptInput.value,
      lastModelId: modelSelect.value,
      submitMode: getMode(),
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
      note.textContent = '先输入内容再提交';
      promptInput.focus();
      return;
    }

    submitBtn.disabled = true;
    note.textContent = getMode() === 'copy' ? '正在复制' : '正在打开模型';

    try {
      const result = await window.api.quick.submit({
        modelId: modelSelect.value,
        prompt,
        mode: getMode(),
      });

      if (result && result.ok) {
        promptInput.value = '';
        await window.api.quick.stateSet({
          draft: '',
          lastModelId: modelSelect.value,
          submitMode: getMode(),
        });
        note.textContent = result.mode === 'copy' ? '已复制到剪贴板' : '已打开模型，内容已复制到剪贴板';
        await refreshHistoryOnly();
      } else {
        note.textContent = '没有可打开的模型';
      }
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function refreshHistoryOnly() {
    const state = await window.api.quick.stateGet();
    renderHistory(state.history || []);
  }

  async function focusPrompt() {
    await loadQuickState();
    note.textContent = 'Enter 提交，Shift+Enter 换行';
    setTimeout(() => promptInput.focus(), 50);
  }

  async function clearDraft() {
    promptInput.value = '';
    note.textContent = '草稿已清空';
    await saveStateNow();
    promptInput.focus();
  }

  async function hideQuickWindow() {
    await saveStateNow();
    window.api.quick.hide();
  }

  document.addEventListener('DOMContentLoaded', () => {
    focusPrompt();
  });

  form.addEventListener('submit', submitQuick);
  closeBtn.addEventListener('click', hideQuickWindow);
  clearDraftBtn.addEventListener('click', clearDraft);
  modelSelect.addEventListener('change', scheduleSaveState);
  promptInput.addEventListener('input', scheduleSaveState);

  document.querySelectorAll('input[name="quickMode"]').forEach((input) => {
    input.addEventListener('change', () => {
      updateSubmitText();
      scheduleSaveState();
    });
  });

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
