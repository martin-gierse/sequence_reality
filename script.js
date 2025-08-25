// --- CONFIGURATION ---
let NUM_TRACKS = 4;
const NUM_STEPS = 16;

// --- DOM ELEMENTS ---
const recordSampleButton = document.getElementById('recordSampleButton'); 
const recordingStatus = document.getElementById('recordingStatus');
const sampleList = document.getElementById('sampleList');
const sequencerGridContainer = document.getElementById('sequencerGrid');
const playButton = document.getElementById('playButton');
const stopButton = document.getElementById('stopButton');
const tempoInput = document.getElementById('tempo');
const messageArea = document.getElementById('messageArea');
const micSelect = document.getElementById('micSelect');
const refreshDevicesButton = document.getElementById('refreshDevicesButton');
const permissionStatus = document.getElementById('permissionStatus');
const prevPresetButton = document.getElementById('prevPresetButton');
const nextPresetButton = document.getElementById('nextPresetButton');
const presetNameDisplay = document.getElementById('presetNameDisplay');

// Modal elements
const sampleModal = document.getElementById('sampleModal');
const closeModalButton = document.getElementById('closeModalButton');
const modalSampleList = document.getElementById('modalSampleList');
const modalNoSamples = document.getElementById('modalNoSamples');

// --- STATE & CONSTANTS ---
const originalRecordButtonHTML = recordSampleButton.innerHTML;
let trackVolumes = new Array(NUM_TRACKS).fill(null).map(() => new Tone.Volume(0).toDestination());
let trackStates = new Array(NUM_TRACKS).fill(null).map(() => ({ muted: false }));
const PRESETS = [
    {
        name: "INIT",
        bpm: 120,
        pattern: Array(4).fill(null).map(() => Array(16).fill(false))
    },
    {
        name: "HOUSE",
        bpm: 125,
        pattern: [
            [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
            [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
            [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]
        ]
    },
    {
        name: "TECHNO",
        bpm: 135,
        pattern: [
            [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
            [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true]
        ]
    },
    {
        name: "REGGAETON",
        bpm: 95,
        pattern: [
            [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
            [false, false, false, true, false, false, true, false, false, false, false, true, false, false, true, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]
        ]
    },
    {
        name: "HIP HOP",
        bpm: 90,
        pattern: [
            [true, false, false, false, false, false, true, false, true, false, false, false, false, false, false, false],
            [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
            [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]
        ]
    },
    {
        name: "D&B",
        bpm: 174,
        pattern: [
            [true, false, false, false, false, false, false, false, false, false, true, false, false, false, false, false],
            [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
            [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
            [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true]
        ]
    }
];
let currentPresetIndex = 0;
let originalSampleState = null; // For reverting changes in editor


// --- HELPER FUNCTIONS ---
async function decodeWithContext(ctx, arrayBuffer) {
    return await new Promise((resolve, reject) => {
        try {
            const ret = ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
            if (ret && typeof ret.then === 'function') {
                ret.then(resolve).catch(reject);
            }
        } catch (e) {
            reject(e);
        }
    });
}
function bufferToWaveBlob(audioBuffer) {
    const numOfChan = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let offset = 0;
    let pos = 0;

    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8);
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt "
    setUint32(16);
    setUint16(1);
    setUint16(numOfChan);
    setUint32(audioBuffer.sampleRate);
    setUint32(audioBuffer.sampleRate * numOfChan * 2);
    setUint16(numOfChan * 2);
    setUint16(16);
    setUint32(0x61746164); // "data"
    setUint32(length - pos - 4);

    for (let i = 0; i < numOfChan; i++) channels.push(audioBuffer.getChannelData(i));
    while (pos < length) {
        const sample = Math.max(-1, Math.min(1, channels[0][offset] || 0));
        for (let ch = 0; ch < numOfChan; ch++) {
            const s = Math.max(-1, Math.min(1, (channels[ch] && channels[ch][offset]) || sample));
            view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            pos += 2;
        }
        offset++;
    }

    return new Blob([buffer], { type: 'audio/wav' });

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
}


// --- MOBILE AUDIO UNLOCK & CONTEXT HELPERS ---
let audioUnlocked = false;
const ua = navigator.userAgent || '';
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isWebKit = /AppleWebKit\//.test(ua) && !/Edge|Edg|OPR|Opera|Chromium/.test(ua);
const isSafariLike = isWebKit && (/Safari\//.test(ua) || isIOS);
async function ensureAudioRunning() {
    try { await Tone.start(); } catch (_) { }
    const ctx = Tone.getContext().rawContext;
    if (ctx && ctx.state !== 'running') {
        try { await ctx.resume(); } catch (_) { }
    }
    try {
        const ac = Tone.getContext().rawContext;
        const silent = ac.createBuffer(1, 1, ac.sampleRate);
        const src = ac.createBufferSource();
        src.buffer = silent;
        src.connect(ac.destination);
        src.start(0);
    } catch (_) { }
    return Tone.context.state === 'running' && Tone.getContext().rawContext.state === 'running';
}

function attachMobileAudioUnlock() {
    const tryUnlock = async () => {
        if (audioUnlocked) return;
        const ok = await ensureAudioRunning();
        if (ok) {
            audioUnlocked = true;
            window.removeEventListener('pointerdown', tryUnlock);
            window.removeEventListener('pointerup', tryUnlock);
            window.removeEventListener('mousedown', tryUnlock);
            window.removeEventListener('touchstart', tryUnlock);
            window.removeEventListener('touchend', tryUnlock);
            window.removeEventListener('click', tryUnlock);
            window.removeEventListener('keydown', tryUnlock);
        }
    };
    window.addEventListener('pointerdown', tryUnlock, { once: false, passive: true });
    window.addEventListener('pointerup', tryUnlock, { once: false, passive: true });
    window.addEventListener('mousedown', tryUnlock, { once: false });
    window.addEventListener('touchstart', tryUnlock, { once: false, passive: true });
    window.addEventListener('touchend', tryUnlock, { once: false, passive: true });
    window.addEventListener('click', tryUnlock, { once: false });
    window.addEventListener('keydown', tryUnlock, { once: false });
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
            await ensureAudioRunning();
        }
    });
    window.addEventListener('pageshow', async () => { await ensureAudioRunning(); });
}
attachMobileAudioUnlock();

// --- AUDIO CONTEXT & TONE.JS SETUP ---
let mic = null;
let recorder = null;
let isRecording = false;
const recordedSamples = [];
let trackPlayers = new Array(NUM_TRACKS).fill(null);
let sequencerData = Array(NUM_TRACKS).fill(null).map(() => Array(NUM_STEPS).fill(false));
let currentTrackToLoad = -1;
let currentStepIndicator = -1;

// Native MediaRecorder fallback
let useNativeRecorder = false;
let nativeMediaRecorder = null;
let nativeMediaStream = null;
let nativeChunks = [];
let nativeMimeType = '';
let selectedDeviceId = '';
let isMicOpen = false;

async function setupNativeRecorder() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return false;
    }
    try {
        if (isSafariLike) {
            return false;
        }
        const constraints = {
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
                deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined
            }
        };
        if (nativeMediaStream) {
            nativeMediaStream.getTracks().forEach(t => t.stop());
            nativeMediaStream = null;
        }
        nativeMediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        const mimeCandidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
        nativeMimeType = mimeCandidates.find(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) || '';
        nativeMediaRecorder = new MediaRecorder(nativeMediaStream, nativeMimeType ? { mimeType: nativeMimeType } : undefined);
        useNativeRecorder = true;
        recorder = {
            start: async () => {
                nativeChunks = [];
                nativeMediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) nativeChunks.push(e.data); };
                nativeMediaRecorder.start();
            },
            stop: async () => new Promise((resolve, reject) => {
                try {
                    nativeMediaRecorder.onstop = () => {
                        const blobType = nativeMimeType || (nativeChunks[0] && nativeChunks[0].type) || 'audio/webm';
                        resolve(new Blob(nativeChunks, { type: blobType }));
                    };
                    nativeMediaRecorder.stop();
                } catch (e) { reject(e); }
            })
        };
        console.log('Native MediaRecorder ready with type:', nativeMimeType || '(default)');
        showMessage(`Mic ready (native ${nativeMimeType || 'default'})`, 'success', 1500);
        return true;
    } catch (err) {
        console.error('Native MediaRecorder setup failed:', err);
        return false;
    }
}

async function listInputDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(d => d.kind === 'audioinput');
        micSelect.innerHTML = '';
        inputs.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || `Input ${micSelect.length + 1}`;
            micSelect.appendChild(opt);
        });
        if (!selectedDeviceId && inputs[0]) {
            selectedDeviceId = inputs[0].deviceId;
        }
        if (selectedDeviceId) micSelect.value = selectedDeviceId;
        permissionStatus.textContent = inputs.length ? 'Inputs available.' : 'No audio inputs found.';
    } catch (e) {
        console.error('enumerateDevices failed', e);
        permissionStatus.textContent = 'Unable to list devices (permission needed).';
    }
}

function showMessage(text, type = 'error', duration = 3000) {
    messageArea.textContent = text;
    messageArea.classList.remove('bg-red-500', 'bg-green-500', 'bg-blue-500', 'border-red-500', 'border-green-500', 'border-blue-500');
    messageArea.classList.remove('hidden', 'animate-pulse');

    if (type === 'error') {
        messageArea.classList.add('bg-red-500');
    } else if (type === 'success') {
        messageArea.classList.add('bg-green-500');
    } else {
        messageArea.classList.add('bg-blue-500');
    }
    void messageArea.offsetWidth;
    messageArea.classList.add('animate-pulse');
    setTimeout(() => {
        messageArea.classList.add('hidden');
        messageArea.classList.remove('animate-pulse');
    }, duration);
}

async function initAudio() {
    try {
        const nativeOk = await setupNativeRecorder();
        if (nativeOk) {
            console.log('Using native MediaRecorder for capture.');
            recordSampleButton.disabled = false;
            recordSampleButton.title = 'Record your sample';
            recordingStatus.textContent = '';
            await listInputDevices();
            return true;
        }

        if (mic && typeof mic.close === 'function') { try { mic.close(); } catch (_) { } }
        isMicOpen = false;
        mic = new Tone.UserMedia();
        const toneConstraints = selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : undefined;
        try {
            await mic.open(toneConstraints);
            isMicOpen = true;
        } catch (e) {
            await mic.open();
            isMicOpen = true;
        }
        const toneRecorder = new Tone.Recorder();
        mic.connect(toneRecorder);
        recorder = toneRecorder;
        recordSampleButton.disabled = false;
        recordSampleButton.title = 'Record your sample';
        recordingStatus.textContent = '';
        await listInputDevices();
        return true;
    } catch (err) {
        console.error('initAudio failed:', err);
        let errorMessage = `Microphone initialization failed.`;
        if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            errorMessage += ' No microphone found.';
        } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            errorMessage += ' Microphone permission was denied.';
        } else if (err.message) {
            errorMessage += ` Details: ${err.message}`;
        }
        errorMessage += ' Ensure you are on https or localhost.';
        showMessage(errorMessage, 'error', 8000);
        recordingStatus.textContent = 'Mic access failed.';
        recordSampleButton.disabled = true;
        recordSampleButton.title = 'Microphone unavailable';
        if (mic && typeof mic.close === 'function') { try { mic.close(); } catch (_) { } }
        mic = null;
        isMicOpen = false;
        return false;
    }
}

recordSampleButton.addEventListener('click', async () => {
    if (isRecording) {
        if (!recorder) return;
        try {
            const recordingBlob = await recorder.stop();
            
            isRecording = false;
            recordSampleButton.disabled = false;
            recordSampleButton.innerHTML = originalRecordButtonHTML;
            recordSampleButton.classList.remove('is-recording');
            recordingStatus.textContent = "Processing sample...";

            const sampleUrl = URL.createObjectURL(recordingBlob);
            const sampleName = `SAMPLE_0${recordedSamples.length + 1}`;

            const arrayBuffer = await recordingBlob.arrayBuffer();
            const audioBuffer = await decodeWithContext(Tone.getContext().rawContext, arrayBuffer);

            recordedSamples.push({ 
                name: sampleName, 
                url: sampleUrl, 
                buffer: audioBuffer,
                originalBuffer: audioBuffer,
                arrayBuffer, 
                trim: null, 
                pitch: 0 
            });
            
            updateSampleList();
            recordingStatus.textContent = `Sample "${sampleName}" acquired.`;
            console.log("Recording stopped. Sample saved:", sampleName);
            showMessage(`SAMPLE "${sampleName}" ACQUIRED`, "success");

            const newSampleIndex = recordedSamples.length - 1;
            const newSample = recordedSamples[newSampleIndex];
            openEditor(newSample, newSampleIndex);

        } catch (err) {
            console.error("Error stopping recording or loading sample:", err);
            showMessage(`Error processing sample: ${err.message}`, "error", 5000);
            
            isRecording = false;
            recordSampleButton.disabled = false;
            recordSampleButton.innerHTML = originalRecordButtonHTML;
            recordSampleButton.classList.remove('is-recording');
            recordingStatus.textContent = "Sample processing failed.";
        }
        return;
    }
    
    try {
        await ensureAudioRunning();
        if ((!isMicOpen && !useNativeRecorder) || !recorder) {
            showMessage("Initializing audio capture...", "info", 3500);
            recordingStatus.innerHTML = '<div class="loader"></div> Initializing Mic...';
            const micReady = await initAudio();
            if (!micReady) {
                return;
            }
        }
        
        if (!recorder) {
             throw new Error("Recorder not available after initialization.");
        }

        await recorder.start();
        isRecording = true;
        
        recordSampleButton.innerHTML = `CAPTURING... (CLICK TO STOP)`;
        recordSampleButton.classList.add('is-recording');
        recordingStatus.textContent = '';
        console.log("Recording started");

    } catch (err) {
        console.error("Error in Start Record handler:", err);
        showMessage(`CAPTURE FAILED: ${err.message}`, "error", 5000);
        
        isRecording = false;
        recordSampleButton.disabled = false;
        recordSampleButton.innerHTML = originalRecordButtonHTML;
        recordSampleButton.classList.remove('is-recording');
        recordingStatus.textContent = "Capture failed.";
    }
});

function updateAllSampleNameDisplays(sampleIndex, newName) {
    updateSampleList();
    for(let i = 0; i < trackPlayers.length; i++) {
        const p = trackPlayers[i];
        if (p && p._sourceIndex === sampleIndex) {
            const sampleNameEl = document.getElementById(`track-${i}-sample-name`);
            if(sampleNameEl) sampleNameEl.textContent = newName;
        }
    }
}

function updateSampleList() {
    sampleList.innerHTML = '';
    if (recordedSamples.length === 0) {
        sampleList.innerHTML = '<p class="text-muted-cyber p-2">No samples acquired. Press record.</p>';
        return;
    }
    recordedSamples.forEach((sample, idx) => {
        const sampleDiv = document.createElement('div');
        sampleDiv.className = 'sample-item p-2 rounded-sm flex justify-between items-center';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = sample.name;
        nameSpan.className = 'text-sm';
        sampleDiv.appendChild(nameSpan);

        const buttonContainer = document.createElement('div');

        const playButton = document.createElement('button');
        playButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112Z" /></svg>`;
        playButton.className = 'p-1 rounded-full border-0 shadow-none hover:bg-transparent';
        playButton.title = `Playback ${sample.name}`;
        playButton.onclick = (e) => {
            e.stopPropagation();
            playSamplePreview(sample);
        };
        buttonContainer.appendChild(playButton);

        const editButton = document.createElement('button');
        editButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 7.125 16.875 4.5" /></svg>`;
        editButton.className = 'p-1 rounded-full border-0 shadow-none hover:bg-transparent';
        editButton.title = `Edit ${sample.name}`;
        editButton.onclick = (e) => { e.stopPropagation(); openEditor(sample, idx); };
        buttonContainer.appendChild(editButton);
        sampleDiv.appendChild(buttonContainer);
        sampleList.appendChild(sampleDiv);
    });
}

async function playSamplePreview(sample) {
    try {
        await ensureAudioRunning();
        if (!sample.buffer) {
             showMessage(`Sample buffer for ${sample.name} not ready.`, 'error');
             return;
        }
        
        const tempPlayer = new Tone.Player(sample.buffer).toDestination();
        tempPlayer.playbackRate = Math.pow(2, (sample.pitch || 0) / 12);

        if (sample.trim && typeof sample.trim.start === 'number' && typeof sample.trim.end === 'number') {
            const dur = Math.max(0, sample.trim.end - sample.trim.start);
            if (dur > 0.0005) {
                tempPlayer.start(undefined, sample.trim.start, dur);
                return;
            }
        }
        tempPlayer.start();

    } catch (err) {
        showMessage(`Error playing ${sample.name}: ${err.message}`, 'error');
    }
}

function createSequencerGrid() {
    sequencerGridContainer.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'w-full border-collapse';
    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    
    const thCorner = document.createElement('th');
    thCorner.className = 'p-1 track-header';
    headerRow.appendChild(thCorner);

    const thVol = document.createElement('th');
    thVol.textContent = 'VOL';
    thVol.className = 'p-1 text-xs font-medium text-center';
    headerRow.appendChild(thVol);

    for (let step = 0; step < NUM_STEPS; step++) {
        const th = document.createElement('th');
        th.textContent = String(step + 1).padStart(2, '0');
        th.className = 'p-1 text-xs font-medium text-center';
        headerRow.appendChild(th);
    }
    const tbody = table.createTBody();
    for (let i = 0; i < NUM_TRACKS; i++) {
        const trackRow = tbody.insertRow();
        const trackInfoCell = trackRow.insertCell();
        trackInfoCell.className = 'p-2 track-header align-top';
        
        const trackLabel = document.createElement('div');
        trackLabel.textContent = `CHANNEL ${String(i + 1).padStart(2, '0')}`;
        trackLabel.className = 'font-semibold text-sm mb-1';
        trackInfoCell.appendChild(trackLabel);
        const loadedSampleName = document.createElement('div');
        loadedSampleName.id = `track-${i}-sample-name`;
        loadedSampleName.textContent = '[NO SAMPLE LOADED]';
        loadedSampleName.className = 'text-xs italic mb-2 truncate text-muted-cyber';
        trackInfoCell.appendChild(loadedSampleName);
        
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'flex gap-1 mt-2';

        const loadButton = document.createElement('button');
        loadButton.textContent = 'ASSIGN';
        loadButton.className = 'flex-grow text-xs py-1 px-2';
        loadButton.onclick = () => openSampleModal(i);
        controlsContainer.appendChild(loadButton);

        const muteButton = document.createElement('button');
        muteButton.textContent = 'MUTE';
        muteButton.className = 'mute-button text-xs py-1 px-2';
        muteButton.dataset.track = i;
        muteButton.classList.toggle('is-muted', trackStates[i]?.muted);
        muteButton.onclick = (e) => {
            const trackIndex = parseInt(e.target.dataset.track, 10);
            trackStates[trackIndex].muted = !trackStates[trackIndex].muted;
            trackVolumes[trackIndex].mute = trackStates[trackIndex].muted;
            e.target.classList.toggle('is-muted', trackStates[trackIndex].muted);
        };
        controlsContainer.appendChild(muteButton);
        trackInfoCell.appendChild(controlsContainer);

        const volumeCell = trackRow.insertCell();
        volumeCell.className = 'volume-cell';
        const volumeSlider = document.createElement('input');
        volumeSlider.type = 'range';
        volumeSlider.className = 'volume-slider';
        volumeSlider.min = -20;
        volumeSlider.max = 20;
        volumeSlider.step = 1;
        volumeSlider.value = trackVolumes[i] ? trackVolumes[i].volume.value : 0;
        volumeSlider.dataset.track = i;
        volumeSlider.addEventListener('input', (e) => {
            const trackIndex = parseInt(e.target.dataset.track, 10);
            const newVolume = parseFloat(e.target.value);
            if (trackVolumes[trackIndex]) {
                trackVolumes[trackIndex].volume.value = newVolume;
            }
        });
        volumeCell.appendChild(volumeSlider);

        for (let j = 0; j < NUM_STEPS; j++) {
            const stepCell = trackRow.insertCell();
            const stepDiv = document.createElement('div');
            stepDiv.className = 'sequencer-step';
            stepDiv.dataset.track = i;
            stepDiv.dataset.step = j;
            stepDiv.addEventListener('click', toggleStep);
            stepCell.appendChild(stepDiv);
        }
    }

    const tfoot = table.createTFoot();
    const footerRow = tfoot.insertRow();
    const addCell = footerRow.insertCell();
    addCell.colSpan = NUM_STEPS + 2;
    addCell.className = 'p-2 text-center';
    const addButton = document.createElement('button');
    addButton.textContent = '+ ADD CHANNEL';
    addButton.className = 'text-xs py-1 px-2 w-full';
    addButton.id = 'addChannelButton';
    addButton.addEventListener('click', () => {
        NUM_TRACKS++;
        sequencerData.push(new Array(NUM_STEPS).fill(false));
        trackVolumes.push(new Tone.Volume(0).toDestination());
        trackPlayers.push(null);
        trackStates.push({ muted: false });
        PRESETS.forEach(p => {
            if(p.pattern.length < NUM_TRACKS) {
                p.pattern.push(new Array(NUM_STEPS).fill(false))
            }
        });
        createSequencerGrid();
        redrawSequencerGrid();
    });
    addCell.appendChild(addButton);

    sequencerGridContainer.appendChild(table);
}

function toggleStep(event) {
    const stepDiv = event.currentTarget;
    const track = parseInt(stepDiv.dataset.track);
    const step = parseInt(stepDiv.dataset.step);
    sequencerData[track][step] = !sequencerData[track][step];
    stepDiv.classList.toggle('active', sequencerData[track][step]);
}

function updateStepHighlight(currentStep) {
    document.querySelectorAll('.sequencer-step.playing').forEach(el => el.classList.remove('playing'));
    if (currentStep !== -1 && Tone.Transport.state === "started") {
        document.querySelectorAll(`.sequencer-step[data-step="${currentStep}"]`).forEach(el => el.classList.add('playing'));
    }
}

function openSampleModal(trackIndex) {
    currentTrackToLoad = trackIndex;
    modalSampleList.innerHTML = '';
    if (recordedSamples.length === 0) {
        modalSampleList.innerHTML = '';
        modalNoSamples.classList.remove('hidden');
    } else {
        modalNoSamples.classList.add('hidden');
        recordedSamples.forEach((sample, idx) => {
            const sampleDiv = document.createElement('div');
            sampleDiv.textContent = sample.name;
            sampleDiv.className = 'p-2 border border-transparent hover:border-current rounded-sm cursor-pointer text-sm';
            sampleDiv.style.borderColor = 'var(--color-border)';
            sampleDiv.onmouseover = () => sampleDiv.style.borderColor = 'var(--color-primary-neon)';
            sampleDiv.onmouseout = () => sampleDiv.style.borderColor = 'var(--color-border)';
            sampleDiv.onclick = () => selectSampleForTrack(sample, idx);
            modalSampleList.appendChild(sampleDiv);
        });
    }
    sampleModal.style.display = 'flex';
}

function closeSampleModal() {
    sampleModal.style.display = 'none';
    currentTrackToLoad = -1;
}
closeModalButton.addEventListener('click', closeSampleModal);
window.addEventListener('click', (event) => {
    if (event.target === sampleModal) {
        closeSampleModal();
    }
});

async function selectSampleForTrack(sample, sampleIndex) {
    if (currentTrackToLoad === -1) return;

    try {
        if (trackPlayers[currentTrackToLoad]) {
            trackPlayers[currentTrackToLoad].dispose();
        }
        
        const newPlayer = new Tone.Player(sample.buffer).connect(trackVolumes[currentTrackToLoad]);
        newPlayer._sourceIndex = sampleIndex;
        trackPlayers[currentTrackToLoad] = newPlayer;

        const sampleNameEl = document.getElementById(`track-${currentTrackToLoad}-sample-name`);
        sampleNameEl.textContent = sample.name;
        sampleNameEl.classList.remove('text-muted-cyber');
        
        console.log(`Sample "${sample.name}" assigned to Track ${currentTrackToLoad + 1}`);
        showMessage(`ASSIGNED: "${sample.name}" TO CHANNEL ${String(currentTrackToLoad + 1).padStart(2, '0')}`, "success");
    } catch (err) {
        showMessage(`Error preparing sample "${sample.name}": ${err.message}`, "error", 5000);
    }
    
    closeSampleModal();
}

let sequence;
function setupSequencerPlayback() {
    if (sequence) {
        sequence.stop(0).dispose();
    }
    const stepsArray = Array.from(Array(NUM_STEPS).keys());
    sequence = new Tone.Sequence((time, step) => {
        for (let track = 0; track < NUM_TRACKS; track++) {
            const p = trackPlayers[track];
            const isPlayerReady = p && p.loaded && !p.disposed;
            
            if (sequencerData[track][step] && isPlayerReady) {
                const sourceIndex = p._sourceIndex;
                if (sourceIndex > -1 && recordedSamples[sourceIndex]) {
                    const sample = recordedSamples[sourceIndex];
                    const pitch = sample.pitch || 0;
                    p.playbackRate = Math.pow(2, pitch / 12);
                    
                    if (sample.trim) {
                        const dur = sample.trim.end - sample.trim.start;
                        if (dur > 0.0005) {
                            p.start(time, sample.trim.start, dur);
                        }
                    } else {
                        p.start(time);
                    }
                }
            }
        }
        Tone.Draw.schedule(() => {
            updateStepHighlight(step);
        }, time);
    }, stepsArray, "16n").start(0);

    Tone.Transport.bpm.value = parseInt(tempoInput.value);
}

let waveSurfer = null;
let selectionStart = null;
let selectionEnd = null;
let containerClickHandler = null;
let currentEditIndex = -1;
let isMarkerDragging = false;
let suppressClick = false;
const editorModal = document.getElementById('editorModal');
const editorCloseButton = document.getElementById('editorCloseButton');
const editorSampleName = document.getElementById('editorSampleName');
const trimApplyButton = document.getElementById('trimApplyButton');
const trimResetButton = document.getElementById('trimResetButton');
const trimInfo = document.getElementById('trimInfo');
const renameButton = document.getElementById('renameButton');
const pitchDownButton = document.getElementById('pitchDownButton');
const pitchUpButton = document.getElementById('pitchUpButton');
const previewButton = document.getElementById('previewButton');
const pitchInfo = document.getElementById('pitchInfo');
const zoomInButton = document.getElementById('zoomInButton');
const zoomOutButton = document.getElementById('zoomOutButton');
const zoomResetButton = document.getElementById('zoomResetButton');
const editorInstructions = document.getElementById('editorInstructions');
const saveButton = document.getElementById('saveButton');
const cancelButton = document.getElementById('cancelButton');

async function applyTrimFromSelection() {
    if (currentEditIndex < 0 || !waveSurfer) return false;
    const range = getSelectionRange();
    const sample = recordedSamples[currentEditIndex];

    if (!range || !sample.originalBuffer) {
        showMessage('No region selected to apply.', 'error');
        return false;
    }

    if (range.end - range.start > 0.005) {
        try {
            const originalBuffer = sample.originalBuffer;
            const audioCtx = Tone.getContext().rawContext;
            const sr = originalBuffer.sampleRate;
            const startFrame = Math.floor(range.start * sr);
            const endFrame = Math.floor(range.end * sr);
            const length = endFrame - startFrame;
            const channels = originalBuffer.numberOfChannels;
            
            if (length <= 0) {
                showMessage('Selection is too short.', 'error');
                return false;
            }

            const trimmedBuffer = audioCtx.createBuffer(channels, length, sr);
            for (let ch = 0; ch < channels; ch++) {
                const data = originalBuffer.getChannelData(ch).subarray(startFrame, endFrame);
                trimmedBuffer.getChannelData(ch).set(data);
            }
            
            sample.buffer = trimmedBuffer;
            const newBlob = bufferToWaveBlob(trimmedBuffer);
            URL.revokeObjectURL(sample.url);
            sample.url = URL.createObjectURL(newBlob);
            
            await waveSurfer.load(sample.url);
            selectionStart = null;
            selectionEnd = null;
            sample.trim = null; // Trim is now baked in
            showMessage('Trim applied.', 'success');
            return true;
        } catch(e) {
            showMessage('Error applying trim.', 'error');
            console.error(e);
            return false;
        }
    } else {
        showMessage('Selection too small to trim.', 'error');
        return false;
    }
}


function closeEditor() {
    try { waveSurfer && waveSurfer.destroy(); } catch (_) { }
    waveSurfer = null;
    editorModal.style.display = 'none';
    currentEditIndex = -1;
    originalSampleState = null;
    trimInfo.textContent = '';
    pitchInfo.textContent = '';
    selectionStart = null;
    selectionEnd = null;
    const container = document.getElementById('waveformContainer');
    if (container && containerClickHandler) {
        container.removeEventListener('click', containerClickHandler, true);
        containerClickHandler = null;
    }
    const overlay = document.getElementById('selectionOverlay');
    if (overlay) { overlay.style.left = '0px'; overlay.style.width = '0px'; }
}

function cancelChanges() {
    if(currentEditIndex > -1 && originalSampleState) {
        const sample = recordedSamples[currentEditIndex];
        sample.pitch = originalSampleState.pitch;
        sample.buffer = originalSampleState.buffer;
        sample.originalBuffer = originalSampleState.originalBuffer;
        sample.url = originalSampleState.url;
        sample.trim = originalSampleState.trim;
    }
    closeEditor();
}

cancelButton.addEventListener('click', cancelChanges);
editorCloseButton.addEventListener('click', cancelChanges);
window.addEventListener('click', (event) => {
    if (event.target === editorModal) cancelChanges();
});

async function openEditor(sample, index) {
    await ensureAudioRunning();
    currentEditIndex = index;

    originalSampleState = {
        pitch: sample.pitch,
        buffer: sample.buffer,
        originalBuffer: sample.originalBuffer,
        url: sample.url,
        trim: sample.trim ? { ...sample.trim } : null
    };
    
    editorSampleName.textContent = sample.name;
    pitchInfo.textContent = `PITCH: ${sample.pitch || 0} st`;
    editorInstructions.textContent = 'Click waveform to set start point, then click again to set end point.';
    
    renameButton.onclick = () => {
        const currentName = recordedSamples[currentEditIndex].name;
        const newName = prompt("Enter new sample name:", currentName);
        if (newName && newName.trim() !== "") {
            recordedSamples[currentEditIndex].name = newName.trim();
            editorSampleName.textContent = newName.trim();
            updateAllSampleNameDisplays(currentEditIndex, newName.trim());
        }
    };
    pitchDownButton.onclick = () => {
        const sample = recordedSamples[currentEditIndex];
        sample.pitch = (sample.pitch || 0) - 1;
        pitchInfo.textContent = `PITCH: ${sample.pitch} st`;
    };
    pitchUpButton.onclick = () => {
        const sample = recordedSamples[currentEditIndex];
        sample.pitch = (sample.pitch || 0) + 1;
        pitchInfo.textContent = `PITCH: ${sample.pitch} st`;
    };
    previewButton.onclick = async () => {
        const sample = recordedSamples[currentEditIndex];
        if (!sample || !sample.buffer) return;
        
        await ensureAudioRunning();

        const tempPlayer = new Tone.Player(sample.buffer).toDestination();
        tempPlayer.playbackRate = Math.pow(2, (sample.pitch || 0) / 12);

        const range = getSelectionRange();
        if (range && (range.end - range.start > 0.005)) {
            tempPlayer.start(undefined, range.start, range.end - range.start);
        } else {
            tempPlayer.start();
        }
    };
    saveButton.onclick = () => {
        if(selectionStart !== null && selectionEnd !== null) {
            applyTrimFromSelection();
        }
        closeEditor();
    }

    const wfContainer = document.getElementById('waveformContainer');
    try { waveSurfer && waveSurfer.destroy(); } catch (_) { }

    let overlay = document.getElementById('selectionOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'selectionOverlay';
        wfContainer.appendChild(overlay);
    }
    let startMarkerEl = document.getElementById('startMarker');
    if (!startMarkerEl) {
        startMarkerEl = document.createElement('div');
        startMarkerEl.id = 'startMarker';
        startMarkerEl.classList.add('hidden');
        wfContainer.appendChild(startMarkerEl);
    }
    let endMarkerEl = document.getElementById('endMarker');
    if (!endMarkerEl) {
        endMarkerEl = document.createElement('div');
        endMarkerEl.id = 'endMarker';
        endMarkerEl.classList.add('hidden');
        wfContainer.appendChild(endMarkerEl);
    }
    
    editorModal.style.display = 'flex';

    const existingWave = document.getElementById('waveformCanvas');
    if (existingWave && existingWave.parentNode) existingWave.parentNode.removeChild(existingWave);

    const waveTarget = document.createElement('div');
    waveTarget.id = 'waveformCanvas';
    waveTarget.style.width = '100%';
    wfContainer.insertBefore(waveTarget, overlay);

    try {
        const waveformHeight = window.innerWidth < 640 ? 96 : 120;
        const wsOptions = {
            container: waveTarget,
            waveColor: 'rgba(0,255,204,0.35)',
            progressColor: 'rgba(0,153,255,0.7)',
            cursorColor: '#00ffcc',
            barWidth: 1,
            height: waveformHeight,
            normalize: true,
            audioContext: Tone.getContext().rawContext
        };
        waveSurfer = WaveSurfer.create(wsOptions);
    } catch (e) {
        console.error('WaveSurfer create failed', e);
        showMessage('Waveform engine failed to load.', 'error', 5000);
        return;
    }

    try {
        await waveSurfer.load(sample.url);
    } catch (e) {
        console.error('WaveSurfer load error:', e);
        showMessage('Error rendering waveform.', 'error');
    }

    const resyncOverlay = () => {
        if (!waveSurfer) return;
        updateSelectionOverlay();
    };

    waveSurfer.on('ready', () => {
        trimInfo.textContent = 'No selection.';
        if (sample.trim) {
            selectionStart = sample.trim.start;
            selectionEnd = sample.trim.end;
            updateSelectionOverlay();
        }
        wfContainer.addEventListener('scroll', resyncOverlay, { passive: true });
        window.addEventListener('resize', resyncOverlay);
        setTimeout(() => {
            try { waveSurfer.zoom(0); } catch (_) { }
            resyncOverlay();
        }, 0);
    });

    waveSurfer.on('error', (e) => {
        console.error('WaveSurfer error:', e);
        showMessage('Error rendering waveform.', 'error', 4000);
    });
    waveSurfer.on && waveSurfer.on('decode', () => { resyncOverlay(); });
    waveSurfer.on && waveSurfer.on('redraw', () => { resyncOverlay(); });

    const updateInfo = () => {
        if (selectionStart != null && selectionEnd != null && selectionEnd > selectionStart) {
            trimInfo.textContent = `Start: ${selectionStart.toFixed(3)}s  End: ${selectionEnd.toFixed(3)}s  Length: ${(selectionEnd - selectionStart).toFixed(3)}s`;
        } else {
            trimInfo.textContent = 'No selection.';
        }
    };

    const wfContainer2 = document.getElementById('waveformContainer');
    const timeFromClientX = (clientX) => {
        const rect = wfContainer2.getBoundingClientRect();
        const scrollX = wfContainer2.scrollLeft || 0;
        const xWithin = Math.min(Math.max((clientX - rect.left), 0), rect.width);
        const xTotal = xWithin + scrollX;
        const totalWidth = waveSurfer.getWrapper().scrollWidth;
        const dur = waveSurfer.getDuration() || 0;
        if (dur === 0 || totalWidth === 0) return 0;
        const t = (xTotal / totalWidth) * dur;
        return Math.min(Math.max(t, 0), dur);
    };
    const handleClick = (e) => {
        if (!waveSurfer) return;
        if (suppressClick) { suppressClick = false; return; }
        const time = timeFromClientX(e.clientX);
        if (selectionStart === null || selectionEnd !== null) {
            selectionStart = time;
            selectionEnd = null;
            editorInstructions.textContent = 'Click again to set end point.';
        } else {
            selectionEnd = time;
            if (selectionEnd < selectionStart) {
                const t = selectionStart; selectionStart = selectionEnd; selectionEnd = t;
            }
            editorInstructions.textContent = 'Drag markers to adjust, or apply changes.';
        }
        updateSelectionOverlay();
    };
    containerClickHandler = handleClick;
    wfContainer.addEventListener('click', handleClick, true);

    function updateSelectionOverlay() {
        const overlay = document.getElementById('selectionOverlay');
        const startMarker = document.getElementById('startMarker');
        const endMarker = document.getElementById('endMarker');
        const dur = waveSurfer.getDuration() || 0;
        if (!overlay || dur === 0 || selectionStart === null) {
            if (overlay) { overlay.style.width = '0px'; }
            if (startMarker) { startMarker.classList.add('hidden'); }
            if (endMarker) { endMarker.classList.add('hidden'); }
            updateInfo();
            return;
        };
        const totalWidth = waveSurfer.getWrapper().scrollWidth;
        const startX = (selectionStart / dur) * totalWidth;
        let width = 0;
        if (selectionEnd !== null) {
            const endX = (selectionEnd / dur) * totalWidth;
            width = Math.max(0, endX - startX);
        }
        overlay.style.left = `${startX}px`;
        overlay.style.width = `${width}px`;
        updateInfo();

        if (startMarker) {
            startMarker.style.left = `${startX - 1}px`;
            startMarker.classList.remove('hidden');
        }
        if (endMarker) {
            const endX = ((selectionEnd != null ? selectionEnd : dur) / dur) * totalWidth;
            endMarker.style.left = `${endX - 1}px`;
            endMarker.classList.toggle('hidden', selectionEnd == null);
        }
    }

    function attachMarkerDrag(markerEl, which) {
        if (!markerEl) return;
        let dragging = false;
        const onDown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            isMarkerDragging = true;
            suppressClick = true;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('mouseup', onUp, { once: true });
            document.addEventListener('touchend', onUp, { once: true });
        };
        const onMove = (e) => {
            if (!dragging || !waveSurfer) return;
            const clientX = (e.touches?.[0]?.clientX ?? e.clientX);
            const t = timeFromClientX(clientX);
            if (which === 'start') {
                selectionStart = Math.min(t, selectionEnd ?? t);
            } else {
                selectionEnd = Math.max(t, selectionStart ?? t);
            }
            updateSelectionOverlay();
            e.preventDefault();
        };
        const onUp = () => {
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('touchmove', onMove);
            setTimeout(() => {
                isMarkerDragging = false;
                suppressClick = false;
            }, 0);
        };
        markerEl.addEventListener('mousedown', onDown);
        markerEl.addEventListener('touchstart', onDown, { passive: false });
    }

    attachMarkerDrag(document.getElementById('startMarker'), 'start');
    attachMarkerDrag(document.getElementById('endMarker'), 'end');
}

const getSelectionRange = () => {
    if (selectionStart != null) {
        let end = selectionEnd;
        if (end == null && waveSurfer) {
            end = waveSurfer.getDuration();
        }
        if (end != null && end > selectionStart) {
            return { start: selectionStart, end };
        }
    }
    return null;
};

trimApplyButton.addEventListener('click', async () => applyTrimFromSelection());

trimResetButton.addEventListener('click', async () => {
    if (currentEditIndex < 0) return;
    const sample = recordedSamples[currentEditIndex];
    if (sample.buffer === sample.originalBuffer) {
        showMessage('Sample is already in its original state.', 'info');
        return;
    }
    sample.buffer = sample.originalBuffer;
    const newBlob = bufferToWaveBlob(sample.buffer);
    URL.revokeObjectURL(sample.url);
    sample.url = URL.createObjectURL(newBlob);
    
    await waveSurfer.load(sample.url);
    selectionStart = null;
    selectionEnd = null;
    showMessage('Sample reset to original.', 'success');
});

playButton.addEventListener('click', async () => {
    const ok = await ensureAudioRunning();
    if (!ok) {
        showMessage("Audio system offline.", "error", 4000);
        return;
    }
    const hasPlayable = trackPlayers.some((p, idx) => p && !p.disposed && p.loaded && sequencerData[idx].some(Boolean));
    if (!hasPlayable) {
        showMessage('No assigned samples with active steps.', 'error', 2500);
        return;
    }
    if (Tone.Transport.state === "started") return;

    setupSequencerPlayback();
    Tone.Transport.start("+0.1");

    playButton.disabled = true;
    stopButton.disabled = false;
    console.log("Sequencer playing");
});

stopButton.addEventListener('click', () => {
    Tone.Transport.stop();
    trackPlayers.forEach(p => { if (p && !p.disposed) p.stop(); });
    if (sequence) {
        sequence.stop(0).dispose();
        sequence = null;
    }
    updateStepHighlight(-1);
    playButton.disabled = false;
    stopButton.disabled = true;
    console.log("Sequencer stopped");
});

tempoInput.addEventListener('change', () => {
    const newTempo = parseInt(tempoInput.value);
    if (newTempo >= 40 && newTempo <= 240) {
        if (Tone.Transport) {
            Tone.Transport.bpm.value = newTempo;
            console.log("Tempo changed to:", newTempo);
        }
    } else {
        showMessage("Tempo out of range (40-240 BPM).", "error");
        tempoInput.value = Tone.Transport.bpm.value;
    }
});

const exportStemsButton = document.getElementById('exportStemsButton');
const exportDownloadLink = document.getElementById('exportDownloadLink');
const exportMixButton = document.getElementById('exportMixButton');
// Export functions are unchanged

function redrawSequencerGrid() {
    const steps = document.querySelectorAll('.sequencer-step');
    steps.forEach(step => {
        const track = parseInt(step.dataset.track, 10);
        const stepIndex = parseInt(step.dataset.step, 10);
        if (sequencerData[track]) {
            const isActive = sequencerData[track][stepIndex];
            step.classList.toggle('active', isActive);
        }
    });
}

function loadPreset(index) {
    const preset = PRESETS[index];
    if (preset.pattern.length < NUM_TRACKS) {
        const diff = NUM_TRACKS - preset.pattern.length;
        for (let i = 0; i < diff; i++) {
            preset.pattern.push(new Array(NUM_STEPS).fill(false));
        }
    }
    sequencerData = JSON.parse(JSON.stringify(preset.pattern.slice(0, NUM_TRACKS)));
    tempoInput.value = preset.bpm;
    tempoInput.dispatchEvent(new Event('change'));
    presetNameDisplay.textContent = preset.name;
    redrawSequencerGrid();
}


window.onload = () => {
    createSequencerGrid();
    updateSampleList();
    loadPreset(0);

    const startAudioButton = document.createElement('button');
    startAudioButton.id = 'startAudioContextButton';
    startAudioButton.textContent = 'ENABLE AUDIO CORE';
    startAudioButton.className = 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 py-4 px-8 rounded-md text-lg z-50';

    if (Tone.context.state !== 'running') {
        document.body.appendChild(startAudioButton);
        startAudioButton.onclick = async () => {
            try {
                await Tone.start();
                console.log("AudioContext started by user interaction.");
                showMessage("AUDIO CORE ONLINE. SYSTEM READY.", "success", 2000);
                if (startAudioButton.parentNode) {
                    document.body.removeChild(startAudioButton);
                }
            } catch (err) {
                console.error("Error starting Tone.js audio context:", err);
                showMessage("AUDIO CORE FAILURE.", "error", 5000);
            }
        };
    } else {
        console.log("AudioContext already running on page load.");
    }
    stopButton.disabled = true;

    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.addEventListener && navigator.mediaDevices.addEventListener('devicechange', listInputDevices);
        refreshDevicesButton.addEventListener('click', listInputDevices);
        micSelect.addEventListener('change', async (e) => {
            selectedDeviceId = e.target.value;
            if (useNativeRecorder) {
                await setupNativeRecorder();
            } else if (mic) {
                try {
                    if (typeof mic.close === 'function') { await mic.close(); }
                    isMicOpen = false;
                } catch (_) { }
                try {
                    const toneConstraints = selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : undefined;
                    await mic.open(toneConstraints);
                    isMicOpen = true;
                } catch (err) {
                    showMessage('Failed to switch input device. Reverting to default.', 'error', 3000);
                    try { await mic.open(); isMicOpen = true; } catch (_) { }
                }
            }
        });
    } else {
        permissionStatus.textContent = 'Media devices API unavailable.';
    }

    nextPresetButton.addEventListener('click', () => {
        currentPresetIndex = (currentPresetIndex + 1) % PRESETS.length;
        loadPreset(currentPresetIndex);
    });
    prevPresetButton.addEventListener('click', () => {
        currentPresetIndex = (currentPresetIndex - 1 + PRESETS.length) % PRESETS.length;
        loadPreset(currentPresetIndex);
    });
};