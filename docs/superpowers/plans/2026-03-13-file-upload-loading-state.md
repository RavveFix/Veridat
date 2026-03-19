# File Upload Loading State Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent users from sending messages before attached files are fully processed by moving base64/PDF processing to file selection time and showing a loading spinner.

**Architecture:** Add `fileProcessing` and `processedFileData` state to ChatController. On file selection, validate and process the file asynchronously while showing a spinner on the file chip and disabling the send button. On submit, use cached processed data instead of processing inline.

**Tech Stack:** TypeScript, vanilla DOM, CSS animations

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/web/app/index.html` | Modify | Add spinner element inside file-preview chip |
| `apps/web/src/styles/main.css` | Modify | Add `.file-preview-spinner` and `.file-preview.loading` styles |
| `apps/web/src/services/UIService.ts` | Modify | Add `loading` param to `showFilePreview`, add `setFilePreviewReady()` |
| `apps/web/src/controllers/ChatController.ts` | Modify | Add async file processing on selection, guard on submit |
| `apps/web/src/services/ChatService.ts` | Modify | Accept pre-processed file data in `sendToGemini` |

---

### Task 1: HTML & CSS — Spinner in File Chip

**Files:**
- Modify: `apps/web/app/index.html:267-270`
- Modify: `apps/web/src/styles/main.css:2647-2663`

- [ ] **Step 1: Add spinner element to file-preview chip**

In `apps/web/app/index.html`, replace:
```html
<div id="file-preview" class="file-preview hidden">
    <span class="file-name">file.pdf</span>
    <button type="button" class="remove-file">×</button>
</div>
```

With:
```html
<div id="file-preview" class="file-preview hidden">
    <span class="file-preview-spinner"></span>
    <span class="file-name">file.pdf</span>
    <button type="button" class="remove-file">×</button>
</div>
```

- [ ] **Step 2: Add CSS for spinner and loading state**

In `apps/web/src/styles/main.css`, after the existing `.file-preview.hidden` rule (around line 2663), add:

```css
/* File preview loading state */
.file-preview-spinner {
    display: none;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(0, 240, 255, 0.3);
    border-top-color: rgba(0, 240, 255, 0.9);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
}

.file-preview.loading .file-preview-spinner {
    display: inline-block;
}

.file-preview.loading {
    opacity: 0.7;
}
```

Note: The `spin` keyframe already exists in main.css (used by `.btn-spinner`). Verify with: `grep -n '@keyframes spin' apps/web/src/styles/main.css`

- [ ] **Step 3: Verify visually**

Run: `npm run dev`
In the browser, inspect the `#file-preview` element and manually toggle the `loading` class to confirm the spinner appears and the chip dims.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/index.html apps/web/src/styles/main.css
git commit -m "feat(ui): add spinner element and loading styles to file preview chip"
```

---

### Task 2: UIService — Loading-Aware File Preview

**Files:**
- Modify: `apps/web/src/services/UIService.ts:160-178`

- [ ] **Step 1: Update `showFilePreview` to accept `loading` parameter**

In `apps/web/src/services/UIService.ts`, replace the existing `showFilePreview` method:

```typescript
showFilePreview(fileName: string): void {
    const { filePreview, fileNameSpan, userInput } = this.elements;
    if (fileNameSpan) fileNameSpan.textContent = fileName;
    if (filePreview) filePreview.classList.remove('hidden');
    if (userInput) userInput.focus();
}
```

With:

```typescript
showFilePreview(fileName: string, loading = false): void {
    const { filePreview, fileNameSpan, userInput } = this.elements;
    if (fileNameSpan) fileNameSpan.textContent = fileName;
    if (filePreview) {
        filePreview.classList.remove('hidden');
        if (loading) {
            filePreview.classList.add('loading');
        } else {
            filePreview.classList.remove('loading');
        }
    }
    if (userInput) userInput.focus();
}
```

- [ ] **Step 2: Add `setFilePreviewReady` method**

After `clearFilePreview()`, add:

```typescript
/**
 * Remove loading state from file preview (processing complete)
 */
setFilePreviewReady(): void {
    const { filePreview } = this.elements;
    if (filePreview) filePreview.classList.remove('loading');
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/UIService.ts
git commit -m "feat(ui): add loading state support to file preview methods"
```

---

### Task 3: ChatService — Accept Pre-Processed File Data

**Files:**
- Modify: `apps/web/src/services/ChatService.ts:176-220`

The current `sendToGemini` method accepts a raw `File` and processes it inline (lines 192-220). We need to also accept pre-processed data so the caller can skip inline processing.

- [ ] **Step 1: Add `ProcessedFileData` type and optional parameter**

At the top of `ChatService.ts` (near the other type imports), add:

```typescript
export interface ProcessedFileData {
    fileData: { data: string; mimeType: string } | null;
    fileDataPages: Array<{ pageNumber?: number; data: string; mimeType: string }> | null;
    documentText: string | null;
}
```

- [ ] **Step 2: Update `sendToGemini` signature and body**

Change the method signature from:

```typescript
async sendToGemini(
    message: string,
    file: File | null = null,
    fileUrl: string | null = null,
    vatReportContext: Record<string, unknown> | null = null,
    onStreamingChunk?: (chunk: string) => void,
    assistantMode: 'agent' | 'skill_assist' | null = null
): Promise<GeminiResponse> {
```

To:

```typescript
async sendToGemini(
    message: string,
    file: File | null = null,
    fileUrl: string | null = null,
    vatReportContext: Record<string, unknown> | null = null,
    onStreamingChunk?: (chunk: string) => void,
    assistantMode: 'agent' | 'skill_assist' | null = null,
    preProcessed?: ProcessedFileData
): Promise<GeminiResponse> {
```

Then replace the file processing block (lines 188-220):

```typescript
// Prepare file data if present
let fileData: { data: string; mimeType: string } | null = null;
let fileDataPages: Array<{ pageNumber?: number; data: string; mimeType: string }> | null = null;
let documentText: string | null = null;

if (file) {
    if (fileService.isPdf(file)) {
        // ... PDF extraction ...
    } else {
        // ... base64 conversion ...
    }
}
```

With:

```typescript
// Prepare file data — use pre-processed if available, otherwise process inline
let fileData: { data: string; mimeType: string } | null = null;
let fileDataPages: Array<{ pageNumber?: number; data: string; mimeType: string }> | null = null;
let documentText: string | null = null;

if (preProcessed) {
    fileData = preProcessed.fileData;
    fileDataPages = preProcessed.fileDataPages;
    documentText = preProcessed.documentText;
} else if (file) {
    if (fileService.isPdf(file)) {
        try {
            const pdf = await fileService.extractPdfForChat(file);
            documentText = pdf.documentText || null;

            if (pdf.pageImages.length > 0) {
                fileDataPages = pdf.pageImages.map((p) => ({
                    pageNumber: p.pageNumber,
                    data: p.data,
                    mimeType: p.mimeType
                }));
            }
        } catch (pdfError) {
            logger.warn('PDF extraction failed, falling back to raw upload payload', { error: pdfError });
            const base64Result = await fileService.toBase64WithPadding(file);
            fileData = {
                data: base64Result.data,
                mimeType: base64Result.mimeType
            };
        }
    } else {
        const base64Result = await fileService.toBase64WithPadding(file);
        fileData = {
            data: base64Result.data,
            mimeType: base64Result.mimeType
        };
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/ChatService.ts
git commit -m "feat(chat): accept pre-processed file data in sendToGemini"
```

---

### Task 4: ChatController — Async File Processing on Selection

**Files:**
- Modify: `apps/web/src/controllers/ChatController.ts`

This is the main task. Add state properties, process files at selection, disable send during processing, and use cached data at submit.

- [ ] **Step 1: Add state properties**

In `ChatController` class, after `private agentMode: boolean = false;` (line 34), add:

```typescript
private fileProcessing: boolean = false;
private processedFileData: import('../services/ChatService').ProcessedFileData | null = null;
```

Add the import at the top — update the existing ChatService import:

```typescript
import { chatService, type AIAnalysisProgress, type ProcessedFileData } from '../services/ChatService';
```

- [ ] **Step 2: Add helper to toggle send button based on file processing**

After the `clearFile` method (line 897), add:

```typescript
private setSendButtonEnabled(enabled: boolean): void {
    const { chatForm } = uiController.elements;
    const sendButton = chatForm?.querySelector('button[type="submit"]') as HTMLButtonElement;
    if (sendButton) sendButton.disabled = !enabled;
}
```

- [ ] **Step 3: Update `setupFileHandlers` to process files asynchronously**

Replace the existing `setupFileHandlers` method:

```typescript
private setupFileHandlers(): void {
    const { fileInput, attachBtn, removeFileBtn } = uiController.elements;

    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files.length > 0) {
                this.currentFile = target.files[0];
                uiController.showFilePreview(this.currentFile.name);
            }
        });
    }

    if (removeFileBtn) {
        removeFileBtn.addEventListener('click', () => this.clearFile());
    }
}
```

With:

```typescript
private setupFileHandlers(): void {
    const { fileInput, attachBtn, removeFileBtn } = uiController.elements;

    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files.length > 0) {
                this.currentFile = target.files[0];
                this.processSelectedFile(this.currentFile);
            }
        });
    }

    if (removeFileBtn) {
        removeFileBtn.addEventListener('click', () => this.clearFile());
    }
}

private async processSelectedFile(file: File): Promise<void> {
    // Show file chip with loading spinner
    uiController.showFilePreview(file.name, true);
    this.fileProcessing = true;
    this.processedFileData = null;
    this.setSendButtonEnabled(false);

    // Validate file
    const validation = fileService.validate(file);
    if (!validation.valid) {
        this.showToast(validation.error || 'Filen kunde inte valideras', 'error');
        this.clearFile();
        return;
    }

    // Skip pre-processing for Excel files (handled separately at submit)
    if (fileService.isExcel(file)) {
        this.fileProcessing = false;
        uiController.setFilePreviewReady();
        this.setSendButtonEnabled(true);
        return;
    }

    // Process PDF/image files
    try {
        let fileData: { data: string; mimeType: string } | null = null;
        let fileDataPages: Array<{ pageNumber?: number; data: string; mimeType: string }> | null = null;
        let documentText: string | null = null;

        if (fileService.isPdf(file)) {
            try {
                const pdf = await fileService.extractPdfForChat(file);
                documentText = pdf.documentText || null;
                if (pdf.pageImages.length > 0) {
                    fileDataPages = pdf.pageImages.map((p) => ({
                        pageNumber: p.pageNumber,
                        data: p.data,
                        mimeType: p.mimeType
                    }));
                }
            } catch (pdfError) {
                logger.warn('PDF extraction failed, falling back to base64', { error: pdfError });
                const base64Result = await fileService.toBase64WithPadding(file);
                fileData = { data: base64Result.data, mimeType: base64Result.mimeType };
            }
        } else {
            const base64Result = await fileService.toBase64WithPadding(file);
            fileData = { data: base64Result.data, mimeType: base64Result.mimeType };
        }

        // Check if file was cleared while processing
        if (this.currentFile !== file) return;

        this.processedFileData = { fileData, fileDataPages, documentText };
        this.fileProcessing = false;
        uiController.setFilePreviewReady();
        this.setSendButtonEnabled(true);
    } catch (error) {
        logger.error('File processing failed', { error });
        this.showToast('Kunde inte bearbeta filen. Försök igen.', 'error');
        this.clearFile();
    }
}

private showToast(message: string, type: 'success' | 'error' = 'success'): void {
    const existing = document.querySelector('.toast-inline');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-inline ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
```

- [ ] **Step 4: Update `clearFile` to reset processing state**

Replace:

```typescript
clearFile(): void {
    this.currentFile = null;
    uiController.clearFilePreview();
}
```

With:

```typescript
clearFile(): void {
    this.currentFile = null;
    this.processedFileData = null;
    this.fileProcessing = false;
    this.setSendButtonEnabled(true);
    uiController.clearFilePreview();
}
```

- [ ] **Step 5: Guard `handleFormSubmit` against in-progress processing**

After the existing `conversationLoading` guard (line 566-569), add:

```typescript
// Block submission while file is still being processed
if (this.fileProcessing) {
    logger.debug('Form submission blocked - file still processing');
    return;
}
```

- [ ] **Step 6: Pass pre-processed data to `sendToGemini`**

In `handleFormSubmit`, find the call to `chatService.sendToGemini` (around line 784):

```typescript
const response = await chatService.sendToGemini(
    userMessage,
    fileForGemini,
    fileUrl,
    vatContext,
    (chunk) => {
        // ...
    },
    shouldUseAgent ? 'agent' : null
);
```

Change to:

```typescript
const preProcessed = fileForGemini ? this.processedFileData ?? undefined : undefined;
const response = await chatService.sendToGemini(
    userMessage,
    preProcessed ? null : fileForGemini,
    fileUrl,
    vatContext,
    (chunk) => {
        didStream = true;
        window.dispatchEvent(new CustomEvent('chat-streaming-chunk', {
            detail: { chunk, isNewResponse: isFirstChunk }
        }));
        isFirstChunk = false;
    },
    shouldUseAgent ? 'agent' : null,
    preProcessed
);
```

When `preProcessed` is available, pass `null` as the file (no need to re-process) and pass the cached data instead.

- [ ] **Step 7: Verify end-to-end**

Run: `npm run dev`

Test scenarios:
1. **PDF file**: Attach → spinner shows → spinner disappears → send → AI analyzes correctly
2. **Image file**: Attach → brief spinner → ready → send works
3. **Excel file**: Attach → no spinner (Excel skips pre-processing) → send routes to Excel handler
4. **Invalid file type**: Attach → toast error → file removed → send button enabled
5. **Large PDF (>5MB)**: Attach → toast "för stor" → file removed
6. **Remove file during processing**: Click × while spinner → file cleared, no errors
7. **Send button**: Verify disabled during processing, enabled after

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/controllers/ChatController.ts
git commit -m "feat(chat): process files asynchronously on selection with loading state"
```
