'use strict';

(function () {
  const form = document.getElementById('quickForm');
  const modelSelect = document.getElementById('quickModelSelect');
  const promptInput = document.getElementById('quickPrompt');
  const closeBtn = document.getElementById('btnQuickClose');
  const note = document.getElementById('quickNote');

  async function loadModels() {
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
    }
  }

  async function submitQuick(event) {
    event.preventDefault();

    const ok = await window.api.quick.submit({
      modelId: modelSelect.value,
      prompt: promptInput.value,
    });

    if (ok) {
      promptInput.value = '';
      note.textContent = '已打开模型，内容已复制到剪贴板';
    } else {
      note.textContent = '没有可打开的模型';
    }
  }

  function focusPrompt() {
    loadModels();
    note.textContent = 'Enter 打开，Shift+Enter 换行';
    setTimeout(() => promptInput.focus(), 50);
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    promptInput.focus();
  });

  form.addEventListener('submit', submitQuick);
  closeBtn.addEventListener('click', () => window.api.quick.hide());

  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      submitQuick(event);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      window.api.quick.hide();
    }
  });

  window.api.quick.onShow(focusPrompt);
})();
