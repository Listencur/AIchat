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
  const restoreSnapshotInput = document.getElementById('inputRestoreSnapshot');
  const shortcutEnabledInput = document.getElementById('inputShortcutEnabled');
  const shortcutAcceleratorInput = document.getElementById('inputShortcutAccelerator');

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
    restoreSnapshotInput.checked = settings.restoreSnapshot === true;
    shortcutEnabledInput.checked = settings.shortcutEnabled !== false;
    shortcutAcceleratorInput.value = settings.shortcutAccelerator || 'Ctrl+Shift+Space';
    updateProxyUrlState();
  }

  function normalizeKeyName(key) {
    if (key === ' ') return 'Space';
    if (key === 'Escape') return 'Esc';
    if (key === 'ArrowUp') return 'Up';
    if (key === 'ArrowDown') return 'Down';
    if (key === 'ArrowLeft') return 'Left';
    if (key === 'ArrowRight') return 'Right';
    if (key.length === 1) return key.toUpperCase();
    return key;
  }

  function captureShortcut(event) {
    event.preventDefault();

    const key = normalizeKeyName(event.key);
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      return;
    }

    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.shiftKey) parts.push('Shift');
    if (event.altKey) parts.push('Alt');
    if (event.metaKey) parts.push('Meta');

    if (parts.length === 0) {
      return;
    }

    parts.push(key);
    shortcutAcceleratorInput.value = parts.join('+');
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

    const shortcutAccelerator = shortcutAcceleratorInput.value.trim();
    if (shortcutEnabledInput.checked && !/^(Ctrl|Shift|Alt|Meta)(\+(Ctrl|Shift|Alt|Meta))*\+[^+]+$/.test(shortcutAccelerator)) {
      shortcutAcceleratorInput.focus();
      return;
    }

    await window.api.settings.set({
      proxyMode,
      proxyUrl,
      restoreSnapshot: restoreSnapshotInput.checked,
      shortcutEnabled: shortcutEnabledInput.checked,
      shortcutAccelerator,
    });
    closeModal();
  }

  settingsBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  form.addEventListener('submit', handleSubmit);

  form.querySelectorAll('input[name="proxyMode"]').forEach((input) => {
    input.addEventListener('change', updateProxyUrlState);
  });
  shortcutAcceleratorInput.addEventListener('keydown', captureShortcut);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      closeModal();
    }
  });
})();
