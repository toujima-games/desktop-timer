const { app, BrowserWindow, globalShortcut, ipcMain } = require("electron");
const path = require("path");

let win;
let dragState = null;

const COMPACT_SIZE = { width: 228, height: 78 };
const MENU_SIZE = { width: 620, height: 78 };
let lockedWindowSize = { ...COMPACT_SIZE };
let enforcingWindowSize = false;
let applyingMenuBounds = false;
let releaseMenuBoundsTimer = null;
let timerAnchorScreenX = null;
let currentDisplayOffsetLeft = 16;
const ALWAYS_ON_TOP_LEVEL = "screen-saver";
const MENU_BOUNDS_GUARD_MS = 120;


function lockWindowSize(width, height) {
  lockedWindowSize = {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height))
  };
}

function getAnchoredWindowX(fallbackX) {
  if (
    Number.isFinite(timerAnchorScreenX) &&
    Number.isFinite(currentDisplayOffsetLeft)
  ) {
    return Math.round(timerAnchorScreenX - currentDisplayOffsetLeft);
  }

  return Math.round(fallbackX);
}

function enforceLockedWindowSize() {
  if (
    enforcingWindowSize ||
    applyingMenuBounds ||
    !win ||
    win.isDestroyed() ||
    win.isFullScreen()
  ) {
    return;
  }

  const bounds = win.getBounds();
  const anchoredX = getAnchoredWindowX(bounds.x);
  if (
    bounds.x === anchoredX &&
    bounds.width === lockedWindowSize.width &&
    bounds.height === lockedWindowSize.height
  ) {
    return;
  }

  enforcingWindowSize = true;
  try {
    win.setBounds({
      x: anchoredX,
      y: bounds.y,
      width: lockedWindowSize.width,
      height: lockedWindowSize.height
    }, false);
  } finally {
    enforcingWindowSize = false;
  }
}


function applyMenuBounds(bounds) {
  if (!win || win.isDestroyed()) return;

  applyingMenuBounds = true;

  if (releaseMenuBoundsTimer) {
    clearTimeout(releaseMenuBoundsTimer);
    releaseMenuBoundsTimer = null;
  }

  win.setBounds(bounds, false);

  // Windows can emit resize/move events after setBounds has returned.
  // Keep the guard active long enough for those delayed events to finish.
  releaseMenuBoundsTimer = setTimeout(() => {
    applyingMenuBounds = false;
    releaseMenuBoundsTimer = null;
    enforceLockedWindowSize();
  }, MENU_BOUNDS_GUARD_MS);
}

function setWindowSizeForMenu(payload) {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;

  const isObjectPayload = payload && typeof payload === "object";
  const isMenuOpen = isObjectPayload ? Boolean(payload.isOpen) : Boolean(payload);
  const previousDisplayOffsetLeft = Number(
    isObjectPayload ? payload.previousDisplayOffsetLeft : NaN
  );
  const targetDisplayOffsetLeft = Number(
    isObjectPayload ? payload.targetDisplayOffsetLeft : NaN
  );
  const requestedWidth = Number(isObjectPayload ? payload.targetWidth : NaN);

  const bounds = win.getBounds();
  const fallbackTarget = isMenuOpen ? MENU_SIZE : COMPACT_SIZE;
  const targetWidth = Number.isFinite(requestedWidth)
    ? Math.max(210, Math.min(1400, Math.round(requestedWidth)))
    : fallbackTarget.width;
  const targetHeight = fallbackTarget.height;

  const previousOffset = Number.isFinite(previousDisplayOffsetLeft)
    ? previousDisplayOffsetLeft
    : 16;
  const targetOffset = Number.isFinite(targetDisplayOffsetLeft)
    ? targetDisplayOffsetLeft
    : previousOffset;

  // Initialize the timer's absolute on-screen X only once. After that, every
  // MENU transition is calculated from this same anchor, never from a possibly
  // delayed/intermediate BrowserWindow X coordinate. This prevents cumulative
  // drift when the MENU is on the left.
  if (!Number.isFinite(timerAnchorScreenX)) {
    timerAnchorScreenX = bounds.x + previousOffset;
  }

  currentDisplayOffsetLeft = targetOffset;
  const nextX = getAnchoredWindowX(bounds.x);

  lockWindowSize(targetWidth, targetHeight);
  applyMenuBounds({
    x: nextX,
    y: bounds.y,
    width: targetWidth,
    height: targetHeight
  });

  keepWindowOnTop();
}

function readScreenPoint(payload) {
  const screenX = Number(payload?.screenX);
  const screenY = Number(payload?.screenY);

  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
    return null;
  }

  return { screenX, screenY };
}

function startWindowDrag(payload) {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;

  const point = readScreenPoint(payload);
  if (!point) return;

  enforceLockedWindowSize();
  const bounds = win.getBounds();

  // Dragging is the only operation allowed to move the timer anchor. MENU
  // opening/closing must never rewrite it.
  timerAnchorScreenX = bounds.x + currentDisplayOffsetLeft;

  dragState = {
    pointerX: point.screenX,
    pointerY: point.screenY,
    windowX: bounds.x,
    windowY: bounds.y,
    windowWidth: lockedWindowSize.width,
    windowHeight: lockedWindowSize.height
  };
}

function moveWindowDrag(payload) {
  if (!dragState || !win || win.isDestroyed() || win.isFullScreen()) return;

  const point = readScreenPoint(payload);
  if (!point) return;

  const nextX = Math.round(dragState.windowX + point.screenX - dragState.pointerX);
  const nextY = Math.round(dragState.windowY + point.screenY - dragState.pointerY);
  timerAnchorScreenX = nextX + currentDisplayOffsetLeft;
  win.setBounds({
    x: nextX,
    y: nextY,
    width: dragState.windowWidth,
    height: dragState.windowHeight
  }, false);
}

function endWindowDrag() {
  if (dragState && win && !win.isDestroyed()) {
    const bounds = win.getBounds();
    timerAnchorScreenX = bounds.x + currentDisplayOffsetLeft;
  }
  dragState = null;
}

function keepWindowOnTop() {
  if (!win || win.isDestroyed()) return;

  win.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function createWindow() {
  timerAnchorScreenX = null;
  currentDisplayOffsetLeft = 16;

  win = new BrowserWindow({
    width: COMPACT_SIZE.width,
    height: COMPACT_SIZE.height,
    minWidth: 210,
    minHeight: 70,
    useContentSize: true,
    resizable: false,
    thickFrame: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setResizable(false);
  win.on("will-resize", (event) => {
    event.preventDefault();
  });
  win.on("resize", enforceLockedWindowSize);

  keepWindowOnTop();
  win.setBackgroundColor("#00000000");
  win.loadFile(path.join(__dirname, "index.html"));

  win.on("blur", () => {
    endWindowDrag();
    setImmediate(keepWindowOnTop);
  });
  win.on("show", keepWindowOnTop);
  win.on("focus", keepWindowOnTop);
  win.on("restore", keepWindowOnTop);
  win.once("ready-to-show", keepWindowOnTop);
  win.on("always-on-top-changed", (_event, isAlwaysOnTop) => {
    if (!isAlwaysOnTop) setImmediate(keepWindowOnTop);
  });

  win.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape" && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  ipcMain.on("timer-menu-state", (_event, payload) => {
    setWindowSizeForMenu(payload);
  });

  ipcMain.on("timer-window-drag-start", (_event, point) => {
    startWindowDrag(point);
  });

  ipcMain.on("timer-window-drag-move", (_event, point) => {
    moveWindowDrag(point);
  });

  ipcMain.on("timer-window-drag-end", endWindowDrag);

  ipcMain.on("timer-app-close", () => {
    endWindowDrag();
    app.quit();
  });

  createWindow();

  globalShortcut.register("F11", () => {
    if (win && !win.isDestroyed()) {
      win.setFullScreen(!win.isFullScreen());
      keepWindowOnTop();
    }
  });

  globalShortcut.register("Alt+Enter", () => {
    if (win && !win.isDestroyed()) {
      win.setFullScreen(!win.isFullScreen());
      keepWindowOnTop();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
