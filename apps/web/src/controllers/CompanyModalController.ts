/**
 * CompanyModalController - Manages company create/edit modals and selector
 *
 * Extracted from main.ts (lines 533-720)
 */

import { companyManager } from '../services/CompanyService';
import { logger } from '../services/LoggerService';

type SwitchCompanyCallback = (companyId: string) => Promise<void>;

export class CompanyModalController {
    private modal: HTMLElement | null = null;
    private form: HTMLFormElement | null = null;
    private switchCompanyCallback: SwitchCompanyCallback | null = null;
    private deleteBtn: HTMLButtonElement | null = null;
    private confirmModal: HTMLElement | null = null;
    private companyToDelete: string | null = null;

    init(onSwitchCompany: SwitchCompanyCallback): void {
        this.switchCompanyCallback = onSwitchCompany;
        this.modal = document.getElementById('company-modal');
        this.form = document.getElementById('company-form') as HTMLFormElement;
        this.deleteBtn = document.getElementById('delete-company-btn') as HTMLButtonElement;
        this.confirmModal = document.getElementById('confirm-delete-company');

        this.setupModalHandlers();
        this.setupSelectorHandlers();
        this.setupDeleteHandlers();
        this.renderSelector();

        // Listen for company changes to update header display live
        window.addEventListener('company-changed', () => {
            this.updateHeaderDisplay();
        });
    }

    private setupModalHandlers(): void {
        const closeModalBtn = document.getElementById('close-modal-btn');
        const cancelModalBtn = document.getElementById('cancel-modal-btn');

        if (closeModalBtn) closeModalBtn.addEventListener('click', () => this.closeModal());
        if (cancelModalBtn) cancelModalBtn.addEventListener('click', () => this.closeModal());

        // Click outside modal to close
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.closeModal();
                }
            });
        }

        // Handle form submission
        if (this.form) {
            this.form.addEventListener('submit', (e) => this.handleFormSubmit(e));
        }
    }

    private setupSelectorHandlers(): void {
        const companySelect = document.getElementById('company-select') as HTMLSelectElement;
        const editCompanyBtn = document.getElementById('edit-company-btn');
        const addCompanyBtn = document.getElementById('add-company-btn');

        if (companySelect) {
            companySelect.addEventListener('change', (e) => {
                const target = e.target as HTMLSelectElement;
                const value = target.value;

                if (value === '__NEW_COMPANY__') {
                    this.createNewCompany();
                    // Reset selection to current company
                    target.value = companyManager.getCurrentId();
                } else if (this.switchCompanyCallback) {
                    this.switchCompanyCallback(value);
                }
            });
        }

        if (editCompanyBtn) {
            editCompanyBtn.addEventListener('click', () => this.editCompany());
        }

        if (addCompanyBtn) {
            addCompanyBtn.addEventListener('click', () => this.createNewCompany());
        }
    }

    private setupDeleteHandlers(): void {
        // Delete button click handler
        if (this.deleteBtn) {
            this.deleteBtn.addEventListener('click', () => this.showDeleteConfirmation());
        }

        // Confirmation modal handlers
        const cancelDeleteBtn = document.getElementById('cancel-delete-company');
        const confirmDeleteBtn = document.getElementById('confirm-delete-company-btn');

        if (cancelDeleteBtn) {
            cancelDeleteBtn.addEventListener('click', () => this.hideDeleteConfirmation());
        }

        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', () => this.confirmDelete());
        }

        // Click outside confirmation modal to close
        if (this.confirmModal) {
            this.confirmModal.addEventListener('click', (e) => {
                if (e.target === this.confirmModal) {
                    this.hideDeleteConfirmation();
                }
            });
        }
    }

    private showDeleteConfirmation(): void {
        const company = companyManager.getCurrent();
        const companyNameEl = document.getElementById('delete-company-name');

        if (companyNameEl) {
            companyNameEl.textContent = company.name;
        }

        this.companyToDelete = company.id;
        this.confirmModal?.classList.remove('hidden');
    }

    private hideDeleteConfirmation(): void {
        this.confirmModal?.classList.add('hidden');
        this.companyToDelete = null;
    }

    private async confirmDelete(): Promise<void> {
        if (!this.companyToDelete) return;

        const companyCount = companyManager.getCount();

        // Check if this is the last company
        if (companyCount <= 1) {
            this.hideDeleteConfirmation();
            this.showToast('Du kan inte ta bort det enda företaget', 'error');
            return;
        }

        const companyId = this.companyToDelete;
        const success = companyManager.delete(companyId);

        if (success) {
            logger.info('Company deleted successfully', { companyId });
            this.hideDeleteConfirmation();
            this.closeModal();
            this.renderSelector();

            // Switch to the new current company
            const newCurrent = companyManager.getCurrent();
            if (this.switchCompanyCallback) {
                await this.switchCompanyCallback(newCurrent.id);
            }

            this.showToast('Företaget har tagits bort', 'success');
        } else {
            logger.error('Failed to delete company', { companyId });
            this.hideDeleteConfirmation();
            this.showToast('Kunde inte ta bort företaget', 'error');
        }
    }

    private showToast(message: string, type: 'success' | 'error'): void {
        // Remove any existing toast
        const existingToast = document.querySelector('.toast-inline');
        if (existingToast) {
            existingToast.remove();
        }

        const toast = document.createElement('div');
        toast.className = `toast-inline ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    createNewCompany(): void {
        const modalTitle = document.getElementById('modal-title');
        const submitBtn = document.getElementById('submit-btn');
        const companyIdInput = document.getElementById('company-id') as HTMLInputElement;

        if (!this.modal || !this.form) return;

        // Set to create mode
        if (modalTitle) modalTitle.textContent = 'Lägg till nytt bolag';
        if (submitBtn) submitBtn.textContent = 'Skapa bolag';
        if (companyIdInput) companyIdInput.value = '';

        // Hide delete button in create mode
        if (this.deleteBtn) {
            this.deleteBtn.classList.add('hidden');
        }

        // Clear form
        this.form.reset();

        // Show modal
        this.modal.classList.remove('hidden');

        // Focus first field
        const nameInput = document.getElementById('company-name');
        if (nameInput) nameInput.focus();
    }

    editCompany(): void {
        const modalTitle = document.getElementById('modal-title');
        const submitBtn = document.getElementById('submit-btn');
        const companyIdInput = document.getElementById('company-id') as HTMLInputElement;

        if (!this.modal || !this.form) return;

        const company = companyManager.getCurrent();

        // Set to edit mode
        if (modalTitle) modalTitle.textContent = 'Redigera bolag';
        if (submitBtn) submitBtn.textContent = 'Spara ändringar';
        if (companyIdInput) companyIdInput.value = company.id;

        // Populate form with current company data
        const nameInput = document.getElementById('company-name') as HTMLInputElement;
        const orgInput = document.getElementById('org-number') as HTMLInputElement;
        const addressInput = document.getElementById('company-address') as HTMLInputElement;
        const phoneInput = document.getElementById('company-phone') as HTMLInputElement;

        if (nameInput) nameInput.value = company.name || '';
        if (orgInput) orgInput.value = company.orgNumber || '';
        if (addressInput) addressInput.value = company.address || '';
        if (phoneInput) phoneInput.value = company.phone || '';

        // Show delete button in edit mode (but only if there's more than one company)
        if (this.deleteBtn) {
            const companyCount = companyManager.getCount();
            if (companyCount > 1) {
                this.deleteBtn.classList.remove('hidden');
            } else {
                this.deleteBtn.classList.add('hidden');
            }
        }

        // Show modal
        this.modal.classList.remove('hidden');

        // Focus first field
        if (nameInput) nameInput.focus();
    }

    closeModal(): void {
        if (this.modal) this.modal.classList.add('hidden');
        if (this.form) this.form.reset();
    }

    private handleFormSubmit(e: SubmitEvent): void {
        e.preventDefault();

        const companyIdInput = document.getElementById('company-id') as HTMLInputElement;
        const nameInput = document.getElementById('company-name') as HTMLInputElement;
        const orgInput = document.getElementById('org-number') as HTMLInputElement;
        const addressInput = document.getElementById('company-address') as HTMLInputElement;
        const phoneInput = document.getElementById('company-phone') as HTMLInputElement;

        const companyName = nameInput?.value?.trim() || '';
        const orgNumber = orgInput?.value?.trim() || '';
        const address = addressInput?.value?.trim() || '';
        const phone = phoneInput?.value?.trim() || '';

        if (!companyName) {
            alert('Företagsnamn är obligatoriskt');
            return;
        }

        const companyId = companyIdInput?.value;

        if (companyId) {
            // Edit mode - update existing company
            companyManager.update(companyId, {
                name: companyName,
                orgNumber: orgNumber || '',
                address: address || '',
                phone: phone || ''
            });
            this.renderSelector();
            this.closeModal();
        } else {
            // Create mode - add new company
            const newCompany = companyManager.create({
                name: companyName,
                orgNumber: orgNumber || '',
                address: address || '',
                phone: phone || ''
            });

            this.renderSelector();
            if (this.switchCompanyCallback) {
                this.switchCompanyCallback(newCompany.id);
            }
            this.closeModal();
        }
    }

    renderSelector(): void {
        const companySelect = document.getElementById('company-select') as HTMLSelectElement;
        if (!companySelect) return;

        companySelect.innerHTML = '';

        const companies = companyManager.getAll();
        const currentCompanyId = companyManager.getCurrentId();

        companies.forEach(company => {
            const option = document.createElement('option');
            option.value = company.id;
            option.textContent = company.name;
            option.selected = company.id === currentCompanyId;
            companySelect.appendChild(option);
        });

        // Add separator and "Add New Company" option
        if (companies.length > 0) {
            const separator = document.createElement('hr');
            companySelect.appendChild(separator);
        }

        const addNewOption = document.createElement('option');
        addNewOption.value = '__NEW_COMPANY__';
        addNewOption.textContent = '+ Lägg till nytt bolag...';
        companySelect.appendChild(addNewOption);

        // Update header display with current company name
        this.updateHeaderDisplay();
    }

    /**
     * Updates the header to show the current company name
     */
    private updateHeaderDisplay(): void {
        const companyNameEl = document.getElementById('current-company-name');
        const company = companyManager.getCurrent();

        if (companyNameEl && company) {
            companyNameEl.textContent = company.name;
        }
    }
}

export const companyModalController = new CompanyModalController();
