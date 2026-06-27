'use strict';

/**
 * renderer.js — 前端主逻辑
 * 负责：渲染侧边栏模型列表、处理点击切换、监听 IPC 事件
 */

(function () {
  const sidebar = document.getElementById('sidebar');
  const groupList = document.getElementById('groupList');
  const addGroupBtn = document.getElementById('btnAddGroup');
  const groupModal = document.getElementById('modalAddGroup');
  const groupCloseBtn = document.getElementById('btnCloseGroupModal');
  const groupCancelBtn = document.getElementById('btnCancelGroupAdd');
  const groupForm = document.getElementById('addGroupForm');
  const groupNameInput = document.getElementById('inputGroupName');
  const groupModelChecks = document.getElementById('groupModelChecks');
  const sidebarToggleBtn = document.getElementById('btnSidebarToggle');
  const themeBtn = document.getElementById('btnTheme');
  const windowMinimizeBtn = document.getElementById('btnWindowMinimize');
  const windowMaximizeBtn = document.getElementById('btnWindowMaximize');
  const windowCloseBtn = document.getElementById('btnWindowClose');
  const windowTitle = document.getElementById('windowTitle');
  const statusBtn = document.getElementById('btnStatus');
  const statusModal = document.getElementById('modalStatus');
  const statusCloseBtn = document.getElementById('btnCloseStatus');
  const statusRefreshBtn = document.getElementById('btnRefreshStatus');
  const closeInactiveModelsBtn = document.getElementById('btnCloseInactiveModels');
  const statusSummary = document.getElementById('statusSummary');
  const statusList = document.getElementById('statusList');
  const modelList = document.getElementById('modelList');
  const modelContextMenu = document.getElementById('modelContextMenu');
  const mainPlaceholder = document.getElementById('mainPlaceholder');
  const placeholderText = document.getElementById('placeholderText');
  const placeholderRefreshBtn = document.getElementById('btnPlaceholderRefresh');
  const splitToggleBtn = document.getElementById('btnToggleSplit');
  const exportConversationBtn = document.getElementById('btnExportConversation');
  const splitActions = document.getElementById('splitActions');
  const splitHint = document.getElementById('splitHint');
  const splitDirectionControl = document.getElementById('splitDirection');
  const splitHorizontalBtn = document.getElementById('btnSplitHorizontal');
  const splitVerticalBtn = document.getElementById('btnSplitVertical');
  const splitRestoreBtn = document.getElementById('btnRestoreSplit');
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
  let loadingModelIds = new Set();
  let failedModelIds = new Set();
  let sidebarCollapsed = false;
  let splitSelecting = false;
  let splitDirection = 'horizontal';
  let splitRatios = [];
  let pendingSplitRestore = null;
  let splitRestoring = false;
  let draggedModelId = null;
  let contextModelId = null;
  let viewEventsRegistered = false;
  const splitSelection = new Set();

  /**
   * 渲染侧边栏模型列表
   */
  function renderModels(models) {
    visibleModelsCache = models;
    modelList.innerHTML = '';

    models.forEach((model) => {
      const li = document.createElement('li');
      const modelStatus = getModelStatus(model.id);
      li.className = 'model-item';
      li.dataset.id = model.id;
      li.draggable = !splitSelecting;
      li.title = `${model.name} · ${modelStatus.label}；拖拽排序，右键打开菜单`;
      li.setAttribute('aria-label', `${model.name}，${modelStatus.label}`);
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

      li.appendChild(createModelStatusDot(model.id, modelStatus));

      const check = document.createElement('span');
      check.className = 'model-check';
      check.textContent = '✓';
      li.appendChild(check);

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
    const iconUrls = Array.isArray(model.iconUrls) ? model.iconUrls : [];
    const candidates = [model.iconUrl, ...iconUrls]
      .filter((url) => typeof url === 'string' && url.trim())
      .map((url) => url.trim())
      .filter((url, index, list) => list.indexOf(url) === index);

    if (candidates.length > 0) {
      const image = document.createElement('img');
      let candidateIndex = 0;
      image.src = candidates[candidateIndex];
      image.alt = '';
      image.addEventListener('error', () => {
        candidateIndex += 1;
        if (candidateIndex < candidates.length) {
          image.src = candidates[candidateIndex];
          return;
        }

        wrapper.textContent = model.icon || '🤖';
        wrapper.classList.add('icon-fallback');
      });
      wrapper.appendChild(image);
      return wrapper;
    }

    wrapper.textContent = model.icon || '🤖';
    wrapper.classList.add('icon-fallback');
    return wrapper;
  }

  function createModelStatusDot(modelId, status = getModelStatus(modelId)) {
    const dot = document.createElement('span');
    dot.className = `model-status-dot ${status.type}`;
    dot.title = status.label;
    dot.setAttribute('aria-label', status.label);
    return dot;
  }

  function getModelStatus(modelId) {
    if (failedModelIds.has(modelId)) {
      return { type: 'failed', label: '加载失败' };
    }

    if (loadingModelIds.has(modelId)) {
      return { type: 'loading', label: '加载中' };
    }

    if (loadedModelIds.has(modelId)) {
      return { type: 'ready', label: '已就绪' };
    }

    return { type: 'idle', label: '未运行' };
  }

  function applyTheme(theme) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    document.body.dataset.theme = nextTheme;
    themeBtn.textContent = nextTheme === 'light' ? '☀' : '☾';
    themeBtn.title = nextTheme === 'light' ? '切换深色模式' : '切换浅色模式';
    themeBtn.setAttribute('aria-label', themeBtn.title);
  }

  async function setSidebarCollapsed(collapsed, persist = true) {
    sidebarCollapsed = collapsed === true;
    document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
    sidebarToggleBtn.title = sidebarCollapsed ? '显示模型栏' : '隐藏模型栏';
    sidebarToggleBtn.setAttribute('aria-label', sidebarToggleBtn.title);
    sidebarToggleBtn.classList.toggle('active', sidebarCollapsed);
    closeModelMenu();

    if (persist) {
      localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    }

    await window.api.view.setSidebarCollapsed(sidebarCollapsed);
    scheduleSplitResizerRefresh();
  }

  function toggleSidebarCollapsed() {
    setSidebarCollapsed(!sidebarCollapsed);
  }

  function scheduleSplitResizerRefresh() {
    renderSplitResizers();

    window.requestAnimationFrame(() => {
      renderSplitResizers();
      window.requestAnimationFrame(renderSplitResizers);
    });

    window.setTimeout(renderSplitResizers, 220);
  }

  function setSplitDirection(direction, syncView = true) {
    splitDirection = direction === 'vertical' ? 'vertical' : 'horizontal';
    splitHorizontalBtn.classList.toggle('active', splitDirection === 'horizontal');
    splitVerticalBtn.classList.toggle('active', splitDirection === 'vertical');
    splitResizers.classList.toggle('vertical', splitDirection === 'vertical');
    splitResizers.classList.toggle('horizontal', splitDirection === 'horizontal');

    if (syncView && splitSelecting && splitSelection.size >= 2) {
      syncSplitView();
      return;
    }

    renderSplitResizers();
  }

  async function toggleTheme() {
    const settings = await window.api.settings.get();
    const nextTheme = settings.theme === 'light' ? 'dark' : 'light';
    const saved = await window.api.settings.set({
      ...settings,
      theme: nextTheme,
    });
    applyTheme(saved.theme);
  }

  /**
   * 切换到指定模型
   */
  function switchModel(id) {
    const shouldShowLoading = !loadedModelIds.has(id);
    if (shouldShowLoading) {
      setModelLoading(id, true);
    }
    failedModelIds.delete(id);
    updateActive(id);
    renderModels(getVisibleModels());

    window.api.view.switch(id)
      .then((ok) => {
        if (ok) {
          loadedModelIds.add(id);
          renderModels(getVisibleModels());
        } else if (shouldShowLoading) {
          setModelLoading(id, false);
        }
      })
      .catch(() => {
        if (shouldShowLoading) {
          setModelLoading(id, false);
        }
      });
  }

  function setModelLoading(id, loading) {
    if (!id) return;

    if (loading) {
      loadingModelIds.add(id);
    } else {
      loadingModelIds.delete(id);
    }

    updateMainPlaceholder();
  }

  function updateMainPlaceholder() {
    const splitVisible = splitSelecting && splitSelection.size >= 2;
    const loadingActive = Boolean(activeModelId && loadingModelIds.has(activeModelId) && !splitVisible);
    const failedActive = Boolean(activeModelId && failedModelIds.has(activeModelId) && !splitVisible);
    const emptyActive = !activeModelId;

    mainArea.classList.toggle('is-loading', loadingActive);
    mainArea.classList.toggle('is-failed', failedActive);
    mainArea.classList.toggle('is-empty', emptyActive);
    mainPlaceholder.style.display = (emptyActive || loadingActive || failedActive) ? 'flex' : 'none';
    placeholderRefreshBtn.hidden = !failedActive;

    if (failedActive) {
      placeholderText.textContent = '页面加载失败';
    } else if (emptyActive) {
      placeholderText.textContent = '选择一个模型开始';
    } else {
      placeholderText.textContent = '正在加载';
    }
  }

  async function refreshPlaceholderModel() {
    if (!activeModelId) return;

    failedModelIds.delete(activeModelId);
    setModelLoading(activeModelId, true);
    renderModels(getVisibleModels());
    await window.api.view.refresh();
    updateMainPlaceholder();
  }

  async function closeModel(id) {
    if (!loadedModelIds.has(id)) return;

    const state = await window.api.view.close(id);
    syncViewState(state, id);
  }

  async function exportConversation() {
    if (!activeModelId) {
      window.alert('请先选择一个模型。');
      return;
    }

    exportConversationBtn.disabled = true;
    const originalText = exportConversationBtn.querySelector('span:last-child').textContent;
    exportConversationBtn.querySelector('span:last-child').textContent = '导出中';

    try {
      const result = await window.api.view.exportConversation();
      if (result && result.canceled) {
        return;
      }

      if (!result || !result.ok) {
        window.alert('当前页面暂时无法导出，可能是页面尚未加载完成或站点结构已变化。');
        return;
      }

      window.alert(`导出完成：\n${result.filePath}`);
    } finally {
      exportConversationBtn.disabled = false;
      exportConversationBtn.querySelector('span:last-child').textContent = originalText;
    }
  }

  async function openStatusModal() {
    await window.api.view.setVisible(false);
    statusModal.classList.add('show');
    await refreshStatusPanel();
  }

  function closeStatusModal() {
    statusModal.classList.remove('show');
    window.api.view.setVisible(true);
  }

  async function refreshStatusPanel() {
    const status = await window.api.view.getStatus();
    renderStatusPanel(status);
  }

  function renderStatusPanel(status) {
    const models = Array.isArray(status.models) ? status.models : [];
    const loadedCount = models.filter((model) => model.loaded).length;
    const visibleCount = models.filter((model) => model.visible).length;
    const backgroundCount = models.filter((model) => model.loaded && !model.visible).length;

    statusSummary.textContent = `已运行 ${loadedCount}/${models.length} · 当前显示 ${visibleCount} · 后台 ${backgroundCount}`;
    closeInactiveModelsBtn.disabled = backgroundCount === 0;
    statusList.innerHTML = '';

    models.forEach((model) => {
      const item = document.createElement('section');
      item.className = 'status-item';
      item.classList.toggle('is-active', model.active);
      item.style.setProperty('--model-color', model.color);

      const icon = createModelIcon(model);
      item.appendChild(icon);

      const content = document.createElement('div');
      content.className = 'status-content';

      const titleRow = document.createElement('div');
      titleRow.className = 'status-title-row';

      const name = document.createElement('span');
      name.className = 'status-name';
      name.textContent = model.name;

      const badges = document.createElement('span');
      badges.className = 'status-badges';
      const statusLabel = model.loadFailed ? '加载失败' : (model.loaded ? (model.isLoading ? '加载中' : '运行中') : '未运行');
      const statusType = model.loadFailed ? 'failed' : (model.loaded ? 'running' : 'idle');
      badges.appendChild(createStatusBadge(statusLabel, statusType));
      if (model.active) badges.appendChild(createStatusBadge('当前', 'active'));
      if (model.inSplit) badges.appendChild(createStatusBadge('分屏', 'split'));

      titleRow.appendChild(name);
      titleRow.appendChild(badges);

      const pageTitle = document.createElement('div');
      pageTitle.className = 'status-page-title';
      pageTitle.textContent = model.loaded && model.title ? model.title : '尚未创建页面';

      const url = document.createElement('div');
      url.className = 'status-url';
      url.textContent = model.url || '';

      const meta = document.createElement('div');
      meta.className = 'status-meta';
      meta.textContent = formatStatusMeta(model);

      content.appendChild(titleRow);
      content.appendChild(pageTitle);
      content.appendChild(url);
      content.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'status-item-actions';
      actions.appendChild(createStatusAction('切换', () => switchFromStatus(model.id)));
      actions.appendChild(createStatusAction('刷新', () => refreshModelFromStatus(model.id), !model.loaded));
      actions.appendChild(createStatusAction('结束', () => closeModelFromStatus(model.id), !model.loaded, true));

      item.appendChild(content);
      item.appendChild(actions);
      statusList.appendChild(item);
    });
  }

  function createStatusBadge(text, type) {
    const badge = document.createElement('span');
    badge.className = `status-badge ${type}`;
    badge.textContent = text;
    return badge;
  }

  function createStatusAction(text, handler, disabled = false, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = danger ? 'btn-status danger' : 'btn-status';
    button.textContent = text;
    button.disabled = disabled;
    button.addEventListener('click', handler);
    return button;
  }

  function formatStatusMeta(model) {
    if (!model.loaded) {
      return '释放状态';
    }

    const parts = [];
    if (model.memoryMb) parts.push(`内存 ${model.memoryMb} MB`);
    if (model.processId) parts.push(`PID ${model.processId}`);
    return parts.length > 0 ? parts.join(' · ') : '运行中';
  }

  async function switchFromStatus(id) {
    const ok = await window.api.view.switch(id);
    if (ok) {
      loadedModelIds.add(id);
      updateActive(id);
      renderModels(getVisibleModels());
      await window.api.view.setVisible(false);
      await refreshStatusPanel();
    }
  }

  async function refreshModelFromStatus(id) {
    await window.api.view.refreshModel(id);
    await refreshStatusPanel();
  }

  async function closeModelFromStatus(id) {
    await closeModel(id);
    await refreshStatusPanel();
  }

  async function closeInactiveModelsFromStatus() {
    const state = await window.api.view.closeInactive();
    syncViewState(state);
    await refreshStatusPanel();
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
    const sidebarRect = sidebar.getBoundingClientRect();
    const margin = 8;
    const minLeft = sidebarRect.left + margin;
    const maxLeft = sidebarRect.right - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    const left = maxLeft >= minLeft
      ? clamp(event.clientX, minLeft, maxLeft)
      : minLeft;
    const top = clamp(event.clientY, margin, Math.max(margin, maxTop));
    modelContextMenu.style.left = `${left}px`;
    modelContextMenu.style.top = `${top}px`;
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
    loadingModelIds = new Set(Array.from(loadingModelIds).filter((id) => loadedModelIds.has(id)));
    failedModelIds = new Set(Array.from(failedModelIds).filter((id) => loadedModelIds.has(id)));

    if (closedId) {
      splitSelection.delete(closedId);
      loadingModelIds.delete(closedId);
      failedModelIds.delete(closedId);
    }

    if (state.splitMode && Array.isArray(state.splitIds) && state.splitIds.length >= 2) {
      splitSelecting = true;
      splitSelection.clear();
      state.splitIds.forEach((id) => splitSelection.add(id));
      setSplitDirection(state.splitDirection, false);
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
    if (enabled) {
      clearPendingSplitRestore();
    }

    if (enabled && activeModelId && splitSelection.size === 0) {
      splitSelection.add(activeModelId);
    }

    updateSplitControls();
    renderModels(visibleModelsCache);
    updateMainPlaceholder();
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
      const ok = await window.api.view.enterSplit(ids, splitDirection);
      if (ok) {
        ids.forEach((id) => loadedModelIds.add(id));
        updateActive(ids[0]);
        renderModels(getVisibleModels());
        renderSplitResizers();
      }
      return;
    }

    await window.api.view.exitSplit();
    clearSplitResizers();
    updateMainPlaceholder();
  }

  /**
   * 退出分屏选择模式并恢复单视图。
   */
  async function exitSplitMode() {
    splitSelecting = false;
    splitSelection.clear();
    splitRatios = [];
    clearPendingSplitRestore();
    await window.api.view.exitSplit();
    clearSplitResizers();
    updateSplitControls();
    renderModels(getVisibleModels());
    updateMainPlaceholder();
  }

  /**
   * 更新分屏控制区域状态。
   */
  function updateSplitControls() {
    const hasPendingRestore = hasPendingSplitRestore();
    splitToggleBtn.classList.toggle('active', splitSelecting);
    splitActions.hidden = !splitSelecting && !hasPendingRestore && !splitRestoring;
    splitRestoreBtn.hidden = !hasPendingRestore || splitSelecting || splitRestoring;
    splitExitBtn.hidden = !splitSelecting || splitRestoring;
    splitDirectionControl.hidden = !splitSelecting || splitRestoring;

    if (splitRestoring) {
      splitHint.textContent = '正在恢复分屏';
      return;
    }

    if (!splitSelecting && hasPendingRestore) {
      splitHint.textContent = `上次分屏 ${pendingSplitRestore.ids.length} 个模型`;
      return;
    }

    const count = splitSelection.size;
    if (!splitSelecting) {
      splitHint.textContent = '选择 2-3 个模型';
    } else if (count < 2) {
      splitHint.textContent = `已选择 ${count} 个，还需 ${2 - count} 个`;
    } else {
      splitHint.textContent = `已选择 ${count} 个`;
    }
  }

  function hasPendingSplitRestore() {
    return Boolean(pendingSplitRestore && Array.isArray(pendingSplitRestore.ids) && pendingSplitRestore.ids.length >= 2);
  }

  function clearPendingSplitRestore() {
    pendingSplitRestore = null;
    splitRestoring = false;
  }

  async function restorePendingSplit() {
    if (!hasPendingSplitRestore() || splitRestoring) return;

    const modelIds = new Set(modelsCache.map((model) => model.id));
    const ids = pendingSplitRestore.ids.filter((id) => modelIds.has(id)).slice(0, 3);
    if (ids.length < 2) {
      clearPendingSplitRestore();
      updateSplitControls();
      return;
    }

    splitRestoring = true;
    splitSelecting = true;
    splitSelection.clear();
    ids.forEach((id) => splitSelection.add(id));
    setSplitDirection(pendingSplitRestore.direction, false);
    splitRatios = normalizeRatios(pendingSplitRestore.ratios, ids.length);
    updateSplitControls();
    renderModels(getVisibleModels());

    const ok = await window.api.view.enterSplit(ids, splitDirection);
    if (ok) {
      await window.api.view.setSplitRatios(splitRatios);
      ids.forEach((id) => loadedModelIds.add(id));
      clearPendingSplitRestore();
      splitSelecting = true;
      updateActive(ids[0]);
      renderModels(getVisibleModels());
      renderSplitResizers();
      updateSplitControls();
      return;
    }

    splitSelecting = false;
    splitRestoring = false;
    updateSplitControls();
    renderModels(getVisibleModels());
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
    splitResizers.classList.toggle('vertical', splitDirection === 'vertical');
    splitResizers.classList.toggle('horizontal', splitDirection === 'horizontal');

    for (let i = 0; i < count - 1; i += 1) {
      const handle = document.createElement('div');
      handle.className = 'split-resizer';
      handle.dataset.index = String(i);
      handle.addEventListener('pointerdown', (event) => startResize(event, i));
      splitResizers.appendChild(handle);
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
      if (splitDirection === 'vertical') {
        return;
      }

      left += contentWidth * splitRatios[index];
      handle.style.left = `${Math.round(left + SPLIT_GUTTER_WIDTH * index)}px`;
      handle.style.top = '';
    });

    if (splitDirection === 'vertical') {
      const contentHeight = Math.max(0, mainArea.clientHeight - SPLIT_GUTTER_WIDTH * (count - 1));
      let top = 0;
      splitResizers.querySelectorAll('.split-resizer').forEach((handle, index) => {
        top += contentHeight * splitRatios[index];
        handle.style.top = `${Math.round(top + SPLIT_GUTTER_WIDTH * index)}px`;
        handle.style.left = '';
      });
    }
  }

  function startResize(event, index) {
    event.preventDefault();

    const handle = event.currentTarget;
    const count = splitSelection.size;
    const startRatios = splitRatios.slice();
    const pairTotal = startRatios[index] + startRatios[index + 1];
    const beforeTotal = startRatios.slice(0, index).reduce((sum, ratio) => sum + ratio, 0);
    const rect = mainArea.getBoundingClientRect();
    const contentSize = splitDirection === 'vertical'
      ? Math.max(1, rect.height - SPLIT_GUTTER_WIDTH * (count - 1))
      : Math.max(1, rect.width - SPLIT_GUTTER_WIDTH * (count - 1));

    handle.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);

    async function handleMove(moveEvent) {
      const pointerPosition = splitDirection === 'vertical'
        ? moveEvent.clientY - rect.top
        : moveEvent.clientX - rect.left;
      const contentPosition = pointerPosition - SPLIT_GUTTER_WIDTH * index;
      const boundaryRatio = contentPosition / contentSize;
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
      pendingSplitRestore = {
        ids: splitIds,
        ratios: normalizeRatios(snapshot.splitRatios, splitIds.length),
        direction: snapshot.splitDirection === 'vertical' ? 'vertical' : 'horizontal',
      };
      updateSplitControls();
      renderModels(getVisibleModels());

      const activeId = snapshot.activeModelId && modelIds.has(snapshot.activeModelId)
        ? snapshot.activeModelId
        : splitIds[0];
      switchModel(activeId);
      return true;
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
    updateWindowTitle();
    updateMainPlaceholder();

    document.querySelectorAll('.model-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.id === id);
    });
  }

  function updateWindowTitle() {
    const model = modelsCache.find((item) => item.id === activeModelId);
    const title = model ? model.name : '';
    windowTitle.textContent = title;
    windowTitle.title = title;
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

  function registerViewEvents() {
    if (viewEventsRegistered) return;
    viewEventsRegistered = true;

    window.api.view.onSwitched((data) => {
      const id = data.id || data;
      updateActive(id);
      if (statusModal.classList.contains('show')) {
        refreshStatusPanel();
      }
    });

    window.api.view.onLoadingChanged((data) => {
      if (!data || !data.id) return;

      setModelLoading(data.id, Boolean(data.loading));
      if (data.failed) {
        failedModelIds.add(data.id);
      } else if (data.loading) {
        failedModelIds.delete(data.id);
      } else {
        failedModelIds.delete(data.id);
      }
      if (!data.loading) {
        loadedModelIds.add(data.id);
      }
      updateMainPlaceholder();
      renderModels(getVisibleModels());

      if (statusModal.classList.contains('show')) {
        refreshStatusPanel();
      }
    });

    window.api.view.onSplitChanged((data) => {
      const ids = Array.isArray(data && data.ids) ? data.ids : [];
      if (data && data.enabled && ids.length >= 2) {
        clearPendingSplitRestore();
        splitSelecting = true;
        splitSelection.clear();
        ids.slice(0, 3).forEach((id) => splitSelection.add(id));
        setSplitDirection(data.direction, false);
        splitRatios = ids.map(() => 1 / ids.length);
        ids.forEach((id) => loadedModelIds.add(id));
        updateSplitControls();
        renderModels(getVisibleModels());
        renderSplitResizers();
        return;
      }

      splitSelecting = false;
      splitSelection.clear();
      splitRatios = [];
      clearSplitResizers();
      updateSplitControls();
      renderModels(getVisibleModels());
    });

    window.api.view.onClosed((data) => {
      syncViewState(data.state, data.id);
      if (statusModal.classList.contains('show')) {
        refreshStatusPanel();
      }
    });
  }

  // ── 初始化 ──
  document.addEventListener('DOMContentLoaded', async () => {
    // 加载模型列表
    const settings = await window.api.settings.get();
    applyTheme(settings.theme);
    await setSidebarCollapsed(localStorage.getItem('sidebarCollapsed') === '1', false);
    setSplitDirection('horizontal', false);

    const data = await window.api.models.list();
    const models = data.models || data;
    modelsCache = models;
    const groups = await window.api.groups.list();
    renderGroups(groups);
    renderModels(getVisibleModels());
    updateSplitControls();
    registerViewEvents();

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
      loadingModelIds = new Set(Array.from(loadingModelIds).filter((id) => modelIds.has(id)));
      failedModelIds = new Set(Array.from(failedModelIds).filter((id) => modelIds.has(id)));
      updateWindowTitle();
      if (hasPendingSplitRestore()) {
        pendingSplitRestore.ids = pendingSplitRestore.ids.filter((id) => modelIds.has(id));
        if (pendingSplitRestore.ids.length < 2) {
          clearPendingSplitRestore();
        }
      }
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
    splitRestoreBtn.addEventListener('click', restorePendingSplit);
    splitHorizontalBtn.addEventListener('click', () => setSplitDirection('horizontal'));
    splitVerticalBtn.addEventListener('click', () => setSplitDirection('vertical'));
    exportConversationBtn.addEventListener('click', exportConversation);
    placeholderRefreshBtn.addEventListener('click', refreshPlaceholderModel);
    sidebarToggleBtn.addEventListener('click', toggleSidebarCollapsed);
    themeBtn.addEventListener('click', toggleTheme);
    windowMinimizeBtn.addEventListener('click', () => window.api.windowControls.minimize());
    windowMaximizeBtn.addEventListener('click', () => window.api.windowControls.toggleMaximize());
    windowCloseBtn.addEventListener('click', () => window.api.windowControls.close());
    statusBtn.addEventListener('click', openStatusModal);
    statusCloseBtn.addEventListener('click', closeStatusModal);
    statusRefreshBtn.addEventListener('click', refreshStatusPanel);
    closeInactiveModelsBtn.addEventListener('click', closeInactiveModelsFromStatus);

    addGroupBtn.addEventListener('click', openGroupModal);
    groupCloseBtn.addEventListener('click', closeGroupModal);
    groupCancelBtn.addEventListener('click', closeGroupModal);
    groupForm.addEventListener('submit', handleGroupSubmit);

    groupModal.addEventListener('click', (event) => {
      if (event.target === groupModal) closeGroupModal();
    });

    statusModal.addEventListener('click', (event) => {
      if (event.target === statusModal) closeStatusModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && groupModal.classList.contains('show')) {
        closeGroupModal();
      }

      if (event.key === 'Escape' && statusModal.classList.contains('show')) {
        closeStatusModal();
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
