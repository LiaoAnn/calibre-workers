import { Hono } from 'hono';
import ping from './routes/ping';

const app = new Hono<{ Bindings: Env }>();

app.route('/ping', ping);

export default app;
