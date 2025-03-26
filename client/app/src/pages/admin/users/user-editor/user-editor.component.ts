import {Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild, inject} from "@angular/core";
import {NgForm, FormsModule} from "@angular/forms";
import {NgbModal, NgbTooltipModule} from "@ng-bootstrap/ng-bootstrap";
import {AppDataService} from "@app/app-data.service";
import {AuthenticationService} from "@app/services/helper/authentication.service";
import {Constants} from "@app/shared/constants/constants";
import {DeleteConfirmationComponent} from "@app/shared/modals/delete-confirmation/delete-confirmation.component";
import {NodeResolver} from "@app/shared/resolvers/node.resolver";
import {PreferenceResolver} from "@app/shared/resolvers/preference.resolver";
import {UtilsService} from "@app/shared/services/utils.service";
import {Observable} from "rxjs";
import {User, UserProfile} from "@app/models/resolvers/user-resolver-model";
import {nodeResolverModel} from "@app/models/resolvers/node-resolver-model";
import {preferenceResolverModel} from "@app/models/resolvers/preference-resolver-model";
import {NgClass, DatePipe, CommonModule} from "@angular/common";
import {ImageUploadDirective} from "@app/shared/directive/image-upload.directive";
import {PasswordStrengthValidatorDirective} from "@app/shared/directive/password-strength-validator.directive";
import {PasswordMeterComponent} from "@app/shared/components/password-meter/password-meter.component";
import {TranslatorPipe} from "@app/shared/pipes/translate";
import {FilterPipe} from "@app/shared/pipes/filter.pipe";
import {CryptoService} from "@app/shared/services/crypto.service";

@Component({
    selector: "src-user-editor",
    templateUrl: "./user-editor.component.html",
    standalone: true,
    imports: [CommonModule, ImageUploadDirective, FormsModule, PasswordStrengthValidatorDirective, NgbTooltipModule, NgClass, PasswordMeterComponent, DatePipe, TranslatorPipe, FilterPipe]
})
export class UserEditorComponent implements OnInit {
  private modalService = inject(NgbModal);
  private appDataService = inject(AppDataService);
  private preference = inject(PreferenceResolver);
  private authenticationService = inject(AuthenticationService);
  private nodeResolver = inject(NodeResolver);
  private utilsService = inject(UtilsService);
  private cryptoService = inject(CryptoService);

  @Input() user: User;
  @Input() users: User[];
  @Input() index: number;
  @Input() editUser: NgForm;
  @Input() is_profile: boolean;
  @Input() userProfiles: UserProfile[];
  @Input() profiles: UserProfile[];
  @Output() dataToParent = new EventEmitter<string>();
  @ViewChild("uploader") uploaderInput: ElementRef;
  editing = false;
  defualt_custom:boolean = true;
  setPasswordArgs: { user_id: string, password: string };
  changePasswordArgs: { password_change_needed: string };
  passwordStrengthScore: number = 0;
  defualtUsersArr = ['Admin', 'Analyst', 'Custodian', 'Receiver'];
  profile_id:string;
  nodeData: nodeResolverModel;
  preferenceData: preferenceResolverModel;
  authenticationData: AuthenticationService;
  appServiceData: AppDataService;
  protected readonly Constants = Constants;

  ngOnInit(): void {
    if (this.nodeResolver.dataModel) {
      this.nodeData = this.nodeResolver.dataModel;
    }
    if (this.preference.dataModel) {
      this.preferenceData = this.preference.dataModel;
    }
    if (this.authenticationService) {
      this.authenticationData = this.authenticationService;
    }
    if (this.appDataService) {
      this.appServiceData = this.appDataService;
    }
    this.setPasswordArgs = {
      user_id: this.user.id,
      password: ""
    };
    this.changePasswordArgs = {
      password_change_needed: ""
    };
    this.defualt_custom = this.userProfiles.filter(user => user.id == this.user.profile_id)[0].custom;
    this.profile_id = this.user.profile_id;
    this.user.profile_id = this.userProfiles.filter(user => user.id == this.user.profile_id)[0].custom ? this.user.profile_id : 'defualt';
  }

  toggleEditing() {
    this.editing = !this.editing;
  }

  onPasswordStrengthChange(score: number) {
    this.passwordStrengthScore = score;
  }

  disable2FA(user: User ) {
    this.utilsService.runAdminOperation("disable_2fa", {"value": user.id}, true).subscribe();
  }

  async setPassword(setPasswordArgs: { user_id: string, password: string }) {
    this.appDataService.updateShowLoadingPanel(true);
    setPasswordArgs.password = await this.cryptoService.hashArgon2(setPasswordArgs.password, this.user.salt);
    this.appDataService.updateShowLoadingPanel(false);

    this.utilsService.runAdminOperation("set_user_password", setPasswordArgs, false).subscribe();
    this.user.newpassword = false;
    this.setPasswordArgs.password = "";
  }

  saveUser(userData: User) {
    const user = userData;
    if (user.pgp_key_remove) {
      user.pgp_key_public = "";
    }
    if (user.pgp_key_public !== "") {
      user.pgp_key_remove = false;
    }
    userData.custom = userData.profile_id !== "defualt" ? true : false;
    userData.profile_id = userData.profile_id !== "defualt" ? userData.profile_id : this.profile_id;
    const profile_User = this.userProfiles.filter(user => user.id == userData.profile_id);
    userData.profile_name = profile_User[0].name
    userData.profile_role = profile_User[0].role
    if(!this.defualt_custom && (this.profile_id !== profile_User[0].id)){
      userData.defualt_profile_id = this.profile_id
    }
    return this.utilsService.updateAdminUser(userData.id,userData).subscribe({
      next:()=>{
        this.sendDataToParent();
      },
      error:()=>{
        if (this.uploaderInput) {
          this.uploaderInput.nativeElement.value = "";
        }
      }
    });
  }

  sendDataToParent() {
    this.dataToParent.emit();
  }

  deleteUser(user: User) {
    this.openConfirmableModalDialog(user, "").subscribe();
  }

  openConfirmableModalDialog(arg: User, scope: any): Observable<string> {
    scope = !scope ? this : scope;
    return new Observable((observer) => {
      const modalRef = this.modalService.open(DeleteConfirmationComponent, {backdrop: 'static', keyboard: false});
      modalRef.componentInstance.arg = arg;
      modalRef.componentInstance.scope = scope;

      modalRef.componentInstance.confirmFunction = () => {
        observer.complete()
        let url = "api/admin/users/";
        const profile = this.userProfiles.filter(user => user.id == (arg.profile_id !== "defualt" ? arg.profile_id : this.profile_id));
        if(!profile[0].custom){
          return this.utilsService.deleteAdminUser(arg.id,url,this.is_profile,profile[0].id).subscribe(_ => {
            this.utilsService.deleteResource(this.users, arg);
          });
        }
        else{
          return this.utilsService.deleteAdminUser(arg.id,url,this.is_profile).subscribe(_ => {
            this.utilsService.deleteResource(this.users, arg);
          });
        }
      };
    });
  }

  resetUserPassword(user: User) {
    this.utilsService.runAdminOperation("send_password_reset_email", {"value": user.id}, true).subscribe();
  }

  loadPublicKeyFile(files: FileList | null,user:User) {
    if (files && files.length > 0) {
      this.utilsService.readFileAsText(files[0])
        .subscribe((txt: string) => {
          this.user.pgp_key_public = txt;
          return this.saveUser(user);
        });
    }
  };

  getUserID() {
    return this.authenticationData.session?.user_id;
  }

  getProfileName(profileId: string): { name : string, custom : boolean} {
    const profile = this.userProfiles.find((p) => p.id === profileId);
    return profile ? { name : profile.name, custom : profile.custom} : {name : "", custom : false};
  }
  
  getUserDisplayName(user:any) {
    const profileName = this.getProfileName(user.profile_id).name;
    const isCustom = this.getProfileName(user.profile_id).custom;
  
    let roleDisplay = '';
    switch (user.role) {
      case 'admin':
        roleDisplay = 'Admin';
        break;
      case 'receiver':
        roleDisplay = 'Recipient';
        break;
      case 'custodian':
        roleDisplay = 'Custodian';
        break;
      case 'analyst':
        roleDisplay = 'Analyst';
        break;
      default:
        roleDisplay = '';
    }
  
    return isCustom ? `${profileName} (${roleDisplay})` : roleDisplay;
  }

  toggleUserEscrow(user: User) {
    this.utilsService.runAdminOperation("toggle_user_escrow", {"value": user.id}, true).subscribe({
      next:()=>{},
      error:()=>{
        user.escrow = !user.escrow;
      }
    });
  }
}
