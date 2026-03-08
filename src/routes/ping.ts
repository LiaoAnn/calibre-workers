import { Hono } from 'hono';

const app = new Hono().get('/', c => c.json('pong'));

export default app;
