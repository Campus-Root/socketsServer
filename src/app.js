import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
app.get('/', (req, res) => res.send("socket server running"));
const server = createServer(app);
// import { getTokens, sendPushNotification } from "./utils/sendNotification.js";
const whitelist = ["*"]
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin || whitelist.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  },
}); // Initialize Socket.IO
io.use((socket, next) => {
  next();
});
// Socket.IO event handlers
io.on('connection', function (socket) {
  console.log("new user connected");
  socket.on('connected', () => {

  })

  socket.on('disconnected', ({ personalroomid, friends }) => {
    friends.forEach(element => {
      socket.broadcast.to(element[0]).emit('disconnected', { user: personalroomid, status: 'offline' });
    });
  })
  socket.on('join', (profile) => {
    socket.join(profile._id);
    console.log(profile.firstName + " joined");
  })
  socket.on('trigger', (triggerObject) => {
    console.log(triggerObject.action, triggerObject.sender.firstName);
    var activityList = [];
    let offlineUsers = [];
    console.log(triggerObject);
    triggerObject.recievers.forEach(reciever => {
      var online = io.sockets.adapter.rooms.get(reciever._id);
      console.log("reciever", reciever.firstName, online ? "online" : "offline");
      if (online) {
        if (triggerObject.action == "ping") {
          activityList.push({ ...reciever, activity: 'online' });
        }
        socket.broadcast.to(reciever._id).emit('trigger', { sender: triggerObject.sender, action: triggerObject.action, data: triggerObject.data });
      }
      else {
        if (triggerObject.action == "ping") {
          activityList.push({ ...reciever, activity: 'offline' });
          offlineUsers.push(reciever._id);
        }
      }
    });
    if (offlineUsers.length > 0) {
      console.log("offlineUsers:" + offlineUsers.length);

      // const message = {
      //   notification: {
      //     title: 'Test Notification',
      //     body: 'This is a test notification from your Express server!',
      //     data: { someData: "ustad hotel" }
      //   },
      //   tokens: getTokens(offlineUsers)
      // };
      // if (sendPushNotification(message)) console.log("push notifications sent");;
    }
    if (triggerObject.action == "ping") {
      socket.emit('trigger', { sender: null, action: "activityList", data: activityList });
    }
  });
});


const port = 1236
server.listen(port, () => console.log("Server Running on " + `${port}`));