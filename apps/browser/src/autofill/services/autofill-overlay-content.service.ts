import "@webcomponents/custom-elements";
import "lit/polyfill-support.js";
import { FocusableElement, tabbable } from "tabbable";

import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { EVENTS, AutofillOverlayVisibility } from "@bitwarden/common/autofill/constants";

import {
  FocusedFieldData,
  SubFrameOffsetData,
} from "../background/abstractions/overlay.background";
import { AutofillExtensionMessage } from "../content/abstractions/autofill-init";
import { AutofillOverlayElement, RedirectFocusDirection } from "../enums/autofill-overlay.enum";
import AutofillField from "../models/autofill-field";
import { ElementWithOpId, FillableFormFieldElement, FormFieldElement } from "../types";
import { elementIsFillableFormField, getAttributeBoolean, sendExtensionMessage } from "../utils";

import {
  AutofillOverlayContentExtensionMessageHandlers,
  AutofillOverlayContentService as AutofillOverlayContentServiceInterface,
  OpenAutofillInlineMenuOptions,
} from "./abstractions/autofill-overlay-content.service";
import { AutoFillConstants } from "./autofill-constants";

class AutofillOverlayContentService implements AutofillOverlayContentServiceInterface {
  pageDetailsUpdateRequired = false;
  inlineMenuVisibility: number;
  private readonly findTabs = tabbable;
  private readonly sendExtensionMessage = sendExtensionMessage;
  private formFieldElements: Set<ElementWithOpId<FormFieldElement>> = new Set([]);
  private hiddenFormFieldElements: WeakMap<ElementWithOpId<FormFieldElement>, AutofillField> =
    new WeakMap();
  private ignoredFieldTypes: Set<string> = new Set(AutoFillConstants.ExcludedOverlayTypes);
  private userFilledFields: Record<string, FillableFormFieldElement> = {};
  private authStatus: AuthenticationStatus;
  private focusableElements: FocusableElement[] = [];
  private mostRecentlyFocusedField: ElementWithOpId<FormFieldElement>;
  private focusedFieldData: FocusedFieldData;
  private userInteractionEventTimeout: number | NodeJS.Timeout;
  private recalculateSubFrameOffsetsTimeout: number | NodeJS.Timeout;
  private autofillFieldKeywordsMap: WeakMap<AutofillField, string> = new WeakMap();
  private eventHandlersMemo: { [key: string]: EventListener } = {};
  readonly extensionMessageHandlers: AutofillOverlayContentExtensionMessageHandlers = {
    openAutofillInlineMenu: ({ message }) => this.openAutofillInlineMenu(message),
    addNewVaultItemFromOverlay: () => this.addNewVaultItem(),
    blurMostRecentOverlayField: () => this.blurMostRecentOverlayField(),
    bgUnlockPopoutOpened: () => this.blurMostRecentOverlayField(true),
    bgVaultItemRepromptPopoutOpened: () => this.blurMostRecentOverlayField(true),
    redirectInlineMenuFocusOut: ({ message }) =>
      this.redirectInlineMenuFocusOut(message?.data?.direction),
    updateAutofillInlineMenuVisibility: ({ message }) =>
      this.updateAutofillInlineMenuVisibility(message),
    getSubFrameOffsets: ({ message }) => this.getSubFrameOffsets(message),
    getSubFrameOffsetsFromWindowMessage: ({ message }) =>
      this.getSubFrameOffsetsFromWindowMessage(message),
  };

  /**
   * Initializes the autofill overlay content service by setting up the mutation observers.
   * The observers will be instantiated on DOMContentLoaded if the page is current loading.
   */
  init() {
    if (globalThis.document.readyState === "loading") {
      globalThis.document.addEventListener(EVENTS.DOMCONTENTLOADED, this.setupGlobalEventListeners);
      return;
    }

    this.setupGlobalEventListeners();
  }

  /**
   * Sets up the autofill inline menu listener on the form field element. This method is called
   * during the page details collection process.
   *
   * @param formFieldElement - Form field elements identified during the page details collection process.
   * @param autofillFieldData - Autofill field data captured from the form field element.
   */
  async setupAutofillInlineMenuListenerOnField(
    formFieldElement: ElementWithOpId<FormFieldElement>,
    autofillFieldData: AutofillField,
  ) {
    if (this.isIgnoredField(autofillFieldData) || this.formFieldElements.has(formFieldElement)) {
      return;
    }

    if (this.isHiddenField(formFieldElement, autofillFieldData)) {
      return;
    }

    this.formFieldElements.add(formFieldElement);

    if (!this.mostRecentlyFocusedField) {
      await this.updateMostRecentlyFocusedField(formFieldElement);
    }

    if (!this.inlineMenuVisibility) {
      await this.getAutofillInlineMenuVisibility();
    }

    this.setupFormFieldElementEventListeners(formFieldElement);

    if (this.getRootNodeActiveElement(formFieldElement) === formFieldElement) {
      await this.triggerFormFieldFocusedAction(formFieldElement);
    }
  }

  /**
   * Handles opening the autofill overlay. Will conditionally open
   * the overlay based on the current autofill overlay visibility setting.
   * Allows you to optionally focus the field element when opening the overlay.
   * Will also optionally ignore the overlay visibility setting and open the
   *
   * @param options - Options for opening the autofill overlay.
   */
  openAutofillInlineMenu(options: OpenAutofillInlineMenuOptions = {}) {
    const { isFocusingFieldElement, isOpeningFullAutofillInlineMenu, authStatus } = options;
    if (!this.mostRecentlyFocusedField) {
      return;
    }

    if (this.pageDetailsUpdateRequired) {
      void this.sendExtensionMessage("bgCollectPageDetails", {
        sender: "autofillOverlayContentService",
      });
      this.pageDetailsUpdateRequired = false;
    }

    if (isFocusingFieldElement && !this.recentlyFocusedFieldIsCurrentlyFocused()) {
      this.focusMostRecentOverlayField();
    }

    if (typeof authStatus !== "undefined") {
      this.authStatus = authStatus;
    }

    if (
      this.inlineMenuVisibility === AutofillOverlayVisibility.OnButtonClick &&
      !isOpeningFullAutofillInlineMenu
    ) {
      this.updateAutofillInlineMenuButtonPosition();
      return;
    }

    this.updateAutofillInlineMenuElementsPosition();
  }

  /**
   * Focuses the most recently focused field element.
   */
  focusMostRecentOverlayField() {
    this.mostRecentlyFocusedField?.focus();
  }

  /**
   * Removes focus from the most recently focused field element.
   */
  blurMostRecentOverlayField(isRemovingOverlay: boolean = false) {
    this.mostRecentlyFocusedField?.blur();

    if (isRemovingOverlay) {
      void sendExtensionMessage("closeAutofillInlineMenu");
    }
  }

  /**
   * Formats any found user filled fields for a login cipher and sends a message
   * to the background script to add a new cipher.
   */
  async addNewVaultItem() {
    if (!(await this.isInlineMenuListVisible())) {
      return;
    }

    const login = {
      username: this.userFilledFields["username"]?.value || "",
      password: this.userFilledFields["password"]?.value || "",
      uri: globalThis.document.URL,
      hostname: globalThis.document.location.hostname,
    };

    void this.sendExtensionMessage("autofillOverlayAddNewVaultItem", { login });
  }

  /**
   * Redirects the keyboard focus out of the overlay, selecting the element that is
   * either previous or next in the tab order. If the direction is current, the most
   * recently focused field will be focused.
   *
   * @param direction - The direction to redirect the focus out.
   */
  async redirectInlineMenuFocusOut(direction?: string) {
    if (!direction || !this.mostRecentlyFocusedField || !(await this.isInlineMenuListVisible())) {
      return;
    }

    if (direction === RedirectFocusDirection.Current) {
      this.focusMostRecentOverlayField();
      setTimeout(() => void this.sendExtensionMessage("closeAutofillInlineMenu"), 100);
      return;
    }

    if (!this.focusableElements.length) {
      this.focusableElements = this.findTabs(globalThis.document.body, { getShadowRoot: true });
    }

    const focusedElementIndex = this.focusableElements.findIndex(
      (element) => element === this.mostRecentlyFocusedField,
    );

    const indexOffset = direction === RedirectFocusDirection.Previous ? -1 : 1;
    const redirectFocusElement = this.focusableElements[focusedElementIndex + indexOffset];
    redirectFocusElement?.focus();
  }

  /**
   * Sets up the event listeners that facilitate interaction with the form field elements.
   * Will clear any cached form field element handlers that are encountered when setting
   * up a form field element to the overlay.
   *
   * @param formFieldElement - The form field element to set up the event listeners for.
   */
  private setupFormFieldElementEventListeners(formFieldElement: ElementWithOpId<FormFieldElement>) {
    this.removeCachedFormFieldEventListeners(formFieldElement);

    formFieldElement.addEventListener(EVENTS.BLUR, this.handleFormFieldBlurEvent);
    formFieldElement.addEventListener(EVENTS.KEYUP, this.handleFormFieldKeyupEvent);
    formFieldElement.addEventListener(
      EVENTS.INPUT,
      this.handleFormFieldInputEvent(formFieldElement),
    );
    formFieldElement.addEventListener(
      EVENTS.CLICK,
      this.handleFormFieldClickEvent(formFieldElement),
    );
    formFieldElement.addEventListener(
      EVENTS.FOCUS,
      this.handleFormFieldFocusEvent(formFieldElement),
    );
  }

  /**
   * Removes any cached form field element handlers that are encountered
   * when setting up a form field element to present the overlay.
   *
   * @param formFieldElement - The form field element to remove the cached handlers for.
   */
  private removeCachedFormFieldEventListeners(formFieldElement: ElementWithOpId<FormFieldElement>) {
    const handlers = [EVENTS.INPUT, EVENTS.CLICK, EVENTS.FOCUS];
    for (let index = 0; index < handlers.length; index++) {
      const event = handlers[index];
      const memoIndex = this.getFormFieldHandlerMemoIndex(formFieldElement, event);
      const existingHandler = this.eventHandlersMemo[memoIndex];
      if (!existingHandler) {
        return;
      }

      formFieldElement.removeEventListener(event, existingHandler);
      delete this.eventHandlersMemo[memoIndex];
    }
  }

  /**
   * Helper method that facilitates registration of an event handler to a form field element.
   *
   * @param eventHandler - The event handler to memoize.
   * @param memoIndex - The memo index to use for the event handler.
   */
  private useEventHandlersMemo = (eventHandler: EventListener, memoIndex: string) => {
    return this.eventHandlersMemo[memoIndex] || (this.eventHandlersMemo[memoIndex] = eventHandler);
  };

  /**
   * Formats the memoIndex for the form field event handler.
   *
   * @param formFieldElement - The form field element to format the memo index for.
   * @param event - The event to format the memo index for.
   */
  private getFormFieldHandlerMemoIndex(
    formFieldElement: ElementWithOpId<FormFieldElement>,
    event: string,
  ) {
    return `${formFieldElement.opid}-${formFieldElement.id}-${event}-handler`;
  }

  /**
   * Form Field blur event handler. Updates the value identifying whether
   * the field is focused and sends a message to check if the overlay itself
   * is currently focused.
   */
  private handleFormFieldBlurEvent = () => {
    void this.sendExtensionMessage("updateIsFieldCurrentlyFocused", {
      isFieldCurrentlyFocused: false,
    });
    void this.sendExtensionMessage("checkAutofillInlineMenuFocused");
  };

  /**
   * Form field keyup event handler. Facilitates the ability to remove the
   * autofill overlay using the escape key, focusing the overlay list using
   * the ArrowDown key, and ensuring that the overlay is repositioned when
   * the form is submitted using the Enter key.
   *
   * @param event - The keyup event.
   */
  private handleFormFieldKeyupEvent = async (event: KeyboardEvent) => {
    const eventCode = event.code;
    if (eventCode === "Escape") {
      void this.sendExtensionMessage("closeAutofillInlineMenu", {
        forceCloseAutofillInlineMenu: true,
      });
      return;
    }

    if (eventCode === "Enter" && !(await this.isFieldCurrentlyFilling())) {
      void this.handleOverlayRepositionEvent();
      return;
    }

    if (eventCode === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();

      void this.focusInlineMenuList();
    }
  };

  /**
   * Triggers a focus of the overlay list, if it is visible. If the list is not visible,
   * the overlay will be opened and the list will be focused after a short delay. Ensures
   * that the overlay list is focused when the user presses the down arrow key.
   */
  private async focusInlineMenuList() {
    if (this.mostRecentlyFocusedField && !(await this.isInlineMenuListVisible())) {
      await this.updateMostRecentlyFocusedField(this.mostRecentlyFocusedField);
      this.openAutofillInlineMenu({ isOpeningFullAutofillInlineMenu: true });
      setTimeout(() => this.sendExtensionMessage("focusAutofillInlineMenuList"), 125);
      return;
    }

    void this.sendExtensionMessage("focusAutofillInlineMenuList");
  }

  /**
   * Sets up and memoizes the form field input event handler.
   *
   * @param formFieldElement - The form field element that triggered the input event.
   */
  private handleFormFieldInputEvent = (formFieldElement: ElementWithOpId<FormFieldElement>) => {
    return this.useEventHandlersMemo(
      () => this.triggerFormFieldInput(formFieldElement),
      this.getFormFieldHandlerMemoIndex(formFieldElement, EVENTS.INPUT),
    );
  };

  /**
   * Triggers when the form field element receives an input event. This method will
   * store the modified form element data for use when the user attempts to add a new
   * vault item. It also acts to remove the overlay list while the user is typing.
   *
   * @param formFieldElement - The form field element that triggered the input event.
   */
  private async triggerFormFieldInput(formFieldElement: ElementWithOpId<FormFieldElement>) {
    if (!elementIsFillableFormField(formFieldElement)) {
      return;
    }

    this.storeModifiedFormElement(formFieldElement);

    if (await this.hideAutofillInlineMenuListOnFilledField(formFieldElement)) {
      void this.sendExtensionMessage("closeAutofillInlineMenu", {
        overlayElement: AutofillOverlayElement.List,
        forceCloseAutofillInlineMenu: true,
      });
      return;
    }

    this.openAutofillInlineMenu();
  }

  /**
   * Stores the modified form element data for use when the user attempts to add a new
   * vault item. This method will also store the most recently focused field, if it is
   * not already stored.
   *
   * @param formFieldElement
   * @private
   */
  private storeModifiedFormElement(formFieldElement: ElementWithOpId<FillableFormFieldElement>) {
    if (formFieldElement !== this.mostRecentlyFocusedField) {
      void this.updateMostRecentlyFocusedField(formFieldElement);
    }

    if (formFieldElement.type === "password") {
      this.userFilledFields.password = formFieldElement;
      return;
    }

    this.userFilledFields.username = formFieldElement;
  }

  /**
   * Sets up and memoizes the form field click event handler.
   *
   * @param formFieldElement - The form field element that triggered the click event.
   */
  private handleFormFieldClickEvent = (formFieldElement: ElementWithOpId<FormFieldElement>) => {
    return this.useEventHandlersMemo(
      () => this.triggerFormFieldClickedAction(formFieldElement),
      this.getFormFieldHandlerMemoIndex(formFieldElement, EVENTS.CLICK),
    );
  };

  /**
   * Triggers when the form field element receives a click event. This method will
   * trigger the focused action for the form field element if the overlay is not visible.
   *
   * @param formFieldElement - The form field element that triggered the click event.
   */
  private async triggerFormFieldClickedAction(formFieldElement: ElementWithOpId<FormFieldElement>) {
    if ((await this.isInlineMenuButtonVisible()) || (await this.isInlineMenuListVisible())) {
      return;
    }

    await this.triggerFormFieldFocusedAction(formFieldElement);
  }

  /**
   * Sets up and memoizes the form field focus event handler.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private handleFormFieldFocusEvent = (formFieldElement: ElementWithOpId<FormFieldElement>) => {
    return this.useEventHandlersMemo(
      () => this.triggerFormFieldFocusedAction(formFieldElement),
      this.getFormFieldHandlerMemoIndex(formFieldElement, EVENTS.FOCUS),
    );
  };

  /**
   * Triggers when the form field element receives a focus event. This method will
   * update the most recently focused field and open the autofill overlay if the
   * autofill process is not currently active.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private async triggerFormFieldFocusedAction(formFieldElement: ElementWithOpId<FormFieldElement>) {
    if (await this.isFieldCurrentlyFilling()) {
      return;
    }

    await this.sendExtensionMessage("updateIsFieldCurrentlyFocused", {
      isFieldCurrentlyFocused: true,
    });
    this.clearUserInteractionEventTimeout();
    const initiallyFocusedField = this.mostRecentlyFocusedField;
    await this.updateMostRecentlyFocusedField(formFieldElement);
    const formElementHasValue = Boolean((formFieldElement as HTMLInputElement).value);

    if (
      this.inlineMenuVisibility === AutofillOverlayVisibility.OnButtonClick ||
      (formElementHasValue && initiallyFocusedField !== this.mostRecentlyFocusedField)
    ) {
      await this.sendExtensionMessage("closeAutofillInlineMenu", {
        overlayElement: AutofillOverlayElement.List,
        forceCloseAutofillInlineMenu: true,
      });
    }

    if (
      await this.hideAutofillInlineMenuListOnFilledField(
        formFieldElement as FillableFormFieldElement,
      )
    ) {
      this.updateAutofillInlineMenuButtonPosition();
      return;
    }

    void this.sendExtensionMessage("openAutofillInlineMenu");
  }

  /**
   * Validates whether the user is currently authenticated.
   */
  private isUserAuthed() {
    return this.authStatus === AuthenticationStatus.Unlocked;
  }

  /**
   * Identifies if the autofill field's data contains any of
   * the keyboards matching the passed list of keywords.
   *
   * @param autofillFieldData - Autofill field data captured from the form field element.
   * @param keywords - Keywords to search for in the autofill field data.
   */
  private keywordsFoundInFieldData(autofillFieldData: AutofillField, keywords: string[]) {
    const searchedString = this.getAutofillFieldDataKeywords(autofillFieldData);
    return keywords.some((keyword) => searchedString.includes(keyword));
  }

  /**
   * Aggregates the autofill field's data into a single string
   * that can be used to search for keywords.
   *
   * @param autofillFieldData - Autofill field data captured from the form field element.
   */
  private getAutofillFieldDataKeywords(autofillFieldData: AutofillField) {
    if (this.autofillFieldKeywordsMap.has(autofillFieldData)) {
      return this.autofillFieldKeywordsMap.get(autofillFieldData);
    }

    const keywordValues = [
      autofillFieldData.htmlID,
      autofillFieldData.htmlName,
      autofillFieldData.htmlClass,
      autofillFieldData.type,
      autofillFieldData.title,
      autofillFieldData.placeholder,
      autofillFieldData.autoCompleteType,
      autofillFieldData["label-data"],
      autofillFieldData["label-aria"],
      autofillFieldData["label-left"],
      autofillFieldData["label-right"],
      autofillFieldData["label-tag"],
      autofillFieldData["label-top"],
    ]
      .join(",")
      .toLowerCase();
    this.autofillFieldKeywordsMap.set(autofillFieldData, keywordValues);

    return keywordValues;
  }

  /**
   * Validates that the most recently focused field is currently
   * focused within the root node relative to the field.
   */
  private recentlyFocusedFieldIsCurrentlyFocused() {
    return (
      this.getRootNodeActiveElement(this.mostRecentlyFocusedField) === this.mostRecentlyFocusedField
    );
  }

  /**
   * Updates the position of both the overlay button and overlay list.
   */
  private updateAutofillInlineMenuElementsPosition() {
    this.updateAutofillInlineMenuButtonPosition();
    this.updateAutofillInlineMenuListPosition();
  }

  /**
   * Updates the position of the overlay button.
   */
  private updateAutofillInlineMenuButtonPosition() {
    void this.sendExtensionMessage("updateAutofillInlineMenuPosition", {
      overlayElement: AutofillOverlayElement.Button,
    });
  }

  /**
   * Updates the position of the overlay list.
   */
  private updateAutofillInlineMenuListPosition() {
    void this.sendExtensionMessage("updateAutofillInlineMenuPosition", {
      overlayElement: AutofillOverlayElement.List,
    });
  }

  /**
   * Sends a message that facilitates hiding the overlay elements.
   *
   * @param isHidden - Indicates if the overlay elements should be hidden.
   * @param setTransparentOverlay - Indicates if the overlay is closing.
   */
  private toggleAutofillInlineMenuHidden(
    isHidden: boolean,
    setTransparentOverlay: boolean = false,
  ) {
    void this.sendExtensionMessage("updateAutofillInlineMenuHidden", {
      isAutofillInlineMenuHidden: isHidden,
      setTransparentOverlay,
    });
  }

  /**
   * Updates the data used to position the overlay elements in relation
   * to the most recently focused form field.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private async updateMostRecentlyFocusedField(
    formFieldElement: ElementWithOpId<FormFieldElement>,
  ) {
    if (!formFieldElement || !elementIsFillableFormField(formFieldElement)) {
      return;
    }

    this.mostRecentlyFocusedField = formFieldElement;
    const { paddingRight, paddingLeft } = globalThis.getComputedStyle(formFieldElement);
    const { width, height, top, left } =
      await this.getMostRecentlyFocusedFieldRects(formFieldElement);
    this.focusedFieldData = {
      focusedFieldStyles: { paddingRight, paddingLeft },
      focusedFieldRects: { width, height, top, left },
    };

    void this.sendExtensionMessage("updateFocusedFieldData", {
      focusedFieldData: this.focusedFieldData,
    });
  }

  /**
   * Gets the bounding client rects for the most recently focused field. This method will
   * attempt to use an intersection observer to get the most recently focused field's
   * bounding client rects. If the intersection observer is not supported, or the
   * intersection observer does not return a valid bounding client rect, the form
   * field element's bounding client rect will be used.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private async getMostRecentlyFocusedFieldRects(
    formFieldElement: ElementWithOpId<FormFieldElement>,
  ) {
    const focusedFieldRects =
      await this.getBoundingClientRectFromIntersectionObserver(formFieldElement);
    if (focusedFieldRects) {
      return focusedFieldRects;
    }

    return formFieldElement.getBoundingClientRect();
  }

  /**
   * Gets the bounds of the form field element from the IntersectionObserver API.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private async getBoundingClientRectFromIntersectionObserver(
    formFieldElement: ElementWithOpId<FormFieldElement>,
  ): Promise<DOMRectReadOnly | null> {
    if (!("IntersectionObserver" in globalThis) && !("IntersectionObserverEntry" in globalThis)) {
      return null;
    }

    return new Promise((resolve) => {
      const intersectionObserver = new IntersectionObserver(
        (entries) => {
          let fieldBoundingClientRects = entries[0]?.boundingClientRect;
          if (!fieldBoundingClientRects?.width || !fieldBoundingClientRects.height) {
            fieldBoundingClientRects = null;
          }

          intersectionObserver.disconnect();
          resolve(fieldBoundingClientRects);
        },
        {
          root: globalThis.document.body,
          rootMargin: "0px",
          threshold: 0.9999, // Safari doesn't seem to function properly with a threshold of 1
        },
      );
      intersectionObserver.observe(formFieldElement);
    });
  }

  /**
   * Identifies if the field should have the autofill overlay setup on it. Currently, this is mainly
   * determined by whether the field correlates with a login cipher. This method will need to be
   * updated in the future to support other types of forms.
   *
   * @param autofillFieldData - Autofill field data captured from the form field element.
   */
  private isIgnoredField(autofillFieldData: AutofillField): boolean {
    if (
      this.ignoredFieldTypes.has(autofillFieldData.type) ||
      this.keywordsFoundInFieldData(autofillFieldData, ["search", "captcha"])
    ) {
      return true;
    }

    const isLoginCipherField =
      autofillFieldData.type === "password" ||
      this.keywordsFoundInFieldData(autofillFieldData, AutoFillConstants.UsernameFieldNames);

    return !isLoginCipherField;
  }

  private isHiddenField(
    formFieldElement: ElementWithOpId<FormFieldElement>,
    autofillFieldData: AutofillField,
  ): boolean {
    if (!autofillFieldData.readonly && !autofillFieldData.disabled && autofillFieldData.viewable) {
      this.removeHiddenFieldFallbackListener(formFieldElement);
      return false;
    }

    this.setupHiddenFieldFallbackListener(formFieldElement, autofillFieldData);

    return true;
  }

  private setupHiddenFieldFallbackListener(
    formFieldElement: ElementWithOpId<FormFieldElement>,
    autofillFieldData: AutofillField,
  ) {
    this.hiddenFormFieldElements.set(formFieldElement, autofillFieldData);
    formFieldElement.addEventListener(EVENTS.FOCUS, this.handleHiddenFieldFocusEvent);
  }

  private removeHiddenFieldFallbackListener(formFieldElement: ElementWithOpId<FormFieldElement>) {
    formFieldElement.removeEventListener(EVENTS.FOCUS, this.handleHiddenFieldFocusEvent);
    this.hiddenFormFieldElements.delete(formFieldElement);
  }

  private handleHiddenFieldFocusEvent = (event: FocusEvent) => {
    const formFieldElement = event.target as ElementWithOpId<FormFieldElement>;
    const autofillFieldData = this.hiddenFormFieldElements.get(formFieldElement);
    if (autofillFieldData) {
      autofillFieldData.readonly = getAttributeBoolean(formFieldElement, "disabled");
      autofillFieldData.disabled = getAttributeBoolean(formFieldElement, "disabled");
      autofillFieldData.viewable = true;
      void this.setupAutofillInlineMenuListenerOnField(formFieldElement, autofillFieldData);
    }

    this.removeHiddenFieldFallbackListener(formFieldElement);
  };

  /**
   * Queries the background script for the autofill overlay visibility setting.
   * If the setting is not found, a default value of OnFieldFocus will be used
   * @private
   */
  private async getAutofillInlineMenuVisibility() {
    const overlayVisibility = await this.sendExtensionMessage("getAutofillInlineMenuVisibility");
    this.inlineMenuVisibility = overlayVisibility || AutofillOverlayVisibility.OnFieldFocus;
  }

  /**
   * Sets up event listeners that facilitate repositioning
   * the autofill overlay on scroll or resize.
   */
  private setOverlayRepositionEventListeners() {
    globalThis.addEventListener(EVENTS.SCROLL, this.handleOverlayRepositionEvent, {
      capture: true,
    });
    globalThis.addEventListener(EVENTS.RESIZE, this.handleOverlayRepositionEvent);
  }

  /**
   * Removes the listeners that facilitate repositioning
   * the autofill overlay on scroll or resize.
   */
  private removeOverlayRepositionEventListeners() {
    globalThis.removeEventListener(EVENTS.SCROLL, this.handleOverlayRepositionEvent, {
      capture: true,
    });
    globalThis.removeEventListener(EVENTS.RESIZE, this.handleOverlayRepositionEvent);
  }

  /**
   * Handles the resize or scroll events that enact
   * repositioning of the overlay.
   */
  private handleOverlayRepositionEvent = async () => {
    this.rebuildSubFrameOffsets();

    if (!(await this.isInlineMenuButtonVisible()) && !(await this.isInlineMenuListVisible())) {
      return;
    }

    this.toggleAutofillInlineMenuHidden(true);
    this.clearUserInteractionEventTimeout();
    this.userInteractionEventTimeout = setTimeout(this.triggerOverlayRepositionUpdates, 750);
  };

  private rebuildSubFrameOffsets() {
    this.clearRecalculateSubFrameOffsetsTimeout();
    this.recalculateSubFrameOffsetsTimeout = setTimeout(
      () => void this.sendExtensionMessage("rebuildSubFrameOffsets"),
      150,
    );
  }

  /**
   * Triggers the overlay reposition updates. This method ensures that the overlay elements
   * are correctly positioned when the viewport scrolls or repositions.
   */
  private triggerOverlayRepositionUpdates = async () => {
    if (!this.recentlyFocusedFieldIsCurrentlyFocused()) {
      this.toggleAutofillInlineMenuHidden(false, true);
      void this.sendExtensionMessage("closeAutofillInlineMenu", {
        forceCloseAutofillInlineMenu: true,
      });
      return;
    }

    await this.updateMostRecentlyFocusedField(this.mostRecentlyFocusedField);
    this.updateAutofillInlineMenuElementsPosition();
    setTimeout(async () => {
      this.toggleAutofillInlineMenuHidden(false);
      if (
        await this.hideAutofillInlineMenuListOnFilledField(
          this.mostRecentlyFocusedField as FillableFormFieldElement,
        )
      ) {
        void this.sendExtensionMessage("closeAutofillInlineMenu", {
          overlayElement: AutofillOverlayElement.List,
          forceCloseAutofillInlineMenu: true,
        });
      }
    }, 50);
    this.clearUserInteractionEventTimeout();

    if (this.isFocusedFieldWithinViewportBounds()) {
      return;
    }

    void this.sendExtensionMessage("closeAutofillInlineMenu", {
      forceCloseAutofillInlineMenu: true,
    });
  };

  /**
   * Clears the user interaction event timeout. This is used to ensure that
   * the overlay is not repositioned while the user is interacting with it.
   */
  private clearUserInteractionEventTimeout() {
    if (this.userInteractionEventTimeout) {
      clearTimeout(this.userInteractionEventTimeout);
    }
  }

  private clearRecalculateSubFrameOffsetsTimeout() {
    if (this.recalculateSubFrameOffsetsTimeout) {
      clearTimeout(this.recalculateSubFrameOffsetsTimeout);
    }
  }

  private isFocusedFieldWithinViewportBounds() {
    const focusedFieldRectsTop = this.focusedFieldData?.focusedFieldRects?.top;
    return (
      focusedFieldRectsTop &&
      focusedFieldRectsTop > 0 &&
      focusedFieldRectsTop < globalThis.innerHeight + globalThis.scrollY
    );
  }

  private async hideAutofillInlineMenuListOnFilledField(
    formFieldElement?: FillableFormFieldElement,
  ): Promise<boolean> {
    return (
      formFieldElement?.value &&
      ((await this.isInlineMenuCiphersPopulated()) || !this.isUserAuthed())
    );
  }

  /**
   * Sets up global event listeners and the mutation
   * observer to facilitate required changes to the
   * overlay elements.
   */
  private setupGlobalEventListeners = () => {
    globalThis.addEventListener(EVENTS.MESSAGE, this.handleWindowMessageEvent);
    globalThis.document.addEventListener(EVENTS.VISIBILITYCHANGE, this.handleVisibilityChangeEvent);
    globalThis.addEventListener(EVENTS.FOCUSOUT, this.handleFormFieldBlurEvent);
    this.setOverlayRepositionEventListeners();
  };

  /**
   * Handles the visibility change event. This method will remove the
   * autofill overlay if the document is not visible.
   */
  private handleVisibilityChangeEvent = () => {
    if (!this.mostRecentlyFocusedField || document.visibilityState === "visible") {
      return;
    }

    this.mostRecentlyFocusedField = null;
    void this.sendExtensionMessage("closeAutofillInlineMenu", {
      forceCloseAutofillInlineMenu: true,
    });
  };

  /**
   * Gets the root node of the passed element and returns the active element within that root node.
   *
   * @param element - The element to get the root node active element for.
   */
  private getRootNodeActiveElement(element: Element): Element {
    if (!element) {
      return null;
    }

    const documentRoot = element.getRootNode() as ShadowRoot | Document;
    return documentRoot?.activeElement;
  }

  private async getSubFrameOffsets(
    message: AutofillExtensionMessage,
  ): Promise<SubFrameOffsetData | null> {
    const { subFrameUrl } = message;
    const subFrameUrlWithoutTrailingSlash = subFrameUrl?.replace(/\/$/, "");

    let iframeElement: HTMLIFrameElement | null = null;
    const iframeElements = document.querySelectorAll(
      `iframe[src="${subFrameUrl}"], iframe[src="${subFrameUrlWithoutTrailingSlash}"]`,
    ) as NodeListOf<HTMLIFrameElement>;
    if (iframeElements.length === 1) {
      iframeElement = iframeElements[0];
    }

    if (!iframeElement) {
      return null;
    }

    return this.calculateSubFrameOffsets(iframeElement, subFrameUrl);
  }

  private calculateSubFrameOffsets(
    iframeElement: HTMLIFrameElement,
    subFrameUrl?: string,
    frameId?: number,
  ): SubFrameOffsetData {
    const iframeRect = iframeElement.getBoundingClientRect();
    const iframeStyles = globalThis.getComputedStyle(iframeElement);
    const paddingLeft = parseInt(iframeStyles.getPropertyValue("padding-left"));
    const paddingTop = parseInt(iframeStyles.getPropertyValue("padding-top"));
    const borderWidthLeft = parseInt(iframeStyles.getPropertyValue("border-left-width"));
    const borderWidthTop = parseInt(iframeStyles.getPropertyValue("border-top-width"));

    return {
      url: subFrameUrl,
      frameId,
      top: iframeRect.top + paddingTop + borderWidthTop,
      left: iframeRect.left + paddingLeft + borderWidthLeft,
    };
  }

  private getSubFrameOffsetsFromWindowMessage(message: any) {
    globalThis.parent.postMessage(
      {
        command: "calculateSubFramePositioning",
        subFrameData: {
          url: window.location.href,
          frameId: message.subFrameId,
          left: 0,
          top: 0,
        },
      },
      "*",
    );
  }

  private handleWindowMessageEvent = (event: MessageEvent) => {
    if (event.data?.command !== "calculateSubFramePositioning") {
      return;
    }

    this.calculateSubFramePositioning(event);
  };

  private calculateSubFramePositioning = (event: MessageEvent) => {
    const subFrameData = event.data.subFrameData;
    let subFrameOffsets: SubFrameOffsetData;
    const iframes = document.querySelectorAll("iframe");
    for (let i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow === event.source) {
        const iframeElement = iframes[i];
        subFrameOffsets = this.calculateSubFrameOffsets(
          iframeElement,
          subFrameData.url,
          subFrameData.frameId,
        );

        subFrameData.top += subFrameOffsets.top;
        subFrameData.left += subFrameOffsets.left;

        break;
      }
    }

    if (globalThis.window.self !== globalThis.window.top) {
      globalThis.parent.postMessage({ command: "calculateSubFramePositioning", subFrameData }, "*");
      return;
    }

    void sendExtensionMessage("updateSubFrameData", {
      subFrameData,
    });
  };

  private updateAutofillInlineMenuVisibility({ data }: AutofillExtensionMessage) {
    if (isNaN(data?.inlineMenuVisibility)) {
      return;
    }

    this.inlineMenuVisibility = data.inlineMenuVisibility;
  }

  private async isFieldCurrentlyFilling() {
    return (await this.sendExtensionMessage("checkIsFieldCurrentlyFilling")) === true;
  }

  private async isInlineMenuButtonVisible() {
    return (await this.sendExtensionMessage("checkIsAutofillInlineMenuButtonVisible")) === true;
  }

  private async isInlineMenuListVisible() {
    return (await this.sendExtensionMessage("checkIsAutofillInlineMenuListVisible")) === true;
  }

  private async isInlineMenuCiphersPopulated() {
    return (await this.sendExtensionMessage("checkIsOverlayLoginCiphersPopulated")) === true;
  }

  /**
   * Destroys the autofill overlay content service. This method will
   * disconnect the mutation observers and remove all event listeners.
   */
  destroy() {
    this.clearUserInteractionEventTimeout();
    this.formFieldElements.forEach((formFieldElement) => {
      this.removeCachedFormFieldEventListeners(formFieldElement);
      formFieldElement.removeEventListener(EVENTS.BLUR, this.handleFormFieldBlurEvent);
      formFieldElement.removeEventListener(EVENTS.KEYUP, this.handleFormFieldKeyupEvent);
      this.formFieldElements.delete(formFieldElement);
    });
    globalThis.document.removeEventListener(
      EVENTS.VISIBILITYCHANGE,
      this.handleVisibilityChangeEvent,
    );
    globalThis.removeEventListener(EVENTS.FOCUSOUT, this.handleFormFieldBlurEvent);
    this.removeOverlayRepositionEventListeners();
  }
}

export default AutofillOverlayContentService;
