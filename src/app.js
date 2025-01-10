import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { initialize } from "./dbConnection.js";
import 'dotenv/config'
import { getTokens, sendPushNotification } from "./sendNotification.js";
import morgan from "morgan";
import helmet from "helmet";
import axios from "axios";

initialize();
const app = express();
app.use(morgan(':date[web] :method :url :status :res[content-length] - :response-time ms'));
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", "data:", "https://lh3.googleusercontent.com", "https://res.cloudinary.com", "https://icon-library.com/", "https://flagcdn.com/", "blob:"], // Added "blob:"
    connectSrc: ["'self'", "https://ipapi.co", "blob:"], // Allow blob URLs for workers
    scriptSrc: ["'self'", "https://accounts.google.com", "https://cdnjs.cloudflare.com"],
    workerSrc: ["'self'", "blob:"], // Add worker-src directive
  },
}));
// Adding missing security headers
app.use(helmet.frameguard({ action: 'sameorigin' }));
app.use(helmet.noSniff());
app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));
app.use(helmet.permittedCrossDomainPolicies({ permittedPolicies: 'none' }));
app.get('/', (req, res) => res.send("socket server running"));


const server = createServer(app);

const pubClient = createClient({ host: 'localhost', port: 6379, password: process.env.REDIS_PASSWORD });
const subClient = pubClient.duplicate();
await Promise.all([
  pubClient.connect(),
  subClient.connect()
]);

const io = new Server(server, {
  transports: ['websocket'],
  cors: {
    origin: "*",
    credentials: true,
  },
});
io.adapter(createAdapter(pubClient, subClient));
io.use((socket, next) => {
  next();
});
io.on('connection', function (socket) {
  const userId = socket.handshake.query.userId;
  console.log("user connected joining", userId);
  userId ? socket.join(userId) : null;
  // socket.on('connected', () => {

  // })
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
  // socket.on('join', (profile) => {
  //   socket.join(profile._id);
  //   console.log(profile.firstName + " joined");
  // })
  socket.on('trigger', async (triggerObject) => {
    try {
      console.log(triggerObject.action, triggerObject.sender.firstName);
      //console.log("all rooms",io.sockets.adapter.rooms);
      var activityList = [];
      let offlineUsers = [];
      //let virtualBot = triggerObject.recievers.find((reciever) => reciever.role == "Virtual_Assistant")
      // Check each receiver's online status
      for (var i = 0; i < triggerObject.recievers.length; i++) {
        let recieverConnections = await io.in(triggerObject.recievers[i]._id).fetchSockets();
        console.log("recievers",recieverConnections.length);
        var isOnline = triggerObject.recievers[i].role == "Virtual_Assistant" ? true : recieverConnections.length != 0
        if (isOnline) {
          console.log(triggerObject.recievers[i].firstName," is online");
          // User is online
          if (triggerObject.action == "ping") {
            //console.log("updating activity user online")
            activityList = [...activityList, ({ ...triggerObject.recievers[i], activity: 'online' })];
          }
          //identify ai agent
          if (triggerObject.recievers[i].role == "Virtual_Assistant") {
            if (triggerObject.action == "send") {
              //handle request
              socket.emit('trigger', {
                sender: triggerObject.recievers[i],
                action: "typing",
                data: "start"
              });
              const response = await axios.post("https://campusroot.com/api/v1/communication/assistant-chat", {
                "content": triggerObject.data.message.content,
                "chatId": triggerObject.data.chat._id

              })
              socket.emit('trigger', { sender: triggerObject.recievers[i], action: "typing", data: "stop" });
              socket.emit('trigger', { sender: triggerObject.recievers[i], action: "send", data: response.data.data });
            }
          }
          else {
            io.to(triggerObject.recievers[i]._id).emit('trigger', {
              sender: triggerObject.sender,
              action: triggerObject.action,
              data: triggerObject.data
            })
          }
          //onlineUsers.push(reciever._id); // Collect online users
        } else {
          // User is offline
          console.log(triggerObject.recievers[i].firstName," is offline");
          if (triggerObject.action == "ping") {
            activityList = [...activityList, ({ ...triggerObject.recievers[i], activity: 'offline' })];
            //console.log("updating activity user offline",activityList)
            //activityList.push({ ...reciever, activity: 'offline' });
          }
          offlineUsers.push(triggerObject.recievers[i]._id); // Collect offline users
        }
      }

      // Handle offline users
      if (offlineUsers.length > 0 && triggerObject.action === "send") {
        console.log("offlineUsers:" + offlineUsers.length);
        let Tokens = await getTokens(offlineUsers);
        const message = {
          notification: {
            title: 'Test Notification',
            body: 'This is a test notification from your Express server!',
            data: { someData: "ustad hotel" }
          },
          tokens: Tokens
        };
        if (Tokens.length > 0) {
          if (await sendPushNotification(message)) console.log("push notifications sent");
        }
      }

      // Emit activity list back to the triggering user
      if (triggerObject.action === "ping") {
        socket.emit('trigger', { sender: null, action: "activityList", data: activityList });
      }
    } catch (error) {
      console.log(error)
    }
  });
});
//   socket.on('trigger', async (triggerObject) => {
//     try {
//       console.log(triggerObject.action, triggerObject.sender.firstName);
//       console.log("all rooms",io.sockets.adapter.rooms);
//       var activityList = [];
//       let offlineUsers = [];
//       // console.log(triggerObject);
//       triggerObject.recievers.forEach(reciever => {
//         var online = io.sockets.adapter.rooms.get(reciever._id);
//         console.log("reciever", reciever._id, reciever.firstName, online ? "online" : "offline");
//         if (online) {
//           if (triggerObject.action == "ping") {
//             activityList.push({ ...reciever, activity: 'online' });
//           }
//           socket.broadcast.to(reciever._id).emit('trigger', { sender: triggerObject.sender, action: triggerObject.action, data: triggerObject.data });
//         }
//         else {
//           if (triggerObject.action == "ping") {
//             activityList.push({ ...reciever, activity: 'offline' });
//             offlineUsers.push(reciever._id);
//           }
//         }
//       });
//       if (offlineUsers.length > 0) {
//         console.log("offlineUsers:" + offlineUsers.length);
//         let Tokens = await getTokens(offlineUsers)
//         console.log(Tokens);
//         const message = {
//           notification: {
//             title: 'Test Notification',
//             body: 'This is a test notification from your Express server!',
//             data: { someData: "ustad hotel" }
//           },
//           tokens: Tokens
//         };
//         if (Tokens.length > 0) {
//           if (await sendPushNotification(message)) console.log("push notifications sent");
//         }
//       }
//       if (triggerObject.action == "ping") {
//         socket.emit('trigger', { sender: null, action: "activityList", data: activityList });
//       }
//     } catch (error) {
//       console.log(error);

//     }

//   });
// });


const port = process.env.PORT
server.listen(port, () => console.log("Server Running on " + `${port}`));
