'use strict';

/**
 * add-model.js — 添加模型弹窗逻辑
 * 负责：弹窗打开/关闭、表单验证、提交添加
 */

(function () {
  const addBtn = document.getElementById('btnAddModel');
  const modal = document.getElementById('modalAddModel');
  const closeBtn = document.getElementById('btnCloseModal');
  const cancelBtn = document.getElementById('btnCancelAdd');
  const form = document.getElementById('addModelForm');
  const nameInput = document.getElementById('inputName');
  const urlInput = document.getElementById('inputUrl');
  const iconInput = document.getElementById('inputIcon');
  const colorInput = document.getElementById('inputColor');

  /** 打开弹窗 */
  function openModal() {
    window.api.view.setVisible(false);  // 隐藏 WebView，避免遮挡弹窗
    modal.classList.add('show');
    nameInput.focus();
  }

  /** 关闭弹窗并重置表单 */
  function closeModal() {
    modal.classList.remove('show');
    window.api.view.setVisible(true);  // 恢复显示 WebView
    form.reset();
    iconInput.value = '🤖';
    colorInput.value = '#666666';
  }

  /** 表单提交 */
  async function handleSubmit(e) {
    e.preventDefault();

    const name = nameInput.value.trim();
    const url = urlInput.value.trim();

    // 验证
    if (!name) {
      nameInput.focus();
      return;
    }
    if (!url || !/^https?:\/\/.+/.test(url)) {
      urlInput.focus();
      return;
    }

    // 调用主进程添加模型
    await window.api.models.add({
      name: name,
      url: url,
      icon: iconInput.value.trim() || '🤖',
      color: colorInput.value,
    });

    closeModal();
  }

  // ── 事件绑定 ──
  addBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  form.addEventListener('submit', handleSubmit);

  // 点击遮罩关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      closeModal();
    }
  });
})();
