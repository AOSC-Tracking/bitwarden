import { Component } from "@angular/core";

import { PremiumComponent as BasePremiumComponent } from "@bitwarden/angular/vault/components/premium.component";
import { ApiService } from "@bitwarden/common/abstractions/api.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@bitwarden/common/billing/abstractions/account/billing-account-profile-state.service";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService, ToastService } from "@bitwarden/components";

@Component({
  selector: "app-premium",
  templateUrl: "premium.component.html",
})
export class PremiumComponent extends BasePremiumComponent {
  constructor(
    i18nService: I18nService,
    platformUtilsService: PlatformUtilsService,
    apiService: ApiService,
    configService: ConfigService,
    logService: LogService,
    dialogService: DialogService,
    environmentService: EnvironmentService,
    billingAccountProfileStateService: BillingAccountProfileStateService,
    toastService: ToastService,
    accountService: AccountService,
  ) {
    super(
      i18nService,
      platformUtilsService,
      apiService,
      configService,
      logService,
      dialogService,
      environmentService,
      billingAccountProfileStateService,
      toastService,
      accountService,
    );
  }
}
