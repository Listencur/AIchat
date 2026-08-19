'use strict';

/**
 * add-model.js — 模型弹窗逻辑
 * 负责：弹窗打开/关闭、表单验证、添加、编辑和删除模型
 */

(function () {
  const addBtn = document.getElementById('btnAddModel');
  const modal = document.getElementById('modalAddModel');
  const closeBtn = document.getElementById('btnCloseModal');
  const cancelBtn = document.getElementById('btnCancelAdd');
  const title = document.getElementById('modelModalTitle');
  const form = document.getElementById('addModelForm');
  const nameInput = document.getElementById('inputName');
  const urlInput = document.getElementById('inputUrl');
  const iconInput = document.getElementById('inputIcon');
  const iconUrlInput = document.getElementById('inputIconUrl');
  const pickLocalIconBtn = document.getElementById('btnPickLocalIcon');
  const clearIconBtn = document.getElementById('btnClearIcon');
  const localIconName = document.getElementById('localIconName');
  const iconPreview = document.getElementById('modelIconPreview');
  const colorInput = document.getElementById('inputColor');
  const deleteBtn = document.getElementById('btnDeleteModel');
  const submitBtn = document.getElementById('btnSubmitModel');
  let editingModel = null;
  let selectedLocalIconPath = '';

  function updateIconPreview() {
    const iconUrl = iconUrlInput.value.trim();
    iconPreview.innerHTML = '';

    if (iconUrl) {
      const image = document.createElement('img');
      image.src = iconUrl;
      image.alt = '';
      image.addEventListener('error', () => {
        iconPreview.textContent = iconInput.value.trim() || '🤖';
      }, { once: true });
      iconPreview.appendChild(image);
      return;
    }

    iconPreview.textContent = iconInput.value.trim() || '🤖';
  }

  function resetToAddMode() {
    editingModel = null;
    title.textContent = '添加 AI 模型';
    submitBtn.textContent = '添加';
    deleteBtn.hidden = true;
    form.reset();
    iconInput.value = '🤖';
    iconUrlInput.value = '';
    selectedLocalIconPath = '';
    localIconName.textContent = '';
    colorInput.value = '#666666';
    updateIconPreview();
  }

  /** 打开弹窗 */
  function openModal() {
    resetToAddMode();
    window.api.view.setVisible(false);  // 隐藏 WebView，避免遮挡弹窗
    modal.classList.add('show');
    nameInput.focus();
  }

  function openEditModal(model) {
    editingModel = model;
    title.textContent = '编辑 AI 模型';
    submitBtn.textContent = '保存';
    deleteBtn.hidden = false;
    nameInput.value = model.name || '';
    urlInput.value = model.url || '';
    iconInput.value = model.icon || '🤖';
    iconUrlInput.value = model.iconUrl || '';
    selectedLocalIconPath = '';
    localIconName.textContent = model.iconUrl && model.iconUrl.startsWith('file:')
      ? '已使用本地图标'
      : '';
    colorInput.value = model.color || '#666666';
    updateIconPreview();
    window.api.view.setVisible(false);
    modal.classList.add('show');
    nameInput.focus();
  }

  /** 关闭弹窗并重置表单 */
  function closeModal() {
    modal.classList.remove('show');
    window.api.view.setVisible(true);  // 恢复显示 WebView
    resetToAddMode();
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

    const payload = {
      name: name,
      url: url,
      icon: iconInput.value.trim() || '🤖',
      iconUrl: iconUrlInput.value.trim(),
      localIconPath: selectedLocalIconPath,
      color: colorInput.value,
    };

    if (editingModel) {
      await window.api.models.update(editingModel.id, payload);
    } else {
      await window.api.models.add(payload);
    }

    closeModal();
  }

  async function handleDelete() {
    if (!editingModel) return;

    const confirmed = window.confirm(
      `确定删除「${editingModel.name}」吗？\n\n将同时清除该站点的登录状态、缓存和本地数据。`
    );
    if (!confirmed) return;

    await window.api.models.remove(editingModel.id);
    closeModal();
  }

  async function pickLocalIcon() {
    const icon = await window.api.models.selectIcon();
    if (!icon) return;

    selectedLocalIconPath = icon.localIconPath;
    iconUrlInput.value = icon.iconUrl;
    localIconName.textContent = icon.name || '本地图标';
    updateIconPreview();
  }

  function clearIcon() {
    selectedLocalIconPath = '';
    iconUrlInput.value = '';
    localIconName.textContent = '';
    updateIconPreview();
  }

  // ── 事件绑定 ──
  addBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  deleteBtn.addEventListener('click', handleDelete);
  pickLocalIconBtn.addEventListener('click', pickLocalIcon);
  clearIconBtn.addEventListener('click', clearIcon);
  iconInput.addEventListener('input', updateIconPreview);
  iconUrlInput.addEventListener('input', () => {
    selectedLocalIconPath = '';
    localIconName.textContent = '';
    updateIconPreview();
  });
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

  window.modelModal = {
    openEdit: openEditModal,
  };
})();
