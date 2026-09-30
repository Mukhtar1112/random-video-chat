require('dotenv').config();
const supabase = require('./supabase');
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);


// ==============================
// SERVE WEBSITE
// ==============================

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


// ==============================
// WAITING USERS
// ==============================

let waitingUsers = [];


// ==============================
// REPORT STORAGE
// ==============================

const reportsFile = path.join(
    __dirname,
    "reports.json"
);

let reports = [];

try {

    if (fs.existsSync(reportsFile)) {

        const fileData =
            fs.readFileSync(
                reportsFile,
                "utf8"
            );

        reports =
            JSON.parse(fileData);

    }

} catch (error) {

    console.error(
        "Could not load reports:",
        error
    );

    reports = [];
}

// ==============================
// FIND PARTNER
// ==============================

function findPartner(socket) {

    // Remove this user if already waiting
    waitingUsers = waitingUsers.filter(
        id => id !== socket.id
    );


    // Remove disconnected users
    waitingUsers = waitingUsers.filter(
        id => io.sockets.sockets.has(id)
    );


    // Find someone waiting
    if (waitingUsers.length > 0) {

        const partnerId = waitingUsers.shift();

        const partnerSocket =
            io.sockets.sockets.get(partnerId);


        // Partner disappeared
        if (!partnerSocket) {

            return findPartner(socket);

        }


        // Save partner IDs
        socket.partnerId = partnerId;

        partnerSocket.partnerId = socket.id;


        // First user creates offer
        io.to(partnerId).emit(
            "matched",
            {
                partnerId: socket.id,
                createOffer: true
            }
        );


        // Second user waits for offer
        io.to(socket.id).emit(
            "matched",
            {
                partnerId: partnerId,
                createOffer: false
            }
        );


        console.log(
            "Matched:",
            partnerId,
            "<->",
            socket.id
        );


        return;
    }


    // Nobody available
    waitingUsers.push(socket.id);


    console.log(
        "User waiting:",
        socket.id
    );

}


// ==============================
// SOCKET CONNECTION
// ==============================

io.on("connection", (socket) => {

    console.log(
        "User connected:",
        socket.id
    );


    // ==============================
    // USER READY
    // ==============================

    socket.on("ready", () => {

        console.log(
            "User ready:",
            socket.id
        );

        findPartner(socket);

    });


    // ==============================
    // NEXT USER
    // ==============================

    socket.on("next", () => {

        console.log(
            "User wants next:",
            socket.id
        );


        // Remove user from waiting queue
        waitingUsers = waitingUsers.filter(
            id => id !== socket.id
        );


        // Remember current partner
        const oldPartnerId =
            socket.partnerId;


        // Clear this user's partner
        socket.partnerId = null;


        // Tell old partner
        if (oldPartnerId) {

            const oldPartner =
                io.sockets.sockets.get(
                    oldPartnerId
                );


            if (oldPartner) {

                // Clear old partner's connection
                oldPartner.partnerId = null;


                // Tell old partner
                io.to(oldPartnerId).emit(
                    "partner-left",
                    {
                        partnerId: socket.id
                    }
                );

            }

        }


        // Search for new partner
        setTimeout(() => {

            // Make sure user still exists
            if (
                !io.sockets.sockets.has(
                    socket.id
                )
            ) {
                return;
            }


            // Make sure user is not already matched
            if (socket.partnerId) {
                return;
            }


            findPartner(socket);

        }, 500);

    });


    // ==============================
    // REPORT USER
    // ==============================

     socket.on("report-user", async (data) => {

        const reportedUserId =
            socket.partnerId;

        if (!reportedUserId) {

            console.log(
                "Report ignored - no partner:",
                socket.id
            );

            return;
        }


        const reason =
            typeof data?.reason === "string"
                ? data.reason.trim()
                : "Other";


       // Save report to Supabase
try {

    const { data, error } = await supabase
        .from("reports")
        .insert([
            {
                reporter_id: socket.id,
                reported_user_id: reportedUserId,
                reason: reason
            }
        ])
        .select();

    if (error) {
        console.error("Could not save report to Supabase:", error);
        return;
    }

    console.log("USER REPORTED:", data);

} catch (error) {

    console.error(
        "Could not save report:",
        error
    );

}

        // End current connection
        const partnerSocket =
            io.sockets.sockets.get(
                reportedUserId
            );


        socket.partnerId = null;


        if (partnerSocket) {

            partnerSocket.partnerId = null;


            // Tell reported user that
            // the other user left
            io.to(reportedUserId).emit(
                "partner-left",
                {
                    partnerId: socket.id
                }
            );

        }


        // Confirm report to reporter
        io.to(socket.id).emit(
            "report-submitted"
        );

    });


    // ==============================
    // WEBRTC OFFER
    // ==============================

    socket.on("offer", (data) => {

        io.to(data.target).emit(
            "offer",
            {
                sender: socket.id,
                offer: data.offer
            }
        );

    });


    // ==============================
    // WEBRTC ANSWER
    // ==============================

    socket.on("answer", (data) => {

        io.to(data.target).emit(
            "answer",
            {
                sender: socket.id,
                answer: data.answer
            }
        );

    });


    // ==============================
    // ICE CANDIDATE
    // ==============================

    socket.on("ice-candidate", (data) => {

        io.to(data.target).emit(
            "ice-candidate",
            {
                sender: socket.id,
                candidate: data.candidate
            }
        );

    });


    // ==============================
    // USER DISCONNECT
    // ==============================

    socket.on("disconnect", () => {

        console.log(
            "User disconnected:",
            socket.id
        );


        // Remove from waiting queue
        waitingUsers = waitingUsers.filter(
            id => id !== socket.id
        );


        // Remember partner
        const partnerId =
            socket.partnerId;


        // Clear partner
        socket.partnerId = null;


        // Tell partner
        if (partnerId) {

            const partnerSocket =
                io.sockets.sockets.get(
                    partnerId
                );


            if (partnerSocket) {

                // Clear partner's connection
                partnerSocket.partnerId = null;


                // Tell partner user disconnected
                io.to(partnerId).emit(
                    "partner-left",
                    {
                        partnerId: socket.id
                    }
                );

            }

        }

    });

});


// ==============================
// START SERVER
// ==============================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log(
        `Server running at http://localhost:${PORT}`
    );

});