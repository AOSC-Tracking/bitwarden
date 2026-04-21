import { dialog, IpcMainEvent, ipcMain, Notification } from "electron";
import log from "electron-log";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { UrlType } from "@bitwarden/common/platform/misc/safe-urls";
import { LogService } from "@bitwarden/logging";

import { SafeShell } from "../platform/main/safe-shell.main";
import { isAppImage, isDev, isMacAppStore, isWindowsPortable, isWindowsStore } from "../utils";

import { WindowMain } from "./window.main";

const UpdaterCheckInitialDelay = 5 * 1000; // 5 seconds
const UpdaterCheckInterval = 12 * 60 * 60 * 1000; // 12 hours

const MaxTimeBeforeBlockingUpdateNotification = 7 * 24 * 60 * 60 * 1000; // 7 days

export class UpdaterMain {
  private doingUpdateCheck = false;
  private doingUpdateCheckWithFeedback = false;
  private canUpdate = false;
  private updateDownloaded: any = null;
  private originalRolloutFunction: any = null;

  // This needs to be tracked to avoid the Notification being garbage collected,
  // which would break the click handler.
  private openedNotification: Notification | null = null;

  // This is used to set when the initial update notification was shown.
  // The system notifications can be easy to miss or be disabled, so we want to
  // ensure the user is eventually made aware of the update. If the user does not
  // interact with the notification in a reasonable time, we will prompt them again.
  private initialUpdateNotificationTime: number | null = null;

  constructor(
    private i18nService: I18nService,
    private logService: LogService,
    private windowMain: WindowMain,
    private shell: SafeShell,
  ) {
    this.canUpdate =
      false;
  }

  async init() {
  }

  async checkForUpdate(withFeedback = false) {
  }

  private reset() {
  }

  private async promptRestartUpdate(info: any, blocking: boolean) {
  }

  private async promptRestartUpdateUsingSystemNotification(info: any) {
  }

  private async promptRestartUpdateUsingDialog(info: any) {
  }

  /**
   * Asks the renderer to check for unsaved changes and prompt the user if needed.
   * Returns true if safe to restart, false if the user chose to stay.
   */
  private confirmUpdateRestart(): Promise<boolean> {
    if (this.windowMain.win == null) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener("confirmUpdateRestart", handler);
        resolve(true);
      }, 30_000);

      const handler = (_: IpcMainEvent, canRestart: boolean) => {
        clearTimeout(timer);
        resolve(canRestart);
      };

      ipcMain.once("confirmUpdateRestart", handler);
      this.windowMain.win.webContents.send("confirmUpdateRestart");
    });
  }

  private userDisabledUpdates(): boolean {
    for (const arg of process.argv) {
      if (arg != null && arg.toUpperCase().indexOf("--ELECTRON_NO_UPDATER=1") > -1) {
        return true;
      }
    }
    return process.env.ELECTRON_NO_UPDATER === "1";
  }
}
