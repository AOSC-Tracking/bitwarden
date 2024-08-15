import { NgModule } from "@angular/core";
import { Route, RouterModule, Routes } from "@angular/router";

import { unauthUiRefreshSwap } from "@bitwarden/angular/auth/functions/unauth-ui-refresh-route-swap";
import {
  authGuard,
  lockGuard,
  redirectGuard,
  tdeDecryptionRequiredGuard,
  unauthGuardFn,
} from "@bitwarden/angular/auth/guards";
import { canAccessFeature } from "@bitwarden/angular/platform/guard/feature-flag.guard";
import {
  AnonLayoutWrapperComponent,
  AnonLayoutWrapperData,
  PasswordHintComponent,
  RegistrationFinishComponent,
  RegistrationStartComponent,
  RegistrationStartSecondaryComponent,
  RegistrationStartSecondaryComponentData,
  SetPasswordJitComponent,
  RegistrationLinkExpiredComponent,
  LockIcon,
} from "@bitwarden/auth/angular";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";

import { twofactorRefactorSwap } from "../../../../libs/angular/src/utils/two-factor-component-refactor-route-swap";
import { flagEnabled, Flags } from "../utils/flags";

import { VerifyRecoverDeleteOrgComponent } from "./admin-console/organizations/manage/verify-recover-delete-org.component";
import { AcceptFamilySponsorshipComponent } from "./admin-console/organizations/sponsorships/accept-family-sponsorship.component";
import { FamiliesForEnterpriseSetupComponent } from "./admin-console/organizations/sponsorships/families-for-enterprise-setup.component";
import { VerifyRecoverDeleteProviderComponent } from "./admin-console/providers/verify-recover-delete-provider.component";
import { CreateOrganizationComponent } from "./admin-console/settings/create-organization.component";
import { deepLinkGuard } from "./auth/guards/deep-link.guard";
import { HintComponent } from "./auth/hint.component";
import { LockComponent } from "./auth/lock.component";
import { LoginDecryptionOptionsComponent } from "./auth/login/login-decryption-options/login-decryption-options.component";
import { LoginViaAuthRequestComponent } from "./auth/login/login-via-auth-request.component";
import { LoginViaWebAuthnComponent } from "./auth/login/login-via-webauthn/login-via-webauthn.component";
import { LoginComponent } from "./auth/login/login.component";
import { AcceptOrganizationComponent } from "./auth/organization-invite/accept-organization.component";
import { RecoverDeleteComponent } from "./auth/recover-delete.component";
import { RecoverTwoFactorComponent } from "./auth/recover-two-factor.component";
import { RemovePasswordComponent } from "./auth/remove-password.component";
import { SetPasswordComponent } from "./auth/set-password.component";
import { AccountComponent } from "./auth/settings/account/account.component";
import { EmergencyAccessComponent } from "./auth/settings/emergency-access/emergency-access.component";
import { EmergencyAccessViewComponent } from "./auth/settings/emergency-access/view/emergency-access-view.component";
import { SecurityRoutingModule } from "./auth/settings/security/security-routing.module";
import { SsoComponent } from "./auth/sso.component";
import { CompleteTrialInitiationComponent } from "./auth/trial-initiation/complete-trial-initiation/complete-trial-initiation.component";
import { freeTrialTextResolver } from "./auth/trial-initiation/complete-trial-initiation/resolver/free-trial-text.resolver";
import { TrialInitiationComponent } from "./auth/trial-initiation/trial-initiation.component";
import { TwoFactorAuthComponent } from "./auth/two-factor-auth.component";
import { TwoFactorComponent } from "./auth/two-factor.component";
import { UpdatePasswordComponent } from "./auth/update-password.component";
import { UpdateTempPasswordComponent } from "./auth/update-temp-password.component";
import { VerifyEmailTokenComponent } from "./auth/verify-email-token.component";
import { VerifyRecoverDeleteComponent } from "./auth/verify-recover-delete.component";
import { SponsoredFamiliesComponent } from "./billing/settings/sponsored-families.component";
import { EnvironmentSelectorComponent } from "./components/environment-selector/environment-selector.component";
import { DataProperties } from "./core";
import { FrontendLayoutComponent } from "./layouts/frontend-layout.component";
import { UserLayoutComponent } from "./layouts/user-layout.component";
import { RequestSMAccessComponent } from "./secrets-manager/secrets-manager-landing/request-sm-access.component";
import { SMLandingComponent } from "./secrets-manager/secrets-manager-landing/sm-landing.component";
import { DomainRulesComponent } from "./settings/domain-rules.component";
import { PreferencesComponent } from "./settings/preferences.component";
import { GeneratorComponent } from "./tools/generator.component";
import { ReportsModule } from "./tools/reports";
import { AccessComponent } from "./tools/send/access.component";
import { SendComponent } from "./tools/send/send.component";
import { VaultModule } from "./vault/individual-vault/vault.module";

const routes: Routes = [
  {
    path: "",
    component: FrontendLayoutComponent,
    data: { doNotSaveUrl: true } satisfies DataProperties,
    children: [
      {
        path: "",
        pathMatch: "full",
        children: [], // Children lets us have an empty component.
        canActivate: [redirectGuard()], // Redirects either to vault, login, or lock page.
      },
      {
        path: "login-with-device",
        component: LoginViaAuthRequestComponent,
        data: { titleId: "loginWithDevice" } satisfies DataProperties,
      },
      {
        path: "login-with-passkey",
        component: LoginViaWebAuthnComponent,
        data: { titleId: "loginWithPasskey" } satisfies DataProperties,
      },
      {
        path: "admin-approval-requested",
        component: LoginViaAuthRequestComponent,
        data: { titleId: "adminApprovalRequested" } satisfies DataProperties,
      },
      {
        path: "login-initiated",
        component: LoginDecryptionOptionsComponent,
        canActivate: [tdeDecryptionRequiredGuard()],
      },
      {
        path: "register",
        component: TrialInitiationComponent,
        canActivate: [unauthGuardFn()],
        data: { titleId: "createAccount" } satisfies DataProperties,
      },
      {
        path: "trial",
        redirectTo: "register",
        pathMatch: "full",
      },
      {
        path: "set-password",
        component: SetPasswordComponent,
        data: { titleId: "setMasterPassword" } satisfies DataProperties,
      },
      { path: "verify-email", component: VerifyEmailTokenComponent },
      {
        path: "accept-organization",
        canActivate: [deepLinkGuard()],
        component: AcceptOrganizationComponent,
        data: { titleId: "joinOrganization", doNotSaveUrl: false } satisfies DataProperties,
      },
      {
        path: "accept-families-for-enterprise",
        component: AcceptFamilySponsorshipComponent,
        canActivate: [deepLinkGuard()],
        data: { titleId: "acceptFamilySponsorship", doNotSaveUrl: false } satisfies DataProperties,
      },
      { path: "recover", pathMatch: "full", redirectTo: "recover-2fa" },
      {
        path: "verify-recover-delete-org",
        component: VerifyRecoverDeleteOrgComponent,
        canActivate: [unauthGuardFn()],
        data: { titleId: "deleteOrganization" },
      },
      {
        path: "verify-recover-delete-provider",
        component: VerifyRecoverDeleteProviderComponent,
        canActivate: [unauthGuardFn()],
        data: { titleId: "deleteAccount" } satisfies DataProperties,
      },
      {
        path: "send/:sendId/:key",
        component: AccessComponent,
        data: { titleId: "Bitwarden Send" } satisfies DataProperties,
      },
      {
        path: "update-temp-password",
        component: UpdateTempPasswordComponent,
        canActivate: [authGuard],
        data: { titleId: "updateTempPassword" } satisfies DataProperties,
      },
      {
        path: "update-password",
        component: UpdatePasswordComponent,
        canActivate: [authGuard],
        data: { titleId: "updatePassword" } satisfies DataProperties,
      },
      {
        path: "migrate-legacy-encryption",
        loadComponent: () =>
          import("./auth/migrate-encryption/migrate-legacy-encryption.component").then(
            (mod) => mod.MigrateFromLegacyEncryptionComponent,
          ),
      },
    ],
  },
  {
    path: "",
    component: AnonLayoutWrapperComponent,
    children: [
      {
        path: "signup",
        canActivate: [canAccessFeature(FeatureFlag.EmailVerification), unauthGuardFn()],
        data: { pageTitle: "createAccount", titleId: "createAccount" } satisfies DataProperties &
          AnonLayoutWrapperData,
        children: [
          {
            path: "",
            component: RegistrationStartComponent,
          },
          {
            path: "",
            component: RegistrationStartSecondaryComponent,
            outlet: "secondary",
            data: {
              loginRoute: "/login",
            } satisfies RegistrationStartSecondaryComponentData,
          },
        ],
      },
      {
        path: "finish-signup",
        canActivate: [canAccessFeature(FeatureFlag.EmailVerification), unauthGuardFn()],
        data: {
          pageTitle: "setAStrongPassword",
          pageSubtitle: "finishCreatingYourAccountBySettingAPassword",
          titleId: "setAStrongPassword",
        } satisfies DataProperties & AnonLayoutWrapperData,
        children: [
          {
            path: "",
            component: RegistrationFinishComponent,
          },
        ],
      },
      ...unauthUiRefreshSwap(
        HintComponent,
        PasswordHintComponent,
        {
          path: "hint",
          canActivate: [unauthGuardFn()],
          data: {
            pageTitle: "passwordHint",
            titleId: "passwordHint",
          },
          children: [
            { path: "", component: HintComponent },
            {
              path: "",
              component: EnvironmentSelectorComponent,
              outlet: "environment-selector",
            },
          ],
        },
        {
          path: "",
          children: [
            {
              path: "hint",
              canActivate: [unauthGuardFn()],
              data: {
                pageTitle: "requestPasswordHint",
                pageSubtitle: "enterYourAccountEmailAddressAndYourPasswordHintWillBeSentToYou",
                state: "hint",
              },
              children: [
                { path: "", component: PasswordHintComponent },
                {
                  path: "",
                  component: EnvironmentSelectorComponent,
                  outlet: "environment-selector",
                },
              ],
            },
          ],
        },
      ),
      {
        path: "set-password-jit",
        canActivate: [canAccessFeature(FeatureFlag.EmailVerification)],
        component: SetPasswordJitComponent,
        data: {
          pageTitle: "joinOrganization",
          pageSubtitle: "finishJoiningThisOrganizationBySettingAMasterPassword",
        } satisfies AnonLayoutWrapperData,
      },
      {
        path: "signup-link-expired",
        canActivate: [canAccessFeature(FeatureFlag.EmailVerification), unauthGuardFn()],
        data: {
          pageTitle: "expiredLink",
        } satisfies AnonLayoutWrapperData,
        children: [
          {
            path: "",
            component: RegistrationLinkExpiredComponent,
            data: {
              loginRoute: "/login",
            } satisfies RegistrationStartSecondaryComponentData,
          },
        ],
      },
      {
        path: "sso",
        canActivate: [unauthGuardFn()],
        data: {
          pageTitle: "enterpriseSingleSignOn",
          titleId: "enterpriseSingleSignOn",
        } satisfies DataProperties & AnonLayoutWrapperData,
        children: [
          {
            path: "",
            component: SsoComponent,
          },
          {
            path: "",
            component: EnvironmentSelectorComponent,
            outlet: "environment-selector",
          },
        ],
      },
      {
        path: "login",
        canActivate: [unauthGuardFn()],
        children: [
          {
            path: "",
            component: LoginComponent,
          },
          {
            path: "",
            component: EnvironmentSelectorComponent,
            outlet: "environment-selector",
          },
        ],
        data: {
          pageTitle: "logIn",
        },
      },
      {
        path: "lock",
        canActivate: [deepLinkGuard(), lockGuard()],
        children: [
          {
            path: "",
            component: LockComponent,
          },
        ],
        data: {
          pageTitle: "yourVaultIsLockedV2",
          pageIcon: LockIcon,
          showReadonlyHostname: true,
        } satisfies AnonLayoutWrapperData,
      },
      {
        path: "2fa",
        canActivate: [unauthGuardFn()],
        children: [
          ...twofactorRefactorSwap(TwoFactorComponent, TwoFactorAuthComponent, {
            path: "",
          }),
          {
            path: "",
            component: EnvironmentSelectorComponent,
            outlet: "environment-selector",
          },
        ],
        data: {
          pageTitle: "verifyIdentity",
        } satisfies DataProperties & AnonLayoutWrapperData,
      },
      {
        path: "recover-2fa",
        canActivate: [unauthGuardFn()],
        children: [
          {
            path: "",
            component: RecoverTwoFactorComponent,
          },
          {
            path: "",
            component: EnvironmentSelectorComponent,
            outlet: "environment-selector",
          },
        ],
        data: {
          pageTitle: "recoverAccountTwoStep",
          titleId: "recoverAccountTwoStep",
        } satisfies DataProperties & AnonLayoutWrapperData,
      },
      {
        path: "accept-emergency",
        canActivate: [deepLinkGuard()],
        data: {
          pageTitle: "emergencyAccess",
          titleId: "acceptEmergency",
          doNotSaveUrl: false,
        } satisfies DataProperties & AnonLayoutWrapperData,
        children: [
          {
            path: "",
            loadComponent: () =>
              import("./auth/emergency-access/accept/accept-emergency.component").then(
                (mod) => mod.AcceptEmergencyComponent,
              ),
          },
        ],
      },
      {
        path: "recover-delete",
        canActivate: [unauthGuardFn()],
        data: {
          pageTitle: "deleteAccount",
          titleId: "deleteAccount",
        } satisfies DataProperties & AnonLayoutWrapperData,
        children: [
          {
            path: "",
            component: RecoverDeleteComponent,
          },
          {
            path: "",
            component: EnvironmentSelectorComponent,
            outlet: "environment-selector",
          },
        ],
      },
      {
        path: "verify-recover-delete",
        canActivate: [unauthGuardFn()],
        data: {
          pageTitle: "deleteAccount",
          titleId: "deleteAccount",
        } satisfies DataProperties & AnonLayoutWrapperData,
        children: [
          {
            path: "",
            component: VerifyRecoverDeleteComponent,
          },
        ],
      },
      {
        path: "remove-password",
        component: RemovePasswordComponent,
        canActivate: [authGuard],
        data: {
          pageTitle: "removeMasterPassword",
          titleId: "removeMasterPassword",
        } satisfies DataProperties & AnonLayoutWrapperData,
      },
      {
        path: "trial-initiation",
        canActivate: [canAccessFeature(FeatureFlag.EmailVerification), unauthGuardFn()],
        component: CompleteTrialInitiationComponent,
        resolve: {
          pageTitle: freeTrialTextResolver,
        },
        data: {
          maxWidth: "3xl",
        } satisfies AnonLayoutWrapperData,
      },
      {
        path: "secrets-manager-trial-initiation",
        canActivate: [canAccessFeature(FeatureFlag.EmailVerification), unauthGuardFn()],
        component: CompleteTrialInitiationComponent,
        resolve: {
          pageTitle: freeTrialTextResolver,
        },
        data: {
          maxWidth: "3xl",
        } satisfies AnonLayoutWrapperData,
      },
    ],
  },
  {
    path: "",
    component: UserLayoutComponent,
    canActivate: [deepLinkGuard(), authGuard],
    children: [
      {
        path: "vault",
        loadChildren: () => VaultModule,
      },
      {
        path: "sends",
        component: SendComponent,
        data: { titleId: "send" } satisfies DataProperties,
      },
      {
        path: "sm-landing",
        component: SMLandingComponent,
        data: { titleId: "moreProductsFromBitwarden" },
      },
      {
        path: "request-sm-access",
        component: RequestSMAccessComponent,
        data: { titleId: "requestAccessToSecretsManager" },
      },
      {
        path: "create-organization",
        component: CreateOrganizationComponent,
        data: { titleId: "newOrganization" } satisfies DataProperties,
      },
      {
        path: "settings",
        children: [
          { path: "", pathMatch: "full", redirectTo: "account" },
          {
            path: "account",
            component: AccountComponent,
            data: { titleId: "myAccount" } satisfies DataProperties,
          },
          {
            path: "preferences",
            component: PreferencesComponent,
            data: { titleId: "preferences" } satisfies DataProperties,
          },
          {
            path: "security",
            loadChildren: () => SecurityRoutingModule,
          },
          {
            path: "domain-rules",
            component: DomainRulesComponent,
            data: { titleId: "domainRules" } satisfies DataProperties,
          },
          {
            path: "subscription",
            loadChildren: () =>
              import("./billing/individual/individual-billing.module").then(
                (m) => m.IndividualBillingModule,
              ),
          },
          {
            path: "emergency-access",
            children: [
              {
                path: "",
                component: EmergencyAccessComponent,
                data: { titleId: "emergencyAccess" } satisfies DataProperties,
              },
              {
                path: ":id",
                component: EmergencyAccessViewComponent,
                data: { titleId: "emergencyAccess" } satisfies DataProperties,
              },
            ],
          },
          {
            path: "sponsored-families",
            component: SponsoredFamiliesComponent,
            data: { titleId: "sponsoredFamilies" } satisfies DataProperties,
          },
        ],
      },
      {
        path: "tools",
        canActivate: [authGuard],
        children: [
          { path: "", pathMatch: "full", redirectTo: "generator" },
          {
            path: "import",
            loadComponent: () =>
              import("./tools/import/import-web.component").then((mod) => mod.ImportWebComponent),
            data: {
              titleId: "importData",
            } satisfies DataProperties,
          },
          {
            path: "export",
            loadComponent: () =>
              import("./tools/vault-export/export-web.component").then(
                (mod) => mod.ExportWebComponent,
              ),
            data: {
              titleId: "exportVault",
            } satisfies DataProperties,
          },
          {
            path: "generator",
            component: GeneratorComponent,
            data: { titleId: "generator" } satisfies DataProperties,
          },
        ],
      },
      {
        path: "reports",
        loadChildren: () => ReportsModule,
      },
      { path: "setup/families-for-enterprise", component: FamiliesForEnterpriseSetupComponent },
    ],
  },
  {
    path: "organizations",
    loadChildren: () =>
      import("./admin-console/organizations/organization.module").then((m) => m.OrganizationModule),
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      useHash: true,
      paramsInheritanceStrategy: "always",
      // enableTracing: true,
    }),
  ],
  exports: [RouterModule],
})
export class OssRoutingModule {}

export function buildFlaggedRoute(flagName: keyof Flags, route: Route): Route {
  return flagEnabled(flagName)
    ? route
    : {
        path: route.path,
        redirectTo: "/",
      };
}
