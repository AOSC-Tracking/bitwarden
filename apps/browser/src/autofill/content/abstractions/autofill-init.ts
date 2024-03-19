import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";

import { SubFrameOffsetData } from "../../background/abstractions/overlay.background";
import AutofillScript from "../../models/autofill-script";

type AutofillExtensionMessage = {
  command: string;
  tab?: chrome.tabs.Tab;
  sender?: string;
  fillScript?: AutofillScript;
  url?: string;
  subFrameUrl?: string;
  pageDetailsUrl?: string;
  ciphers?: any;
  data?: {
    authStatus?: AuthenticationStatus;
    isFocusingFieldElement?: boolean;
    isOverlayCiphersPopulated?: boolean;
    direction?: "previous" | "next";
    isOpeningFullOverlay?: boolean;
    forceCloseOverlay?: boolean;
    autofillOverlayVisibility?: number;
  };
};

type AutofillExtensionMessageParam = { message: AutofillExtensionMessage };

type AutofillExtensionMessageHandlers = {
  [key: string]: CallableFunction;
  collectPageDetails: ({ message }: AutofillExtensionMessageParam) => void;
  collectPageDetailsImmediately: ({ message }: AutofillExtensionMessageParam) => void;
  fillForm: ({ message }: AutofillExtensionMessageParam) => void;
  openAutofillOverlay: ({ message }: AutofillExtensionMessageParam) => void;
  closeAutofillOverlay: ({ message }: AutofillExtensionMessageParam) => void;
  addNewVaultItemFromOverlay: () => void;
  redirectOverlayFocusOut: ({ message }: AutofillExtensionMessageParam) => void;
  updateIsOverlayCiphersPopulated: ({ message }: AutofillExtensionMessageParam) => void;
  bgUnlockPopoutOpened: () => void;
  bgVaultItemRepromptPopoutOpened: () => void;
  updateAutofillOverlayVisibility: ({ message }: AutofillExtensionMessageParam) => void;
  getSubFrameOffsets: ({ message }: AutofillExtensionMessageParam) => Promise<SubFrameOffsetData>;
};

interface AutofillInit {
  init(): void;
  destroy(): void;
}

export { AutofillExtensionMessage, AutofillExtensionMessageHandlers, AutofillInit };
