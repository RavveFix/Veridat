document.addEventListener('DOMContentLoaded', () => {
    // Company Management
    let companies = JSON.parse(localStorage.getItem('companies')) || [];
    let currentCompanyId = localStorage.getItem('currentCompanyId') || null;

    // Initialize companies if none exist
    if (companies.length === 0) {
        const defaultCompany = {
            id: 'company-' + Date.now(),
            name: 'Mitt Företag AB',
            orgNumber: '',
            address: '',
            phone: '',
            history: [],
            invoices: [],
            documents: [],
            verificationCounter: 1,
            chatHistory: []
        };
        companies = [defaultCompany];
        currentCompanyId = defaultCompany.id;
        localStorage.setItem('companies', JSON.stringify(companies));
        localStorage.setItem('currentCompanyId', currentCompanyId);
    }

    // Get current company
    function getCurrentCompany() {
        return companies.find(c => c.id === currentCompanyId) || companies[0];
    }

    // Save companies to localStorage
    function saveCompanies() {
        localStorage.setItem('companies', JSON.stringify(companies));
    }

    // Switch company
    function switchCompany(companyId) {
        // Save current company's chat before switching
        const currentCompany = getCurrentCompany();
        if (currentCompany) {
            currentCompany.chatHistory = getChatHistory();
            saveCompanies();
        }

        currentCompanyId = companyId;
        localStorage.setItem('currentCompanyId', companyId);

        // Reload all data for new company
        const company = getCurrentCompany();
        bookkeepingHistory = company.history || [];
        supplierInvoices = company.invoices || [];
        accountingDocuments = company.documents || [];
        verificationCounter = company.verificationCounter || 1;

        // Refresh views
        renderHistory();
        renderInvoices();
        renderDocuments();

        // Load chat history for new company
        loadChatHistory(company.chatHistory || []);
    }

    // Get current chat history from DOM
    function getChatHistory() {
        const messages = [];
        const messageElements = chatContainer.querySelectorAll('.message:not(.welcome-message)');

        messageElements.forEach(msg => {
            const isUser = msg.classList.contains('user-message');
            const bubble = msg.querySelector('.bubble');
            if (bubble) {
                messages.push({
                    sender: isUser ? 'user' : 'ai',
                    content: bubble.innerHTML,
                    timestamp: Date.now()
                });
            }
        });

        return messages;
    }

    // Load chat history into DOM
    function loadChatHistory(history) {
        // Clear chat
        chatContainer.innerHTML = '';

        // Add welcome message
        const welcomeMsg = document.createElement('div');
        welcomeMsg.className = 'message ai-message welcome-message';
        welcomeMsg.innerHTML = `
            <div class="avatar">B</div>
            <div class="bubble">
                <p>Hej! Jag är <strong>Britta</strong>, din expert på svensk bokföring.</p>
                <p>Jag kan hjälpa dig med kontering, momsregler, avdrag och bokslut. Vad funderar du på idag?</p>
            </div>
        `;
        chatContainer.appendChild(welcomeMsg);

        // Load saved messages
        history.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${msg.sender === 'user' ? 'user-message' : 'ai-message'}`;

            const avatar = document.createElement('div');
            avatar.className = 'avatar';
            avatar.textContent = msg.sender === 'user' ? 'Du' : 'B';

            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            bubble.innerHTML = msg.content;

            messageDiv.appendChild(avatar);
            messageDiv.appendChild(bubble);
            chatContainer.appendChild(messageDiv);
        });

        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Create new company
    function createNewCompany() {
        const modal = document.getElementById('company-modal');
        const form = document.getElementById('company-form');

        // Show modal
        modal.classList.remove('hidden');

        // Clear form
        form.reset();

        // Focus first field
        document.getElementById('company-name').focus();
    }

    // Modal event listeners
    const companyModal = document.getElementById('company-modal');
    const companyForm = document.getElementById('company-form');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const cancelModalBtn = document.getElementById('cancel-modal-btn');

    // Close modal handlers
    function closeModal() {
        companyModal.classList.add('hidden');
        companyForm.reset();
    }

    closeModalBtn.addEventListener('click', closeModal);
    cancelModalBtn.addEventListener('click', closeModal);

    // Click outside modal to close
    companyModal.addEventListener('click', (e) => {
        if (e.target === companyModal) {
            closeModal();
        }
    });

    // Handle form submission
    companyForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const companyName = document.getElementById('company-name').value.trim();
        const orgNumber = document.getElementById('org-number').value.trim();
        const address = document.getElementById('company-address').value.trim();
        const phone = document.getElementById('company-phone').value.trim();

        if (!companyName) {
            alert('Företagsnamn är obligatoriskt');
            return;
        }

        const newCompany = {
            id: 'company-' + Date.now(),
            name: companyName,
            orgNumber: orgNumber || '',
            address: address || '',
            phone: phone || '',
            history: [],
            invoices: [],
            documents: [],
            verificationCounter: 1,
            chatHistory: []
        };

        companies.push(newCompany);
        saveCompanies();
        renderCompanySelector();
        switchCompany(newCompany.id);
        closeModal();
    });

    // Render company selector
    function renderCompanySelector() {
        const companySelect = document.getElementById('company-select');
        companySelect.innerHTML = '';

        companies.forEach(company => {
            const option = document.createElement('option');
            option.value = company.id;
            option.textContent = company.name;
            option.selected = company.id === currentCompanyId;
            companySelect.appendChild(option);
        });
    }

    // Company selector event listeners
    const companySelect = document.getElementById('company-select');
    const addCompanyBtn = document.getElementById('add-company-btn');

    companySelect.addEventListener('change', (e) => {
        switchCompany(e.target.value);
    });

    addCompanyBtn.addEventListener('click', () => {
        createNewCompany();
    });

    // Initialize company selector
    renderCompanySelector();

    // Rest of the initialization
    const chatForm = document.getElementById('chat-form');
    const userInput = document.getElementById('user-input');
    const chatContainer = document.getElementById('chat-container');
    const fileInput = document.getElementById('file-input');
    const attachBtn = document.getElementById('attach-btn');
    const filePreview = document.getElementById('file-preview');
    const fileNameSpan = filePreview.querySelector('.file-name');
    const removeFileBtn = filePreview.querySelector('.remove-file');

    let currentFile = null;

    // Auto-focus input
    userInput.focus();

    // File Attachment Logic
    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            currentFile = e.target.files[0];
            showFilePreview(currentFile.name);
        }
    });

    removeFileBtn.addEventListener('click', () => {
        clearFile();
    });

    function showFilePreview(name) {
        fileNameSpan.textContent = name;
        filePreview.classList.remove('hidden');
        userInput.focus();
    }

    function clearFile() {
        currentFile = null;
        fileInput.value = '';
        filePreview.classList.add('hidden');
        userInput.focus();
    }

    // Voice Logic
    const micBtn = document.getElementById('mic-btn');
    let recognition = null;
    let isListening = false;

    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'sv-SE';
        recognition.interimResults = false;

        recognition.onstart = () => {
            isListening = true;
            micBtn.classList.add('listening');
        };

        recognition.onend = () => {
            isListening = false;
            micBtn.classList.remove('listening');
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            userInput.value = transcript;
            // Optional: Auto-submit
            // chatForm.dispatchEvent(new Event('submit'));
        };

        micBtn.addEventListener('click', () => {
            if (isListening) {
                recognition.stop();
            } else {
                recognition.start();
            }
        });
    } else {
        micBtn.style.display = 'none';
        console.log('Web Speech API not supported');
    }

    function speakText(text, btn) {
        if ('speechSynthesis' in window) {
            // Cancel current speech if any
            window.speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'sv-SE';

            // Try to find a Swedish voice
            const voices = window.speechSynthesis.getVoices();
            const svVoice = voices.find(v => v.lang.includes('sv'));
            if (svVoice) utterance.voice = svVoice;

            utterance.onstart = () => {
                btn.classList.add('speaking');
            };

            utterance.onend = () => {
                btn.classList.remove('speaking');
            };

            window.speechSynthesis.speak(utterance);
        }
    }

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = userInput.value.trim();

        if (!message && !currentFile) return;

        // Add user message with optional file
        addMessage(message, 'user', currentFile);

        // Clear input and file
        userInput.value = '';
        const fileToSend = currentFile; // Store reference for AI response
        clearFile();

        // Simulate AI thinking and response
        simulateAIResponse(message, fileToSend);
    });

    function addMessage(text, sender, file = null) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', sender === 'user' ? 'user-message' : 'ai-message');

        const avatarDiv = document.createElement('div');
        avatarDiv.classList.add('avatar');
        avatarDiv.textContent = sender === 'user' ? 'Du' : 'B';

        const bubbleDiv = document.createElement('div');
        bubbleDiv.classList.add('bubble');

        let content = '';

        // Add file attachment display if present
        if (file) {
            content += `
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; background: rgba(255,255,255,0.1); padding: 8px; border-radius: 8px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                    <span style="font-size: 0.9em;">${file.name}</span>
                </div>
            `;
        }

        // Allow simple HTML in AI responses for formatting
        if (sender === 'ai') {
            content += text;

            // Add speak button for AI messages
            // Strip HTML tags for speech
            const textForSpeech = text.replace(/<[^>]*>/g, ' ');
            const speakBtnId = 'speak-' + Date.now();

            // We need to append the button after setting innerHTML
            setTimeout(() => {
                const speakBtn = document.createElement('button');
                speakBtn.className = 'speak-btn';
                speakBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                `;
                speakBtn.onclick = () => speakText(textForSpeech, speakBtn);
                bubbleDiv.appendChild(speakBtn);
            }, 0);

        } else {
            content += text ? `<p>${text}</p>` : '';
        }

        bubbleDiv.innerHTML = content;

        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(bubbleDiv);
        chatContainer.appendChild(messageDiv);

        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    async function simulateAIResponse(userMessage, attachedFile) {
        // Show typing indicator
        const typingIndicator = showTypingIndicator();

        try {
            const response = await generateResponse(userMessage, attachedFile);
            removeTypingIndicator(typingIndicator);
            addMessage(response, 'ai');
        } catch (error) {
            console.error("Error generating response:", error);
            removeTypingIndicator(typingIndicator);
            addMessage("Ursäkta, något gick fel vid kommunikationen med AI-tjänsten.", 'ai');
        }
    }

    function showTypingIndicator() {
        const indicatorDiv = document.createElement('div');
        indicatorDiv.classList.add('typing-indicator');
        indicatorDiv.id = 'typing-indicator';

        indicatorDiv.innerHTML = `
            <div class="avatar">B</div>
            <div class="bubble">
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;

        chatContainer.appendChild(indicatorDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return indicatorDiv;
    }

    function removeTypingIndicator(indicator) {
        if (indicator && indicator.parentNode) {
            indicator.parentNode.removeChild(indicator);
        }
    }

    // Tab Switching Logic
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // Update buttons
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update views
            views.forEach(view => {
                if (view.id === `${tabId}-view`) {
                    view.classList.remove('hidden');
                } else {
                    view.classList.add('hidden');
                }
            });

            // If history tab, refresh list
            if (tabId === 'history') {
                renderHistory();
            }
            // If invoices tab, refresh list
            if (tabId === 'invoices') {
                renderInvoices();
            }
            // If documents tab, refresh list
            if (tabId === 'documents') {
                renderDocuments();
            }
        });
    });

    // History Management - Load from current company
    const company = getCurrentCompany();
    let bookkeepingHistory = company.history || [];
    let supplierInvoices = company.invoices || [];
    let accountingDocuments = company.documents || [];
    let verificationCounter = company.verificationCounter || 1;

    function addToHistory(item, file = null) {
        // Generate Verification ID
        const verId = `A-${verificationCounter}`;
        verificationCounter++;

        // Update current company's verification counter
        const company = getCurrentCompany();
        company.verificationCounter = verificationCounter;
        saveCompanies();

        const historyItem = {
            ...item,
            verId: verId
        };

        bookkeepingHistory.push(historyItem);

        // Save to current company
        company.history = bookkeepingHistory;
        saveCompanies();

        // Check if it's a supplier invoice (Credit 2440)
        if (item.creditAccount === '2440') {
            addToSupplierInvoices(historyItem);
        }

        // Add document if present
        if (file) {
            addToDocuments(file, verId, item.description);
        }
    }

    function addToDocuments(file, verId, description) {
        const doc = {
            id: Date.now(),
            verId: verId,
            date: new Date().toISOString().split('T')[0],
            fileName: file.name,
            type: file.type || 'application/pdf',
            linkedTransaction: description
        };
        accountingDocuments.push(doc);

        // Save to current company
        const company = getCurrentCompany();
        company.documents = accountingDocuments;
        saveCompanies();
    }

    function addToSupplierInvoices(item) {
        const invoice = {
            id: Date.now(),
            date: item.date,
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            supplier: item.description,
            amount: item.amount,
            status: 'Obetald',
            verId: item.verId
        };
        supplierInvoices.push(invoice);

        // Save to current company
        const company = getCurrentCompany();
        company.invoices = supplierInvoices;
        saveCompanies();
    }

    function payInvoice(id) {
        const invoiceIndex = supplierInvoices.findIndex(inv => inv.id === id);
        if (invoiceIndex === -1) return;

        const invoice = supplierInvoices[invoiceIndex];

        // Create payment verification
        const paymentVerification = {
            date: new Date().toISOString().split('T')[0],
            description: `Betalning ${invoice.supplier}`,
            amount: invoice.amount,
            debitAccount: '2440',
            creditAccount: '1930',
            status: 'Bokförd'
        };

        // Add to history (this will generate a new Ver ID)
        addToHistory(paymentVerification);

        // Update invoice status
        supplierInvoices[invoiceIndex].status = 'Betald';
        localStorage.setItem('supplierInvoices', JSON.stringify(supplierInvoices));

        renderInvoices();
    }

    // Expose payInvoice to global scope for button onclick
    window.payInvoice = payInvoice;

    function renderHistory() {
        const historyList = document.getElementById('history-list');
        const emptyState = document.getElementById('empty-history');

        historyList.innerHTML = '';

        if (bookkeepingHistory.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        // Sort by date desc
        const sortedHistory = [...bookkeepingHistory].sort((a, b) => new Date(b.date) - new Date(a.date));

        sortedHistory.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="ver-badge">${item.verId || '-'}</span></td>
                <td>${item.date}</td>
                <td>${item.description}</td>
                <td>${item.amount} kr</td>
                <td>${item.debitAccount}</td>
                <td>${item.creditAccount}</td>
                <td><span class="status-badge ${item.status === 'Bokförd' ? 'booked' : 'pending'}">${item.status}</span></td>
            `;
            historyList.appendChild(tr);
        });
    }

    function renderDocuments() {
        const documentsList = document.getElementById('documents-list');
        const emptyState = document.getElementById('empty-documents');

        documentsList.innerHTML = '';

        if (accountingDocuments.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        // Sort by Ver ID desc
        const sortedDocs = [...accountingDocuments].sort((a, b) => b.id - a.id);

        sortedDocs.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="ver-badge">${item.verId}</span></td>
                <td>${item.date}</td>
                <td>${item.fileName}</td>
                <td>${item.type.split('/')[1].toUpperCase()}</td>
                <td>${item.linkedTransaction}</td>
            `;
            documentsList.appendChild(tr);
        });
    }

    function renderInvoices() {
        const invoicesList = document.getElementById('invoices-list');
        const emptyState = document.getElementById('empty-invoices');

        invoicesList.innerHTML = '';

        if (supplierInvoices.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        // Sort by due date
        const sortedInvoices = [...supplierInvoices].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

        sortedInvoices.forEach(item => {
            const tr = document.createElement('tr');
            const isPaid = item.status === 'Betald';
            tr.innerHTML = `
                <td>${item.dueDate}</td>
                <td>${item.supplier}</td>
                <td>${item.amount} kr</td>
                <td><span class="status-badge ${isPaid ? 'booked' : 'pending'}">${item.status}</span></td>
                <td>
                    <button class="pay-btn" onclick="payInvoice(${item.id})" ${isPaid ? 'disabled' : ''}>
                        ${isPaid ? 'Betald' : 'Betala'}
                    </button>
                </td>
            `;
            invoicesList.appendChild(tr);
        });
    }

    // Pending file state for unrecognized uploads
    let pendingFile = null;

    // Agent Server Configuration
    const AGENT_SERVER_URL = 'http://localhost:3001';

    async function callAgentAPI(message, userId = 'default-user') {
        const apiUrl = `${AGENT_SERVER_URL}/api/chat`;

        const requestBody = {
            message: message,
            userId: userId
        };

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data; // Returns { type: 'text' | 'json', data: ... }

        } catch (error) {
            console.error('Error calling Agent Server:', error);
            return { type: 'text', data: `Fel vid anslutning till servern: ${error.message}` };
        }
    }

    async function executeFortnoxAction(payload) {
        const apiUrl = `${AGENT_SERVER_URL}/api/fortnox/execute`;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Fortnox API call failed');
            }

            return result;

        } catch (error) {
            console.error('Error executing Fortnox action:', error);
            throw error;
        }
    }

    function renderInvoiceDraftCard(invoiceData) {
        const rows = invoiceData.InvoiceRows || [];
        const total = rows.reduce((sum, row) => sum + (row.DeliveredQuantity * row.Price), 0);

        let rowsHTML = rows.map(row => `
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <div>
                    <div style="font-weight: 500;">${row.ArticleNumber || 'N/A'}</div>
                    <div style="font-size: 0.9em; opacity: 0.8;">${row.DeliveredQuantity || 0} st</div>
                </div>
                <div style="text-align: right;">
                    <div>${row.Price || 0} kr/st</div>
                    <div style="font-weight: 600;">${(row.DeliveredQuantity * row.Price).toFixed(2)} kr</div>
                </div>
            </div>
        `).join('');

        const btnId = 'execute-btn-' + Date.now();
        const cancelBtnId = 'cancel-btn-' + Date.now();

        const cardHTML = `
            <div style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.15)); border-radius: 16px; padding: 20px; margin: 16px 0; border: 1px solid rgba(255,255,255,0.2); backdrop-filter: blur(10px);">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="9" y1="3" x2="9" y2="21"></line>
                    </svg>
                    <h3 style="margin: 0; font-size: 1.2em;">Fakturautkast</h3>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <div style="font-size: 0.9em; opacity: 0.8;">Kund</div>
                    <div style="font-weight: 600; font-size: 1.1em;">${invoiceData.CustomerNumber || 'N/A'}</div>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <div style="font-size: 0.9em; opacity: 0.8;">Fakturadatum</div>
                    <div style="font-weight: 500;">${invoiceData.InvoiceDate || new Date().toISOString().split('T')[0]}</div>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <div style="font-size: 0.9em; opacity: 0.8; margin-bottom: 8px;">Artiklar</div>
                    ${rowsHTML}
                </div>
                
                <div style="display: flex; justify-content: space-between; padding: 16px 0; border-top: 2px solid rgba(255,255,255,0.3); font-size: 1.2em; font-weight: 700;">
                    <div>Totalt</div>
                    <div>${total.toFixed(2)} kr</div>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 16px;">
                    <button id="${btnId}" style="flex: 1; background: linear-gradient(135deg, #6366f1, #8b5cf6); border: none; color: white; padding: 12px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        Bokför & Skicka till Fortnox
                    </button>
                    <button id="${cancelBtnId}" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px 20px; border-radius: 10px; font-weight: 600; cursor: pointer;">
                        Avbryt
                    </button>
                </div>
            </div>
        `;

        setTimeout(() => {
            const executeBtn = document.getElementById(btnId);
            const cancelBtn = document.getElementById(cancelBtnId);

            if (executeBtn) {
                executeBtn.onclick = async function () {
                    if (this.disabled) return;

                    this.disabled = true;
                    this.innerHTML = `
                        <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                        </svg>
                        Skickar...
                    `;

                    try {
                        const result = await executeFortnoxAction({
                            action: 'create_invoice_draft',
                            data: invoiceData
                        });

                        this.style.background = 'linear-gradient(135deg, #10b981, #059669)';
                        this.innerHTML = `
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 6L9 17l-5-5"/>
                            </svg>
                            Skickad!
                        `;

                        addMessage(`✅ Faktura skapad i Fortnox! Dokumentnummer: ${result.data?.Invoice?.DocumentNumber || 'N/A'}`, 'ai');
                    } catch (error) {
                        this.disabled = false;
                        this.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
                        this.innerHTML = `
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            </svg>
                            Fel vid skickning
                        `;

                        addMessage(`❌ Fel vid skapande av faktura: ${error.message}`, 'ai');
                    }
                };
            }

            if (cancelBtn) {
                cancelBtn.onclick = function () {
                    addMessage('Faktura avbröts.', 'ai');
                };
            }
        }, 100);

        return cardHTML;
    }

    async function generateResponse(input, file) {
        const userId = getCurrentCompany().id;

        // Call Agent API
        const responseData = await callAgentAPI(input, userId);

        // Handle response based on type
        if (responseData.type === 'json') {
            // Invoice draft card
            const invoiceData = responseData.data;
            const cardHTML = renderInvoiceDraftCard(invoiceData);
            return `<p>Här är fakturautkastet:</p>${cardHTML}`;
        } else {
            // Plain text response
            return responseData.data || "Inget svar.";
        }
    }

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then((registration) => {
                    console.log('✅ Service Worker registered successfully:', registration.scope);
                })
                .catch((error) => {
                    console.log('❌ Service Worker registration failed:', error);
                });
        });
    }
});
