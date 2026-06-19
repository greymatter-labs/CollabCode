// Live interview panel sizing, workspace collapse, and right-dock tabs.
(function() {
  const STORAGE_KEY = 'opencall.interviewPanelLayout.v2';
  const HANDLE_WIDTH = 6;

  const PANEL_CONFIG = {
    workspace: {
      elementId: 'workspace-panel',
      handleId: 'workspace-resize-handle',
      cssVar: '--workspace-panel-width',
      defaultWidth: 260,
      minWidth: 150,
      maxWidth: 420,
      side: 'left'
    },
    rightDock: {
      elementId: 'right-dock',
      handleId: 'right-dock-resize-handle',
      cssVar: '--right-dock-width',
      defaultWidth: 420,
      minWidth: 280,
      maxWidth: 680,
      side: 'right'
    }
  };

  const RIGHT_TABS = {
    problem: {
      panelId: 'problem-panel',
      tabId: 'right-dock-tab-problem',
      closeId: 'close-problem'
    },
    output: {
      panelId: 'output-panel',
      tabId: 'right-dock-tab-output',
      closeId: 'close-output'
    },
    notes: {
      panelId: 'notes-panel',
      tabId: 'right-dock-tab-notes',
      closeId: 'close-notes'
    }
  };
  const RIGHT_TAB_ORDER = ['problem', 'output', 'notes'];

  let splitContainer = null;
  let resizeRaf = null;
  let saveTimer = null;
  let activeResize = null;
  let previousRightAvailability = {};

  const state = {
    workspaceCollapsed: false,
    activeRightTab: 'problem',
    widths: Object.fromEntries(
      Object.entries(PANEL_CONFIG).map(([key, config]) => [key, config.defaultWidth])
    )
  };
  const effectiveWidths = {};

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getElement(id) {
    return document.getElementById(id);
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      state.workspaceCollapsed = stored.workspaceCollapsed === true;
      if (RIGHT_TABS[stored.activeRightTab]) {
        state.activeRightTab = stored.activeRightTab;
      }
      Object.keys(PANEL_CONFIG).forEach(key => {
        const width = Number(stored.widths?.[key]);
        if (Number.isFinite(width)) {
          state.widths[key] = width;
        }
      });
    } catch (error) {
      console.warn('Could not load panel layout preferences:', error);
    }
  }

  function saveStateSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          workspaceCollapsed: state.workspaceCollapsed,
          activeRightTab: state.activeRightTab,
          widths: state.widths
        }));
      } catch (error) {
        console.warn('Could not save panel layout preferences:', error);
      }
    }, 100);
  }

  function isDisplayed(element) {
    if (!element) return false;
    return getComputedStyle(element).display !== 'none';
  }

  function isRightTabAvailable(key) {
    const panel = getElement(RIGHT_TABS[key]?.panelId);
    return !!panel && panel.style.display !== 'none';
  }

  function availableRightTabs() {
    return RIGHT_TAB_ORDER.filter(isRightTabAvailable);
  }

  function hasRightDockContent() {
    return availableRightTabs().length > 0;
  }

  function isPanelVisible(key) {
    if (key === 'workspace') {
      return !state.workspaceCollapsed && isDisplayed(getElement(PANEL_CONFIG.workspace.elementId));
    }
    if (key === 'rightDock') {
      return hasRightDockContent();
    }
    return false;
  }

  function visiblePanelKeys() {
    return Object.keys(PANEL_CONFIG).filter(isPanelVisible);
  }

  function getEditorMinWidth(containerWidth) {
    if (containerWidth < 720) return 180;
    if (containerWidth < 1100) return 240;
    return 340;
  }

  function maxWidthFor(key, containerWidth) {
    const config = PANEL_CONFIG[key];
    const viewportLimit = key === 'workspace' ? containerWidth * 0.42 : containerWidth * 0.55;
    return Math.max(config.minWidth, Math.min(config.maxWidth, viewportLimit || config.maxWidth));
  }

  function getDesiredWidth(key, containerWidth) {
    const config = PANEL_CONFIG[key];
    const width = Number(state.widths[key]) || config.defaultWidth;
    return clamp(width, config.minWidth, maxWidthFor(key, containerWidth));
  }

  function fitPanelWidths(keys, containerWidth) {
    const widths = {};
    keys.forEach(key => {
      widths[key] = getDesiredWidth(key, containerWidth);
    });

    if (containerWidth < 100) {
      return widths;
    }

    const railWidth = state.workspaceCollapsed ? 40 : 0;
    const handleWidth = keys.length * HANDLE_WIDTH;
    const availableForPanels = Math.max(0, containerWidth - getEditorMinWidth(containerWidth) - railWidth - handleWidth);
    let totalWidth = keys.reduce((sum, key) => sum + widths[key], 0);
    let excess = totalWidth - availableForPanels;

    while (excess > 0.5) {
      const shrinkable = keys.filter(key => widths[key] > PANEL_CONFIG[key].minWidth);
      if (!shrinkable.length) break;

      const share = excess / shrinkable.length;
      let removed = 0;
      shrinkable.forEach(key => {
        const next = Math.max(PANEL_CONFIG[key].minWidth, widths[key] - share);
        removed += widths[key] - next;
        widths[key] = next;
      });

      if (removed < 0.5) break;
      totalWidth -= removed;
      excess = totalWidth - availableForPanels;
    }

    return widths;
  }

  function requestEditorResize() {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const firepad = getElement('firepad-container');
      if (window.ace && firepad?.classList.contains('ace_editor')) {
        try {
          window.ace.edit('firepad-container').resize(true);
        } catch (error) {
          console.warn('Could not resize ACE editor:', error);
        }
      }
      window.dispatchEvent(new CustomEvent('collab:layout-resize'));
    });
  }

  function updateWorkspaceCollapseControls() {
    const collapseButton = getElement('workspace-collapse-btn');
    const railButton = getElement('workspace-rail');

    if (collapseButton) {
      collapseButton.setAttribute('aria-expanded', String(!state.workspaceCollapsed));
      collapseButton.title = state.workspaceCollapsed ? 'Show files' : 'Collapse files';
      collapseButton.setAttribute('aria-label', collapseButton.title);
    }
    if (railButton) {
      railButton.setAttribute('aria-expanded', String(!state.workspaceCollapsed));
    }
  }

  function updateHandle(handle, key, visible, width) {
    if (!handle) return;

    handle.classList.toggle('is-visible', visible);
    handle.setAttribute('aria-hidden', String(!visible));
    if (!visible) {
      handle.removeAttribute('aria-valuenow');
      return;
    }

    const config = PANEL_CONFIG[key];
    handle.setAttribute('aria-valuemin', String(config.minWidth));
    handle.setAttribute('aria-valuemax', String(Math.round(maxWidthFor(key, splitContainer?.getBoundingClientRect().width || 0))));
    handle.setAttribute('aria-valuenow', String(Math.round(width || state.widths[key] || config.defaultWidth)));
  }

  function syncRightDock() {
    const dock = getElement('right-dock');
    const available = availableRightTabs();
    const availability = Object.fromEntries(RIGHT_TAB_ORDER.map(key => [key, available.includes(key)]));
    const newlyAvailable = RIGHT_TAB_ORDER.filter(key => availability[key] && !previousRightAvailability[key]);

    if (newlyAvailable.length) {
      state.activeRightTab = newlyAvailable[newlyAvailable.length - 1];
    }
    if (!availability[state.activeRightTab]) {
      state.activeRightTab = available[0] || 'problem';
    }
    previousRightAvailability = availability;

    if (dock) {
      dock.style.display = available.length ? 'flex' : 'none';
      dock.dataset.activeTab = available.length ? state.activeRightTab : '';
    }

    RIGHT_TAB_ORDER.forEach(key => {
      const isAvailable = availability[key];
      const isActive = isAvailable && state.activeRightTab === key;
      const tab = getElement(RIGHT_TABS[key].tabId);
      const panel = getElement(RIGHT_TABS[key].panelId);

      if (tab) {
        tab.classList.toggle('is-available', isAvailable);
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
      }

      if (panel) {
        panel.classList.toggle('is-active-tab', isActive);
        panel.setAttribute('aria-hidden', String(!isActive));
      }
    });
  }

  function applyLayout() {
    if (!splitContainer) return;

    splitContainer.classList.toggle('workspace-collapsed', state.workspaceCollapsed);
    syncRightDock();

    const containerWidth = splitContainer.getBoundingClientRect().width;
    const keys = visiblePanelKeys();
    const widths = fitPanelWidths(keys, containerWidth);

    Object.keys(PANEL_CONFIG).forEach(key => {
      const visible = keys.includes(key);
      const width = widths[key] || getDesiredWidth(key, containerWidth);
      effectiveWidths[key] = width;
      splitContainer.style.setProperty(PANEL_CONFIG[key].cssVar, `${Math.round(width)}px`);
      updateHandle(getElement(PANEL_CONFIG[key].handleId), key, visible, width);
    });

    updateWorkspaceCollapseControls();
    requestEditorResize();
  }

  function setDesiredWidth(key, width, shouldSave) {
    const containerWidth = splitContainer?.getBoundingClientRect().width || window.innerWidth;
    const config = PANEL_CONFIG[key];
    state.widths[key] = clamp(Math.round(width), config.minWidth, maxWidthFor(key, containerWidth));
    applyLayout();
    if (shouldSave) saveStateSoon();
  }

  function resetPanelWidth(key) {
    state.widths[key] = PANEL_CONFIG[key].defaultWidth;
    if (key === 'workspace') {
      state.workspaceCollapsed = false;
    }
    applyLayout();
    saveStateSoon();
  }

  function toggleWorkspace(nextCollapsed) {
    state.workspaceCollapsed = typeof nextCollapsed === 'boolean' ? nextCollapsed : !state.workspaceCollapsed;
    applyLayout();
    saveStateSoon();
  }

  function selectRightTab(key) {
    if (!RIGHT_TABS[key] || !isRightTabAvailable(key)) return false;
    state.activeRightTab = key;
    applyLayout();
    saveStateSoon();
    return true;
  }

  function closeRightTab(key = state.activeRightTab) {
    if (!RIGHT_TABS[key]) return;

    const panel = getElement(RIGHT_TABS[key].panelId);
    const closeButton = getElement(RIGHT_TABS[key].closeId);
    const wasAvailable = isRightTabAvailable(key);

    if (closeButton) {
      closeButton.click();
    }

    requestAnimationFrame(() => {
      if (wasAvailable && isRightTabAvailable(key) && panel) {
        panel.style.display = 'none';
      }
      applyLayout();
      saveStateSoon();
    });
  }

  function beginResize(event, key) {
    if (event.button !== undefined && event.button !== 0) return;
    if (!isPanelVisible(key)) return;

    event.preventDefault();
    activeResize = {
      key,
      startX: event.clientX,
      startWidth: effectiveWidths[key] || getElement(PANEL_CONFIG[key].elementId)?.getBoundingClientRect().width || PANEL_CONFIG[key].defaultWidth
    };

    document.body.classList.add('is-resizing-panel');
    event.currentTarget.classList.add('is-active');

    const onPointerMove = moveEvent => {
      if (!activeResize) return;
      const config = PANEL_CONFIG[activeResize.key];
      const delta = moveEvent.clientX - activeResize.startX;
      const signedDelta = config.side === 'left' ? delta : -delta;
      setDesiredWidth(activeResize.key, activeResize.startWidth + signedDelta, true);
    };

    const finishResize = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', finishResize);
      document.removeEventListener('pointercancel', finishResize);
      document.body.classList.remove('is-resizing-panel');
      document.querySelectorAll('.panel-resize-handle.is-active').forEach(handle => handle.classList.remove('is-active'));
      activeResize = null;
      requestEditorResize();
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', finishResize);
    document.addEventListener('pointercancel', finishResize);
  }

  function handleSeparatorKeydown(event, key) {
    const config = PANEL_CONFIG[key];
    const step = event.shiftKey ? 48 : 16;
    let nextWidth = state.widths[key];

    if (event.key === 'Home') {
      nextWidth = config.minWidth;
    } else if (event.key === 'End') {
      nextWidth = maxWidthFor(key, splitContainer?.getBoundingClientRect().width || window.innerWidth);
    } else if (event.key === 'ArrowLeft') {
      nextWidth += config.side === 'left' ? -step : step;
    } else if (event.key === 'ArrowRight') {
      nextWidth += config.side === 'left' ? step : -step;
    } else {
      return;
    }

    event.preventDefault();
    setDesiredWidth(key, nextWidth, true);
  }

  function attachHandles() {
    Object.keys(PANEL_CONFIG).forEach(key => {
      const handle = getElement(PANEL_CONFIG[key].handleId);
      if (!handle || handle.dataset.layoutReady === 'true') return;

      handle.dataset.layoutReady = 'true';
      handle.addEventListener('pointerdown', event => beginResize(event, key));
      handle.addEventListener('keydown', event => handleSeparatorKeydown(event, key));
      handle.addEventListener('dblclick', () => resetPanelWidth(key));
    });
  }

  function attachWorkspaceControls() {
    const collapseButton = getElement('workspace-collapse-btn');
    const railButton = getElement('workspace-rail');

    if (collapseButton && collapseButton.dataset.layoutReady !== 'true') {
      collapseButton.dataset.layoutReady = 'true';
      collapseButton.addEventListener('click', () => toggleWorkspace(true));
    }

    if (railButton && railButton.dataset.layoutReady !== 'true') {
      railButton.dataset.layoutReady = 'true';
      railButton.addEventListener('click', () => toggleWorkspace(false));
    }
  }

  function attachRightDockControls() {
    RIGHT_TAB_ORDER.forEach(key => {
      const tab = getElement(RIGHT_TABS[key].tabId);
      if (!tab || tab.dataset.layoutReady === 'true') return;

      tab.dataset.layoutReady = 'true';
      tab.addEventListener('click', () => selectRightTab(key));
    });

    const closeButton = getElement('right-dock-close');
    if (closeButton && closeButton.dataset.layoutReady !== 'true') {
      closeButton.dataset.layoutReady = 'true';
      closeButton.addEventListener('click', () => closeRightTab());
    }
  }

  function observePanelVisibility() {
    const observer = new MutationObserver(applyLayout);

    Object.values(RIGHT_TABS).forEach(config => {
      const panel = getElement(config.panelId);
      if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['style'] });
    });

    const mainContainer = getElement('main-container');
    if (mainContainer) {
      observer.observe(mainContainer, { attributes: true, attributeFilter: ['style', 'class'] });
    }
  }

  function init() {
    splitContainer = getElement('split-container');
    if (!splitContainer || splitContainer.dataset.layoutReady === 'true') return;

    splitContainer.dataset.layoutReady = 'true';
    loadState();
    attachWorkspaceControls();
    attachRightDockControls();
    attachHandles();
    observePanelVisibility();
    window.addEventListener('resize', applyLayout);
    window.addEventListener('orientationchange', applyLayout);
    applyLayout();
  }

  window.CollabPanelLayout = {
    refresh: applyLayout,
    collapseWorkspace: () => toggleWorkspace(true),
    expandWorkspace: () => toggleWorkspace(false),
    resetPanelWidth,
    selectRightTab,
    closeRightTab,
    isRightTabAvailable,
    isRightTabActive: key => state.activeRightTab === key && isRightTabAvailable(key)
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
