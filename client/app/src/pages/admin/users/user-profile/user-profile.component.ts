import {Component, ElementRef, OnInit, ViewChild, inject} from "@angular/core";
import {NewUser} from "@app/models/admin/new-user";
import {tenantResolverModel} from "@app/models/resolvers/tenant-resolver-model";
import {UserProfile} from "@app/models/resolvers/user-resolver-model";
import {Constants} from "@app/shared/constants/constants";
import {NodeResolver} from "@app/shared/resolvers/node.resolver";
import {TenantsResolver} from "@app/shared/resolvers/tenants.resolver";
import {HttpService} from "@app/shared/services/http.service";
import {UtilsService} from "@app/shared/services/utils.service";
import {NgbTooltipModule} from "@ng-bootstrap/ng-bootstrap";
import {FormsModule} from "@angular/forms";
import {TranslatorPipe} from "@app/shared/pipes/translate";
import {OrderByPipe} from "@app/shared/pipes/order-by.pipe";
import {ProfileEditorComponent} from "../profile-editor/profile-editor.component";
import {HttpClient} from "@angular/common/http";

@Component({
  selector: 'src-user-profile',
  standalone: true,
  imports: [FormsModule, NgbTooltipModule, ProfileEditorComponent, TranslatorPipe, OrderByPipe],
  templateUrl: './user-profile.component.html',
})
export class UserProfileComponent implements OnInit {
  private httpService = inject(HttpService);
  protected nodeResolver = inject(NodeResolver);
  private tenantsResolver = inject(TenantsResolver);
  private utilsService = inject(UtilsService);
  private http = inject(HttpClient);
  @ViewChild('keyUploadInput') keyUploadInput: ElementRef<HTMLInputElement>;

  showAddUser = false;
  tenantData: tenantResolverModel;
  usersData: UserProfile[]=[];
  new_user: { role: string, name: string} = { role: "", name: ""};
  editing = false;
  protected readonly Constants = Constants;

  ngOnInit(): void {
    this.getResolver();
    if (this.nodeResolver.dataModel.root_tenant) {
      this.tenantData = this.tenantsResolver.dataModel;
    }
  }

  addUser(): void {
    const user: NewUser = new NewUser();
    user.role = this.new_user.role;
    user.name = this.new_user.name;
    user.custom = true;
    user.language = this.nodeResolver.dataModel.default_language;
    this.utilsService.addAdminUser(user).subscribe(_ => {
      this.getResolver();
      this.new_user = {role: "", name: ""};
    });
  }

  importProfile(files: FileList | null) {
    if (files && files.length > 0) {
      this.utilsService.readFileAsText(files[0]).subscribe((txt) => {
        return this.http.post("api/admin/users", txt).subscribe({
          next:()=>{
            this.getResolver();
          },
          error:()=>{
            if (this.keyUploadInput) {
                this.keyUploadInput.nativeElement.value = "";
            }
          }
        });
      });
    }
  }

  getResolver() {
    return this.httpService.requestUsersResource().subscribe(response => {
      this.usersData = response.user_profiles.filter(profile => profile.custom != false);
    });
  }

  toggleAddUser(): void {
    this.showAddUser = !this.showAddUser;
  }
}

