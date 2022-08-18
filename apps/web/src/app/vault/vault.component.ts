import {
  ChangeDetectorRef,
  Component,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewContainerRef,
} from "@angular/core";
import { ActivatedRoute, Params, Router } from "@angular/router";
import { first } from "rxjs/operators";

import { ModalService } from "@bitwarden/angular/services/modal.service";
import { CipherTypeFilter } from "@bitwarden/angular/vault/vault-filter/models/cipher-filter.model";
import { CollectionFilter } from "@bitwarden/angular/vault/vault-filter/models/collection-filter.model";
import { FolderFilter } from "@bitwarden/angular/vault/vault-filter/models/folder-filter.model";
import { OrganizationFilter } from "@bitwarden/angular/vault/vault-filter/models/organization-filter.model";
import {
  VaultFilterLabel,
  VaultFilterList,
} from "@bitwarden/angular/vault/vault-filter/models/vault-filter-section";
import { VaultFilter } from "@bitwarden/angular/vault/vault-filter/models/vault-filter.model";
import { BroadcasterService } from "@bitwarden/common/abstractions/broadcaster.service";
import { CipherService } from "@bitwarden/common/abstractions/cipher.service";
import { CryptoService } from "@bitwarden/common/abstractions/crypto.service";
import { I18nService } from "@bitwarden/common/abstractions/i18n.service";
import { MessagingService } from "@bitwarden/common/abstractions/messaging.service";
import { OrganizationService } from "@bitwarden/common/abstractions/organization.service";
import { PasswordRepromptService } from "@bitwarden/common/abstractions/passwordReprompt.service";
import { PlatformUtilsService } from "@bitwarden/common/abstractions/platformUtils.service";
import { StateService } from "@bitwarden/common/abstractions/state.service";
import { SyncService } from "@bitwarden/common/abstractions/sync.service";
import { TokenService } from "@bitwarden/common/abstractions/token.service";
import { CipherType } from "@bitwarden/common/enums/cipherType";
import { TreeNode } from "@bitwarden/common/models/domain/treeNode";
import { CipherView } from "@bitwarden/common/models/view/cipherView";

import { UpdateKeyComponent } from "../settings/update-key.component";

import { AddEditComponent } from "./add-edit.component";
import { AttachmentsComponent } from "./attachments.component";
import { CiphersComponent } from "./ciphers.component";
import { CollectionsComponent } from "./collections.component";
import { FolderAddEditComponent } from "./folder-add-edit.component";
import { ShareComponent } from "./share.component";
import { VaultService } from "./shared/vault.service";
import { OrganizationOptionsComponent } from "./vault-filter/organization-filter/organization-options.component";
import { VaultFilterService } from "./vault-filter/shared/vault-filter.service";
import { VaultFilterComponent } from "./vault-filter/vault-filter.component";

const BroadcasterSubscriptionId = "VaultComponent";

@Component({
  selector: "app-vault",
  templateUrl: "vault.component.html",
})
export class VaultComponent implements OnInit, OnDestroy {
  @ViewChild("vaultFilter", { static: true }) filterComponent: VaultFilterComponent;
  @ViewChild(CiphersComponent, { static: true }) ciphersComponent: CiphersComponent;
  @ViewChild("attachments", { read: ViewContainerRef, static: true })
  attachmentsModalRef: ViewContainerRef;
  @ViewChild("folderAddEdit", { read: ViewContainerRef, static: true })
  folderAddEditModalRef: ViewContainerRef;
  @ViewChild("cipherAddEdit", { read: ViewContainerRef, static: true })
  cipherAddEditModalRef: ViewContainerRef;
  @ViewChild("share", { read: ViewContainerRef, static: true }) shareModalRef: ViewContainerRef;
  @ViewChild("collections", { read: ViewContainerRef, static: true })
  collectionsModalRef: ViewContainerRef;
  @ViewChild("updateKeyTemplate", { read: ViewContainerRef, static: true })
  updateKeyModalRef: ViewContainerRef;

  showVerifyEmail = false;
  showBrowserOutdated = false;
  showUpdateKey = false;
  showPremiumCallout = false;
  trashCleanupWarning: string = null;
  activeFilter: VaultFilter = new VaultFilter();
  filters: VaultFilterList;

  constructor(
    private syncService: SyncService,
    private route: ActivatedRoute,
    private router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    private i18nService: I18nService,
    private modalService: ModalService,
    private tokenService: TokenService,
    private cryptoService: CryptoService,
    private messagingService: MessagingService,
    private platformUtilsService: PlatformUtilsService,
    private broadcasterService: BroadcasterService,
    private ngZone: NgZone,
    private stateService: StateService,
    private organizationService: OrganizationService,
    private vaultService: VaultService,
    private cipherService: CipherService,
    private passwordRepromptService: PasswordRepromptService,
    private vaultFilterService: VaultFilterService
  ) {}

  async ngOnInit() {
    this.showVerifyEmail = !(await this.tokenService.getEmailVerified());
    this.showBrowserOutdated = window.navigator.userAgent.indexOf("MSIE") !== -1;
    this.trashCleanupWarning = this.i18nService.t(
      this.platformUtilsService.isSelfHost()
        ? "trashCleanupWarningSelfHosted"
        : "trashCleanupWarning"
    );

    this.route.queryParams.pipe(first()).subscribe(async (params) => {
      await this.syncService.fullSync(false);
      const canAccessPremium = await this.stateService.getCanAccessPremium();
      this.showPremiumCallout =
        !this.showVerifyEmail && !canAccessPremium && !this.platformUtilsService.isSelfHost();

      this.reloadCollections();
      this.reloadOrganizations();
      this.showUpdateKey = !(await this.cryptoService.hasEncKey());

      const cipherId = getCipherIdFromParams(params);

      if (cipherId) {
        const cipherView = new CipherView();
        cipherView.id = cipherId;
        if (params.action === "clone") {
          await this.cloneCipher(cipherView);
        } else if (params.action === "edit") {
          await this.editCipher(cipherView);
        }
      }
      await this.ciphersComponent.reload();

      this.route.queryParams.subscribe(async (params) => {
        const cipherId = getCipherIdFromParams(params);
        if (cipherId) {
          if ((await this.cipherService.get(cipherId)) != null) {
            this.editCipherId(cipherId);
          } else {
            this.platformUtilsService.showToast(
              "error",
              this.i18nService.t("errorOccurred"),
              this.i18nService.t("unknownCipher")
            );
            this.router.navigate([], {
              queryParams: { itemId: null, cipherId: null },
              queryParamsHandling: "merge",
            });
          }
        }
      });

      this.broadcasterService.subscribe(BroadcasterSubscriptionId, (message: any) => {
        this.ngZone.run(async () => {
          switch (message.command) {
            case "syncCompleted":
              if (message.successfully) {
                await Promise.all([
                  this.reloadCollections(),
                  this.reloadOrganizations(),
                  this.ciphersComponent.load(this.ciphersComponent.filter),
                ]);
                this.changeDetectorRef.detectChanges();
              }
              break;
          }
        });
      });
    });

    const singleOrgPolicy = await this.vaultFilterService.checkForSingleOrganizationPolicy();
    const personalVaultPolicy = await this.vaultFilterService.checkForPersonalOwnershipPolicy();

    this.filters = {
      [VaultFilterLabel.OrganizationFilter]: {
        data$: await this.vaultFilterService.buildNestedOrganizations(),
        header: {
          showHeader: !(singleOrgPolicy && personalVaultPolicy),
          isSelectable: true,
        },
        action: this.applyOrganizationFilter,
        options: !personalVaultPolicy
          ? {
              component: OrganizationOptionsComponent,
            }
          : null,
        add: !singleOrgPolicy
          ? {
              text: "newOrganization",
              route: "/create-organization",
            }
          : null,
        divider: true,
      },
      [VaultFilterLabel.TypeFilter]: {
        data$: await this.vaultFilterService.buildNestedTypes(
          { id: "all", name: "allItems", type: "all", icon: "" },
          [
            {
              id: "favorites",
              name: this.i18nService.t("favorites"),
              type: "favorites",
              icon: "bwi-star",
            },
            {
              id: "login",
              name: this.i18nService.t("typeLogin"),
              type: CipherType.Login,
              icon: "bwi-globe",
            },
            {
              id: "card",
              name: this.i18nService.t("typeCard"),
              type: CipherType.Card,
              icon: "bwi-credit-card",
            },
            {
              id: "identity",
              name: this.i18nService.t("typeIdentity"),
              type: CipherType.Identity,
              icon: "bwi-id-card",
            },
            {
              id: "note",
              name: this.i18nService.t("typeSecureNote"),
              type: CipherType.SecureNote,
              icon: "bwi-sticky-note",
            },
          ]
        ),
        header: {
          showHeader: true,
          isSelectable: true,
          defaultSelection: true,
        },
        action: this.applyTypeFilter,
      },
      [VaultFilterLabel.FolderFilter]: {
        data$: await this.vaultFilterService.buildNestedFolders(),
        header: {
          showHeader: true,
          isSelectable: false,
        },
        action: await this.applyFolderFilter,
        edit: {
          text: "editFolder",
          action: this.editFolder,
        },
        add: {
          text: "Add Folder",
          action: this.addFolder,
        },
      },
      [VaultFilterLabel.CollectionFilter]: {
        data$: await this.vaultFilterService.buildCollections(),
        header: {
          showHeader: true,
          isSelectable: true,
        },
        action: this.applyCollectionFilter,
      },
      [VaultFilterLabel.TrashFilter]: {
        data$: this.vaultFilterService.buildTrash(),
        header: {
          showHeader: false,
          isSelectable: true,
        },
        action: this.applyTypeFilter,
      },
    };
  }

  get isShowingCards() {
    return (
      this.showBrowserOutdated ||
      this.showPremiumCallout ||
      this.showUpdateKey ||
      this.showVerifyEmail
    );
  }

  ngOnDestroy() {
    this.broadcasterService.unsubscribe(BroadcasterSubscriptionId);
  }

  async reloadOrganizations() {
    this.filters.organizationFilter.data$ =
      await this.vaultFilterService.buildNestedOrganizations();
  }

  async reloadCollections(orgNode?: TreeNode<OrganizationFilter>) {
    if (!orgNode || orgNode.node.id === "AllVaults") {
      this.activeFilter.selectedOrganizationNode = null;
      this.filters.collectionFilter.data$ = await this.vaultFilterService.buildCollections();
    } else {
      this.activeFilter.selectedOrganizationNode = orgNode;
      this.filters.collectionFilter.data$ = await this.vaultFilterService.buildCollections(
        orgNode.node.id
      );
    }
  }

  applyOrganizationFilter = async (orgNode: TreeNode<OrganizationFilter>): Promise<void> => {
    if (!orgNode.node.enabled) {
      this.platformUtilsService.showToast(
        "error",
        null,
        this.i18nService.t("disabledOrganizationFilterError")
      );
      return;
    }
    this.activeFilter.resetOrganization();
    await this.reloadCollections(orgNode);

    await this.vaultFilterService.ensureVaultFiltersAreExpanded();
    await this.applyVaultFilter();
  };

  applyTypeFilter = async (filterNode: TreeNode<CipherTypeFilter>): Promise<void> => {
    this.activeFilter.resetFilter();
    this.activeFilter.selectedCipherTypeNode = filterNode;
    await this.applyVaultFilter();
  };

  applyFolderFilter = async (folderNode: TreeNode<FolderFilter>): Promise<void> => {
    this.activeFilter.resetFilter();
    this.activeFilter.selectedFolderNode = folderNode;
    await this.applyVaultFilter();
  };

  applyCollectionFilter = async (collectionNode: TreeNode<CollectionFilter>): Promise<void> => {
    this.activeFilter.resetFilter();
    this.activeFilter.selectedCollectionNode = collectionNode;
    await this.applyVaultFilter();
  };

  private async applyVaultFilter() {
    this.ciphersComponent.showAddNew =
      this.activeFilter.selectedCipherTypeNode?.node.id !== "trash";
    await this.ciphersComponent.reload(
      this.activeFilter.buildFilter(),
      this.activeFilter.selectedCipherTypeNode?.node.id === "trash"
    );
    this.filterComponent.searchPlaceholder = this.vaultService.calculateSearchBarLocalizationString(
      this.activeFilter
    );
    this.go();
  }

  addFolder = async (): Promise<void> => {
    const [modal] = await this.modalService.openViewRef(
      FolderAddEditComponent,
      this.folderAddEditModalRef,
      (comp) => {
        comp.folderId = null;
        comp.onSavedFolder.subscribe(async () => {
          modal.close();
        });
      }
    );
  };

  editFolder = async (folder: FolderFilter): Promise<void> => {
    const [modal] = await this.modalService.openViewRef(
      FolderAddEditComponent,
      this.folderAddEditModalRef,
      (comp) => {
        comp.folderId = folder.id;
        comp.onSavedFolder.subscribe(async () => {
          modal.close();
        });
        comp.onDeletedFolder.subscribe(async () => {
          modal.close();
        });
      }
    );
  };

  filterSearchText(searchText: string) {
    this.ciphersComponent.searchText = searchText;
    this.ciphersComponent.search(200);
  }

  async editCipherAttachments(cipher: CipherView) {
    const canAccessPremium = await this.stateService.getCanAccessPremium();
    if (cipher.organizationId == null && !canAccessPremium) {
      this.messagingService.send("premiumRequired");
      return;
    } else if (cipher.organizationId != null) {
      const org = await this.organizationService.get(cipher.organizationId);
      if (org != null && (org.maxStorageGb == null || org.maxStorageGb === 0)) {
        this.messagingService.send("upgradeOrganization", {
          organizationId: cipher.organizationId,
        });
        return;
      }
    }

    let madeAttachmentChanges = false;
    const [modal] = await this.modalService.openViewRef(
      AttachmentsComponent,
      this.attachmentsModalRef,
      (comp) => {
        comp.cipherId = cipher.id;
        comp.onUploadedAttachment.subscribe(() => (madeAttachmentChanges = true));
        comp.onDeletedAttachment.subscribe(() => (madeAttachmentChanges = true));
        comp.onReuploadedAttachment.subscribe(() => (madeAttachmentChanges = true));
      }
    );

    modal.onClosed.subscribe(async () => {
      if (madeAttachmentChanges) {
        await this.ciphersComponent.refresh();
      }
      madeAttachmentChanges = false;
    });
  }

  async shareCipher(cipher: CipherView) {
    const [modal] = await this.modalService.openViewRef(
      ShareComponent,
      this.shareModalRef,
      (comp) => {
        comp.cipherId = cipher.id;
        comp.onSharedCipher.subscribe(async () => {
          modal.close();
          await this.ciphersComponent.refresh();
        });
      }
    );
  }

  async editCipherCollections(cipher: CipherView) {
    const [modal] = await this.modalService.openViewRef(
      CollectionsComponent,
      this.collectionsModalRef,
      (comp) => {
        comp.cipherId = cipher.id;
        comp.onSavedCollections.subscribe(async () => {
          modal.close();
          await this.ciphersComponent.refresh();
        });
      }
    );
  }

  async addCipher() {
    const component = await this.editCipher(null);
    if (this.activeFilter.selectedCipherTypeNode.node.type in CipherType) {
      component.type = this.activeFilter.selectedCipherTypeNode?.node.type as CipherType;
    }
    const selectedCol = this.activeFilter.selectedCollectionNode?.node;
    if (selectedCol && selectedCol.id && selectedCol.id != "AllCollections") {
      component.organizationId = selectedCol.organizationId;
      component.collectionIds = [selectedCol.id];
    }
    if (this.activeFilter.selectedFolderNode) {
      component.folderId = this.activeFilter.selectedFolderNode.node.id;
    }
    if (this.activeFilter.selectedOrganizationNode) {
      component.organizationId = this.activeFilter.selectedOrganizationNode.node.id;
    }
  }

  async editCipher(cipher: CipherView) {
    return this.editCipherId(cipher?.id);
  }

  async editCipherId(id: string) {
    const cipher = await this.cipherService.get(id);
    if (cipher != null && cipher.reprompt != 0) {
      if (!(await this.passwordRepromptService.showPasswordPrompt())) {
        this.go({ cipherId: null, itemId: null });
        return;
      }
    }

    const [modal, childComponent] = await this.modalService.openViewRef(
      AddEditComponent,
      this.cipherAddEditModalRef,
      (comp) => {
        comp.cipherId = id;
        comp.onSavedCipher.subscribe(async () => {
          modal.close();
          await this.ciphersComponent.refresh();
        });
        comp.onDeletedCipher.subscribe(async () => {
          modal.close();
          await this.ciphersComponent.refresh();
        });
        comp.onRestoredCipher.subscribe(async () => {
          modal.close();
          await this.ciphersComponent.refresh();
        });
      }
    );

    modal.onClosedPromise().then(() => {
      this.go({ cipherId: null, itemId: null });
    });

    return childComponent;
  }

  async cloneCipher(cipher: CipherView) {
    const component = await this.editCipher(cipher);
    component.cloneMode = true;
  }

  async updateKey() {
    await this.modalService.openViewRef(UpdateKeyComponent, this.updateKeyModalRef);
  }

  private go(queryParams: any = null) {
    if (queryParams == null) {
      queryParams = {
        favorites:
          this.activeFilter.selectedCipherTypeNode?.node.type === "favorites" ? true : null,
        type: this.activeFilter.selectedCipherTypeNode?.node.type,
        folderId: this.activeFilter.selectedFolderNode?.node.id,
        collectionId: this.activeFilter.selectedCollectionNode?.node.id,
        deleted: this.activeFilter.selectedCipherTypeNode?.node.type === "trash" ? true : null,
      };
    }

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: queryParams,
      queryParamsHandling: "merge",
      replaceUrl: true,
    });
  }
}

/**
 * Allows backwards compatibility with
 * old links that used the original `cipherId` param
 */
const getCipherIdFromParams = (params: Params): string => {
  return params["itemId"] || params["cipherId"];
};
