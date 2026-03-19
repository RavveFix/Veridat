# File Upload Loading State

## Goal

Prevent users from sending messages before attached files are fully processed (base64/PDF extraction). Show visual feedback during processing.

## Current Behavior

1. User clicks attach -> file stored as raw `File` object in `this.currentFile`
2. File chip shown immediately (filename only)
3. Send button enabled — user can submit immediately
4. Base64 conversion + PDF extraction runs synchronously at submit time
5. No indication that file processing is happening

## New Behavior

1. User clicks attach -> file chip shown with **spinner**
2. **Send button disabled** while file processes
3. Base64 conversion + PDF extraction runs **asynchronously at file selection**
4. On success: spinner removed, processed data cached, send button enabled
5. On failure: file removed, toast error shown, send button enabled

## Architecture

### State

In `ChatController`:
- `fileProcessing: boolean` — true while async processing runs
- `processedFileData: { base64: Base64Result, pdfText?: string, pdfPages?: PageData[] } | null` — cached result

### Flow

```
File selected
  → showFilePreview(name, loading=true)
  → disable send button
  → fileProcessing = true
  → async: validate file, run base64/PDF extraction
    → success: processedFileData = result, fileProcessing = false, setFilePreviewReady(), enable send
    → error: clearFile(), showToast(error), fileProcessing = false, enable send

Submit
  → if fileProcessing → return early (safety guard)
  → use processedFileData instead of processing at submit time
  → rest of submit unchanged

Clear file
  → processedFileData = null
  → fileProcessing = false
```

### Files to Modify

| File | Change |
|------|--------|
| `ChatController.ts` | Add `fileProcessing`, `processedFileData`, async processing in `setupFileHandlers`, guard in `handleFormSubmit` |
| `UIService.ts` | `showFilePreview(name, loading?)`, new `setFilePreviewReady()` |
| `index.html` | Add spinner element inside `#file-preview` |
| `main.css` | `.file-preview-spinner`, `.file-preview.loading` styles |

### Send Button Disable Logic

Reuse existing pattern — `sendButton.disabled = true` while `fileProcessing`. The button is already toggled in `handleFormSubmit`; add a second toggle point in the file selection handler.

### Visual

- Spinner: 12px rotating border (same style as `.btn-spinner` but smaller)
- Placed after filename text in the file chip
- On ready: spinner hidden (no checkmark — keep it simple)
- File chip keeps existing cyan styling throughout

### Error Handling

- File validation failure (wrong type, too large): toast with Swedish message, file removed
- Base64/PDF extraction failure: toast "Kunde inte bearbeta filen", file removed
- Send button re-enabled on any error path
