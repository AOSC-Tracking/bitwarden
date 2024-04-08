import { firstValueFrom } from "rxjs";

import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { SHOW_AUTOFILL_BUTTON } from "@bitwarden/common/autofill/constants";
import { AutofillSettingsServiceAbstraction } from "@bitwarden/common/autofill/services/autofill-settings.service";
import { DomainSettingsService } from "@bitwarden/common/autofill/services/domain-settings.service";
import { InlineMenuVisibilitySetting } from "@bitwarden/common/autofill/types";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { StateService } from "@bitwarden/common/platform/abstractions/state.service";
import { Utils } from "@bitwarden/common/platform/misc/utils";
import { ThemeStateService } from "@bitwarden/common/platform/theming/theme-state.service";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherType } from "@bitwarden/common/vault/enums";
import { buildCipherIcon } from "@bitwarden/common/vault/icon/build-cipher-icon";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import { openUnlockPopout } from "../../auth/popup/utils/auth-popout-window";
import { BrowserApi } from "../../platform/browser/browser-api";
import {
  openAddEditVaultItemPopout,
  openViewVaultItemPopout,
} from "../../vault/popup/utils/vault-popout-window";
import { AutofillService } from "../services/abstractions/autofill.service";
import { generateRandomChars } from "../utils";
import { AutofillOverlayElement, AutofillOverlayPort } from "../utils/autofill-overlay.enum";

import { LockedVaultPendingNotificationsData } from "./abstractions/notification.background";
import {
  FocusedFieldData,
  OverlayAddNewItemMessage,
  OverlayBackground as OverlayBackgroundInterface,
  OverlayBackgroundExtensionMessage,
  OverlayBackgroundExtensionMessageHandlers,
  OverlayButtonPortMessageHandlers,
  OverlayCipherData,
  OverlayListPortMessageHandlers,
  OverlayPortMessage,
  PageDetailsForTab,
  SubFrameOffsetData,
  SubFrameOffsetsForTab,
} from "./abstractions/overlay.background";

class OverlayBackground implements OverlayBackgroundInterface {
  private readonly openUnlockPopout = openUnlockPopout;
  private readonly openViewVaultItemPopout = openViewVaultItemPopout;
  private readonly openAddEditVaultItemPopout = openAddEditVaultItemPopout;
  private overlayLoginCiphers: Map<string, CipherView> = new Map();
  private pageDetailsForTab: PageDetailsForTab = {};
  private subFrameOffsetsForTab: SubFrameOffsetsForTab = {};
  private updateOverlayPositionAfterSubFrameRebuildTimeout: number | NodeJS.Timeout;
  private userAuthStatus: AuthenticationStatus = AuthenticationStatus.LoggedOut;
  private overlayButtonPort: chrome.runtime.Port;
  private overlayListPort: chrome.runtime.Port;
  private portKeyForTab: Record<number, string> = {};
  private focusedFieldData: FocusedFieldData;
  private isFieldCurrentlyFocused: boolean = false;
  private isFieldCurrentlyFilling: boolean = false;
  private overlayPageTranslations: Record<string, string>;
  private iconsServerUrl: string;
  private readonly extensionMessageHandlers: OverlayBackgroundExtensionMessageHandlers = {
    openAutofillOverlay: () => this.openOverlay(false),
    closeAutofillOverlay: ({ message, sender }) => this.closeOverlay(sender, message),
    autofillOverlayElementClosed: ({ message }) => this.overlayElementClosed(message),
    autofillOverlayAddNewVaultItem: ({ message, sender }) => this.addNewVaultItem(message, sender),
    getAutofillOverlayVisibility: () => this.getOverlayVisibility(),
    checkAutofillOverlayFocused: () => this.checkOverlayFocused(),
    focusAutofillOverlayList: () => this.focusOverlayList(),
    updateAutofillOverlayPosition: ({ message, sender }) =>
      this.updateOverlayPosition(message, sender),
    updateAutofillOverlayHidden: ({ message, sender }) => this.updateOverlayHidden(message, sender),
    updateFocusedFieldData: ({ message, sender }) => this.setFocusedFieldData(message, sender),
    collectPageDetailsResponse: ({ message, sender }) => this.storePageDetails(message, sender),
    unlockCompleted: ({ message }) => this.unlockCompleted(message),
    addEditCipherSubmitted: () => this.updateOverlayCiphers(),
    deletedCipher: () => this.updateOverlayCiphers(),
    updateIsFieldCurrentlyFocused: ({ message }) => this.updateIsFieldCurrentlyFocused(message),
    checkIsFieldCurrentlyFocused: () => this.checkIsFieldCurrentlyFocused(),
    updateIsFieldCurrentlyFilling: ({ message }) => this.updateIsFieldCurrentlyFilling(message),
    checkIsFieldCurrentlyFilling: () => this.checkIsFieldCurrentlyFilling(),
    checkIsInlineMenuButtonVisible: ({ sender }) => this.checkIsInlineMenuButtonVisible(sender),
    checkIsInlineMenuListVisible: ({ sender }) => this.checkIsInlineMenuListVisible(sender),
    checkIsInlineMenuCiphersPopulated: ({ sender }) =>
      this.checkIsInlineMenuCiphersPopulated(sender),
    updateSubFrameData: ({ message, sender }) => this.updateSubFrameData(message, sender),
    rebuildSubFrameOffsets: ({ sender }) => this.rebuildSubFrameOffsets(sender),
  };
  private readonly overlayButtonPortMessageHandlers: OverlayButtonPortMessageHandlers = {
    overlayButtonClicked: ({ port }) => this.handleOverlayButtonClicked(port),
    closeAutofillOverlay: ({ port }) => this.closeOverlay(port.sender),
    forceCloseAutofillOverlay: ({ port }) =>
      this.closeOverlay(port.sender, { forceCloseOverlay: true }),
    overlayPageBlurred: () => this.checkOverlayListFocused(),
    redirectOverlayFocusOut: ({ message, port }) => this.redirectOverlayFocusOut(message, port),
    getPageColorScheme: () => this.updateButtonPageColorScheme(),
  };
  private readonly overlayListPortMessageHandlers: OverlayListPortMessageHandlers = {
    checkAutofillOverlayButtonFocused: () => this.checkOverlayButtonFocused(),
    forceCloseAutofillOverlay: ({ port }) =>
      this.closeOverlay(port.sender, { forceCloseOverlay: true }),
    overlayPageBlurred: () => this.checkOverlayButtonFocused(),
    unlockVault: ({ port }) => this.unlockVault(port),
    fillSelectedListItem: ({ message, port }) => this.fillSelectedOverlayListItem(message, port),
    addNewVaultItem: ({ port }) => this.getNewVaultItemDetails(port),
    viewSelectedCipher: ({ message, port }) => this.viewSelectedCipher(message, port),
    redirectOverlayFocusOut: ({ message, port }) => this.redirectOverlayFocusOut(message, port),
    updateAutofillOverlayListHeight: ({ message }) => this.updateOverlayListHeight(message),
  };

  constructor(
    private logService: LogService,
    private cipherService: CipherService,
    private autofillService: AutofillService,
    private authService: AuthService,
    private environmentService: EnvironmentService,
    private domainSettingsService: DomainSettingsService,
    private stateService: StateService,
    private autofillSettingsService: AutofillSettingsServiceAbstraction,
    private i18nService: I18nService,
    private platformUtilsService: PlatformUtilsService,
    private themeStateService: ThemeStateService,
  ) {}

  /**
   * Removes cached page details for a tab
   * based on the passed tabId.
   *
   * @param tabId - Used to reference the page details of a specific tab
   */
  removePageDetails(tabId: number) {
    if (this.pageDetailsForTab[tabId]) {
      this.pageDetailsForTab[tabId].clear();
      delete this.pageDetailsForTab[tabId];
    }

    if (this.subFrameOffsetsForTab[tabId]) {
      this.subFrameOffsetsForTab[tabId].clear();
      delete this.subFrameOffsetsForTab[tabId];
    }

    if (this.portKeyForTab[tabId]) {
      delete this.portKeyForTab[tabId];
    }
  }

  /**
   * Sets up the extension message listeners and gets the settings for the
   * overlay's visibility and the user's authentication status.
   */
  async init() {
    this.setupExtensionMessageListeners();
    const env = await firstValueFrom(this.environmentService.environment$);
    this.iconsServerUrl = env.getIconsUrl();
    await this.getOverlayVisibility();
    await this.getAuthStatus();
  }

  /**
   * Updates the overlay list's ciphers and sends the updated list to the overlay list iframe.
   * Queries all ciphers for the given url, and sorts them by last used. Will not update the
   * list of ciphers if the extension is not unlocked.
   */
  async updateOverlayCiphers() {
    if (this.userAuthStatus !== AuthenticationStatus.Unlocked) {
      return;
    }

    const currentTab = await BrowserApi.getTabFromCurrentWindowId();
    if (!currentTab?.url) {
      return;
    }

    this.overlayLoginCiphers = new Map();
    const ciphersViews = (await this.cipherService.getAllDecryptedForUrl(currentTab.url)).sort(
      (a, b) => this.cipherService.sortCiphersByLastUsedThenName(a, b),
    );
    for (let cipherIndex = 0; cipherIndex < ciphersViews.length; cipherIndex++) {
      this.overlayLoginCiphers.set(`overlay-cipher-${cipherIndex}`, ciphersViews[cipherIndex]);
    }

    const ciphers = await this.getOverlayCipherData();
    this.overlayListPort?.postMessage({ command: "updateOverlayListCiphers", ciphers });
  }

  /**
   * Strips out unnecessary data from the ciphers and returns an array of
   * objects that contain the cipher data needed for the overlay list.
   */
  private async getOverlayCipherData(): Promise<OverlayCipherData[]> {
    const showFavicons = await firstValueFrom(this.domainSettingsService.showFavicons$);
    const overlayCiphersArray = Array.from(this.overlayLoginCiphers);
    const overlayCipherData = [];

    for (let cipherIndex = 0; cipherIndex < overlayCiphersArray.length; cipherIndex++) {
      const [overlayCipherId, cipher] = overlayCiphersArray[cipherIndex];

      overlayCipherData.push({
        id: overlayCipherId,
        name: cipher.name,
        type: cipher.type,
        reprompt: cipher.reprompt,
        favorite: cipher.favorite,
        icon: buildCipherIcon(this.iconsServerUrl, cipher, showFavicons),
        login: cipher.type === CipherType.Login ? { username: cipher.login.username } : null,
        card: cipher.type === CipherType.Card ? cipher.card.subTitle : null,
      });
    }

    return overlayCipherData;
  }

  /**
   * Handles aggregation of page details for a tab. Stores the page details
   * in association with the tabId of the tab that sent the message.
   *
   * @param message - Message received from the `collectPageDetailsResponse` command
   * @param sender - The sender of the message
   */
  private storePageDetails(
    message: OverlayBackgroundExtensionMessage,
    sender: chrome.runtime.MessageSender,
  ) {
    const pageDetails = {
      frameId: sender.frameId,
      tab: sender.tab,
      details: message.details,
    };

    if (pageDetails.frameId !== 0 && pageDetails.details.fields.length) {
      void this.buildSubFrameOffsets(pageDetails.tab, pageDetails.frameId, pageDetails.details.url);
    }

    const pageDetailsMap = this.pageDetailsForTab[sender.tab.id];
    if (!pageDetailsMap) {
      this.pageDetailsForTab[sender.tab.id] = new Map([[sender.frameId, pageDetails]]);
      return;
    }

    pageDetailsMap.set(sender.frameId, pageDetails);
  }

  private updateSubFrameData(
    message: OverlayBackgroundExtensionMessage,
    sender: chrome.runtime.MessageSender,
  ) {
    const subFrameOffsetsForTab = this.subFrameOffsetsForTab[sender.tab.id];
    if (subFrameOffsetsForTab) {
      subFrameOffsetsForTab.set(message.subFrameData.frameId, message.subFrameData);
    }
  }

  private async buildSubFrameOffsets(tab: chrome.tabs.Tab, frameId: number, url: string) {
    const tabId = tab.id;
    let subFrameOffsetsForTab = this.subFrameOffsetsForTab[tabId];
    if (!subFrameOffsetsForTab) {
      this.subFrameOffsetsForTab[tabId] = new Map();
      subFrameOffsetsForTab = this.subFrameOffsetsForTab[tabId];
    }

    if (subFrameOffsetsForTab.get(frameId)) {
      return;
    }

    const subFrameData = { url, top: 0, left: 0 };
    let frameDetails = await BrowserApi.getFrameDetails({ tabId, frameId });

    while (frameDetails && frameDetails.parentFrameId !== -1) {
      const subFrameOffset: SubFrameOffsetData = await BrowserApi.tabSendMessage(
        tab,
        {
          command: "getSubFrameOffsets",
          subFrameUrl: frameDetails.url,
          subFrameId: frameDetails.documentId,
        },
        { frameId: frameDetails.parentFrameId },
      );

      if (!subFrameOffset) {
        subFrameOffsetsForTab.set(frameId, null);
        void BrowserApi.tabSendMessage(
          tab,
          { command: "getSubFrameOffsetsFromWindowMessage", subFrameId: frameId },
          { frameId: frameId },
        );
        return;
      }

      subFrameData.top += subFrameOffset.top;
      subFrameData.left += subFrameOffset.left;

      frameDetails = await BrowserApi.getFrameDetails({
        tabId,
        frameId: frameDetails.parentFrameId,
      });
    }

    subFrameOffsetsForTab.set(frameId, subFrameData);
  }

  private async rebuildSubFrameOffsets(sender: chrome.runtime.MessageSender) {
    if (sender.frameId === this.focusedFieldData?.frameId) {
      return;
    }

    const subFrameOffsetsForTab = this.subFrameOffsetsForTab[sender.tab.id];
    if (!subFrameOffsetsForTab) {
      return;
    }

    if (this.updateOverlayPositionAfterSubFrameRebuildTimeout) {
      clearTimeout(this.updateOverlayPositionAfterSubFrameRebuildTimeout);
    }

    const frameTabs = Array.from(subFrameOffsetsForTab.keys());
    for (const frameId of frameTabs) {
      if (frameId === sender.frameId) {
        continue;
      }

      subFrameOffsetsForTab.delete(frameId);
      await this.buildSubFrameOffsets(sender.tab, frameId, sender.url);
    }

    this.updateOverlayPositionAfterSubFrameRebuildTimeout = setTimeout(() => {
      if (this.isFieldCurrentlyFocused) {
        void this.updateOverlayPosition({ overlayElement: AutofillOverlayElement.List }, sender);
        void this.updateOverlayPosition({ overlayElement: AutofillOverlayElement.Button }, sender);
      }
    }, 650);
  }

  /**
   * Triggers autofill for the selected cipher in the overlay list. Also places
   * the selected cipher at the top of the list of ciphers.
   *
   * @param overlayCipherId - Cipher ID corresponding to the overlayLoginCiphers map. Does not correspond to the actual cipher's ID.
   * @param sender - The sender of the port message
   */
  private async fillSelectedOverlayListItem(
    { overlayCipherId }: OverlayPortMessage,
    { sender }: chrome.runtime.Port,
  ) {
    const pageDetails = this.pageDetailsForTab[sender.tab.id];
    if (!overlayCipherId || !pageDetails?.size) {
      return;
    }

    const cipher = this.overlayLoginCiphers.get(overlayCipherId);

    if (await this.autofillService.isPasswordRepromptRequired(cipher, sender.tab)) {
      return;
    }
    const totpCode = await this.autofillService.doAutoFill({
      tab: sender.tab,
      cipher: cipher,
      pageDetails: Array.from(pageDetails.values()),
      fillNewPassword: true,
      allowTotpAutofill: true,
    });

    if (totpCode) {
      this.platformUtilsService.copyToClipboard(totpCode);
    }

    this.overlayLoginCiphers = new Map([[overlayCipherId, cipher], ...this.overlayLoginCiphers]);
  }

  /**
   * Checks if the overlay is focused. Will check the overlay list
   * if it is open, otherwise it will check the overlay button.
   */
  private checkOverlayFocused() {
    if (this.overlayListPort) {
      this.checkOverlayListFocused();

      return;
    }

    this.checkOverlayButtonFocused();
  }

  /**
   * Posts a message to the overlay button iframe to check if it is focused.
   */
  private checkOverlayButtonFocused() {
    this.overlayButtonPort?.postMessage({ command: "checkAutofillOverlayButtonFocused" });
  }

  /**
   * Posts a message to the overlay list iframe to check if it is focused.
   */
  private checkOverlayListFocused() {
    this.overlayListPort?.postMessage({ command: "checkAutofillOverlayListFocused" });
  }

  /**
   * Sends a message to the sender tab to close the autofill overlay.
   *
   * @param sender - The sender of the port message
   * @param forceCloseOverlay - Identifies whether the overlay should be forced closed
   * @param overlayElement - The overlay element to close, either the list or button
   */
  private closeOverlay(
    sender: chrome.runtime.MessageSender,
    {
      forceCloseOverlay,
      overlayElement,
    }: { forceCloseOverlay?: boolean; overlayElement?: string } = {},
  ) {
    if (forceCloseOverlay) {
      void BrowserApi.tabSendMessage(
        sender.tab,
        { command: "closeInlineMenu", overlayElement },
        { frameId: 0 },
      );
      return;
    }

    if (this.isFieldCurrentlyFocused) {
      return;
    }

    if (this.isFieldCurrentlyFilling) {
      void BrowserApi.tabSendMessage(
        sender.tab,
        {
          command: "closeInlineMenu",
          overlayElement: AutofillOverlayElement.List,
        },
        { frameId: 0 },
      );
      return;
    }

    void BrowserApi.tabSendMessage(
      sender.tab,
      { command: "closeInlineMenu", overlayElement },
      { frameId: 0 },
    );
  }

  /**
   * Handles cleanup when an overlay element is closed. Disconnects
   * the list and button ports and sets them to null.
   *
   * @param overlayElement - The overlay element that was closed, either the list or button
   */
  private overlayElementClosed({ overlayElement }: OverlayBackgroundExtensionMessage) {
    if (overlayElement === AutofillOverlayElement.Button) {
      this.overlayButtonPort?.disconnect();
      this.overlayButtonPort = null;

      return;
    }

    this.overlayListPort?.disconnect();
    this.overlayListPort = null;
  }

  /**
   * Updates the position of either the overlay list or button. The position
   * is based on the focused field's position and dimensions.
   *
   * @param overlayElement - The overlay element to update, either the list or button
   * @param sender - The sender of the extension message
   */
  private async updateOverlayPosition(
    { overlayElement }: { overlayElement?: string },
    sender: chrome.runtime.MessageSender,
  ) {
    if (!overlayElement || sender.tab.id !== this.focusedFieldData.tabId) {
      return;
    }

    await BrowserApi.tabSendMessage(
      sender.tab,
      { command: "appendInlineMenuElementsToDom", overlayElement },
      { frameId: 0 },
    );

    const subFrameOffsetsForTab = this.subFrameOffsetsForTab[this.focusedFieldData.tabId];
    let subFrameOffsets: SubFrameOffsetData;
    if (subFrameOffsetsForTab) {
      subFrameOffsets = subFrameOffsetsForTab.get(this.focusedFieldData.frameId);
    }

    if (overlayElement === AutofillOverlayElement.Button) {
      this.overlayButtonPort?.postMessage({
        command: "updateIframePosition",
        styles: this.getOverlayButtonPosition(subFrameOffsets),
      });

      return;
    }

    this.overlayListPort?.postMessage({
      command: "updateIframePosition",
      styles: this.getOverlayListPosition(subFrameOffsets),
    });
  }

  /**
   * Gets the position of the focused field and calculates the position
   * of the overlay button based on the focused field's position and dimensions.
   */
  private getOverlayButtonPosition(subFrameOffsets: SubFrameOffsetData) {
    if (!this.focusedFieldData) {
      return;
    }

    const subFrameTopOffset = subFrameOffsets?.top || 0;
    const subFrameLeftOffset = subFrameOffsets?.left || 0;

    const { top, left, width, height } = this.focusedFieldData.focusedFieldRects;
    const { paddingRight, paddingLeft } = this.focusedFieldData.focusedFieldStyles;
    let elementOffset = height * 0.37;
    if (height >= 35) {
      elementOffset = height >= 50 ? height * 0.47 : height * 0.42;
    }

    const fieldPaddingRight = parseInt(paddingRight, 10);
    const fieldPaddingLeft = parseInt(paddingLeft, 10);
    const elementHeight = height - elementOffset;

    const elementTopPosition = subFrameTopOffset + top + elementOffset / 2;
    const elementLeftPosition =
      fieldPaddingRight > fieldPaddingLeft
        ? subFrameLeftOffset + left + width - height - (fieldPaddingRight - elementOffset + 2)
        : subFrameLeftOffset + left + width - height + elementOffset / 2;

    return {
      top: `${Math.round(elementTopPosition)}px`,
      left: `${Math.round(elementLeftPosition)}px`,
      height: `${Math.round(elementHeight)}px`,
      width: `${Math.round(elementHeight)}px`,
    };
  }

  /**
   * Gets the position of the focused field and calculates the position
   * of the overlay list based on the focused field's position and dimensions.
   */
  private getOverlayListPosition(subFrameOffsets: SubFrameOffsetData) {
    if (!this.focusedFieldData) {
      return;
    }

    const subFrameTopOffset = subFrameOffsets?.top || 0;
    const subFrameLeftOffset = subFrameOffsets?.left || 0;

    const { top, left, width, height } = this.focusedFieldData.focusedFieldRects;
    return {
      width: `${Math.round(width)}px`,
      top: `${Math.round(top + height + subFrameTopOffset)}px`,
      left: `${Math.round(left + subFrameLeftOffset)}px`,
    };
  }

  /**
   * Sets the focused field data to the data passed in the extension message.
   *
   * @param focusedFieldData - Contains the rects and styles of the focused field.
   * @param sender - The sender of the extension message
   */
  private setFocusedFieldData(
    { focusedFieldData }: OverlayBackgroundExtensionMessage,
    sender: chrome.runtime.MessageSender,
  ) {
    this.focusedFieldData = { ...focusedFieldData, tabId: sender.tab.id, frameId: sender.frameId };
  }

  /**
   * Updates the overlay's visibility based on the display property passed in the extension message.
   *
   * @param display - The display property of the overlay, either "block" or "none"
   * @param sender - The sender of the extension message
   */
  private updateOverlayHidden(
    { isOverlayHidden, setTransparentOverlay }: OverlayBackgroundExtensionMessage,
    sender: chrome.runtime.MessageSender,
  ) {
    const display = isOverlayHidden ? "none" : "block";
    let styles: { display: string; opacity?: number } = { display };

    if (typeof setTransparentOverlay !== "undefined") {
      const opacity = setTransparentOverlay ? 0 : 1;
      styles = { ...styles, opacity };
    }

    const portMessage = { command: "updateOverlayHidden", styles };

    void BrowserApi.tabSendMessage(
      sender.tab,
      { command: "toggleInlineMenuHidden", isInlineMenuHidden: isOverlayHidden },
      { frameId: 0 },
    );

    this.overlayButtonPort?.postMessage(portMessage);
    this.overlayListPort?.postMessage(portMessage);
  }

  /**
   * Sends a message to the currently active tab to open the autofill overlay.
   *
   * @param isFocusingFieldElement - Identifies whether the field element should be focused when the overlay is opened
   * @param isOpeningFullOverlay - Identifies whether the full overlay should be forced open regardless of other states
   */
  private async openOverlay(isFocusingFieldElement = false, isOpeningFullOverlay = false) {
    const currentTab = await BrowserApi.getTabFromCurrentWindowId();

    await BrowserApi.tabSendMessage(
      currentTab,
      {
        command: "openAutofillOverlay",
        isFocusingFieldElement,
        isOpeningFullOverlay,
        authStatus: await this.getAuthStatus(),
      },
      {
        frameId: this.focusedFieldData?.tabId === currentTab.id ? this.focusedFieldData.frameId : 0,
      },
    );
  }

  /**
   * Gets the overlay's visibility setting from the settings service.
   */
  private async getOverlayVisibility(): Promise<InlineMenuVisibilitySetting> {
    return await firstValueFrom(this.autofillSettingsService.inlineMenuVisibility$);
  }

  /**
   * Gets the user's authentication status from the auth service. If the user's
   * authentication status has changed, the overlay button's authentication status
   * will be updated and the overlay list's ciphers will be updated.
   */
  private async getAuthStatus() {
    const formerAuthStatus = this.userAuthStatus;
    this.userAuthStatus = await firstValueFrom(this.authService.activeAccountStatus$);

    if (
      this.userAuthStatus !== formerAuthStatus &&
      this.userAuthStatus === AuthenticationStatus.Unlocked
    ) {
      this.updateOverlayButtonAuthStatus();
      await this.updateOverlayCiphers();
    }

    return this.userAuthStatus;
  }

  /**
   * Sends a message to the overlay button to update its authentication status.
   */
  private updateOverlayButtonAuthStatus() {
    this.overlayButtonPort?.postMessage({
      command: "updateOverlayButtonAuthStatus",
      authStatus: this.userAuthStatus,
    });
  }

  /**
   * Handles the overlay button being clicked. If the user is not authenticated,
   * the vault will be unlocked. If the user is authenticated, the overlay will
   * be opened.
   *
   * @param port - The port of the overlay button
   */
  private handleOverlayButtonClicked(port: chrome.runtime.Port) {
    if (this.userAuthStatus !== AuthenticationStatus.Unlocked) {
      void this.unlockVault(port);
      return;
    }

    void this.openOverlay(false, true);
  }

  /**
   * Facilitates opening the unlock popout window.
   *
   * @param port - The port of the overlay list
   */
  private async unlockVault(port: chrome.runtime.Port) {
    const { sender } = port;

    this.closeOverlay(port.sender);
    const retryMessage: LockedVaultPendingNotificationsData = {
      commandToRetry: { message: { command: "openAutofillOverlay" }, sender },
      target: "overlay.background",
    };
    await BrowserApi.tabSendMessageData(
      sender.tab,
      "addToLockedVaultPendingNotifications",
      retryMessage,
    );
    await this.openUnlockPopout(sender.tab, true);
  }

  /**
   * Triggers the opening of a vault item popout window associated
   * with the passed cipher ID.
   * @param overlayCipherId - Cipher ID corresponding to the overlayLoginCiphers map. Does not correspond to the actual cipher's ID.
   * @param sender - The sender of the port message
   */
  private async viewSelectedCipher(
    { overlayCipherId }: OverlayPortMessage,
    { sender }: chrome.runtime.Port,
  ) {
    const cipher = this.overlayLoginCiphers.get(overlayCipherId);
    if (!cipher) {
      return;
    }

    await this.openViewVaultItemPopout(sender.tab, {
      cipherId: cipher.id,
      action: SHOW_AUTOFILL_BUTTON,
    });
  }

  /**
   * Facilitates redirecting focus to the overlay list.
   */
  private focusOverlayList() {
    this.overlayListPort?.postMessage({ command: "focusOverlayList" });
  }

  /**
   * Updates the authentication status for the user and opens the overlay if
   * a followup command is present in the message.
   *
   * @param message - Extension message received from the `unlockCompleted` command
   */
  private async unlockCompleted(message: OverlayBackgroundExtensionMessage) {
    await this.getAuthStatus();

    if (message.data?.commandToRetry?.message?.command === "openAutofillOverlay") {
      await this.openOverlay(true);
    }
  }

  /**
   * Gets the translations for the overlay page.
   */
  private getTranslations() {
    if (!this.overlayPageTranslations) {
      this.overlayPageTranslations = {
        locale: BrowserApi.getUILanguage(),
        opensInANewWindow: this.i18nService.translate("opensInANewWindow"),
        buttonPageTitle: this.i18nService.translate("bitwardenOverlayButton"),
        toggleBitwardenVaultOverlay: this.i18nService.translate("toggleBitwardenVaultOverlay"),
        listPageTitle: this.i18nService.translate("bitwardenVault"),
        unlockYourAccount: this.i18nService.translate("unlockYourAccountToViewMatchingLogins"),
        unlockAccount: this.i18nService.translate("unlockAccount"),
        fillCredentialsFor: this.i18nService.translate("fillCredentialsFor"),
        partialUsername: this.i18nService.translate("partialUsername"),
        view: this.i18nService.translate("view"),
        noItemsToShow: this.i18nService.translate("noItemsToShow"),
        newItem: this.i18nService.translate("newItem"),
        addNewVaultItem: this.i18nService.translate("addNewVaultItem"),
      };
    }

    return this.overlayPageTranslations;
  }

  /**
   * Facilitates redirecting focus out of one of the
   *  overlay elements to elements on the page.
   *
   * @param direction - The direction to redirect focus to (either "next", "previous" or "current)
   * @param sender - The sender of the port message
   */
  private redirectOverlayFocusOut(
    { direction }: OverlayPortMessage,
    { sender }: chrome.runtime.Port,
  ) {
    if (!direction) {
      return;
    }

    void BrowserApi.tabSendMessageData(sender.tab, "redirectOverlayFocusOut", { direction });
  }

  /**
   * Triggers adding a new vault item from the overlay. Gathers data
   * input by the user before calling to open the add/edit window.
   *
   * @param sender - The sender of the port message
   */
  private getNewVaultItemDetails({ sender }: chrome.runtime.Port) {
    if (sender.tab.id !== this.focusedFieldData.tabId) {
      return;
    }

    void BrowserApi.tabSendMessage(
      sender.tab,
      { command: "addNewVaultItemFromOverlay" },
      {
        frameId: this.focusedFieldData.frameId || 0,
      },
    );
  }

  /**
   * Handles adding a new vault item from the overlay. Gathers data login
   * data captured in the extension message.
   *
   * @param login - The login data captured from the extension message
   * @param sender - The sender of the extension message
   */
  private async addNewVaultItem(
    { login }: OverlayAddNewItemMessage,
    sender: chrome.runtime.MessageSender,
  ) {
    if (!login) {
      return;
    }

    const uriView = new LoginUriView();
    uriView.uri = login.uri;

    const loginView = new LoginView();
    loginView.uris = [uriView];
    loginView.username = login.username || "";
    loginView.password = login.password || "";

    const cipherView = new CipherView();
    cipherView.name = (Utils.getHostname(login.uri) || login.hostname).replace(/^www\./, "");
    cipherView.folderId = null;
    cipherView.type = CipherType.Login;
    cipherView.login = loginView;

    await this.stateService.setAddEditCipherInfo({
      cipher: cipherView,
      collectionIds: cipherView.collectionIds,
    });

    await this.openAddEditVaultItemPopout(sender.tab, { cipherId: cipherView.id });
    await BrowserApi.sendMessage("inlineAutofillMenuRefreshAddEditCipher");
  }

  private updateIsFieldCurrentlyFocused(message: OverlayBackgroundExtensionMessage) {
    this.isFieldCurrentlyFocused = message.isFieldCurrentlyFocused;
  }

  private checkIsFieldCurrentlyFocused() {
    return this.isFieldCurrentlyFocused;
  }

  private updateIsFieldCurrentlyFilling(message: OverlayBackgroundExtensionMessage) {
    this.isFieldCurrentlyFilling = message.isFieldCurrentlyFilling;
  }

  private checkIsFieldCurrentlyFilling() {
    return this.isFieldCurrentlyFilling;
  }

  private async checkIsInlineMenuButtonVisible(sender: chrome.runtime.MessageSender) {
    return await BrowserApi.tabSendMessage(
      sender.tab,
      { command: "checkIsInlineMenuButtonVisible" },
      { frameId: 0 },
    );
  }

  private async checkIsInlineMenuListVisible(sender: chrome.runtime.MessageSender) {
    return await BrowserApi.tabSendMessage(
      sender.tab,
      { command: "checkIsInlineMenuListVisible" },
      { frameId: 0 },
    );
  }

  private checkIsInlineMenuCiphersPopulated(sender: chrome.runtime.MessageSender) {
    return sender.tab.id === this.focusedFieldData.tabId && this.overlayLoginCiphers.size > 0;
  }

  private updateButtonPageColorScheme() {
    this.overlayButtonPort?.postMessage({
      command: "getPageColorScheme",
    });
  }

  private updateOverlayListHeight(message: OverlayBackgroundExtensionMessage) {
    this.overlayListPort?.postMessage({
      command: "updateIframePosition",
      styles: message.styles,
    });
  }

  /**
   * Sets up the extension message listeners for the overlay.
   */
  private setupExtensionMessageListeners() {
    BrowserApi.messageListener("overlay.background", this.handleExtensionMessage);
    BrowserApi.addListener(chrome.runtime.onConnect, this.handlePortOnConnect);
  }

  /**
   * Handles extension messages sent to the extension background.
   *
   * @param message - The message received from the extension
   * @param sender - The sender of the message
   * @param sendResponse - The response to send back to the sender
   */
  private handleExtensionMessage = (
    message: OverlayBackgroundExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void,
  ) => {
    const handler: CallableFunction | undefined = this.extensionMessageHandlers[message?.command];
    if (!handler) {
      return;
    }

    const messageResponse = handler({ message, sender });
    if (typeof messageResponse === "undefined") {
      return;
    }

    Promise.resolve(messageResponse)
      .then((response) => sendResponse(response))
      .catch(this.logService.error);
    return true;
  };

  /**
   * Handles the connection of a port to the extension background.
   *
   * @param port - The port that connected to the extension background
   */
  private handlePortOnConnect = async (port: chrome.runtime.Port) => {
    const isOverlayListMessageConnector = port.name === AutofillOverlayPort.ListMessageConnector;
    const isOverlayButtonMessageConnector =
      port.name === AutofillOverlayPort.ButtonMessageConnector;
    if (isOverlayListMessageConnector || isOverlayButtonMessageConnector) {
      port.onMessage.addListener(this.handleOverlayElementPortMessage);
      return;
    }

    const isOverlayListPort = port.name === AutofillOverlayPort.List;
    const isOverlayButtonPort = port.name === AutofillOverlayPort.Button;
    if (!isOverlayListPort && !isOverlayButtonPort) {
      return;
    }

    const tabId = port.sender.tab.id;
    if (!this.portKeyForTab[tabId]) {
      this.portKeyForTab[tabId] = generateRandomChars(12);
    }

    if (isOverlayListPort) {
      this.overlayListPort = port;
    } else {
      this.overlayButtonPort = port;
    }

    port.onDisconnect.addListener(this.handlePortOnDisconnect);
    port.postMessage({
      command: `initAutofillOverlay${isOverlayListPort ? "List" : "Button"}`,
      authStatus: await this.getAuthStatus(),
      styleSheetUrl: chrome.runtime.getURL(`overlay/${isOverlayListPort ? "list" : "button"}.css`),
      theme: await firstValueFrom(this.themeStateService.selectedTheme$),
      translations: this.getTranslations(),
      ciphers: isOverlayListPort ? await this.getOverlayCipherData() : null,
      messageConnectorUrl: chrome.runtime.getURL("overlay/message-connector.html"),
      portKey: this.portKeyForTab[tabId],
    });
    void this.updateOverlayPosition(
      {
        overlayElement: isOverlayListPort
          ? AutofillOverlayElement.List
          : AutofillOverlayElement.Button,
      },
      port.sender,
    );
  };

  /**
   * Handles messages sent to the overlay list or button ports.
   *
   * @param message - The message received from the port
   * @param port - The port that sent the message
   */
  private handleOverlayElementPortMessage = (
    message: OverlayBackgroundExtensionMessage,
    port: chrome.runtime.Port,
  ) => {
    const tabId = port.sender.tab.id;
    if (this.portKeyForTab[tabId] !== message?.portKey) {
      return;
    }

    const command = message.command;
    let handler: CallableFunction | undefined;

    if (port.name === AutofillOverlayPort.ButtonMessageConnector) {
      handler = this.overlayButtonPortMessageHandlers[command];
    }

    if (port.name === AutofillOverlayPort.ListMessageConnector) {
      handler = this.overlayListPortMessageHandlers[command];
    }

    if (!handler) {
      return;
    }

    handler({ message, port });
  };

  private handlePortOnDisconnect = (port: chrome.runtime.Port) => {
    if (port.name === AutofillOverlayPort.List) {
      this.overlayListPort = null;
    }

    if (port.name === AutofillOverlayPort.Button) {
      this.overlayButtonPort = null;
    }
  };
}

export default OverlayBackground;
