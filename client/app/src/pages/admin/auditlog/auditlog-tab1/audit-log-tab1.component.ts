import {Component, OnInit, inject} from "@angular/core";
import {auditlogResolverModel} from "@app/models/resolvers/auditlog-resolver-model";
import {AuditLogResolver} from "@app/shared/resolvers/audit-log-resolver.service";
import {UsersResolver} from "@app/shared/resolvers/users.resolver";
import {User} from "@app/models/resolvers/user-resolver-model";
import {NodeResolver} from "@app/shared/resolvers/node.resolver";
import {UtilsService} from "@app/shared/services/utils.service";
import {AuthenticationService} from "@app/services/helper/authentication.service";
import {DatePipe, NgClass} from "@angular/common";
import {FormsModule} from "@angular/forms";
import {NgbDate, NgbPagination, NgbPaginationPrevious, NgbPaginationNext, NgbPaginationFirst, NgbPaginationLast, NgbTooltipModule} from "@ng-bootstrap/ng-bootstrap";
import {TranslatorPipe} from "@app/shared/pipes/translate";
import {TranslateModule, TranslateService} from "@ngx-translate/core";
import {IDropdownSettings, NgMultiSelectDropDownModule} from "ng-multiselect-dropdown";
import {DateRangeSelectorComponent} from "@app/shared/components/date-selector/date-selector.component";

@Component({
    selector: "src-auditlog-tab1",
    templateUrl: "./audit-log-tab1.component.html",
    styleUrls: ["./audit-log-tab1.component.css"],
    standalone: true,
    imports: [NgbPagination, NgbPaginationPrevious, NgbPaginationNext, NgbPaginationFirst, NgbPaginationLast, NgbTooltipModule, DatePipe, NgClass, FormsModule, NgMultiSelectDropDownModule, DateRangeSelectorComponent, TranslatorPipe, TranslateModule]
})
export class AuditLogTab1Component implements OnInit {
  protected authenticationService = inject(AuthenticationService);
  private auditLogResolver = inject(AuditLogResolver);
  private usersResolver = inject(UsersResolver);
  protected nodeResolver = inject(NodeResolver);
  protected utilsService = inject(UtilsService);
  private translateService = inject(TranslateService);

  currentPage = 1;
  pageSize = 20;
  auditLog: auditlogResolverModel[] = [];
  users: User[] = [];

  searchTerm = '';
  sortField: string = '';
  sortDirection: 'asc' | 'desc' = 'asc';

  // Date filtering properties
  dateFilter: [number, number] | null = null;
  dateModel: { fromDate: NgbDate | null; toDate: NgbDate | null; } | null = null;
  datePicker: boolean = false;

  // Type filtering properties
  dropdownTypeModel: { id: number; label: string; color?: string; }[] = [];
  dropdownTypeData: { id: number; label: string; color?: string; }[] = [];
  typeDropdownVisible: boolean = false;

  // Dropdown settings
  dropdownSettings: IDropdownSettings = {
    idField: "id",
    textField: "label",
    itemsShowLimit: 3,
    allowSearchFilter: false,
    selectAllText: this.translateService.instant("Select all"),
    unSelectAllText: this.translateService.instant("Deselect all"),
    searchPlaceholderText: this.translateService.instant("Search")
  };

  ngOnInit() {
    this.loadAuditLogData();
    this.loadUsersData();
    this.initializeTypeFilterData();
  }

  loadAuditLogData() {
    if (Array.isArray(this.auditLogResolver.dataModel)) {
      this.auditLog = this.auditLogResolver.dataModel;
    } else {
      this.auditLog = [this.auditLogResolver.dataModel];
    }
  }

  loadUsersData() {
    this.users = this.usersResolver.dataModel;
  }

  initializeTypeFilterData() {
    this.dropdownTypeData = [
      { id: 1, label: 'Access', color: 'info' },
      { id: 2, label: 'Update', color: 'warning' },
      { id: 3, label: 'Delete', color: 'danger' }
    ];
  }

  getUserName(userId: string): string {
    if (!userId) {
      return this.translateService.instant('Whistleblower');
    }

    const user = this.users.find(u => u.id === userId);
    if (user) {
      // Return name with username in parentheses for better identification
      return user.name ? `${user.name} (${user.username})` : user.username;
    }

    // Return the ID if user not found (might be deleted user)
    return userId;
  }

  onSearchChange() {
    this.currentPage = 1; // Reset to first page when searching
  }

  onDateFilterChange(event: { fromDate: string | null; toDate: string | null }) {
    const {fromDate, toDate} = event;
    if (!fromDate && !toDate) {
      this.dateFilter = null;
      this.datePicker = false;
    }
    if (fromDate && toDate) {
      this.dateFilter = [new Date(fromDate).getTime(), new Date(toDate).getTime()];
    }
    this.currentPage = 1; // Reset to first page when filtering
  }

  onTypeFilterChange(model: { id: number; label: string; }[]) {
    this.dropdownTypeModel = model;
    this.currentPage = 1; // Reset to first page when filtering
  }

  toggleTypeDropdown() {
    this.typeDropdownVisible = !this.typeDropdownVisible;
    this.datePicker = false;
  }

  checkTypeFilter(model: { id: number; label: string; }[]): boolean {
    return model && model.length > 0;
  }

  getAuditLogCategory(type: string): string {
    // Categorize audit log types into Access, Update, Delete

    // Access category: authentication and data access
    if (type === 'login' || type === 'whistleblower_login' ||
        type === 'logout' || type === 'whistleblower_logout' ||
        type === 'login_failure' || type === 'whistleblower_login_failure' ||
        type === 'access_report' || type === 'grant_access' || type === 'revoke_access' ||
        type === 'transfer_access' || type === 'whistleblower_new_report') {
      return 'Access';
    }

    // Delete category: destructive actions
    if (type === 'delete_report' || type === 'delete_user' || type === 'reset_reports') {
      return 'Delete';
    }

    // Update category: modifications and administrative actions (default)
    return 'Update';
  }

  toggleSort(field: string) {
    if (this.sortField === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDirection = 'asc';
    }
    this.currentPage = 1; // Reset to first page when sorting
  }

    getFilteredData(): auditlogResolverModel[] {
    let filtered = this.auditLog;

    // Apply search filter
    if (this.searchTerm.trim()) {
      const searchLower = this.searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        item.type.toLowerCase().includes(searchLower) ||
        (item.user_id && item.user_id.toLowerCase().includes(searchLower)) ||
        (item.user_id && this.getUserName(item.user_id).toLowerCase().includes(searchLower)) ||
        (item.object_id && item.object_id.toLowerCase().includes(searchLower)) ||
        item.date.toLowerCase().includes(searchLower)
      );
    }

    // Apply date filter
    if (this.dateFilter) {
      const [fromTime, toTime] = this.dateFilter;
      filtered = filtered.filter(item => {
        const itemTime = new Date(item.date).getTime();
        return itemTime >= fromTime && itemTime <= toTime;
      });
    }

    // Apply type filter
    if (this.dropdownTypeModel && this.dropdownTypeModel.length > 0) {
      const selectedCategories = this.dropdownTypeModel.map(item => item.label);
      filtered = filtered.filter(item => {
        const category = this.getAuditLogCategory(item.type);
        return selectedCategories.includes(category);
      });
    }

    // Apply sorting
    if (this.sortField) {
      filtered = filtered.sort((a, b) => {
        let aValue = (a as any)[this.sortField];
        let bValue = (b as any)[this.sortField];

        // Handle date sorting specially
        if (this.sortField === 'date') {
          aValue = new Date(aValue).getTime();
          bValue = new Date(bValue).getTime();
        } else if (this.sortField === 'user_id') {
          // Sort by user name instead of user ID
          aValue = this.getUserName(aValue).toLowerCase();
          bValue = this.getUserName(bValue).toLowerCase();
        } else {
          aValue = aValue?.toString().toLowerCase() || '';
          bValue = bValue?.toString().toLowerCase() || '';
        }

        if (aValue < bValue) {
          return this.sortDirection === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return this.sortDirection === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    return filtered;
  }

  getPaginatedData(): auditlogResolverModel[] {
    const filteredData = this.getFilteredData();
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    return filteredData.slice(startIndex, endIndex);
  }

  getTypeDotColor(type: string): string {
    const category = this.getAuditLogCategory(type);

    switch(category) {
      case 'Access':
        return 'text-info';
      case 'Delete':
        return 'text-danger';
      case 'Update':
        return 'text-warning';
      default:
        return 'text-primary';
    }
  }

  exportAuditLog() {
    // Transform data to include user names for export
    const exportData = this.getFilteredData().map(item => ({
      Date: item.date,
      Type: item.type,
      User: this.getUserName(item.user_id || ''),
      'User ID': item.user_id || '',
      Object: item.object_id || '',
      Data: item.data ? JSON.stringify(item.data) : ''
    }));

    this.utilsService.generateCSV(JSON.stringify(exportData), 'auditlog', ["Date", "Type", "User", "User ID", "Object", "Data"]);
  }
}
