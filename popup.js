// Popup script for AI Meeting Summarizer
class MeetingSummarizerPopup {
    constructor() {
        this.isRecording = false;
        this.recordingStartTime = null;
        this.summaryPollingInterval = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.loadState();
        this.checkMeetingDetection();
    }
    
    initializeElements() {
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.status = document.getElementById('status');
        this.statusText = this.status.querySelector('.status-text');
        this.statusDetail = this.status.querySelector('.status-detail');
        this.meetingInfo = document.getElementById('meetingInfo');
        this.meetingUrl = document.getElementById('meetingUrl');
        this.summarySection = document.getElementById('summarySection');
        this.summaryContent = document.getElementById('summaryContent');
    }
    
    setupEventListeners() {
        this.startBtn.addEventListener('click', () => this.startRecording());
        this.stopBtn.addEventListener('click', () => this.stopRecording());
        
        // Listen for messages from background script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
        });
    }
    
    async loadState() {
        try {
            const result = await chrome.storage.local.get(['isRecording', 'recordingStartTime', 'meetingUrl']);
            
            if (result.isRecording) {
                this.isRecording = true;
                this.recordingStartTime = result.recordingStartTime;
                this.updateUI();
                this.startSummaryPolling();
            }
            
            if (result.meetingUrl) {
                this.showMeetingInfo(result.meetingUrl);
            }
        } catch (error) {
            console.error('Error loading state:', error);
        }
    }
    
    async checkMeetingDetection() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'checkMeeting' });
            
            if (response && response.isMeeting) {
                this.showMeetingInfo(response.url);
            }
        } catch (error) {
            // Content script might not be ready, ignore
        }
    }
    
    async startRecording() {
        try {
            this.startBtn.disabled = true;
            this.updateStatus('processing', 'Starting...', 'Initializing audio capture');
            
            // Request audio capture permission
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const response = await chrome.tabs.sendMessage(tab.id, { 
                action: 'startRecording',
                tabId: tab.id 
            });
            
            if (response && response.success) {
                this.isRecording = true;
                this.recordingStartTime = Date.now();
                
                // Save state
                await chrome.storage.local.set({
                    isRecording: true,
                    recordingStartTime: this.recordingStartTime
                });
                
                this.updateUI();
                this.startSummaryPolling();
                this.updateStatus('recording', 'Recording Active', 'Capturing meeting audio');
            } else {
                throw new Error(response?.error || 'Failed to start recording');
            }
        } catch (error) {
            console.error('Error starting recording:', error);
            this.updateStatus('idle', 'Error', 'Failed to start recording');
            this.startBtn.disabled = false;
        }
    }
    
    async stopRecording() {
        try {
            this.stopBtn.disabled = true;
            this.updateStatus('processing', 'Stopping...', 'Finalizing audio capture');
            
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' });
            
            this.isRecording = false;
            this.recordingStartTime = null;
            
            // Clear state
            await chrome.storage.local.remove(['isRecording', 'recordingStartTime']);
            
            this.updateUI();
            this.stopSummaryPolling();
            this.updateStatus('idle', 'Processing Complete', 'Generating summary...');
            
            // Start polling for summary
            this.startSummaryPolling();
            
        } catch (error) {
            console.error('Error stopping recording:', error);
            this.updateStatus('idle', 'Error', 'Failed to stop recording');
            this.stopBtn.disabled = false;
        }
    }
    
    updateUI() {
        if (this.isRecording) {
            this.startBtn.style.display = 'none';
            this.stopBtn.style.display = 'block';
            this.stopBtn.disabled = false;
        } else {
            this.startBtn.style.display = 'block';
            this.stopBtn.style.display = 'none';
            this.startBtn.disabled = false;
        }
    }
    
    updateStatus(type, text, detail) {
        this.status.className = `status ${type}`;
        this.statusText.textContent = text;
        this.statusDetail.textContent = detail;
    }
    
    showMeetingInfo(url) {
        this.meetingInfo.style.display = 'block';
        this.meetingUrl.textContent = this.formatUrl(url);
    }
    
    formatUrl(url) {
        try {
            const urlObj = new URL(url);
            return `${urlObj.hostname}${urlObj.pathname}`;
        } catch {
            return url;
        }
    }
    
    startSummaryPolling() {
        this.stopSummaryPolling(); // Clear any existing interval
        
        this.summaryPollingInterval = setInterval(async () => {
            try {
                const result = await chrome.storage.local.get(['summary', 'summaryStatus']);
                
                if (result.summary) {
                    this.showSummary(result.summary);
                    this.stopSummaryPolling();
                } else if (result.summaryStatus === 'error') {
                    this.updateStatus('idle', 'Error', 'Failed to generate summary');
                    this.stopSummaryPolling();
                }
            } catch (error) {
                console.error('Error polling for summary:', error);
            }
        }, 2000); // Poll every 2 seconds
    }
    
    stopSummaryPolling() {
        if (this.summaryPollingInterval) {
            clearInterval(this.summaryPollingInterval);
            this.summaryPollingInterval = null;
        }
    }
    
    showSummary(summary) {
        this.summarySection.style.display = 'block';
        this.summaryContent.textContent = summary;
        this.updateStatus('idle', 'Summary Ready', 'Meeting summary generated');
    }
    
    handleMessage(message, sender, sendResponse) {
        switch (message.action) {
            case 'recordingStarted':
                this.isRecording = true;
                this.updateUI();
                this.updateStatus('recording', 'Recording Active', 'Capturing meeting audio');
                break;
                
            case 'recordingStopped':
                this.isRecording = false;
                this.updateUI();
                this.updateStatus('processing', 'Processing...', 'Generating summary');
                break;
                
            case 'meetingDetected':
                this.showMeetingInfo(message.url);
                break;
                
            case 'summaryReady':
                this.showSummary(message.summary);
                this.stopSummaryPolling();
                break;
                
            case 'error':
                this.updateStatus('idle', 'Error', message.error);
                this.startBtn.disabled = false;
                this.stopBtn.disabled = false;
                break;
        }
    }
    
    formatDuration(startTime) {
        if (!startTime) return '00:00';
        
        const duration = Date.now() - startTime;
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new MeetingSummarizerPopup();
});
