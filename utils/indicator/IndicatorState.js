import GLib from "gi://GLib";

export class IndicatorState {
  constructor() {
    this._currentPlayer = null;
    this._manuallySelected = false;
    this._scrollTimeout = null;
    this._scrollPosition = 0;
    this._fullText = "";
    this._settingsChangedId = 0;
    this._sessionModeId = 0;
    this._updateThrottle = null;
    this._capturedEventId = null;
    this._windowFocusId = null;
    this._overviewShowingId = null;
    this._overviewHidingId = null;
    this._lastUpdateTime = 0;
    this._pendingOperations = new Set();
    this._sessionChanging = false;
    this._managerInitialized = false;
    this._initTimeout = null;
    this._safetyLock = false;
    this._errorCount = 0;
    this._maxErrors = 10;
    this._lastErrorTime = 0;
    this._preventLogout = false;
  }

  safeExecute(fn) {
    if (this._sessionChanging || this._safetyLock || this._preventLogout)
      return;

    const now = Date.now();
    if (now - this._lastErrorTime < 1000 && this._errorCount >= this._maxErrors) {
      return;
    }

    try {
      fn();
      this._errorCount = 0;
    } catch (e) {
      this._errorCount++;
      this._lastErrorTime = now;

      if (this._errorCount < this._maxErrors) {
        console.error("Safe execute error:", e);
      }

      // Remove timeout before creating new one
      if (this._errorRecoveryTimeout) {
        GLib.source_remove(this._errorRecoveryTimeout);
        this._errorRecoveryTimeout = null;
      }

      this._errorRecoveryTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, 5000, () => {
        this._errorCount = Math.max(0, this._errorCount - 1);
        this._errorRecoveryTimeout = null;
        return GLib.SOURCE_REMOVE;
      });
    }
  }

  scheduleOperation(fn, delay = 0) {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, delay, () => {
      this._pendingOperations.delete(id);
      if (!this._sessionChanging && !this._preventLogout) {
        this.safeExecute(fn);
      }
      return GLib.SOURCE_REMOVE;
    });

    this._pendingOperations.add(id);
    return id;
  }

  destroy() {
    // Remove error recovery timeout
    if (this._errorRecoveryTimeout) {
      GLib.source_remove(this._errorRecoveryTimeout);
      this._errorRecoveryTimeout = null;
    }

    // Remove all pending operations
    for (const id of this._pendingOperations) {
      GLib.source_remove(id);
    }
    this._pendingOperations.clear();

    // Remove scroll timeout
    if (this._scrollTimeout) {
      GLib.source_remove(this._scrollTimeout);
      this._scrollTimeout = null;
    }

    // Remove update throttle
    if (this._updateThrottle) {
      GLib.source_remove(this._updateThrottle);
      this._updateThrottle = null;
    }

    // Remove init timeout
    if (this._initTimeout) {
      GLib.source_remove(this._initTimeout);
      this._initTimeout = null;
    }
  }
}