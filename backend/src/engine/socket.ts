import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { checkAccess, isAllowedOrigin } from '../security/access.js';

let ioInstance: Server | null = null;

export function initIo(server: HttpServer) {
  ioInstance = new Server(server, {
    cors: {
      origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),
      credentials: true,
      methods: ['GET', 'POST']
    },
    // Same rules as the HTTP API: live progress and console output are as private as the API itself
    allowRequest: (req, callback) => {
      const decision = checkAccess({
        remoteAddress: req.socket.remoteAddress,
        host: req.headers.host,
        origin: req.headers.origin,
        cookie: req.headers.cookie,
        authorization: req.headers.authorization,
        headers: req.headers,
      });
      callback(decision.ok ? null : decision.code, decision.ok);
    },
  });

  ioInstance.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return ioInstance;
}

export function getIo(): Server {
  if (!ioInstance) {
    throw new Error('Socket.io not initialized. Call initIo first.');
  }
  return ioInstance;
}
