'use strict';

/**
 * renderer.js — 前端主逻辑
 * 负责：渲染侧边栏模型列表、处理点击切换、监听 IPC 事件
 */

(function () {
  const groupList = document.getElementById('groupList');
  const addGroupBtn = document.getElementById('btnAddGroup');
  const groupModal = document.getElementById('modalAddGroup');
  const groupCloseBtn = document.getElementById('btnCloseGroupModal');
  const groupCancelBtn = document.getElementById('btnCancelGroupAdd');
  const groupForm = document.getElementById('addGroupForm');
  const groupNameInput = document.getElementById('inputGroupName');
  const groupModelChecks = document.getElementById('groupModelChecks');
  const modelList = document.getElementById('modelList');
  const modelContextMenu = document.getElementById('modelContextMenu');
  const mainPlaceholder = document.getElementById('mainPlaceholder');
  const splitToggleBtn = document.getElementById('btnToggleSplit');
  const splitActions = document.getElementById('splitActions');
  const splitHint = document.getElementById('splitHint');
  const splitExitBtn = document.getElementById('btnExitSplit');
  const mainArea = document.getElementById('mainArea');
  const splitResizers = document.getElementById('splitResizers');
  const SPLIT_GUTTER_WIDTH = 10;
  const MIN_SPLIT_RATIO = 0.18;
  let activeModelId = null;
  let modelsCache = [];
  let visibleModelsCache = [];
  let groupsCache = [];
  let activeGroupId = 'all';
  let loadedModelIds = new Set();
  let splitSelecting = false;
  let splitRatios = [];
  let draggedModelId = null;
  let contextModelId = null;
  const splitSelection = new Set();

  /**
   * 渲染侧边栏模型列表
   */
  function renderModels(models) {
    visibleModelsCache = models;
    modelList.innerHTML = '';

    models.forEach((model) => {
      const li = document.createElement('li');
      li.className = 'model-item';
      li.dataset.id = model.id;
      li.draggable = !splitSelecting;
      li.title = '拖拽排序，右键打开菜单';
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

      if (loadedModelIds.has(model.id)) {
        li.classList.add('is-loaded');
      }

      li.appendChild(createModelIcon(model));

      const name = document.createElement('span');
      name.className = 'model-name';
      name.textContent = model.name;
      li.appendChild(name);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'model-close';
      closeBtn.type = 'button';
      closeBtn.title = '结束并释放内存';
      closeBtn.setAttribute('aria-label', `结束 ${model.name}`);
      closeBtn.textContent = '×';
      closeBtn.disabled = !loadedModelIds.has(model.id);
      li.appendChild(closeBtn);

      const check = document.createElement('span');
      check.className = 'model-check';
      check.textContent = '✓';
      li.appendChild(check);

      closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeModel(model.id);
      });

      li.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openModelMenu(event, model.id);
      });

      li.addEventListener('dragstart', (event) => startModelDrag(event, model.id));
      li.addEventListener('dragover', handleModelDragOver);
      li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
      li.addEventListener('drop', (event) => dropModel(event, model.id));
      li.addEventListener('dragend', clearModelDrag);

      li.addEventListener('click', () => {
        closeModelMenu();
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

  function createModelIcon(model) {
    const wrapper = document.createElement('span');
    wrapper.className = 'model-icon';

    if (model.iconUrl) {
      const image = document.createElement('img');
      image.src = model.iconUrl;
      image.alt = '';
      image.addEventListener('error', () => {
        wrapper.textContent = model.icon || '🤖';
        wrapper.classList.add('icon-fallback');
      }, { once: true });
      wrapper.appendChild(image);
      return wrapper;
    }

    wrapper.textContent = model.icon || '🤖';
    wrapper.classList.add('icon-fallback');
    return wrapper;
  }

  /**
   * 切换到指定模型
   */
  function switchModel(id) {
    window.api.view.switch(id).then((ok) => {
      if (ok) {
        loadedModelIds.add(id);
        updateActive(id);
        renderModels(getVisibleModels());
      }
    });
  }

  async function closeModel(id) {
    if (!loadedModelIds.has(id)) return;

    const state = await window.api.view.close(id);
    syncViewState(state, id);
  }

  async function deleteModel(id) {
    const model = modelsCache.find((item) => item.id === id);
    if (!model) return;

    const confirmed = window.confirm(`确定删除「${model.name}」吗？`);
    if (!confirmed) return;

    await window.api.models.remove(id);
    closeModelMenu();
  }

  function openModelMenu(event, id) {
    contextModelId = id;
    const isLoaded = loadedModelIds.has(id);
    const closeAction = modelContextMenu.querySelector('[data-action="close"]');
    closeAction.disabled = !isLoaded;

    modelContextMenu.hidden = false;
    const rect = modelContextMenu.getBoundingClientRect();
    const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
    modelContextMenu.style.left = `${Math.max(8, left)}px`;
    modelContextMenu.style.top = `${Math.max(8, top)}px`;
  }

  function closeModelMenu() {
    contextModelId = null;
    modelContextMenu.hidden = true;
  }

  function handleModelMenuAction(action) {
    if (!contextModelId) return;

    const model = modelsCache.find((item) => item.id === contextModelId);
    if (!model) {
      closeModelMenu();
      return;
    }

    if (action === 'edit') {
      closeModelMenu();
      window.modelModal.openEdit({ ...model });
      return;
    }

    if (action === 'close') {
      closeModel(contextModelId);
      closeModelMenu();
      return;
    }

    if (action === 'delete') {
      deleteModel(contextModelId);
    }
  }

  function startModelDrag(event, id) {
    if (splitSelecting) {
      event.preventDefault();
      return;
    }

    draggedModelId = id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    event.currentTarget.classList.add('dragging');
  }

  function handleModelDragOver(event) {
    if (!draggedModelId || splitSelecting) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
  }

  async function dropModel(event, targetId) {
    event.preventDefault();
    if (!draggedModelId || draggedModelId === targetId) {
      clearModelDrag();
      return;
    }

    const visibleIds = visibleModelsCache.map((model) => model.id);
    const fromIndex = visibleIds.indexOf(draggedModelId);
    const toIndex = visibleIds.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) {
      clearModelDrag();
      return;
    }

    visibleIds.splice(toIndex, 0, visibleIds.splice(fromIndex, 1)[0]);
    const visibleQueue = visibleIds.slice();
    const visibleSet = new Set(visibleIds);
    const orderedIds = modelsCache.map((model) => (
      visibleSet.has(model.id) ? visibleQueue.shift() : model.id
    ));

    const nextModels = await window.api.models.reorder(orderedIds);
    modelsCache = nextModels.models || nextModels;
    renderGroups(groupsCache);
    renderModels(getVisibleModels());
    clearModelDrag();
  }

  function clearModelDrag() {
    draggedModelId = null;
    document.querySelectorAll('.model-item.dragging, .model-item.drag-over').forEach((item) => {
      item.classList.remove('dragging', 'drag-over');
    });
  }

  function syncViewState(state, closedId = null) {
    if (!state) return;

    loadedModelIds = new Set(Array.isArray(state.loadedIds) ? state.loadedIds : []);

    if (closedId) {
      splitSelection.delete(closedId);
    }

    if (state.splitMode && Array.isArray(state.splitIds) && state.splitIds.length >= 2) {
      splitSelecting = true;
      splitSelection.clear();
      state.splitIds.forEach((id) => splitSelection.add(id));
      splitRatios = normalizeRatios(state.splitRatios, state.splitIds.length);
      updateActive(state.activeId || state.splitIds[0]);
      updateSplitControls();
      renderModels(getVisibleModels());
      renderSplitResizers();
      return;
    }

    splitSelecting = false;
    splitSelection.clear();
    splitRatios = [];
    clearSplitResizers();
    updateActive(state.activeId || null);
    updateSplitControls();
    renderModels(getVisibleModels());
  }

  /**
   * 渲染场景分组列表，包含内置「全部」分组。
   */
  function renderGroups(groups) {
    groupsCache = groups;
    groupList.innerHTML = '';

    const allGroup = {
      id: 'all',
      name: '全部',
      modelIds: modelsCache.map((model) => model.id),
      builtin: true,
    };

    [allGroup, ...groups].forEach((group) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'group-item';
      button.dataset.id = group.id;
      button.classList.toggle('active', group.id === activeGroupId);

      const name = document.createElement('span');
      name.className = 'group-name';
      name.textContent = group.name;

      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = String(group.modelIds.length);

      button.appendChild(name);
      button.appendChild(count);

      if (!group.builtin) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'group-remove';
        removeBtn.textContent = '×';
        removeBtn.title = '删除分组';
        removeBtn.addEventListener('click', async (event) => {
          event.stopPropagation();
          if (activeGroupId === group.id) {
            activeGroupId = 'all';
          }
          await window.api.groups.remove(group.id);
        });
        button.appendChild(removeBtn);
      }

      button.addEventListener('click', () => {
        applyGroup(group.id);
      });

      groupList.appendChild(button);
    });
  }

  /**
   * 应用当前分组过滤。
   */
  async function applyGroup(groupId) {
    activeGroupId = groupId;

    if (splitSelecting) {
      await exitSplitMode();
    }

    renderGroups(groupsCache);
    renderModels(getVisibleModels());

    const visibleIds = new Set(visibleModelsCache.map((model) => model.id));
    if (!visibleIds.has(activeModelId) && visibleModelsCache.length > 0) {
      switchModel(visibleModelsCache[0].id);
    }
  }

  function getVisibleModels() {
    if (activeGroupId === 'all') {
      return modelsCache;
    }

    const group = groupsCache.find((item) => item.id === activeGroupId);
    if (!group) {
      activeGroupId = 'all';
      return modelsCache;
    }

    const modelIds = new Set(group.modelIds);
    return modelsCache.filter((model) => modelIds.has(model.id));
  }

  function ensureActiveModelVisible() {
    const visibleIds = new Set(visibleModelsCache.map((model) => model.id));
    if (!visibleIds.has(activeModelId) && visibleModelsCache.length > 0) {
      switchModel(visibleModelsCache[0].id);
    }
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
    renderModels(visibleModelsCache);
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
    renderModels(visibleModelsCache);
    await syncSplitView();
  }

  /**
   * 根据当前选择进入或退出分屏视图。
   */
  async function syncSplitView() {
    const ids = Array.from(splitSelection);

    if (ids.length >= 2) {
      splitRatios = ids.map(() => 1 / ids.length);
      const ok = await window.api.view.enterSplit(ids);
      if (ok) {
        ids.forEach((id) => loadedModelIds.add(id));
        mainPlaceholder.style.display = 'none';
        updateActive(ids[0]);
        renderModels(getVisibleModels());
        renderSplitResizers();
      }
      return;
    }

    await window.api.view.exitSplit();
    clearSplitResizers();
  }

  /**
   * 退出分屏选择模式并恢复单视图。
   */
  async function exitSplitMode() {
    splitSelecting = false;
    splitSelection.clear();
    splitRatios = [];
    await window.api.view.exitSplit();
    clearSplitResizers();
    updateSplitControls();
    renderModels(getVisibleModels());
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
   * 渲染分屏拖拽分隔条。
   */
  function renderSplitResizers() {
    const count = splitSelection.size;
    splitResizers.innerHTML = '';

    if (count < 2) {
      clearSplitResizers();
      return;
    }

    if (splitRatios.length !== count) {
      splitRatios = Array.from({ length: count }, () => 1 / count);
    }

    splitResizers.hidden = false;

    const contentWidth = Math.max(0, mainArea.clientWidth - SPLIT_GUTTER_WIDTH * (count - 1));
    let left = 0;

    for (let i = 0; i < count - 1; i += 1) {
      const handle = document.createElement('div');
      handle.className = 'split-resizer';
      handle.dataset.index = String(i);
      handle.addEventListener('pointerdown', (event) => startResize(event, i));
      splitResizers.appendChild(handle);

      left += contentWidth * splitRatios[i];
    }

    updateSplitResizerPositions();
  }

  function clearSplitResizers() {
    splitResizers.hidden = true;
    splitResizers.innerHTML = '';
  }

  function updateSplitResizerPositions() {
    const count = splitSelection.size;
    if (count < 2 || splitRatios.length !== count) return;

    const contentWidth = Math.max(0, mainArea.clientWidth - SPLIT_GUTTER_WIDTH * (count - 1));
    let left = 0;

    splitResizers.querySelectorAll('.split-resizer').forEach((handle, index) => {
      left += contentWidth * splitRatios[index];
      handle.style.left = `${Math.round(left + SPLIT_GUTTER_WIDTH * index)}px`;
    });
  }

  function startResize(event, index) {
    event.preventDefault();

    const handle = event.currentTarget;
    const count = splitSelection.size;
    const startRatios = splitRatios.slice();
    const pairTotal = startRatios[index] + startRatios[index + 1];
    const beforeTotal = startRatios.slice(0, index).reduce((sum, ratio) => sum + ratio, 0);
    const rect = mainArea.getBoundingClientRect();
    const contentWidth = Math.max(1, rect.width - SPLIT_GUTTER_WIDTH * (count - 1));

    handle.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);

    async function handleMove(moveEvent) {
      const x = moveEvent.clientX - rect.left;
      const contentX = x - SPLIT_GUTTER_WIDTH * index;
      const boundaryRatio = contentX / contentWidth;
      const nextLeft = clamp(boundaryRatio - beforeTotal, MIN_SPLIT_RATIO, pairTotal - MIN_SPLIT_RATIO);

      splitRatios = startRatios.slice();
      splitRatios[index] = nextLeft;
      splitRatios[index + 1] = pairTotal - nextLeft;

      updateSplitResizerPositions();
      await window.api.view.setSplitRatios(splitRatios);
    }

    function handleUp(upEvent) {
      handle.releasePointerCapture(upEvent.pointerId);
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', handleMove);
      handle.removeEventListener('pointerup', handleUp);
      handle.removeEventListener('pointercancel', handleUp);
    }

    handle.addEventListener('pointermove', handleMove);
    handle.addEventListener('pointerup', handleUp);
    handle.addEventListener('pointercancel', handleUp);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeRatios(ratios, count) {
    if (!Array.isArray(ratios) || ratios.length !== count) {
      return Array.from({ length: count }, () => 1 / count);
    }

    const values = ratios.map(Number);
    if (values.some((ratio) => ratio <= 0)) {
      return Array.from({ length: count }, () => 1 / count);
    }

    const total = values.reduce((sum, ratio) => sum + ratio, 0);
    if (total <= 0) {
      return Array.from({ length: count }, () => 1 / count);
    }

    return values.map((ratio) => ratio / total);
  }

  async function restoreInitialView(models) {
    const settings = await window.api.settings.get();
    if (!settings.restoreSnapshot) {
      return false;
    }

    const snapshot = await window.api.snapshot.get();
    const modelIds = new Set(models.map((model) => model.id));
    const splitIds = Array.isArray(snapshot.splitIds)
      ? snapshot.splitIds.filter((id) => modelIds.has(id)).slice(0, 3)
      : [];

    if (snapshot.splitMode && splitIds.length >= 2) {
      splitSelecting = true;
      splitSelection.clear();
      splitIds.forEach((id) => splitSelection.add(id));
      splitRatios = normalizeRatios(snapshot.splitRatios, splitIds.length);
      updateSplitControls();
      renderModels(getVisibleModels());

      const ok = await window.api.view.enterSplit(splitIds);
      if (ok) {
        await window.api.view.setSplitRatios(splitRatios);
        splitIds.forEach((id) => loadedModelIds.add(id));
        mainPlaceholder.style.display = 'none';
        updateActive(splitIds[0]);
        renderModels(getVisibleModels());
        renderSplitResizers();
        return true;
      }

      splitSelecting = false;
      splitSelection.clear();
      splitRatios = [];
    }

    if (snapshot.activeModelId && modelIds.has(snapshot.activeModelId)) {
      switchModel(snapshot.activeModelId);
      return true;
    }

    return false;
  }

  /**
   * 更新侧边栏 active 状态
   */
  function updateActive(id) {
    activeModelId = id;
    mainPlaceholder.style.display = id ? 'none' : 'flex';

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

  function renderGroupModelChecks() {
    groupModelChecks.innerHTML = '';

    modelsCache.forEach((model) => {
      const label = document.createElement('label');
      label.className = 'check-row';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = model.id;

      const icon = document.createElement('span');
      icon.textContent = model.icon || '🤖';

      const name = document.createElement('span');
      name.textContent = model.name;

      label.appendChild(input);
      label.appendChild(icon);
      label.appendChild(name);
      groupModelChecks.appendChild(label);
    });
  }

  async function openGroupModal() {
    await window.api.view.setVisible(false);
    renderGroupModelChecks();
    groupModal.classList.add('show');
    groupNameInput.focus();
  }

  function closeGroupModal() {
    groupModal.classList.remove('show');
    window.api.view.setVisible(true);
    groupForm.reset();
  }

  async function handleGroupSubmit(event) {
    event.preventDefault();

    const name = groupNameInput.value.trim();
    const modelIds = Array.from(groupModelChecks.querySelectorAll('input:checked'))
      .map((input) => input.value);

    if (!name) {
      groupNameInput.focus();
      return;
    }

    if (modelIds.length === 0) {
      return;
    }

    const group = await window.api.groups.add({ name, modelIds });
    if (group) {
      activeGroupId = group.id;
      if (!groupsCache.some((item) => item.id === group.id)) {
        groupsCache.push(group);
      }
      renderGroups(groupsCache);
      renderModels(getVisibleModels());
      ensureActiveModelVisible();
    }

    closeGroupModal();
  }

  // ── 初始化 ──
  document.addEventListener('DOMContentLoaded', async () => {
    // 加载模型列表
    const data = await window.api.models.list();
    const models = data.models || data;
    modelsCache = models;
    const groups = await window.api.groups.list();
    renderGroups(groups);
    renderModels(getVisibleModels());
    updateSplitControls();

    // 自动恢复上次会话；未开启或恢复失败时切换到第一个模型
    const restored = await restoreInitialView(models);
    if (!restored && models.length > 0) {
      switchModel(models[0].id);
    }

    // 监听模型列表更新
    window.api.models.onUpdated((models) => {
      const list = models.models || models;
      modelsCache = list;
      const modelIds = new Set(list.map((model) => model.id));
      loadedModelIds = new Set(Array.from(loadedModelIds).filter((id) => modelIds.has(id)));
      for (const id of Array.from(splitSelection)) {
        if (!modelIds.has(id)) {
          splitSelection.delete(id);
        }
      }
      renderGroups(groupsCache);
      renderModels(getVisibleModels());
      ensureActiveModelVisible();
      updateSplitControls();
      renderSplitResizers();
    });

    window.api.groups.onUpdated((groups) => {
      groupsCache = groups;
      if (activeGroupId !== 'all' && !groupsCache.some((group) => group.id === activeGroupId)) {
        activeGroupId = 'all';
      }
      renderGroups(groupsCache);
      renderModels(getVisibleModels());
      ensureActiveModelVisible();
    });

    // 监听视图切换
    window.api.view.onSwitched((data) => {
      const id = data.id || data;
      updateActive(id);
    });

    window.api.view.onClosed((data) => {
      syncViewState(data.state, data.id);
    });

    modelContextMenu.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button || button.disabled) return;
      handleModelMenuAction(button.dataset.action);
    });

    document.addEventListener('click', (event) => {
      if (!modelContextMenu.hidden && !modelContextMenu.contains(event.target)) {
        closeModelMenu();
      }
    });

    modelList.addEventListener('scroll', closeModelMenu);

    splitToggleBtn.addEventListener('click', () => {
      if (splitSelecting) {
        exitSplitMode();
      } else {
        setSplitSelecting(true);
      }
    });

    splitExitBtn.addEventListener('click', exitSplitMode);

    addGroupBtn.addEventListener('click', openGroupModal);
    groupCloseBtn.addEventListener('click', closeGroupModal);
    groupCancelBtn.addEventListener('click', closeGroupModal);
    groupForm.addEventListener('submit', handleGroupSubmit);

    groupModal.addEventListener('click', (event) => {
      if (event.target === groupModal) closeGroupModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && groupModal.classList.contains('show')) {
        closeGroupModal();
      }

      if (event.key === 'Escape' && !modelContextMenu.hidden) {
        closeModelMenu();
      }
    });

    window.addEventListener('resize', () => {
      renderSplitResizers();
    });
  });
})();
