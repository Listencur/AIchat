'use strict';

/**
 * settings.js — 设置弹窗逻辑
 * 负责：代理模式读取、保存和弹窗显示控制。
 */

(function () {
  const settingsBtn = document.getElementById('btnSettings');
  const modal = document.getElementById('modalSettings');
  const closeBtn = document.getElementById('btnCloseSettings');
  const cancelBtn = document.getElementById('btnCancelSettings');
  const form = document.getElementById('settingsForm');
  const proxyUrlRow = document.getElementById('proxyUrlRow');
  const proxyUrlInput = document.getElementById('inputProxyUrl');

  function getSelectedProxyMode() {
    const selected = form.querySelector('input[name="proxyMode"]:checked');
    return selected ? selected.value : 'system';
  }

  function updateProxyUrlState() {
    const isCustom = getSelectedProxyMode() === 'custom';
    proxyUrlInput.disabled = !isCustom;
    proxyUrlRow.classList.toggle('is-disabled', !isCustom);
  }

  async function loadSettingsIntoForm() {
    const settings = await window.api.settings.get();
    const modeInput = form.querySelector(`input[name="proxyMode"][value="${settings.proxyMode}"]`);
    const fallbackInput = form.querySelector('input[name="proxyMode"][value="system"]');

    (modeInput || fallbackInput).checked = true;
    proxyUrlInput.value = settings.proxyUrl || 'http://127.0.0.1:7897';
    updateProxyUrlState();
  }

  async function openModal() {
    await window.api.view.setVisible(false);
    await loadSettingsIntoForm();
    modal.classList.add('show');
  }

  function closeModal() {
    modal.classList.remove('show');
    window.api.view.setVisible(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const proxyMode = getSelectedProxyMode();
    const proxyUrl = proxyUrlInput.value.trim();

    if (proxyMode === 'custom' && !/^(https?|socks5?):\/\/.+/.test(proxyUrl)) {
      proxyUrlInput.focus();
      return;
    }

    await window.api.settings.set({ proxyMode, proxyUrl });
    closeModal();
  }

  settingsBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  form.addEventListener('submit', handleSubmit);

  form.querySelectorAll('input[name="proxyMode"]').forEach((input) => {
    input.addEventListener('change', updateProxyUrlState);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      closeModal();
    }
  });
})();
