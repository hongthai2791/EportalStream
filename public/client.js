const STUN_SERVERS = {
    iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }
    ]
};

const app = {
    socket: null,
    peer: null,
    localStream: null,
    remoteStream: null,
    role: null,
    roomId: null,
    isMuted: false,
    isVideoOff: false,

    init: function() {
        this.socket = io();
        this.setupSocketListeners();
        lucide.createIcons();
    },

    setupSocketListeners: function() {
        this.socket.on('user-connected', async (userId) => {
            console.log("User connected:", userId);
            this.updateStatus("Đang kết nối với đối tác...");
            const offer = await this.createPeerConnection(userId, true);
        });

        this.socket.on('offer', async (payload) => {
            console.log("Received offer");
            await this.createPeerConnection(payload.caller, false);
            await this.peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            const answer = await this.peer.createAnswer();
            await this.peer.setLocalDescription(answer);
            this.socket.emit('answer', { target: payload.caller, sdp: answer });
        });

        this.socket.on('answer', async (payload) => {
            console.log("Received answer");
            if (this.peer) {
                await this.peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            }
        });

        this.socket.on('ice-candidate', async (payload) => {
            if (this.peer) {
                try {
                    await this.peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
                } catch (e) {
                    console.error("Error adding ICE candidate", e);
                }
            }
        });

        this.socket.on('user-disconnected', () => {
            this.endCall(true);
            alert("Đối tác đã ngắt kết nối.");
        });
    },

    // --- UI Navigation ---

    selectRole: function(role) {
        this.role = role;
        document.getElementById('step-role').classList.add('hidden');
        document.getElementById('step-lobby').classList.remove('hidden');
        document.getElementById('exit-btn').classList.remove('hidden');
        document.getElementById('exit-btn').onclick = () => this.resetToRole();

        const title = document.getElementById('lobby-title');
        const desc = document.getElementById('lobby-desc');
        const icon = document.getElementById('lobby-icon');
        const businessLobby = document.getElementById('business-lobby');
        const workerLobby = document.getElementById('worker-lobby');

        if (role === 'business') {
            title.textContent = "Thiết lập phòng phỏng vấn";
            desc.textContent = "Tạo mã phòng duy nhất cho ứng viên.";
            icon.innerHTML = '<i data-lucide="briefcase"></i>';
            icon.className = 'lobby-icon-wrapper business';
            businessLobby.classList.remove('hidden');
            workerLobby.classList.add('hidden');
            
            // Generate Code
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            this.roomId = code;
            document.getElementById('generated-code').textContent = code;
        } else {
            title.textContent = "Tham gia phỏng vấn";
            desc.textContent = "Nhập mã phòng do nhà tuyển dụng cung cấp.";
            icon.innerHTML = '<i data-lucide="users"></i>';
            icon.className = 'lobby-icon-wrapper worker';
            businessLobby.classList.add('hidden');
            workerLobby.classList.remove('hidden');
        }
        lucide.createIcons();
    },

    resetToRole: function() {
        this.endCall();
        document.getElementById('step-role').classList.remove('hidden');
        document.getElementById('step-lobby').classList.add('hidden');
        document.getElementById('step-call').classList.add('hidden');
        document.getElementById('exit-btn').classList.add('hidden');
        this.role = null;
        this.roomId = null;
    },

    // --- Call Logic ---

    startRoom: async function() {
        if (await this.startLocalStream()) {
            this.enterCallRoom();
        }
    },

    joinRoom: async function() {
        const input = document.getElementById('room-code-input');
        const code = input.value.trim().toUpperCase();
        if (code.length < 3) {
            alert("Vui lòng nhập mã phòng hợp lệ.");
            return;
        }
        this.roomId = code;
        if (await this.startLocalStream()) {
            this.enterCallRoom();
        }
    },

    enterCallRoom: function() {
        document.getElementById('step-lobby').classList.add('hidden');
        document.getElementById('step-call').classList.remove('hidden');
        document.getElementById('active-room-code').textContent = this.roomId;
        document.getElementById('room-info').textContent = `Phòng: ${this.roomId}`;
        document.getElementById('exit-btn').onclick = () => this.endCall();
        
        // Join Socket Room
        this.socket.emit('join-room', this.roomId, this.socket.id);
    },

    startLocalStream: async function() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this.localStream = stream;
            document.getElementById('local-video').srcObject = stream;
            return true;
        } catch (err) {
            console.error(err);
            alert("Không thể truy cập camera/microphone. Vui lòng kiểm tra quyền truy cập.");
            return false;
        }
    },

    createPeerConnection: async function(targetId, isInitiator) {
        this.peer = new RTCPeerConnection(STUN_SERVERS);

        this.peer.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    target: targetId,
                    candidate: event.candidate
                });
            }
        };

        this.peer.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            document.getElementById('remote-video').srcObject = this.remoteStream;
            this.updateStatus(null); // Connected
        };

        this.peer.onconnectionstatechange = () => {
            if (this.peer.connectionState === 'connected') {
                this.updateStatus(null);
            } else if (this.peer.connectionState === 'disconnected') {
                this.updateStatus("Mất kết nối...");
            }
        };

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peer.addTrack(track, this.localStream);
            });
        }

        if (isInitiator) {
            const offer = await this.peer.createOffer();
            await this.peer.setLocalDescription(offer);
            this.socket.emit('offer', { target: targetId, sdp: offer, caller: this.socket.id });
        }
        
        return this.peer;
    },

    endCall: function(remoteOnly = false) {
        if (this.peer) {
            this.peer.close();
            this.peer = null;
        }
        
        if (!remoteOnly) {
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }
            this.socket.emit('leave-room', this.roomId);
            this.resetToRole();
        } else {
            document.getElementById('remote-video').srcObject = null;
            this.updateStatus("Đang chờ kết nối...");
        }
    },

    // --- Controls ---

    toggleMute: function() {
        this.isMuted = !this.isMuted;
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => track.enabled = !this.isMuted);
        }
        const btn = document.getElementById('btn-mute');
        btn.innerHTML = this.isMuted 
            ? `<i data-lucide="mic-off"></i> <span>Bật Mic</span>` 
            : `<i data-lucide="mic"></i> <span>Tắt Mic</span>`;
        if (this.isMuted) btn.classList.add('btn-danger');
        else btn.classList.remove('btn-danger');
        lucide.createIcons();
    },

    toggleVideo: function() {
        this.isVideoOff = !this.isVideoOff;
        if (this.localStream) {
            this.localStream.getVideoTracks().forEach(track => track.enabled = !this.isVideoOff);
        }
        const btn = document.getElementById('btn-video');
        btn.innerHTML = this.isVideoOff 
            ? `<i data-lucide="video-off"></i> <span>Bật Camera</span>` 
            : `<i data-lucide="video"></i> <span>Tắt Camera</span>`;
        if (this.isVideoOff) btn.classList.add('btn-danger');
        else btn.classList.remove('btn-danger');
        lucide.createIcons();
    },

    copyCode: function() {
        navigator.clipboard.writeText(this.roomId);
        alert("Đã sao chép mã phòng!");
    },

    copyActiveCode: function() {
        navigator.clipboard.writeText(this.roomId);
        alert("Đã sao chép mã phòng!");
    },

    updateStatus: function(msg) {
        const overlay = document.getElementById('connection-status');
        if (msg) {
            overlay.classList.remove('hidden');
            document.getElementById('status-text').textContent = msg;
        } else {
            overlay.classList.add('hidden');
        }
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => app.init());
