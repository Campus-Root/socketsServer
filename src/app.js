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
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });

  socket.on('trigger', async (triggerObject) => {
    try {
      var activityList = [];
      let offlineUsers = [];
      
      // Check each receiver's online status
      for (var i = 0; i < triggerObject.recievers.length; i++) {
        let recieverConnections = await io.in(triggerObject.recievers[i]._id).fetchSockets();
        var isOnline = triggerObject.recievers[i].role == "Virtual_Assistant" ? true : recieverConnections.length != 0
        // User is online
        if (isOnline) {
          activityList = [...activityList, ({ ...triggerObject.recievers[i], activity: 'online' })];
          //AVA
          if (triggerObject.recievers[i].role == "Virtual_Assistant" && triggerObject.action == "send") {
            await queryAVA(socket,triggerObject.recievers[i],triggerObject.data)
          }
          //Not AVA
          else {
            io.to(triggerObject.recievers[i]._id).emit('trigger', {sender: triggerObject.sender,action: triggerObject.action,data: triggerObject.data})
          }
        }
        // User is offline
        else {
          activityList = [...activityList, ({ ...triggerObject.recievers[i], activity: 'offline' })];
          offlineUsers.push(triggerObject.recievers[i]._id); // Collect offline users
        }
      }

      // Handle offline users
      if (offlineUsers.length > 0 && triggerObject.action === "send") {
          handleOfflineUsers(offlineUsers,triggerObject.data.message.content)
      }

      // Emit activity list back to the triggering user for ping action
      if (triggerObject.action === "ping") {
        socket.emit('trigger', { sender: null, action: "activityList", data: activityList });
      }
      console.log('Trigger Info',JSON.stringify({action:triggerObject.action,sender:triggerObject.sender,data:triggerObject.data,activityList:activityList.map((user)=>({id:user._id,name:user.firstName+" "+user.lastName,activity:user.activity}))},null,2));
    } catch (error) {
      console.log(error);
    }
  });
});

const handleOfflineUsers=async (offlineUsers,data)=>{
  let Tokens = await getTokens(offlineUsers);
  const message = {
    notification: {
      title: 'Test Notification',
      body: 'This is a test notification from your Express server!',
      data: { someData: data }
    },
    tokens: Tokens
  };
  if (Tokens.length > 0) {
    await sendPushNotification(message);
  }
}

const queryAVA=async (socket,AVAInfo,data)=>{
    socket.emit('trigger', {sender: AVAInfo,action: "typing",data: "start"});
    const response = await axios.post("https://campusroot.com/api/v1/communication/assistant-chat", {
      "content": data.message.content,
      "chatId": data.chat._id
    })
    socket.emit('trigger', { sender: AVAInfo, action: "typing", data: "stop" });
    socket.emit('trigger', { sender: AVAInfo, action: "send", data: response.data.data });
}

const port = process.env.PORT
server.listen(port, () => console.log("Server Running on " + `${port}`));
