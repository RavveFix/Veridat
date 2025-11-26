document.addEventListener('DOMContentLoaded', () => {
    // Initialize Excel Viewer
    const excelViewer = new ExcelViewer();

    // Theme Toggle
    const themeToggle = document.getElementById('theme-toggle');
    const moonIcon = document.querySelector('.moon-icon');
    const sunIcon = document.querySelector('.sun-icon');
    const savedTheme = localStorage.getItem('theme') || 'dark';

    // Apply saved theme
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });

    function updateThemeIcon(theme) {
        if (theme === 'light') {
            moonIcon.style.display = 'none';
            sunIcon.style.display = 'block';
        } else {
            moonIcon.style.display = 'block';
            sunIcon.style.display = 'none';
        }
    }

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
        // renderHistory();
        // renderInvoices();
        // renderDocuments();

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

    // Mock Connect Fortnox Logic
    const connectBtn = document.getElementById('connect-fortnox-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            // Simulate connection flow
            const originalText = connectBtn.innerHTML;
            connectBtn.innerHTML = '<span>Ansluter...</span>';
            connectBtn.style.opacity = '0.7';
            connectBtn.disabled = true;

            setTimeout(() => {
                alert('🔗 Du skickas nu till Fortnox för att godkänna kopplingen...\n\n(Detta är en simulation)');

                setTimeout(() => {
                    connectBtn.innerHTML = `
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 6L9 17l-5-5"></path>
                        </svg>
                        <span>Kopplad</span>
                    `;
                    connectBtn.classList.add('connected');
                    connectBtn.style.opacity = '1';
                    connectBtn.disabled = false;

                    addMessage('✅ <strong>Fortnox kopplat!</strong><br>Jag har nu tillgång till dina kunder och artiklar.', 'ai');
                }, 1000);
            }, 1000);
        });
    }

    // Create test invoice button
    const createTestInvoiceBtn = document.getElementById('create-test-invoice-btn');
    if (createTestInvoiceBtn) {
        createTestInvoiceBtn.addEventListener('click', () => {
            createTestInvoice();
        });
    }

    // Create a test invoice for attestation testing
    function createTestInvoice() {
        const testSuppliers = ['Telia', 'Elgiganten', 'IKEA', 'Staples', 'Telenor'];
        const randomSupplier = testSuppliers[Math.floor(Math.random() * testSuppliers.length)];
        const randomAmount = Math.floor(Math.random() * 5000) + 500;

        const testInvoice = {
            id: Date.now(),
            date: new Date().toISOString().split('T')[0],
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            supplier: randomSupplier,
            amount: randomAmount,
            status: 'Ej attesterad',
            verId: null,
            fileData: null,
            fileName: null,
            attestedDate: null
        };

        supplierInvoices.push(testInvoice);

        const company = getCurrentCompany();
        company.invoices = supplierInvoices;
        saveCompanies();

        // renderInvoices();

        // Show notification
        addMessage(`
            <p><strong>✅ Testfaktura skapad!</strong></p>
            <p>Leverantör: ${randomSupplier}</p>
            <p>Belopp: ${randomAmount} kr</p>
            <p>Gå till Lev.fakturor för att attestera!</p>
        `, 'ai');
    }

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

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'sv-SE';
        recognition.interimResults = false;

        recognition.onstart = () => {
            console.log('Voice recognition started');
            isListening = true;
            micBtn.classList.add('listening');
        };

        recognition.onend = () => {
            console.log('Voice recognition ended');
            isListening = false;
            micBtn.classList.remove('listening');
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            console.log('Voice result:', transcript);
            userInput.value = transcript;
            // Optional: Auto-submit
            // chatForm.dispatchEvent(new Event('submit'));
        };

        recognition.onerror = (event) => {
            console.error('Voice recognition error:', event.error);
            isListening = false;
            micBtn.classList.remove('listening');

            let errorMessage = 'Kunde inte höra dig.';
            if (event.error === 'not-allowed') {
                errorMessage = 'Mikrofonåtkomst nekad. Kontrollera dina inställningar.';
            } else if (event.error === 'no-speech') {
                errorMessage = 'Ingen röst uppfattades. Försök igen.';
            }

            alert(errorMessage);
        };

        micBtn.addEventListener('click', () => {
            if (isListening) {
                recognition.stop();
            } else {
                try {
                    recognition.start();
                } catch (e) {
                    console.error('Failed to start recognition:', e);
                }
            }
        });
    } else {
        micBtn.style.display = 'none';
        console.log('Web Speech API not supported in this browser');
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

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        let message = userInput.value.trim();
        console.log('Form submit - message:', message, 'currentFile:', !!currentFile);

        if (!message && !currentFile) return;

        // If no message but file is attached, use a default message
        if (!message && currentFile) {
            message = "Analysera denna fil";
        }

        const fileToSend = currentFile; // Store reference
        let fileUrl = null;
        let vatReport = null; // Store Claude analysis result

        // Upload Excel files to Supabase Storage
        if (fileToSend && (fileToSend.name.endsWith('.xlsx') || fileToSend.name.endsWith('.xls'))) {
            try {
                // Upload for Excel viewer
                fileUrl = await uploadFileToSupabase(fileToSend);
                console.log('File uploaded successfully:', fileUrl);

                // Analyze with Claude for Swedish VAT report
                vatReport = await analyzeExcelWithClaude(fileToSend);
                console.log('VAT report generated:', vatReport.period);

                // Store report in localStorage for potential export later
                localStorage.setItem('latest_vat_report', JSON.stringify({
                    ...vatReport,
                    fileUrl,
                    filename: fileToSend.name,
                    analyzedAt: new Date().toISOString()
                }));

            } catch (error) {
                console.error('Failed to process Excel file:', error);
                // Show error message but continue
                addMessage('⚠️ Kunde inte analysera Excel-filen helt, men den är uppladdad och kan öppnas.', 'ai');
            }
        }

        // Add user message with optional file and URL
        addMessage(message, 'user', fileToSend, fileUrl);

        // Clear input and file
        userInput.value = '';
        clearFile();

        // Show AI response based on file type
        if (vatReport) {
            // Excel file - show Swedish accounting summary
            const summary = renderVATSummary(vatReport);
            addMessage(summary, 'ai');
        } else {
            // Other files - use existing AI flow
            console.log('Calling simulateAIResponse with message:', message);
            simulateAIResponse(message, fileToSend);
        }
    });

    // Helper function to convert simple markdown to HTML
    function markdownToHtml(text) {
        if (!text) return '';

        return text
            // Bold: **text** or __text__
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.+?)__/g, '<strong>$1</strong>')
            // Italic: *text* or _text_
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/_(.+?)_/g, '<em>$1</em>')
            // Code: `code`
            .replace(/`(.+?)`/g, '<code>$1</code>')
            // Line breaks
            .replace(/\n/g, '<br>');
    }

    function addMessage(text, sender, file = null, fileUrl = null) {
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
            const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
            const clickableClass = (isExcel && fileUrl) ? 'file-attachment-clickable' : '';

            content += `
                <div class="${clickableClass}" data-file-url="${fileUrl || ''}" data-file-name="${file.name}" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; background: rgba(255,255,255,0.1); padding: 8px; border-radius: 8px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                    <span style="font-size: 0.9em;">${file.name}</span>
                    ${isExcel && fileUrl ? '<span style="margin-left: auto; font-size: 0.75em; color: var(--accent-primary);">Klicka för att öppna →</span>' : ''}
                </div>
            `;
        }

        // Allow simple HTML in AI responses for formatting
        if (sender === 'ai') {
            // Convert markdown to HTML
            const htmlContent = markdownToHtml(text);
            content += htmlContent;

            // Add speak button for AI messages
            // Strip HTML tags for speech
            const textForSpeech = text.replace(/\u003c[^\u003e]*\u003e/g, ' ');
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

        // Add click handler for Excel files
        if (file && fileUrl) {
            const fileAttachment = bubbleDiv.querySelector('.file-attachment-clickable');
            if (fileAttachment) {
                fileAttachment.addEventListener('click', () => {
                    const url = fileAttachment.dataset.fileUrl;
                    const name = fileAttachment.dataset.fileName;
                    excelViewer.openExcelFile(url, name);
                });
            }
        }

        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(bubbleDiv);
        chatContainer.appendChild(messageDiv);

        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Upload file to Supabase Storage
    async function uploadFileToSupabase(file) {
        try {
            // Get current session for auth token
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('User not authenticated');

            // Convert file to base64
            const reader = new FileReader();
            const base64Data = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            // Get current company ID for file association
            const company = getCurrentCompany();

            // Call upload-file Edge Function
            const response = await fetch(`${SUPABASE_URL}/functions/v1/upload-file`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    filename: file.name,
                    fileData: base64Data,
                    mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    userId: session.user.id,
                    companyId: company ? company.id : null
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Upload failed');
            }

            const result = await response.json();
            return result.file.url; // Return the public URL
        } catch (error) {
            console.error('File upload error:', error);
            throw error;
        }
    }

    // Analyze Excel file with Claude for Swedish VAT reports
    async function analyzeExcelWithClaude(file) {
        try {
            // Get current session for auth token
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('User not authenticated');

            addMessage('Britta', 'Jag analyserar din Excel-fil... Detta kan ta några sekunder. ⏳');

            console.log('Analyzing Excel with Claude:', file.name);

            // Parse Excel file locally using SheetJS
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer);

            // Convert all sheets to JSON
            const sheets = {};
            workbook.SheetNames.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                sheets[sheetName] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            });

            console.log('Excel parsed locally, sheets:', Object.keys(sheets));

            // Call Claude Edge Function with JSON data instead of binary Excel
            const response = await fetch(`${SUPABASE_URL}/functions/v1/claude-analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({
                    filename: file.name,
                    sheets: sheets
                })
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('Claude analysis error response:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: error
                });

                // Show user-friendly error
                addMessage(`⚠️ **Kunde inte analysera Excel-filen**\n\nFel: ${error.error || 'Okänt fel'}\n\nFilen är uppladdad och kan öppnas i Excel-panelen.`, 'ai');

                throw new Error(error.error || 'Analysis failed');
            }

            const result = await response.json();
            console.log('Claude analysis complete:', result.report.period);

            return result.report; // Return structured VAT report
        } catch (error) {
            console.error('Excel analysis error:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    // Render Swedish VAT summary in chat
    function renderVATSummary(report) {
        const { period, company_name, summary, revenue, costs, vat_summary, warnings } = report;

        let summaryText = `**Sammanfattning för ${period}**\n\n`;

        if (company_name) {
            summaryText += `**Företag:** ${company_name}\n\n`;
        }

        // Revenue section
        summaryText += `**Intäkter:**\n\n`;
        revenue.forEach(r => {
            const vatInfo = r.is_vat_free ? '(momsfritt)' : `(${r.vat_rate}% moms)`;
            summaryText += `• ${r.description}: ${r.amount_excl_vat.toFixed(2)} SEK exkl moms ${vatInfo}\n`;
        });
        summaryText += `• **Total försäljning:** ${summary.total_revenue.toFixed(2)} SEK\n\n`;

        // Costs section
        summaryText += `**Kostnader:**\n\n`;
        costs.forEach(c => {
            const vatInfo = c.vat_amount ? `(+ ${c.vat_amount.toFixed(2)} SEK moms)` : '(momsfritt)';
            summaryText += `• ${c.description}: ${c.amount_excl_vat.toFixed(2)} SEK exkl moms ${vatInfo}\n`;
        });
        summaryText += `• **Totala kostnader:** ${summary.total_costs.toFixed(2)} SEK\n\n`;

        // VAT section
        summaryText += `**Momsredovisning:**\n\n`;
        summaryText += `• Utgående moms 25%: ${vat_summary.outgoing_vat_25.toFixed(2)} SEK\n`;
        if (vat_summary.outgoing_vat_12) {
            summaryText += `• Utgående moms 12%: ${vat_summary.outgoing_vat_12.toFixed(2)} SEK\n`;
        }
        if (vat_summary.outgoing_vat_6) {
            summaryText += `• Utgående moms 6%: ${vat_summary.outgoing_vat_6.toFixed(2)} SEK\n`;
        }
        summaryText += `• Ingående moms 25%: ${vat_summary.incoming_vat.toFixed(2)} SEK\n`;

        const vatAction = vat_summary.net_vat < 0 ? 'återfå' : 'betala';
        summaryText += `• **Moms att ${vatAction}:** ${Math.abs(vat_summary.net_vat).toFixed(2)} SEK\n\n`;

        // Result
        const resultLabel = summary.result < 0 ? '(förlust)' : '(vinst)';
        summaryText += `**Resultat:** ${summary.result.toFixed(2)} SEK ${resultLabel}`;

        // Warnings if any
        if (warnings && warnings.length > 0) {
            summaryText += `\n\n**⚠️ Varningar:**\n`;
            warnings.forEach(w => {
                summaryText += `• ${w}\n`;
            });
        }

        return summaryText;
    }


    async function simulateAIResponse(userMessage, attachedFile) {
        // Show typing indicator
        const typingIndicator = showTypingIndicator();

        try {
            // If Excel file is attached, provide a custom response
            const isExcel = attachedFile && (attachedFile.name.endsWith('.xlsx') || attachedFile.name.endsWith('.xls'));

            if (isExcel) {
                // Special handling for Excel files
                removeTypingIndicator(typingIndicator);
                addMessage(`📊 Excel-filen **${attachedFile.name}** har laddats upp! Klicka på filen ovan för att öppna den i Excel-panelen.`, 'ai');
            } else {
                // Normal AI response for other messages/files
                const response = await generateResponse(userMessage, attachedFile);
                removeTypingIndicator(typingIndicator);
                addMessage(response, 'ai');
            }
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
            // if (tabId === 'history') {
            //     renderHistory();
            // }
            // // If invoices tab, refresh list
            // if (tabId === 'invoices') {
            //     renderInvoices();
            // }
            // // If documents tab, refresh list
            // if (tabId === 'documents') {
            //     renderDocuments();
            // }
        });
    });

    // History Management - Load from current company
    const company = getCurrentCompany();
    let bookkeepingHistory = company.history || [];
    let supplierInvoices = company.invoices || [];
    let accountingDocuments = company.documents || [];
    let verificationCounter = company.verificationCounter || 1;

    function addToHistory(item, file = null, skipInvoice = false) {
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
        if (item.creditAccount === '2440' && !skipInvoice) {
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
            status: 'Ej attesterad',  // New: attestation status
            verId: item.verId,
            fileData: null,  // For future file attachments
            fileName: null,
            attestedDate: null
        };
        supplierInvoices.push(invoice);

        // Save to current company
        const company = getCurrentCompany();
        company.invoices = supplierInvoices;
        saveCompanies();
    }

    // Attestera faktura - Send to Britta for AI analysis and auto-book
    async function attestInvoice(invoiceId) {
        const invoice = supplierInvoices.find(inv => inv.id === invoiceId);
        if (!invoice) return;

        // Update status to show processing
        invoice.status = 'Under attestering...';
        // renderInvoices();

        try {
            // Build prompt for Britta AI
            const prompt = `Analysera denna leverantörsfaktura och ge ett konteringsförslag:

Leverantör: ${invoice.supplier}
Belopp: ${invoice.amount} kr
Datum: ${invoice.date}
Förfallodatum: ${invoice.dueDate}

Ge mig ett exakt konteringsförslag enligt BAS 2024-kontoplanen.
VIKTIGT: Returnera ENDAST ett JSON-objekt i ett kodblock, inget annat text:

\`\`\`json
{
    "description": "Beskrivning av transaktionen",
    "amount": ${invoice.amount},
    "debitAccount": "XXXX",
    "creditAccount": "2440",
    "vatAmount": "0",
    "vatAccount": ""
}
\`\`\``;

            // Call Britta AI
            const response = await callGeminiAPI(prompt);

            // Parse JSON from response
            const bookingData = parseBookingData(response);

            if (bookingData) {
                // Auto-book the invoice
                const verificationEntry = {
                    date: invoice.date,
                    description: bookingData.description || `Inköp - ${invoice.supplier}`,
                    amount: bookingData.amount,
                    debitAccount: bookingData.debitAccount,
                    creditAccount: bookingData.creditAccount,
                    status: 'Bokförd'
                };

                addToHistory(verificationEntry, null, true);

                // Update invoice status
                invoice.status = 'Attesterad';
                invoice.attestedDate = new Date().toISOString();
                invoice.verId = `A-${verificationCounter - 1}`; // Get the verId from just-created verification

                const company = getCurrentCompany();
                company.invoices = supplierInvoices;
                saveCompanies();

                // renderInvoices();

                // Show success message in chat (optional)
                addMessage(`
                    <p><strong>✅ Faktura attesterad och bokförd!</strong></p>
                    <p>Leverantör: ${invoice.supplier}</p>
                    <p>Belopp: ${invoice.amount} kr</p>
                    <p>Verifikat: ${invoice.verId}</p>
                    <p>Debet: ${bookingData.debitAccount} / Kredit: ${bookingData.creditAccount}</p>
                `, 'ai');
            } else {
                throw new Error('Kunde inte tolka bokföringsförslag från AI');
            }

        } catch (error) {
            console.error('Attestering failed:', error);
            invoice.status = 'Ej attesterad';
            // renderInvoices();

            addMessage(`
                <p><strong>❌ Attestering misslyckades</strong></p>
                <p>Fel: ${error.message}</p>
                <p>Försök igen eller bokför manuellt.</p>
            `, 'ai');
        }
    }

    // Parse booking data from AI response
    function parseBookingData(responseText) {
        try {
            // Try to find JSON code block
            const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1]);
            }

            // Try to parse raw JSON
            const objMatch = responseText.match(/\{[\s\S]*\}/);
            if (objMatch) {
                return JSON.parse(objMatch[0]);
            }

            return null;
        } catch (e) {
            console.error('Failed to parse booking data:', e);
            return null;
        }
    }

    // Expose attestInvoice to global scope
    window.attestInvoice = attestInvoice;


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

        // renderInvoices();
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

            // Determine status badge and action button
            let statusBadge, actionButton;

            if (item.status === 'Ej attesterad') {
                statusBadge = '<span class="status-badge unattested">🔴 Ej attesterad</span>';
                actionButton = `<button class="attest-btn" onclick="attestInvoice(${item.id})">Attestera</button>`;
            } else if (item.status === 'Attesterad') {
                statusBadge = '<span class="status-badge attested">🟡 Attesterad</span>';
                actionButton = `<button class="pay-btn" onclick="payInvoice(${item.id})">Betala</button>`;
            } else if (item.status === 'Betald') {
                statusBadge = '<span class="status-badge booked">🟢 Betald</span>';
                actionButton = '<button class="pay-btn" disabled>Betald</button>';
            }

            tr.innerHTML = `
                <td>${item.dueDate}</td>
                <td>${item.supplier}</td>
                <td>${item.amount} kr</td>
                <td>${statusBadge}</td>
                <td>${actionButton}</td>
            `;
            invoicesList.appendChild(tr);
        });
    }

    // Pending file state for unrecognized uploads
    let pendingFile = null;

    // Supabase Configuration
    // Agent Server Configuration
    // Supabase Configuration
    const SUPABASE_URL = 'https://baweorbvueghhkzlyncu.supabase.co'; // Production URL
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhd2VvcmJ2dWVnaGhremx5bmN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2Mjk4MTYsImV4cCI6MjA3OTIwNTgxNn0.IkPVcD_shy7vPLuQdwLjzK4NoIEHUbUGdWjGVxt-tic';
    const AGENT_SERVER_URL = `${SUPABASE_URL}/functions/v1`;

    // --- Authentication & Initialization ---

    // Initialize Supabase client
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Async initialization function
    async function initApp() {
        // Check Authentication State
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            // Redirect to login if not authenticated
            window.location.href = '/login.html';
            return; // Stop execution
        }

        console.log('User authenticated:', session.user.email);

        // Add Logout Button Logic (if button exists)
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                await supabase.auth.signOut();
                window.location.href = '/login.html';
            });
        }
    }

    // Start initialization
    initApp();

    // --- Tool Execution Logic ---

    async function executeTool(toolCall) {
        if (toolCall.tool === 'browser_action') {
            try {
                const response = await fetch('http://localhost:3001/api/browse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(toolCall.args)
                });
                const result = await response.json();

                // Handle error with screenshot
                if (!result.success && result.screenshot) {
                    const imgId = 'error-view-' + Date.now();
                    addMessage(`
                        <div class="agent-screenshot-container error">
                            <p style="font-size: 0.8em; color: var(--error-color); margin-bottom: 5px;">⚠️ Något gick fel. Britta ser:</p>
                            <img src="data:image/jpeg;base64,${result.screenshot}" 
                                 style="max-width: 100%; border-radius: 8px; border: 2px solid var(--error-color); box-shadow: 0 2px 8px rgba(255,0,0,0.1);" 
                                 alt="Error view">
                        </div>
                    `, 'ai');

                    // Pass screenshot to LLM for analysis, but mark as error
                    return {
                        error: result.error,
                        screenshot: result.screenshot
                    };
                }

                return result;
            } catch (error) {
                console.error("Agent Server Error:", error);
                return { error: "Could not contact local Agent Server. Is it running?" };
            }
        }
        return { error: "Unknown tool" };
    }

    async function callAgentAPI(message, userId = 'default-user', fileData = null) {
        const apiUrl = `${AGENT_SERVER_URL}/gemini-chat`;

        const requestBody = {
            message: message
        };

        // Only include fileData if it exists
        if (fileData) {
            requestBody.fileData = fileData;
        }

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': userId  // Add user ID header for rate limiting
                },
                body: JSON.stringify(requestBody)
            });

            // Check for rate limiting
            if (response.status === 429) {
                const errorData = await response.json();
                showRateLimitBanner(errorData);
                return {
                    type: 'text',
                    data: '⚠️ Du har nått din dagliga gräns för AI-frågor. Uppgradera till Pro för obegränsad åtkomst!'
                };
            }

            if (!response.ok) {
                // Try to get error details from response
                let errorDetails = `HTTP error! status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    console.error('Backend error response:', errorData);
                    errorDetails = errorData.error || errorData.message || errorDetails;
                } catch (e) {
                    console.error('Could not parse error response');
                }
                throw new Error(errorDetails);
            }

            const data = await response.json();
            return data; // Returns { type: 'text' | 'json', data: ... }

        } catch (error) {
            console.error('Error calling Agent Server:', error);
            console.error('Request was:', { message, userId, fileData: fileData ? 'present' : 'none' });
            return { type: 'text', data: `Fel vid anslutning till servern: ${error.message}` };
        }
    }

    async function executeFortnoxAction(payload) {
        const apiUrl = `${AGENT_SERVER_URL}/fortnox`;

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
                            action: 'createInvoice',
                            payload: invoiceData
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
        console.log('generateResponse called with input:', input, 'file:', !!file);
        const userId = getCurrentCompany().id;

        let fileData = null;

        // Process file if attached (but skip Excel files - they're only for viewing)
        if (file) {
            const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

            if (isExcel) {
                // Don't send Excel files to Gemini - they're only uploaded to Supabase for viewing
                console.log('Skipping Excel file from Gemini API - will be viewable in Excel panel');
            } else {
                // Process other files (images, PDFs, etc.) for Gemini
                try {
                    const base64 = await fileToBase64(file);
                    const base64Data = base64.split(',')[1]; // Remove data:image/png;base64, prefix

                    fileData = {
                        mimeType: file.type,
                        data: base64Data
                    };
                } catch (error) {
                    console.error('Error processing file:', error);
                    // Continue without file if there's an error
                }
            }
        }

        // Call Agent API with file data if available
        console.log('Calling callAgentAPI with input:', input);
        const responseData = await callAgentAPI(input, userId, fileData);

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

    // Helper function to convert file to base64
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Helper function to describe actions in Swedish
    function getActionDescription(toolCall) {
        const action = toolCall.args.action;
        switch (action) {
            case 'goto':
                return `Navigerar till ${toolCall.args.url}`;
            case 'click':
                return `Klickar på element "${toolCall.args.selector}"`;
            case 'type':
                return `Skriver "${toolCall.args.text}" i fält "${toolCall.args.selector}"`;
            case 'screenshot':
                return `Tar en skärmdump`;
            case 'content':
                return `Läser sidans innehåll`;
            default:
                return `Utför ${action}`;
        }
    }

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js')
                .then((registration) => {
                    console.log('✅ Service Worker registered successfully:', registration.scope);
                })
                .catch((error) => {
                    console.log('❌ Service Worker registration failed:', error);
                });
        });
    }

    // Quick Action Helper
    window.setInputValue = (text) => {
        const input = document.getElementById('user-input');
        input.value = text;
        input.focus();
        // Optional: Auto-submit
        // document.getElementById('chat-form').dispatchEvent(new Event('submit'));
    };

    // ===== RATE LIMIT BANNER LOGIC =====
    let rateLimitReached = false;
    let rateLimitResetAt = null;

    // Show rate limit banner
    function showRateLimitBanner(data) {
        rateLimitReached = true;
        rateLimitResetAt = data.resetAt ? new Date(data.resetAt) : null;

        const banner = document.getElementById('rate-limit-banner');
        const message = document.getElementById('rate-limit-message');
        const progress = document.getElementById('rate-limit-progress');

        if (!banner) return;

        // Update message
        if (rateLimitResetAt) {
            const resetTime = rateLimitResetAt.toLocaleTimeString('sv-SE', {
                hour: '2-digit',
                minute: '2-digit'
            });
            message.textContent = `${data.message || 'Du har nått din API-gräns.'} Återställs ${resetTime}.`;
        } else {
            message.textContent = data.message || 'Du har använt dina gratis AI-frågor för idag.';
        }

        // Update progress (0% when limit reached)
        if (progress) {
            progress.style.width = '0%';
        }

        // Show banner with animation
        banner.classList.remove('hidden');

        console.log('Rate limit banner shown:', data);
    }

    // Hide rate limit banner
    function hideRateLimitBanner() {
        rateLimitReached = false;
        const banner = document.getElementById('rate-limit-banner');
        if (banner) {
            banner.classList.add('hidden');
        }
    }

    // Update progress bar based on usage
    function updateRateLimitProgress(remaining, total) {
        const progress = document.getElementById('rate-limit-progress');
        if (!progress) return;

        const percentage = (remaining / total) * 100;
        progress.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
    }

    // Show soft warning at 80% usage
    function checkUsageWarning(remaining, total) {
        const usagePercentage = ((total - remaining) / total) * 100;

        if (usagePercentage >= 80 && usagePercentage < 100) {
            addMessage(`⚠️ Du har använt ${Math.floor(usagePercentage)}% av dina AI-frågor. ${remaining} kvar idag.`, 'ai');
        }
    }

    // Handle banner close
    const closeBannerBtn = document.getElementById('close-banner-btn');
    if (closeBannerBtn) {
        closeBannerBtn.addEventListener('click', () => {
            hideRateLimitBanner();
        });
    }

    // Handle upgrade button
    const upgradeBtn = document.getElementById('upgrade-btn');
    if (upgradeBtn) {
        upgradeBtn.addEventListener('click', () => {
            addMessage('💎 Pro-planer kommer snart! Håll utkik.', 'ai');
            // TODO: Navigate to pricing page when implemented
        });
    }

    // Test function to show banner (for demo purposes)
    window.testRateLimitBanner = () => {
        showRateLimitBanner({
            message: 'Daily limit reached (50 requests/day)',
            resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour from now
        });
    };

    // Expose functions for testing
    window.showRateLimitBanner = showRateLimitBanner;
    window.hideRateLimitBanner = hideRateLimitBanner;
    window.updateRateLimitProgress = updateRateLimitProgress;
});
