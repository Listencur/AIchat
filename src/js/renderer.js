'use strict';

/**
 * renderer.js — 前端主逻辑
 * 负责：渲染侧边栏模型列表、处理点击切换、监听 IPC 事件
 */

(function () {
  const modelList = document.getElementById('modelList');
  const mainPlaceholder = document.getElementById('mainPlaceholder');
  const splitToggleBtn = document.getElementById('btnToggleSplit');
  const splitActions = document.getElementById('splitActions');
  const splitHint = document.getElementById('splitHint');
  const splitExitBtn = document.getElementById('btnExitSplit');
  let activeModelId = null;
  let modelsCache = [];
  let splitSelecting = false;
  const splitSelection = new Set();

  /**
   * 渲染侧边栏模型列表
   */
  function renderModels(models) {
    modelsCache = models;
    modelList.innerHTML = '';

    models.forEach((model) => {
      const li = document.createElement('li');
      li.className = 'model-item';
      li.dataset.id = model.id;
      li.style.setProperty('--model-color', model.color);

      if (splitSelecting) {
        li.classList.add('split-selecting');
      }

      if (splitSelection.has(model.id)) {
        li.classList.add('split-selected');
      }

      if (model.id === activeModelId) {
        li.classList.add('active');
      }

      li.innerHTML = `
        <span class="model-icon">${model.icon || '🤖'}</span>
        <span class="model-name">${escapeHtml(model.name)}</span>
        <span class="model-check">✓</span>
      `;

      li.addEventListener('click', () => {
        if (splitSelecting) {
          toggleSplitModel(model.id);
          return;
        }

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
   * 开启或关闭分屏选择模式。
   */
  function setSplitSelecting(enabled) {
    splitSelecting = enabled;

    if (enabled && activeModelId && splitSelection.size === 0) {
      splitSelection.add(activeModelId);
    }

    updateSplitControls();
    renderModels(modelsCache);
  }

  /**
   * 切换某个模型的分屏选择状态。
   */
  async function toggleSplitModel(id) {
    if (splitSelection.has(id)) {
      splitSelection.delete(id);
    } else {
      if (splitSelection.size >= 3) {
        splitHint.textContent = '最多选择 3 个模型';
        return;
      }
      splitSelection.add(id);
    }

    updateSplitControls();
    renderModels(modelsCache);
    await syncSplitView();
  }

  /**
   * 根据当前选择进入或退出分屏视图。
   */
  async function syncSplitView() {
    const ids = Array.from(splitSelection);

    if (ids.length >= 2) {
      const ok = await window.api.view.enterSplit(ids);
      if (ok) {
        mainPlaceholder.style.display = 'none';
      }
      return;
    }

    await window.api.view.exitSplit();
  }

  /**
   * 退出分屏选择模式并恢复单视图。
   */
  async function exitSplitMode() {
    splitSelecting = false;
    splitSelection.clear();
    await window.api.view.exitSplit();
    updateSplitControls();
    renderModels(modelsCache);
  }

  /**
   * 更新分屏控制区域状态。
   */
  function updateSplitControls() {
    splitToggleBtn.classList.toggle('active', splitSelecting);
    splitActions.hidden = !splitSelecting;

    const count = splitSelection.size;
    if (!splitSelecting) {
      splitHint.textContent = '选择 2-3 个模型';
    } else if (count < 2) {
      splitHint.textContent = `已选择 ${count} 个，还需 ${2 - count} 个`;
    } else {
      splitHint.textContent = `已选择 ${count} 个`;
    }
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
    updateSplitControls();

    // 自动切换到第一个模型
    if (models.length > 0) {
      switchModel(models[0].id);
    }

    // 监听模型列表更新
    window.api.models.onUpdated((models) => {
      const list = models.models || models;
      const modelIds = new Set(list.map((model) => model.id));
      for (const id of Array.from(splitSelection)) {
        if (!modelIds.has(id)) {
          splitSelection.delete(id);
        }
      }
      renderModels(list);
      updateSplitControls();
    });

    // 监听视图切换
    window.api.view.onSwitched((data) => {
      const id = data.id || data;
      updateActive(id);
    });

    splitToggleBtn.addEventListener('click', () => {
      if (splitSelecting) {
        exitSplitMode();
      } else {
        setSplitSelecting(true);
      }
    });

    splitExitBtn.addEventListener('click', exitSplitMode);
  });
})();
