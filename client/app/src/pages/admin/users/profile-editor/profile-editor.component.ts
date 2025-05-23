import {Component, EventEmitter, Input, OnInit, Output, inject} from "@angular/core";
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
import {UserProfile} from "@app/models/resolvers/user-resolver-model";
import {nodeResolverModel} from "@app/models/resolvers/node-resolver-model";
import {preferenceResolverModel} from "@app/models/resolvers/preference-resolver-model";
import {NgClass, CommonModule} from "@angular/common";
import {TranslatorPipe} from "@app/shared/pipes/translate";
import {NgSelectComponent, NgOptionTemplateDirective} from "@ng-select/ng-select";

@Component({
    selector: "src-profile-editor",
    templateUrl: "./profile-editor.component.html",
    standalone: true,
    imports: [CommonModule, NgSelectComponent, NgOptionTemplateDirective, FormsModule, NgbTooltipModule, NgClass, TranslatorPipe]
})
export class ProfileEditorComponent implements OnInit {
  private modalService = inject(NgbModal);
  private appDataService = inject(AppDataService);
  private preference = inject(PreferenceResolver);
  private authenticationService = inject(AuthenticationService);
  private nodeResolver = inject(NodeResolver);
  protected utilsService = inject(UtilsService);

  @Input() user: UserProfile;
  @Input() users: UserProfile[];
  @Input() index: number;
  @Input() editUser: NgForm;
  @Output() dataToParent = new EventEmitter<string>();
  editing = false;
  nodeData: nodeResolverModel;
  preferenceData: preferenceResolverModel;
  authenticationData: AuthenticationService;
  appServiceData: AppDataService;
  roles = [
       { value: 'admin', role: 'Admin' },
       { value: 'analyst', role: 'Analyst' },
       { value: 'custodian', role: 'Custodian' },
       { value: 'receiver', role: 'Recipient' }
     ];
  userRole: string;
  defaultUsersArr = ['Admin', 'Analyst', 'Custodian', 'Receiver'];
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
    if (!this.user || !this.user || !Array.isArray(this.user.roles)) {
      this.roles;
    } else {
       this.roles = this.roles.filter(r => !this.user.roles.includes(r.value));
    }
    if (this.user.role === 'receiver') {
      this.roles.push({ value: 'receiver', role: 'Recipient' });
    } else {
      this.roles.push({ value: this.user.role, role: this.user.role.charAt(0).toUpperCase() + this.user.role.slice(1) });
    }
    this.userRole = this.user.role;
  }

  toggleEditing() {
    this.editing = !this.editing;
  }

  saveUser(userData: UserProfile ) {
    const user = userData;
    return this.utilsService.updateAdminUserProfile(userData.id, userData).subscribe({
      next:()=>{
        this.sendDataToParent();
      },
      error:()=>{
      }
    });
  }

  sendDataToParent() {
    this.dataToParent.emit();
  }

  deleteUser(user:UserProfile) {
    this.openConfirmableModalDialog(user, "").subscribe();
  }

  openConfirmableModalDialog(arg: UserProfile, scope: any): Observable<string> {
    scope = !scope ? this : scope;
    return new Observable((observer) => {
      const modalRef = this.modalService.open(DeleteConfirmationComponent, {backdrop: 'static', keyboard: false});
      modalRef.componentInstance.arg = arg;
      modalRef.componentInstance.scope = scope;

      modalRef.componentInstance.confirmFunction = () => {
        observer.complete()
        return this.utilsService.deleteAdminUserProfile(arg.id).subscribe(_ => {
          this.utilsService.deleteResource(this.users, arg);
        });
      };
    });
  }

  getUserID() {
    return this.authenticationData.session?.user_id;
  }

  exportProfile(user:UserProfile){
    this.utilsService.saveAs(this.authenticationService, user.name + ".json", "api/admin/users/" + user.id);
  }

  hasSpecificRole(user: any): boolean {
    return user.roles && user.roles.some((role: string) => ['analyst', 'custodian', 'receiver'].includes(role));
  }

 getUserRoleLabel(user: any, badge: boolean): string {
    const roleMap: { [key: string]: string } = {
      'analyst': 'Analyst',
      'custodian': 'Custodian',
      'receiver': 'Recipient',
      'admin': 'Admin'
    };
    const filter = badge
      ? ['analyst', 'custodian', 'receiver', 'admin']
      : ['analyst', 'custodian'];
    const separator = badge ? ' , ' : ' | ';
    return user.roles
      .filter((role: string) => filter.includes(role))
      .map((role: string) => roleMap[role] || role)
      .join(separator);
  }

  assignRole(role: string) {
    if (role && !this.user.roles.includes(role)) {
      this.user.roles.push(role);
      this.roles = this.roles.filter(r => r.value !== role);
      if (!this.user.role) {
        this.user.role = role;
      }
    }
  }
  
  removeRole(index: number, role: string) {
    this.user.roles.splice(index, 1);
    if (!this.roles.some(r => r.value === role)) {
      const displayName = role === 'receiver' ? 'Recipient' : role.charAt(0).toUpperCase() + role.slice(1);
      this.roles = [...this.roles, { value: role, role: displayName }];
    }
    if (this.user.role === role) {
      this.user.role = this.user.roles[0] || '';
    }
  }
  
  setDefaultRole(role: string) {
    this.user.role = role;
  }
}
