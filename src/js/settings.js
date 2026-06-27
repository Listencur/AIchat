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
  const clearCacheBtn = document.getElementById('btnClearCache');
  const clearLoginStateBtn = document.getElementById('btnClearLoginState');
  let currentSettings = null;

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
    currentSettings = settings;
    const modeInput = form.querySelector(`input[name="proxyMode"][value="${settings.proxyMode}"]`);
    const fallbackInput = form.querySelector('input[name="proxyMode"][value="system"]');
    const closeActionInput = form.querySelector(`input[name="closeAction"][value="${settings.closeAction || 'ask'}"]`);
    const closeActionFallback = form.querySelector('input[name="closeAction"][value="ask"]');

    (modeInput || fallbackInput).checked = true;
    (closeActionInput || closeActionFallback).checked = true;
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

  function getButtonHint(button) {
    return button ? button.querySelector('small') : null;
  }

  function setCleanupButtonsDisabled(disabled) {
    clearCacheBtn.disabled = disabled;
    clearLoginStateBtn.disabled = disabled;
  }

  function setCleanupHint(button, text, restoreDelay = 0) {
    const hint = getButtonHint(button);
    if (!hint) return;

    if (!hint.dataset.defaultText) {
      hint.dataset.defaultText = hint.textContent;
    }

    hint.textContent = text;

    if (restoreDelay > 0) {
      window.setTimeout(() => {
        hint.textContent = hint.dataset.defaultText;
      }, restoreDelay);
    }
  }

  async function runCleanupAction(button, runningText, action, doneTextFactory) {
    setCleanupButtonsDisabled(true);
    setCleanupHint(button, runningText);

    try {
      const result = await action();
      const doneText = typeof doneTextFactory === 'function'
        ? doneTextFactory(result)
        : '已完成';
      setCleanupHint(button, doneText, 3200);
      return result;
    } catch (error) {
      console.error('[settings] cleanup failed:', error);
      setCleanupHint(button, '操作失败', 3200);
      window.alert('清理失败，请稍后重试。');
      return null;
    } finally {
      setCleanupButtonsDisabled(false);
    }
  }

  async function handleClearCache() {
    await runCleanupAction(
      clearCacheBtn,
      '正在清理',
      () => window.api.settings.clearCache(),
      (result) => `已清理 ${result && result.sessions ? result.sessions : 0} 个会话`
    );
  }

  async function handleClearLoginState() {
    const confirmed = window.confirm('清除登录状态会退出所有 AI 模型账号，之后需要重新登录。确定继续吗？');
    if (!confirmed) return;

    await runCleanupAction(
      clearLoginStateBtn,
      '正在清除',
      () => window.api.settings.clearLoginState(),
      (result) => `已清除 ${result && result.sessions ? result.sessions : 0} 个会话`
    );
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
      ...(currentSettings || {}),
      proxyMode,
      proxyUrl,
      restoreSnapshot: restoreSnapshotInput.checked,
      shortcutEnabled: shortcutEnabledInput.checked,
      shortcutAccelerator,
      closeAction: form.querySelector('input[name="closeAction"]:checked')?.value || 'ask',
    });
    closeModal();
  }

  settingsBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  form.addEventListener('submit', handleSubmit);
  clearCacheBtn.addEventListener('click', handleClearCache);
  clearLoginStateBtn.addEventListener('click', handleClearLoginState);

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
