const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("timerWindow", {
  setMenuOpen(
    isOpen,
    menuSide = "right",
    previousDisplayOffsetLeft = null,
    targetDisplayOffsetLeft = null,
    targetWidth = null
  ) {
    ipcRenderer.send("timer-menu-state", {
      isOpen: Boolean(isOpen),
      menuSide: menuSide === "left" ? "left" : "right",
      previousDisplayOffsetLeft,
      targetDisplayOffsetLeft,
      targetWidth
    });
  },

  startDrag(screenX, screenY) {
    ipcRenderer.send("timer-window-drag-start", { screenX, screenY });
  },

  moveDrag(screenX, screenY) {
    ipcRenderer.send("timer-window-drag-move", { screenX, screenY });
  },

  endDrag() {
    ipcRenderer.send("timer-window-drag-end");
  },

  closeApp() {
    ipcRenderer.send("timer-app-close");
  }
});
