const socket = io();

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const nextButton = document.getElementById("nextButton");
const leaveButton = document.getElementById("leaveButton");
const status = document.getElementById("status");

const statusText = document.getElementById("statusText");
const loadingDots = document.getElementById("loadingDots");
const searchOverlay = document.getElementById("searchOverlay");

let localStream = null;
let peerConnection = null;
let partnerId = null;


// ==============================
// CAMERA + MICROPHONE
// ==============================

async function startCamera() {

    try {

        console.log("Requesting camera and microphone...");

        localStream =
            await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

        console.log("Camera and microphone ready.");

        // Show your own face
        localVideo.srcObject = localStream;

       statusText.textContent = "Finding stranger";
       status.className = "status searching";

       loadingDots.style.display = "inline-block";
       searchOverlay.classList.remove("hidden");
    
       // Tell server we are ready
        socket.emit("ready");

    } catch (error) {

        console.error("Camera error:", error);

        status.textContent = "● Camera permission required";
        status.className = "status searching";

        alert(
            "Camera and microphone access is required. Please allow permission and reload the page."
        );
    }
}


// ==============================
// MATCHED
// ==============================

socket.on("matched", async (data) => {

    console.log("Matched with:", data.partnerId);

    partnerId = data.partnerId;
    
    searchingForNext = false;

    nextButton.disabled = false;
    nextButton.textContent = "Next";

    statusText.textContent = "Connected";
    status.className = "status connected";

    loadingDots.style.display = "none";
    searchOverlay.classList.add("hidden");

    // Close old connection
    if (peerConnection) {

        peerConnection.close();

        peerConnection = null;
    }

    remoteVideo.srcObject = null;

    await createPeerConnection();

    // Only one person creates the offer
    if (data.createOffer) {

        console.log("Creating offer...");

        try {

            const offer =
                await peerConnection.createOffer();

            await peerConnection.setLocalDescription(
                offer
            );

            if (partnerId !== data.partnerId) {
                return;
            }

            socket.emit("offer", {
                target: data.partnerId,
                offer: offer
            });

        } catch (error) {

            console.error("Offer error:", error);

        }
    }
});


// ==============================
// RECEIVE OFFER
// ==============================

socket.on("offer", async (data) => {

    console.log("Offer received from:", data.sender);

    partnerId = data.sender;

    if (peerConnection) {

        peerConnection.close();

        peerConnection = null;
    }

    remoteVideo.srcObject = null;

    await createPeerConnection();

    try {

        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.offer)
        );

        const answer =
            await peerConnection.createAnswer();

        await peerConnection.setLocalDescription(
            answer
        );

        socket.emit("answer", {
            target: data.sender,
            answer: answer
        });

    } catch (error) {

        console.error("Offer handling error:", error);

    }
});


// ==============================
// RECEIVE ANSWER
// ==============================

socket.on("answer", async (data) => {

    console.log("Answer received.");

    if (data.sender !== partnerId) {

        console.log(
            "Ignoring answer from old partner."
        );

        return;
    }

    if (!peerConnection) {
        return;
    }

    try {

        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
        );

    } catch (error) {

        console.error("Answer error:", error);

    }
});


// ==============================
// RECEIVE ICE
// ==============================

socket.on("ice-candidate", async (data) => {

    if (data.sender !== partnerId) {

        console.log(
            "Ignoring ICE from old partner."
        );

        return;
    }

    if (!peerConnection) {
        return;
    }

    try {

        await peerConnection.addIceCandidate(
            new RTCIceCandidate(data.candidate)
        );

    } catch (error) {

        console.error("ICE error:", error);

    }
});


// ==============================
// CREATE WEBRTC CONNECTION
// ==============================

async function createPeerConnection() {

    if (!localStream) {

        console.error(
            "Local camera is not ready."
        );

        return;
    }

    try {

        const response = await fetch(
            "https://random-video-chat-app.metered.live/api/v1/turn/credentials?apiKey=5af54f486cf9b751a4a4442a642d76df25bf"
        );

        if (!response.ok) {

            throw new Error(
                "Could not get TURN credentials"
            );

        }

        const iceServers =
            await response.json();

        console.log(
            "TURN/ICE servers received."
        );

        peerConnection =
            new RTCPeerConnection({
                iceServers: iceServers
            });


        // Add our camera and microphone
        localStream.getTracks().forEach((track) => {

            peerConnection.addTrack(
                track,
                localStream
            );

        });


        // Receive stranger video/audio
        peerConnection.ontrack = (event) => {

            console.log(
                "Stranger video received."
            );

            remoteVideo.srcObject =
                event.streams[0];

        };


        // Send ICE candidates
        peerConnection.onicecandidate =
            (event) => {

                if (event.candidate && partnerId) {

                    socket.emit(
                        "ice-candidate",
                        {
                            target: partnerId,
                            candidate: event.candidate
                        }
                    );

                }

            };


        // Connection state
        peerConnection.onconnectionstatechange =
            () => {

                if (!peerConnection) {
                    return;
                }

                console.log(
                    "Connection:",
                    peerConnection.connectionState
                );

            };

    } catch (error) {

        console.error(
            "TURN server error:",
            error
        );

    }

}
// ==============================
// REPORT
// ==============================

const reportButton =
    document.getElementById("reportButton");

const reportModal =
    document.getElementById("reportModal");

const cancelReport =
    document.getElementById("cancelReport");

const submitReport =
    document.getElementById("submitReport");


// Open report popup
reportButton.addEventListener("click", () => {

    // Don't allow report when there is
    // no stranger connected
    if (!partnerId) {

        alert(
            "There is no stranger to report."
        );

        return;
    }

    reportModal.classList.add("show");

});


// Cancel report
cancelReport.addEventListener("click", () => {

    reportModal.classList.remove("show");

});


// Submit report
submitReport.addEventListener("click", () => {

    if (!partnerId) {

        reportModal.classList.remove("show");

        return;
    }


    // Find selected reason
    const selectedReason =
        document.querySelector(
            'input[name="reportReason"]:checked'
        );


    if (!selectedReason) {

        alert(
            "Please select a reason."
        );

        return;
    }


    const reason =
        selectedReason.value;


    console.log(
        "Reporting stranger:",
        reason
    );


    // Send report to server
    socket.emit(
        "report-user",
        {
            reason: reason
        }
    );


    // Close popup
    reportModal.classList.remove("show");

});


// Report successfully submitted
socket.on("report-submitted", () => {

    console.log(
        "Report submitted successfully."
    );


    // Close current connection
    if (peerConnection) {

        peerConnection.onconnectionstatechange = null;

        peerConnection.close();

        peerConnection = null;

    }


    // Remove stranger video
    remoteVideo.srcObject = null;


    // Clear partner
    partnerId = null;


    // Show searching status
    statusText.textContent =
        "Finding stranger";

    status.className =
        "status searching";

    loadingDots.style.display =
        "inline-block";

    searchOverlay.classList.remove(
        "hidden"
    );


    // Start looking for another stranger
    if (!searchingForNext) {

        searchingForNext = true;

        nextButton.disabled = true;

        nextButton.textContent =
            "Finding...";

        socket.emit("next");

    }

});
// ==============================
// NEXT
// ==============================

let searchingForNext = false;

nextButton.addEventListener("click", () => {

    // Prevent double-clicks
    if (searchingForNext) {
        return;
    }

    console.log(
        "Looking for next stranger..."
    );

    searchingForNext = true;

    nextButton.disabled = true;
    nextButton.textContent = "Finding...";

    statusText.textContent = "Finding stranger";
    status.className = "status searching";

    loadingDots.style.display = "inline-block";
    searchOverlay.classList.remove("hidden");


    // Close current WebRTC connection
    if (peerConnection) {

        peerConnection.onconnectionstatechange = null;

        peerConnection.close();

        peerConnection = null;
    }


    // Remove stranger video
    remoteVideo.srcObject = null;


    // Clear current partner
    partnerId = null;


    // Tell server
    socket.emit("next");

});


// ==============================
// PARTNER LEFT
// ==============================

socket.on("partner-left", (data) => {

    console.log(
        "Stranger left:",
        data.partnerId
    );


    // Ignore messages from an old partner
    if (
        partnerId &&
        partnerId !== data.partnerId
    ) {

        console.log(
            "Ignoring old partner-left."
        );

        return;
    }


    // Close old WebRTC connection
    if (peerConnection) {

        peerConnection.onconnectionstatechange = null;

        peerConnection.close();

        peerConnection = null;
    }


    // Clear stranger video
    remoteVideo.srcObject = null;


    // Clear partner
    partnerId = null;


// Show searching
    statusText.textContent = "Finding stranger";

    status.className = "status searching";

    loadingDots.style.display = "inline-block";

    searchOverlay.classList.remove("hidden");

    // If we are already searching,
    // don't send another request.
    if (searchingForNext) {
        return;
    }


    searchingForNext = true;

    // Automatically find another stranger
    socket.emit("next");

});

// ==============================
// LEAVE
// ==============================

leaveButton.addEventListener("click", () => {

    console.log("Leaving chat...");

    if (peerConnection) {

        peerConnection.close();

        peerConnection = null;
    }

    if (localStream) {

        localStream.getTracks().forEach(
            track => track.stop()
        );

        localStream = null;
    }

    localVideo.srcObject = null;
    remoteVideo.srcObject = null;

    partnerId = null;

    status.textContent = "● Left";
    status.className = "status";

    socket.disconnect();

});


// ==============================
// START AUTOMATICALLY
// ==============================

startCamera();