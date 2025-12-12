/**
 * CompanyModalController - Manages company create/edit modals and selector
 *
 * Extracted from main.ts (lines 533-720)
 */

import { companyManager } from '../services/CompanyService';

type SwitchCompanyCallback = (companyId: string) => Promise<void>;

export class CompanyModalController {
    private modal: HTMLElement | null = null;
    private form: HTMLFormElement | null = null;
    private switchCompanyCallback: SwitchCompanyCallback | null = null;

    init(onSwitchCompany: SwitchCompanyCallback): void {
        this.switchCompanyCallback = onSwitchCompany;
        this.modal = document.getElementById('company-modal');
        this.form = document.getElementById('company-form') as HTMLFormElement;

        this.setupModalHandlers();
        this.setupSelectorHandlers();
        this.renderSelector();
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

    createNewCompany(): void {
        const modalTitle = document.getElementById('modal-title');
        const submitBtn = document.getElementById('submit-btn');
        const companyIdInput = document.getElementById('company-id') as HTMLInputElement;

        if (!this.modal || !this.form) return;

        // Set to create mode
        if (modalTitle) modalTitle.textContent = 'Lägg till nytt bolag';
        if (submitBtn) submitBtn.textContent = 'Skapa bolag';
        if (companyIdInput) companyIdInput.value = '';

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
        (document.getElementById('company-name') as HTMLInputElement).value = company.name || '';
        (document.getElementById('org-number') as HTMLInputElement).value = company.orgNumber || '';
        (document.getElementById('company-address') as HTMLInputElement).value = company.address || '';
        (document.getElementById('company-phone') as HTMLInputElement).value = company.phone || '';

        // Show modal
        this.modal.classList.remove('hidden');

        // Focus first field
        const nameInput = document.getElementById('company-name');
        if (nameInput) nameInput.focus();
    }

    closeModal(): void {
        if (this.modal) this.modal.classList.add('hidden');
        if (this.form) this.form.reset();
    }

    private handleFormSubmit(e: SubmitEvent): void {
        e.preventDefault();

        const companyIdInput = document.getElementById('company-id') as HTMLInputElement;
        const companyName = (document.getElementById('company-name') as HTMLInputElement).value.trim();
        const orgNumber = (document.getElementById('org-number') as HTMLInputElement).value.trim();
        const address = (document.getElementById('company-address') as HTMLInputElement).value.trim();
        const phone = (document.getElementById('company-phone') as HTMLInputElement).value.trim();

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
    }
}

export const companyModalController = new CompanyModalController();
