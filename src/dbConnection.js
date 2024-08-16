import 'dotenv/config';
import { createClient } from 'redis';

let redisClient;

export const connectRedis = async () => {
    try {
        redisClient = createClient({
            url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
            password: process.env.REDIS_PASSWORD
        });
        redisClient.on('error', (err) => console.log('Redis Client Error', err));
        await redisClient.connect();
        console.log('Connected to Redis');
    } catch (err) {
        console.error('Error connecting to Redis:', err);
    }
};

export const getRedisClient = () => {
    if (!redisClient) {
        connectRedis();
        // throw new Error('Redis client is not initialized. Call connectRedis first.');
    }
    return redisClient;
};


export const initialize = async () => {
    try {
        await connectRedis(); // Connect to Redis
        console.log('Application initialized successfully');

        // Start your server or application logic here
        // import and use your server configuration, routes, etc.
    } catch (err) {
        console.error('Error during initialization:', err);
        process.exit(1); // Exit the process if initialization fails
    }
};


