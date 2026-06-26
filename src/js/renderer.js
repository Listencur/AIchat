'use strict';

/**
 * renderer.js — 前端主逻辑
 * 负责：渲染侧边栏模型列表、处理点击切换、监听 IPC 事件
 */

(function () {
  const modelList = document.getElementById('modelList');
  const mainPlaceholder = document.getElementById('mainPlaceholder');
  let activeModelId = null;

  /**
   * 渲染侧边栏模型列表
   */
  function renderModels(models) {
    modelList.innerHTML = '';

    models.forEach((model) => {
      const li = document.createElement('li');
      li.className = 'model-item';
      li.dataset.id = model.id;
      li.style.setProperty('--model-color', model.color);

      if (model.id === activeModelId) {
        li.classList.add('active');
      }

      li.innerHTML = `
        <span class="model-icon">${model.icon || '🤖'}</span>
        <span class="model-name">${escapeHtml(model.name)}</span>
      `;

      li.addEventListener('click', () => {
        if (model.id === activeModelId) return;
        switchModel(model.id);
      });

      modelList.appendChild(li);
    });
  }

  /**
   * 切换到指定模型
   */
  function switchModel(id) {
    window.api.view.switch(id);
  }

  /**
   * 更新侧边栏 active 状态
   */
  function updateActive(id) {
    activeModelId = id;
    if (id) {
      mainPlaceholder.style.display = 'none';
    }

    document.querySelectorAll('.model-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.id === id);
    });
  }

  /**
   * HTML 转义，防止 XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── 初始化 ──
  document.addEventListener('DOMContentLoaded', async () => {
    // 加载模型列表
    const data = await window.api.models.list();
    const models = data.models || data;
    renderModels(models);

    // 自动切换到第一个模型
    if (models.length > 0) {
      switchModel(models[0].id);
    }

    // 监听模型列表更新
    window.api.models.onUpdated((models) => {
      const list = models.models || models;
      renderModels(list);
    });

    // 监听视图切换
    window.api.view.onSwitched((data) => {
      const id = data.id || data;
      updateActive(id);
    });
  });
})();
