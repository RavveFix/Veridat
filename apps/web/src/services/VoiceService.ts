export class VoiceService {
    private recognition: SpeechRecognition | null = null;
    private isListening: boolean = false;
    private onResultCallback: ((text: string) => void) | null = null;
    private onStateChangeCallback: ((isListening: boolean) => void) | null = null;
    private onAudioLevelCallback: ((level: number) => void) | null = null;

    // Audio analysis
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private microphone: MediaStreamAudioSourceNode | null = null;
    private animationFrame: number | null = null;

    constructor() {
        const recognitionCtor = this.getSpeechRecognitionCtor();
        if (recognitionCtor) {
            this.recognition = new recognitionCtor();
            this.setupRecognition();
            return;
        }

        console.warn('Web Speech API not supported in this browser.');
    }

    private getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
        const speechWindow = window as Window & {
            SpeechRecognition?: new () => SpeechRecognition;
            webkitSpeechRecognition?: new () => SpeechRecognition;
        };
        return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
    }

    private setupRecognition() {
        const recognition = this.recognition;
        if (!recognition) return;

        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'sv-SE'; // Swedish

        recognition.onstart = () => {
            this.isListening = true;
            this.notifyStateChange();
            this.startAudioAnalysis();
        };

        recognition.onend = () => {
            this.isListening = false;
            this.notifyStateChange();
            this.stopAudioAnalysis();
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            if (this.onResultCallback) {
                // Prefer final, fallback to interim for real-time feedback
                this.onResultCallback(finalTranscript || interimTranscript);
            }
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error('Speech recognition error', event.error);
            this.isListening = false;
            this.notifyStateChange();
            this.stopAudioAnalysis();
        };
    }

    private async startAudioAnalysis() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const audioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!audioContextCtor) {
                throw new Error('AudioContext not supported');
            }
            this.audioContext = new audioContextCtor();
            this.analyser = this.audioContext.createAnalyser();
            this.microphone = this.audioContext.createMediaStreamSource(stream);

            this.analyser.fftSize = 256;
            this.microphone.connect(this.analyser);

            this.analyzeAudio();
        } catch (error) {
            console.error('Failed to start audio analysis:', error);
        }
    }

    private analyzeAudio() {
        if (!this.analyser) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const analyze = () => {
            if (!this.isListening || !this.analyser) return;

            this.analyser.getByteFrequencyData(dataArray);

            // Calculate average volume
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;

            // Normalize to 0-1 range and apply sensitivity
            const normalizedLevel = Math.min(average / 128, 1);

            if (this.onAudioLevelCallback) {
                this.onAudioLevelCallback(normalizedLevel);
            }

            this.animationFrame = requestAnimationFrame(analyze);
        };

        analyze();
    }

    private stopAudioAnalysis() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.analyser = null;
    }

    public start() {
        if (this.recognition && !this.isListening) {
            try {
                this.recognition.start();
            } catch (e) {
                console.error('Failed to start recognition:', e);
            }
        }
    }

    public stop() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    }

    public toggle() {
        if (this.isListening) {
            this.stop();
        } else {
            this.start();
        }
    }

    public cancel() {
        if (this.recognition && this.isListening) {
            this.recognition.abort();
            this.isListening = false;
            this.notifyStateChange();
            this.stopAudioAnalysis();
        }
    }

    public onResult(callback: (text: string) => void) {
        this.onResultCallback = callback;
    }

    public onStateChange(callback: (isListening: boolean) => void) {
        this.onStateChangeCallback = callback;
    }

    public onAudioLevel(callback: (level: number) => void) {
        this.onAudioLevelCallback = callback;
    }

    private notifyStateChange() {
        if (this.onStateChangeCallback) {
            this.onStateChangeCallback(this.isListening);
        }
    }

    public isSupported(): boolean {
        return !!this.recognition;
    }
}
